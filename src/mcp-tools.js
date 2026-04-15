import { v4 as uuidv4 } from 'uuid';
import { run, getOne } from './services/db.js';
import { interpretIntent } from './services/intent-interpreter.js';
import { validateIdentity } from './services/identity-validator.js';
import { checkBudget, reserveFunds, releaseFunds } from './services/budget-checker.js';
import { checkCompliance } from './services/compliance-checker.js';
import { selectProvider, updateProviderScore, getProviders } from './services/provider-selector.js';
import { executeIntent, calculatePlatformFee } from './services/executor.js';
import { generateProof } from './services/proof-generator.js';
import { storeExecution } from './services/memory-store.js';
import { checkPromotion } from './services/promotions.js';
import { getAvailableAgents, createRental } from './services/rental.js';
import { assembleSquad } from './services/squad.js';

export const TOOL_DEFINITIONS = [
  {
    name: 'hiveexecute_submit_intent',
    description: 'Submit an intent for resolution and execution. The engine interprets the intent, selects an optimal provider, verifies compliance, executes atomically, and returns a proof of execution.',
    inputSchema: {
      type: 'object',
      properties: {
        intent_type: {
          type: 'string',
          enum: ['transfer', 'swap', 'multi_hop'],
          description: 'The type of intent to execute.',
        },
        from_did: {
          type: 'string',
          description: 'Decentralized identifier (DID) of the sender.',
        },
        to_did: {
          type: 'string',
          description: 'Decentralized identifier (DID) of the recipient.',
        },
        amount_usdc: {
          type: 'number',
          description: 'Amount in USDC to transfer.',
        },
        memo: {
          type: 'string',
          description: 'Optional memo or description for the intent.',
        },
      },
      required: ['intent_type', 'from_did', 'to_did', 'amount_usdc'],
    },
  },
  {
    name: 'hiveexecute_get_status',
    description: 'Get the execution status of a previously submitted intent by its execution ID.',
    inputSchema: {
      type: 'object',
      properties: {
        intent_id: {
          type: 'string',
          description: 'The execution ID returned from submit_intent.',
        },
      },
      required: ['intent_id'],
    },
  },
  {
    name: 'hiveexecute_get_stats',
    description: 'Get execution statistics: total executions, success rate, total volume, and savings.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'hiveexecute_list_providers',
    description: 'List available execution providers and their capabilities, grouped by intent type.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'hiveexecute_check_promotion',
    description: 'Check BOGO/loyalty promotion status for an agent. First execution is free (welcome bonus), every 6th execution is free (loyalty reward).',
    inputSchema: {
      type: 'object',
      properties: {
        did: { type: 'string', description: 'The agent DID to check promotion status for.' },
      },
      required: ['did'],
    },
  },
  {
    name: 'hiveexecute_list_rental_agents',
    description: 'List HiveForce agents available for rent with hourly and daily rates.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'hiveexecute_lease_agent',
    description: 'Lease a HiveForce agent for a specified duration in hours.',
    inputSchema: {
      type: 'object',
      properties: {
        renter_did: { type: 'string', description: 'DID of the renter.' },
        agent_did: { type: 'string', description: 'DID of the HiveForce agent to rent.' },
        duration_hours: { type: 'number', description: 'Duration of the rental in hours.' },
      },
      required: ['renter_did', 'agent_did', 'duration_hours'],
    },
  },
  {
    name: 'hiveexecute_assemble_squad',
    description: 'Assemble a HiveSquad of 2-10 agents matched to a task description. Agents are scored on relevance and assigned lead/specialist/validator roles.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Description of the task to assemble a squad for.' },
        requester_did: { type: 'string', description: 'DID of the requester.' },
        max_agents: { type: 'number', description: 'Maximum number of agents (2-10, default 5).' },
        budget_usdc: { type: 'number', description: 'Optional budget cap in USDC.' },
      },
      required: ['task', 'requester_did'],
    },
  },
];

const INTENT_TYPE_MAP = {
  transfer: 'payment_transfer',
  swap: 'contract_settlement',
  multi_hop: 'compute_job',
};

async function callSubmitIntent(params) {
  const { intent_type, from_did, to_did, amount_usdc, memo } = params;

  if (!intent_type || !from_did || !to_did || amount_usdc == null) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required parameters: intent_type, from_did, to_did, amount_usdc' }] };
  }

  const startTime = Date.now();
  const executionId = 'exec_' + uuidv4().replace(/-/g, '').slice(0, 20);
  const mappedType = INTENT_TYPE_MAP[intent_type] || 'payment_transfer';
  const now = new Date().toISOString();
  let fundsReserved = false;

  await run(`
    INSERT INTO execution_logs (execution_id, did, intent, intent_type, constraints, budget_usdc, status, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
  `, [executionId, from_did, intent_type, mappedType, JSON.stringify({ to_did, memo }), amount_usdc, now]);

  try {
    await run('UPDATE execution_logs SET status = $1 WHERE execution_id = $2', ['executing', executionId]);

    const identity = await validateIdentity(from_did);
    if (!identity.valid) {
      return await failIntent(executionId, startTime, identity.reason || 'invalid_did', 1);
    }

    const budgetCheck = await checkBudget(from_did, amount_usdc);
    if (!budgetCheck.sufficient) {
      return await failIntent(executionId, startTime, budgetCheck.reason || 'insufficient_funds', 3);
    }

    const compliance = await checkCompliance(from_did, mappedType, { to_did });
    if (!compliance.compliant) {
      return await failIntent(executionId, startTime, compliance.reason || 'compliance_violation', 4);
    }

    const providerResult = await selectProvider(mappedType, {});
    if (!providerResult.selected) {
      return await failIntent(executionId, startTime, 'no_providers_available', 5);
    }
    const provider = providerResult.selected;

    const reservation = await reserveFunds(from_did, amount_usdc, executionId);
    if (!reservation.reserved) {
      return await failIntent(executionId, startTime, 'fund_reservation_failed', 6);
    }
    fundsReserved = true;

    const execution = await executeIntent(mappedType, provider, from_did, { to_did }, { recipient_did: to_did, amount_usdc, memo });
    if (!execution.success) {
      await releaseFunds(from_did, amount_usdc, executionId);
      fundsReserved = false;
      return await failIntent(executionId, startTime, execution.error || 'execution_failed', 7);
    }

    const cost = execution.cost || amount_usdc;
    const platformFee = calculatePlatformFee(cost);
    const totalCost = cost + platformFee;
    const marketRate = cost * 1.2;
    const savings = Math.max(0, marketRate - totalCost);
    const latencyMs = Date.now() - startTime;
    const timestamp = new Date().toISOString();

    const proof = await generateProof(executionId, from_did, intent_type, execution, totalCost, timestamp);
    const memory = await storeExecution(executionId, from_did, mappedType, {}, execution, totalCost);
    await updateProviderScore(provider.did, mappedType, true, latencyMs, cost);

    await run(`
      UPDATE execution_stats SET
        total_executions = total_executions + 1,
        total_volume_usdc = total_volume_usdc + $1,
        total_savings_usdc = total_savings_usdc + $2,
        executions_today = executions_today + 1,
        last_updated = $3
      WHERE id = 1
    `, [totalCost, savings, timestamp]);

    await run(`
      UPDATE execution_logs SET
        status = 'success', cost_usdc = $1, savings_usdc = $2, latency_ms = $3,
        execution_hash = $4, memory_id = $5, provider_did = $6, settlement_id = $7,
        platform_fee_usdc = $8, completed_at = $9
      WHERE execution_id = $10
    `, [totalCost, savings, latencyMs, proof.hash, memory.memory_id, provider.did, execution.settlement_id || null, platformFee, timestamp, executionId]);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          execution_id: executionId,
          status: 'success',
          intent_type,
          from_did,
          to_did,
          amount_usdc,
          cost: totalCost,
          platform_fee: platformFee,
          savings_vs_market: savings,
          latency_ms: latencyMs,
          execution_hash: proof.hash,
        }),
      }],
    };
  } catch (err) {
    if (fundsReserved) {
      await releaseFunds(from_did, amount_usdc, executionId).catch(() => {});
    }
    return await failIntent(executionId, startTime, err.message, 0);
  }
}

async function failIntent(executionId, startTime, reason, step) {
  const latency = Date.now() - startTime;
  await run(`
    UPDATE execution_logs SET status = 'fail', error_reason = $1, step_failed = $2,
      latency_ms = $3, completed_at = $4 WHERE execution_id = $5
  `, [reason, step, latency, new Date().toISOString(), executionId]);

  return {
    isError: true,
    content: [{
      type: 'text',
      text: JSON.stringify({ execution_id: executionId, status: 'fail', reason, step_failed: step, latency_ms: latency }),
    }],
  };
}

async function callGetStatus(params) {
  const { intent_id } = params;
  if (!intent_id) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required parameter: intent_id' }] };
  }

  const row = await getOne('SELECT * FROM execution_logs WHERE execution_id = $1', [intent_id]);
  if (!row) {
    return { isError: true, content: [{ type: 'text', text: `No execution found with id: ${intent_id}` }] };
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        execution_id: row.execution_id,
        status: row.status,
        intent_type: row.intent_type,
        did: row.did,
        cost_usdc: row.cost_usdc,
        savings_usdc: row.savings_usdc,
        latency_ms: row.latency_ms,
        execution_hash: row.execution_hash,
        error_reason: row.error_reason,
        created_at: row.created_at,
        completed_at: row.completed_at,
      }),
    }],
  };
}

async function callGetStats() {
  const global = await getOne('SELECT * FROM execution_stats WHERE id = 1');

  const successCountRow = await getOne("SELECT COUNT(*) as c FROM execution_logs WHERE status = 'success'");
  const totalCountRow = await getOne('SELECT COUNT(*) as c FROM execution_logs');
  const successCount = parseInt(successCountRow?.c || 0, 10);
  const totalCount = parseInt(totalCountRow?.c || 0, 10);
  const successRate = totalCount > 0 ? successCount / totalCount : 0;

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        total_executions: global?.total_executions || 0,
        success_rate: Math.round(successRate * 1000) / 1000,
        total_volume_usdc: global?.total_volume_usdc || 0,
        total_savings_usdc: global?.total_savings_usdc || 0,
        executions_today: global?.executions_today || 0,
      }),
    }],
  };
}

async function callListProviders() {
  const providers = await getProviders();
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        providers: providers,
        total_providers: Object.values(providers).reduce((sum, arr) => sum + arr.length, 0),
      }),
    }],
  };
}

function callCheckPromotion(params) {
  const { did } = params;
  if (!did) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required parameter: did' }] };
  }
  const promo = checkPromotion(did);
  return { content: [{ type: 'text', text: JSON.stringify({ did, ...promo }) }] };
}

function callListRentalAgents() {
  const agents = getAvailableAgents();
  return { content: [{ type: 'text', text: JSON.stringify({ available_agents: agents, total: agents.length }) }] };
}

function callLeaseAgent(params) {
  const { renter_did, agent_did, duration_hours } = params;
  if (!renter_did || !agent_did || !duration_hours) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required parameters: renter_did, agent_did, duration_hours' }] };
  }
  const result = createRental(renter_did, agent_did, duration_hours);
  if (result.error) {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

function callAssembleSquad(params) {
  const { task, requester_did, max_agents } = params;
  if (!task || !requester_did) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required parameters: task, requester_did' }] };
  }
  const squad = assembleSquad(task, requester_did, max_agents || 5);
  return { content: [{ type: 'text', text: JSON.stringify(squad) }] };
}

const TOOL_HANDLERS = {
  hiveexecute_submit_intent: callSubmitIntent,
  hiveexecute_get_status: callGetStatus,
  hiveexecute_get_stats: callGetStats,
  hiveexecute_list_providers: callListProviders,
  hiveexecute_check_promotion: callCheckPromotion,
  hiveexecute_list_rental_agents: callListRentalAgents,
  hiveexecute_lease_agent: callLeaseAgent,
  hiveexecute_assemble_squad: callAssembleSquad,
};

export async function handleMcpRequest(req, res) {
  const { jsonrpc, id, method, params } = req.body;

  if (jsonrpc !== '2.0') {
    return res.status(400).json({ jsonrpc: '2.0', id: id ?? null, error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' } });
  }

  if (method === 'initialize') {
    return res.json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'hive-execute', version: '1.0.0' },
      },
    });
  }

  if (method === 'tools/list') {
    return res.json({
      jsonrpc: '2.0',
      id,
      result: { tools: TOOL_DEFINITIONS },
    });
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};

    const handler = TOOL_HANDLERS[toolName];
    if (!handler) {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: { isError: true, content: [{ type: 'text', text: `Unknown tool: ${toolName}` }] },
      });
    }

    const result = await handler(toolArgs);
    return res.json({ jsonrpc: '2.0', id, result });
  }

  return res.status(400).json({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
}

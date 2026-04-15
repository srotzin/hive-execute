import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { run } from '../services/db.js';
import { requirePayment } from '../middleware/auth.js';
import {
  createFastLane,
  getFastLanesForAgent,
  getFastLane,
  deactivateFastLane,
  findMatchingFastLane,
  recordFastLaneExecution,
  getTotalFastLaneExecutions,
} from '../services/fast-lanes.js';
import { interpretIntent } from '../services/intent-interpreter.js';
import { checkBudget } from '../services/budget-checker.js';
import { executeIntent, calculatePlatformFee } from '../services/executor.js';
import { selectProvider } from '../services/provider-selector.js';
import { generateProof } from '../services/proof-generator.js';
import { storeExecution } from '../services/memory-store.js';
import { updateProviderScore } from '../services/provider-selector.js';

// Map shorthand intent type names to canonical types (same as execute route)
function resolveIntentType(type) {
  const t = (type || '').toLowerCase().trim();
  if (['transfer', 'pay', 'send', 'payment', 'payment_transfer'].includes(t)) return 'payment_transfer';
  if (['settle', 'settlement', 'contract', 'contract_settlement'].includes(t)) return 'contract_settlement';
  if (['compute', 'compute_job', 'run', 'execute'].includes(t)) return 'compute_job';
  return null;
}

const router = Router();

// POST /v1/execute_intent/fast-lane/register — Create a pre-approved fast lane
router.post('/v1/execute_intent/fast-lane/register', requirePayment('execute_intent'), async (req, res) => {
  const { did, intent_type, parameters_template, max_amount_usdc, valid_hours } = req.body;

  if (!did || !intent_type) {
    return res.status(400).json({ error: 'missing_required_fields', details: 'did and intent_type are required' });
  }

  const canonicalType = resolveIntentType(intent_type);
  if (!canonicalType) {
    return res.status(400).json({ error: 'invalid_intent_type', details: `Unrecognized intent type: ${intent_type}` });
  }

  if (!max_amount_usdc || max_amount_usdc <= 0) {
    return res.status(400).json({ error: 'invalid_max_amount', details: 'max_amount_usdc must be a positive number' });
  }

  const lane = await createFastLane(
    did,
    canonicalType,
    parameters_template || {},
    max_amount_usdc,
    valid_hours || 720,
    false
  );

  return res.json({
    lane_id: lane.lane_id,
    valid_until: lane.valid_until,
    status: 'active',
  });
});

// GET /v1/execute_intent/fast-lane/:did — List all active fast lanes for an agent
router.get('/v1/execute_intent/fast-lane/:did', requirePayment('stats'), async (req, res) => {
  const { did } = req.params;
  const lanes = await getFastLanesForAgent(did);
  const agentStats = await getTotalFastLaneExecutions(did);

  return res.json({
    lanes,
    total_executions_via_fast_lane: agentStats.total_executions_via_fast_lane,
    total_savings: agentStats.total_savings,
  });
});

// DELETE /v1/execute_intent/fast-lane/:lane_id — Deactivate a fast lane
router.delete('/v1/execute_intent/fast-lane/:lane_id', requirePayment('stats'), async (req, res) => {
  const { lane_id } = req.params;
  const lane = await deactivateFastLane(lane_id);

  if (!lane) {
    return res.status(404).json({ error: 'lane_not_found', details: `Fast lane ${lane_id} not found or already deactivated` });
  }

  return res.json({
    lane_id: lane.lane_id,
    status: 'deactivated',
    executions_completed: lane.execution_count,
  });
});

// POST /v1/execute_intent/fast-lane/:lane_id/execute — Execute through a fast lane
router.post('/v1/execute_intent/fast-lane/:lane_id/execute', requirePayment('execute_intent'), async (req, res) => {
  const startTime = Date.now();
  const executionId = 'exec_' + uuidv4().replace(/-/g, '').slice(0, 20);
  const { lane_id } = req.params;
  const { did, intent, constraints, metadata } = req.body;
  const budget = req.body.budget || (typeof intent === 'object' ? intent.amount_usdc : undefined);

  // Validate input
  if (!did) {
    return res.status(400).json({ error: 'missing_required_fields', details: 'did is required' });
  }

  // Validate the fast lane exists and belongs to this agent
  const lane = await getFastLane(lane_id);
  if (!lane) {
    return res.status(404).json({ error: 'lane_not_found', details: `Fast lane ${lane_id} not found` });
  }

  if (lane.agent_did !== did) {
    return res.status(403).json({ error: 'lane_ownership_mismatch', details: 'This fast lane does not belong to the requesting agent' });
  }

  // Check lane not expired
  if (new Date(lane.valid_until) <= new Date()) {
    return res.status(410).json({ error: 'lane_expired', details: `Fast lane expired at ${lane.valid_until}` });
  }

  // Check amount within max
  const amount = budget || 0;
  if (amount > lane.max_amount_usdc) {
    return res.status(400).json({
      error: 'amount_exceeds_lane_limit',
      details: `Amount ${amount} exceeds fast lane max of ${lane.max_amount_usdc} USDC`,
    });
  }

  const intentString = typeof intent === 'string' ? intent : JSON.stringify(intent || lane.intent_type);
  const intentType = lane.intent_type;
  const now = new Date().toISOString();

  // Create log entry
  await run(`
    INSERT INTO execution_logs (execution_id, did, intent, intent_type, constraints, budget_usdc, status, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
  `, [executionId, did, intentString, intentType, JSON.stringify(constraints || {}), budget || 0, now]);

  try {
    // Fast lane path: skip compliance, skip negotiation — only check budget
    const budgetCheck = await checkBudget(did, budget || 0);
    if (!budgetCheck.sufficient) {
      const latency = Date.now() - startTime;
      await run(`
        UPDATE execution_logs SET status = 'fail', error_reason = $1, step_failed = 3,
          latency_ms = $2, completed_at = $3 WHERE execution_id = $4
      `, [budgetCheck.reason || 'insufficient_funds', latency, new Date().toISOString(), executionId]);

      return res.status(200).json({
        execution_id: executionId,
        status: 'fail',
        reason: budgetCheck.reason || 'insufficient_funds',
        step_failed: 3,
        latency_ms: latency,
        fast_lane: true,
        lane_id: lane_id,
      });
    }

    // Select provider (use approved or pick best)
    const providerResult = await selectProvider(intentType, constraints);
    if (!providerResult.selected) {
      const latency = Date.now() - startTime;
      await run(`
        UPDATE execution_logs SET status = 'fail', error_reason = 'no_providers_available', step_failed = 5,
          latency_ms = $1, completed_at = $2 WHERE execution_id = $3
      `, [latency, new Date().toISOString(), executionId]);

      return res.status(200).json({
        execution_id: executionId,
        status: 'fail',
        reason: 'no_providers_available',
        step_failed: 5,
        latency_ms: latency,
        fast_lane: true,
        lane_id: lane_id,
      });
    }
    const provider = providerResult.selected;

    // Execute
    await run('UPDATE execution_logs SET status = $1 WHERE execution_id = $2', ['executing', executionId]);

    const execMetadata = typeof intent === 'object'
      ? { ...metadata, recipient_did: intent.to, amount_usdc: intent.amount_usdc, ...intent }
      : metadata;
    const execution = await executeIntent(intentType, provider, did, constraints, execMetadata);

    if (!execution.success) {
      const latency = Date.now() - startTime;
      await run(`
        UPDATE execution_logs SET status = 'fail', error_reason = $1, step_failed = 7,
          latency_ms = $2, completed_at = $3 WHERE execution_id = $4
      `, [execution.error || 'execution_failed', latency, new Date().toISOString(), executionId]);

      return res.status(200).json({
        execution_id: executionId,
        status: 'fail',
        reason: execution.error || 'execution_failed',
        step_failed: 7,
        latency_ms: latency,
        fast_lane: true,
        lane_id: lane_id,
      });
    }

    // Calculate costs
    const cost = execution.cost || provider.price_usdc;
    const platformFee = calculatePlatformFee(cost);
    const totalCost = cost + platformFee;
    const marketRate = cost * 1.2;
    const savings = Math.max(0, marketRate - totalCost);

    const executionPlan = {
      intent_interpreted: intentType,
      interpretation_reason: 'fast_lane_execution',
      selected_providers: [{ did: provider.did, service: provider.service, price_usdc: provider.price_usdc }],
      selected_payment_rail: 'x402_base_usdc',
      routing_reason: 'fast_lane_pre_approved',
      compliance_status: 'skipped_fast_lane',
      identity_reputation: 'skipped_fast_lane',
    };

    const result = {
      transaction_id: execution.transaction_id,
      provider_response: execution.provider_response,
      settlement_id: execution.settlement_id || null,
    };

    // Generate proof
    const timestamp = new Date().toISOString();
    const proof = await generateProof(executionId, did, intentString, result, totalCost, timestamp);

    // Store memory
    const memory = await storeExecution(executionId, did, intentType, executionPlan, result, totalCost);

    // Update stats
    const latencyMs = Date.now() - startTime;
    await updateProviderScore(provider.did, intentType, true, latencyMs, cost);

    await run(`
      UPDATE execution_stats SET
        total_executions = total_executions + 1,
        total_volume_usdc = total_volume_usdc + $1,
        total_savings_usdc = total_savings_usdc + $2,
        executions_today = executions_today + 1,
        last_updated = $3
      WHERE id = 1
    `, [totalCost, savings, timestamp]);

    // Update execution log
    await run(`
      UPDATE execution_logs SET
        status = 'success', intent_type = $1, execution_plan = $2, result = $3,
        cost_usdc = $4, savings_usdc = $5, latency_ms = $6, execution_hash = $7,
        memory_id = $8, provider_did = $9, settlement_id = $10, platform_fee_usdc = $11,
        completed_at = $12
      WHERE execution_id = $13
    `, [
      intentType, JSON.stringify(executionPlan), JSON.stringify(result),
      totalCost, savings, latencyMs, proof.hash,
      memory.memory_id, provider.did, execution.settlement_id || null, platformFee,
      timestamp, executionId
    ]);

    // Record fast lane execution
    await recordFastLaneExecution(lane_id, savings);

    return res.json({
      execution_id: executionId,
      status: 'success',
      execution_plan: executionPlan,
      result,
      cost: totalCost,
      platform_fee: platformFee,
      savings_vs_market: savings,
      latency_ms: latencyMs,
      execution_hash: proof.hash,
      memory_id: memory.memory_id,
      fast_lane: true,
      lane_id: lane_id,
    });
  } catch (err) {
    const latency = Date.now() - startTime;
    await run(`
      UPDATE execution_logs SET status = 'fail', error_reason = $1, latency_ms = $2, completed_at = $3
      WHERE execution_id = $4
    `, [err.message, latency, new Date().toISOString(), executionId]);

    return res.status(500).json({
      execution_id: executionId,
      status: 'fail',
      reason: 'internal_error',
      error: err.message,
      latency_ms: latency,
      fast_lane: true,
      lane_id: lane_id,
    });
  }
});

export default router;

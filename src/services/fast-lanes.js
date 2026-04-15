import { v4 as uuidv4 } from 'uuid';
import { getOne, getAll, run } from './db.js';

export async function createFastLane(agentDid, intentType, parametersTemplate, maxAmountUsdc, validHours = 720, isAuto = false) {
  const laneId = 'lane_' + uuidv4().replace(/-/g, '').slice(0, 16);
  const now = new Date();
  const validUntil = new Date(now.getTime() + validHours * 60 * 60 * 1000);

  await run(`
    INSERT INTO fast_lanes (lane_id, agent_did, intent_type, parameters_template, max_amount_usdc, valid_until, execution_count, created_at, auto_created)
    VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8)
  `, [laneId, agentDid, intentType, JSON.stringify(parametersTemplate || {}), maxAmountUsdc, validUntil.toISOString(), now.toISOString(), isAuto]);

  if (isAuto) {
    await run(`UPDATE fast_lane_stats SET auto_created = auto_created + 1 WHERE id = 1`);
  } else {
    await run(`UPDATE fast_lane_stats SET manually_created = manually_created + 1 WHERE id = 1`);
  }

  return {
    lane_id: laneId,
    agent_did: agentDid,
    intent_type: intentType,
    parameters_template: parametersTemplate || {},
    approved_provider: null,
    max_amount_usdc: maxAmountUsdc,
    valid_until: validUntil.toISOString(),
    execution_count: 0,
    created_at: now.toISOString(),
    auto_created: isAuto,
  };
}

export async function getFastLanesForAgent(agentDid) {
  const now = new Date().toISOString();
  const rows = await getAll(`
    SELECT * FROM fast_lanes WHERE agent_did = $1 AND valid_until > $2
  `, [agentDid, now]);
  return rows.map(r => ({
    lane_id: r.lane_id,
    agent_did: r.agent_did,
    intent_type: r.intent_type,
    parameters_template: JSON.parse(r.parameters_template || '{}'),
    approved_provider: r.approved_provider,
    max_amount_usdc: r.max_amount_usdc,
    valid_until: r.valid_until,
    execution_count: r.execution_count,
    created_at: r.created_at,
    auto_created: r.auto_created,
  }));
}

export async function getFastLane(laneId) {
  const row = await getOne(`SELECT * FROM fast_lanes WHERE lane_id = $1`, [laneId]);
  if (!row) return null;
  return {
    lane_id: row.lane_id,
    agent_did: row.agent_did,
    intent_type: row.intent_type,
    parameters_template: JSON.parse(row.parameters_template || '{}'),
    approved_provider: row.approved_provider,
    max_amount_usdc: row.max_amount_usdc,
    valid_until: row.valid_until,
    execution_count: row.execution_count,
    created_at: row.created_at,
    auto_created: row.auto_created,
  };
}

export async function deactivateFastLane(laneId) {
  const lane = await getFastLane(laneId);
  if (!lane) return null;
  await run(`DELETE FROM fast_lanes WHERE lane_id = $1`, [laneId]);
  return lane;
}

export async function findMatchingFastLane(agentDid, intentType, amountUsdc) {
  const now = new Date().toISOString();
  const row = await getOne(`
    SELECT * FROM fast_lanes
    WHERE agent_did = $1 AND intent_type = $2 AND valid_until > $3 AND $4 <= max_amount_usdc
    LIMIT 1
  `, [agentDid, intentType, now, amountUsdc]);
  if (!row) return null;
  return {
    lane_id: row.lane_id,
    agent_did: row.agent_did,
    intent_type: row.intent_type,
    parameters_template: JSON.parse(row.parameters_template || '{}'),
    approved_provider: row.approved_provider,
    max_amount_usdc: row.max_amount_usdc,
    valid_until: row.valid_until,
    execution_count: row.execution_count,
    created_at: row.created_at,
    auto_created: row.auto_created,
  };
}

export async function recordFastLaneExecution(laneId, savingsUsdc) {
  await run(`UPDATE fast_lanes SET execution_count = execution_count + 1 WHERE lane_id = $1`, [laneId]);
  await run(`
    UPDATE fast_lane_stats SET total_executions = total_executions + 1, total_savings_usdc = total_savings_usdc + $1
    WHERE id = 1
  `, [savingsUsdc || 0]);
}

export async function trackExecution(agentDid, intentType, amountUsdc) {
  // Upsert execution counts
  await run(`
    INSERT INTO execution_counts (agent_did, intent_type, exec_count, highest_amount)
    VALUES ($1, $2, 1, $3)
    ON CONFLICT (agent_did, intent_type) DO UPDATE SET
      exec_count = execution_counts.exec_count + 1,
      highest_amount = GREATEST(execution_counts.highest_amount, $3)
  `, [agentDid, intentType, amountUsdc]);

  const row = await getOne(`
    SELECT exec_count, highest_amount FROM execution_counts WHERE agent_did = $1 AND intent_type = $2
  `, [agentDid, intentType]);

  if (row && row.exec_count === 3) {
    const existingLane = await findMatchingFastLane(agentDid, intentType, Infinity);
    if (!existingLane) {
      const maxAmount = (row.highest_amount || amountUsdc) * 2;
      const lane = await createFastLane(agentDid, intentType, {}, maxAmount, 720, true);
      console.log(`Auto-created fast lane ${lane.lane_id} for ${agentDid} — ${intentType}`);
      return lane;
    }
  }

  return null;
}

export async function isFastLaneEligible(agentDid, intentType) {
  const row = await getOne(`
    SELECT exec_count FROM execution_counts WHERE agent_did = $1 AND intent_type = $2
  `, [agentDid, intentType]);
  return (row?.exec_count || 0) >= 2;
}

export async function getFastLaneStats() {
  const now = new Date().toISOString();
  const activeResult = await getOne(`SELECT COUNT(*) as count FROM fast_lanes WHERE valid_until > $1`, [now]);
  const statsRow = await getOne(`SELECT * FROM fast_lane_stats WHERE id = 1`);

  return {
    fast_lane_executions: statsRow?.total_executions || 0,
    fast_lane_savings_usdc: Math.round((statsRow?.total_savings_usdc || 0) * 10000) / 10000,
    active_fast_lanes: parseInt(activeResult?.count || 0, 10),
    auto_created_lanes: statsRow?.auto_created || 0,
    manually_created_lanes: statsRow?.manually_created || 0,
  };
}

export async function getTotalFastLaneExecutions(agentDid) {
  const result = await getOne(`
    SELECT COALESCE(SUM(execution_count), 0) as total FROM fast_lanes WHERE agent_did = $1
  `, [agentDid]);
  return { total_executions_via_fast_lane: parseInt(result?.total || 0, 10), total_savings: 0 };
}

import { v4 as uuidv4 } from 'uuid';

// In-memory fast lane storage — resets on deploy, auto-recreates as agents re-execute
const fastLanes = new Map();

// Track execution counts per (did, intent_type) for auto-creation
const executionCounts = new Map();

// Track highest amounts seen per (did, intent_type) for auto max_amount_usdc
const highestAmounts = new Map();

// Global fast lane stats
const fastLaneStats = {
  total_executions: 0,
  total_savings_usdc: 0,
  auto_created: 0,
  manually_created: 0,
};

function makeKey(did, intentType) {
  return `${did}::${intentType}`;
}

export function createFastLane(agentDid, intentType, parametersTemplate, maxAmountUsdc, validHours = 720, isAuto = false) {
  const laneId = 'lane_' + uuidv4().replace(/-/g, '').slice(0, 16);
  const now = new Date();
  const validUntil = new Date(now.getTime() + validHours * 60 * 60 * 1000);

  const lane = {
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

  fastLanes.set(laneId, lane);

  if (isAuto) {
    fastLaneStats.auto_created++;
  } else {
    fastLaneStats.manually_created++;
  }

  return lane;
}

export function getFastLanesForAgent(agentDid) {
  const now = new Date();
  const lanes = [];
  for (const lane of fastLanes.values()) {
    if (lane.agent_did === agentDid && new Date(lane.valid_until) > now) {
      lanes.push(lane);
    }
  }
  return lanes;
}

export function getFastLane(laneId) {
  return fastLanes.get(laneId) || null;
}

export function deactivateFastLane(laneId) {
  const lane = fastLanes.get(laneId);
  if (!lane) return null;
  fastLanes.delete(laneId);
  return lane;
}

export function findMatchingFastLane(agentDid, intentType, amountUsdc) {
  const now = new Date();
  for (const lane of fastLanes.values()) {
    if (
      lane.agent_did === agentDid &&
      lane.intent_type === intentType &&
      new Date(lane.valid_until) > now &&
      amountUsdc <= lane.max_amount_usdc
    ) {
      return lane;
    }
  }
  return null;
}

export function recordFastLaneExecution(laneId, savingsUsdc) {
  const lane = fastLanes.get(laneId);
  if (lane) {
    lane.execution_count++;
  }
  fastLaneStats.total_executions++;
  fastLaneStats.total_savings_usdc += savingsUsdc || 0;
}

export function trackExecution(agentDid, intentType, amountUsdc) {
  const key = makeKey(agentDid, intentType);

  // Update execution count
  const count = (executionCounts.get(key) || 0) + 1;
  executionCounts.set(key, count);

  // Update highest amount
  const highest = highestAmounts.get(key) || 0;
  if (amountUsdc > highest) {
    highestAmounts.set(key, amountUsdc);
  }

  // Auto-create fast lane on 3rd successful execution
  if (count === 3) {
    const existingLane = findMatchingFastLane(agentDid, intentType, Infinity);
    if (!existingLane) {
      const maxAmount = (highestAmounts.get(key) || amountUsdc) * 2;
      const lane = createFastLane(agentDid, intentType, {}, maxAmount, 720, true);
      console.log(`Auto-created fast lane ${lane.lane_id} for ${agentDid} — ${intentType}`);
      return lane;
    }
  }

  return null;
}

export function isFastLaneEligible(agentDid, intentType) {
  const key = makeKey(agentDid, intentType);
  const count = executionCounts.get(key) || 0;
  return count >= 2; // Close to auto-creation threshold
}

export function getFastLaneStats() {
  const now = new Date();
  let activeLanes = 0;
  for (const lane of fastLanes.values()) {
    if (new Date(lane.valid_until) > now) {
      activeLanes++;
    }
  }

  return {
    fast_lane_executions: fastLaneStats.total_executions,
    fast_lane_savings_usdc: Math.round(fastLaneStats.total_savings_usdc * 10000) / 10000,
    active_fast_lanes: activeLanes,
    auto_created_lanes: fastLaneStats.auto_created,
    manually_created_lanes: fastLaneStats.manually_created,
  };
}

export function getTotalFastLaneExecutions(agentDid) {
  let total = 0;
  let savings = 0;
  for (const lane of fastLanes.values()) {
    if (lane.agent_did === agentDid) {
      total += lane.execution_count;
    }
  }
  return { total_executions_via_fast_lane: total, total_savings: savings };
}

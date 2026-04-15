import { getServiceUrl } from './cross-service.js';

const HIVEMIND_TIMEOUT = 5000;
const HIVE_INTERNAL_KEY = 'hive_internal_125e04e071e8829be631ea0216dd4a0c9b707975fcecaf8c62c6a2ab43327d46';

// Performance tier thresholds
const TIER_THRESHOLDS = {
  platinum: 100,
  gold: 50,
  silver: 20,
  bronze: 0,
};

function getTier(executionCount) {
  if (executionCount >= TIER_THRESHOLDS.platinum) return 'platinum';
  if (executionCount >= TIER_THRESHOLDS.gold) return 'gold';
  if (executionCount >= TIER_THRESHOLDS.silver) return 'silver';
  return 'bronze';
}

/**
 * Fetch the agent's execution history from HiveMind memory and build a performance profile.
 * Returns a safe default profile if HiveMind is unavailable.
 */
export async function fetchPerformanceProfile(agentDid) {
  const defaultProfile = {
    preferred_providers: [],
    avg_cost_by_intent: {},
    success_rate_by_provider: {},
    execution_count: 0,
    performance_tier: 'bronze',
    has_history: false,
  };

  try {
    const baseUrl = getServiceUrl('hivemind');
    if (!baseUrl) return defaultProfile;

    const url = `${baseUrl}/v1/memory/${encodeURIComponent(agentDid)}/query?q=execution_history&type=execution`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-hive-internal': HIVE_INTERNAL_KEY,
      },
      signal: AbortSignal.timeout(HIVEMIND_TIMEOUT),
    });

    if (!res.ok) return defaultProfile;

    const data = await res.json();
    const memories = data.memories || data.results || data.data || [];

    if (!Array.isArray(memories) || memories.length === 0) return defaultProfile;

    return buildPerformanceProfile(memories);
  } catch {
    // HiveMind unavailable — continue without memory boost
    return defaultProfile;
  }
}

/**
 * Analyze execution history memories and extract performance patterns.
 */
function buildPerformanceProfile(memories) {
  const providerStats = {};   // providerDid → { successes, total, totalCost }
  const intentCosts = {};     // intentType → { totalCost, count }
  let totalExecutions = 0;

  for (const mem of memories) {
    const content = mem.content || mem.data || mem;
    const provider = content.provider || content.provider_did;
    const intentType = content.intent_type;
    const cost = parseFloat(content.cost_usdc || content.cost || 0);
    const success = content.success !== false && content.status !== 'fail';

    totalExecutions++;

    // Provider stats
    if (provider) {
      if (!providerStats[provider]) {
        providerStats[provider] = { successes: 0, total: 0, totalCost: 0 };
      }
      providerStats[provider].total++;
      providerStats[provider].totalCost += cost;
      if (success) providerStats[provider].successes++;
    }

    // Intent cost stats
    if (intentType) {
      if (!intentCosts[intentType]) {
        intentCosts[intentType] = { totalCost: 0, count: 0 };
      }
      intentCosts[intentType].totalCost += cost;
      intentCosts[intentType].count++;
    }
  }

  // Build preferred providers (sorted by success rate, min 2 executions)
  const preferred_providers = Object.entries(providerStats)
    .filter(([, s]) => s.total >= 2)
    .map(([did, s]) => ({
      did,
      success_rate: s.total > 0 ? s.successes / s.total : 0,
      executions: s.total,
      avg_cost: s.total > 0 ? s.totalCost / s.total : 0,
    }))
    .sort((a, b) => b.success_rate - a.success_rate || b.executions - a.executions);

  // Build avg cost by intent
  const avg_cost_by_intent = {};
  for (const [type, stats] of Object.entries(intentCosts)) {
    avg_cost_by_intent[type] = stats.count > 0 ? stats.totalCost / stats.count : 0;
  }

  // Build success rate by provider
  const success_rate_by_provider = {};
  for (const [did, stats] of Object.entries(providerStats)) {
    success_rate_by_provider[did] = stats.total > 0 ? stats.successes / stats.total : 0;
  }

  return {
    preferred_providers,
    avg_cost_by_intent,
    success_rate_by_provider,
    execution_count: totalExecutions,
    performance_tier: getTier(totalExecutions),
    has_history: totalExecutions > 0,
  };
}

/**
 * Store an execution result back to HiveMind memory.
 * Wrapped in try/catch — memory write failure never blocks execution.
 */
export async function storeExecutionToMemory(agentDid, executionData) {
  try {
    const baseUrl = getServiceUrl('hivemind');
    if (!baseUrl) return { stored: false, reason: 'no_hivemind_url' };

    const body = {
      agent_did: agentDid,
      memory_type: 'execution',
      key: `exec_${executionData.execution_id}`,
      content: {
        execution_id: executionData.execution_id,
        intent_type: executionData.intent_type,
        provider: executionData.provider,
        cost_usdc: executionData.cost,
        success: executionData.success,
        latency_ms: executionData.latency_ms,
        timestamp: executionData.timestamp || new Date().toISOString(),
      },
      visibility: 'private',
      tags: ['execution', 'performance', executionData.intent_type],
    };

    const res = await fetch(`${baseUrl}/v1/memory/${encodeURIComponent(agentDid)}/store`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hive-internal': HIVE_INTERNAL_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(HIVEMIND_TIMEOUT),
    });

    if (!res.ok) return { stored: false, reason: `hivemind_${res.status}` };

    const data = await res.json();
    return { stored: true, memory_id: data.memory_id || data.id };
  } catch {
    // Memory write failure is non-critical
    return { stored: false, reason: 'hivemind_unavailable' };
  }
}

export { getTier, buildPerformanceProfile, TIER_THRESHOLDS };

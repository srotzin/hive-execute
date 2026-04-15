import crypto from 'crypto';
import { getOne, getAll, run } from './db.js';

const MAX_ENTRIES_PER_AGENT = 1000;
const MAX_TOTAL_ENTRIES = 50000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REPEAT_THRESHOLD = 2; // 2+ executions = repeat

/**
 * Generate a deterministic hash for an intent based on DID, type, and normalized parameters.
 */
export function hashIntent(did, intentType, parameters) {
  const normalized = typeof parameters === 'string'
    ? parameters.toLowerCase().trim()
    : JSON.stringify(sortKeys(parameters || {}));
  const input = `${did}:${intentType}:${normalized}`;
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 32);
}

/**
 * Recursively sort object keys for deterministic hashing.
 */
function sortKeys(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeys(obj[key]);
  }
  return sorted;
}

/**
 * Detect if this is a repeat execution.
 * Returns cached routing info if repeat, null otherwise.
 */
export async function detectRepeat(did, intentType, parameters) {
  try {
    const intentHash = hashIntent(did, intentType, parameters);
    const row = await getOne(`
      SELECT * FROM repeat_cache WHERE agent_did = $1 AND intent_hash = $2
    `, [did, intentHash]);

    if (!row) return null;

    // Check TTL
    if (Date.now() - row.updated_at > CACHE_TTL_MS) {
      await run(`DELETE FROM repeat_cache WHERE agent_did = $1 AND intent_hash = $2`, [did, intentHash]);
      return null;
    }

    // Check threshold
    if (row.execution_count >= REPEAT_THRESHOLD) {
      let routing = null;
      try { routing = JSON.parse(row.routing); } catch { routing = null; }
      return {
        intent_hash: intentHash,
        intent_type: row.intent_type,
        provider_did: row.provider_did,
        cost: row.cost,
        routing,
        execution_count: row.execution_count,
        last_execution: new Date(parseInt(row.updated_at, 10)).toISOString(),
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Record an execution in the repeat cache.
 */
export async function recordExecution(did, intentType, parameters, providerDid, cost, routing, executionId) {
  try {
    const intentHash = hashIntent(did, intentType, parameters);
    const now = Date.now();

    // Evict expired entries for this agent
    const cutoff = now - CACHE_TTL_MS;
    await run(`DELETE FROM repeat_cache WHERE agent_did = $1 AND updated_at < $2`, [did, cutoff]);

    // Check per-agent limit
    const countResult = await getOne(`SELECT COUNT(*) as c FROM repeat_cache WHERE agent_did = $1`, [did]);
    const agentCount = parseInt(countResult?.c || 0, 10);

    if (agentCount >= MAX_ENTRIES_PER_AGENT) {
      // Evict oldest entry for this agent
      await run(`
        DELETE FROM repeat_cache WHERE agent_did = $1 AND intent_hash = (
          SELECT intent_hash FROM repeat_cache WHERE agent_did = $1 ORDER BY updated_at ASC LIMIT 1
        )
      `, [did]);
    }

    // Upsert
    await run(`
      INSERT INTO repeat_cache (agent_did, intent_hash, intent_type, provider_did, cost, routing, updated_at, execution_count, last_execution_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8)
      ON CONFLICT (agent_did, intent_hash) DO UPDATE SET
        intent_type = $3,
        provider_did = $4,
        cost = $5,
        routing = $6,
        updated_at = $7,
        execution_count = repeat_cache.execution_count + 1,
        last_execution_id = $8
    `, [did, intentHash, intentType, providerDid, cost, JSON.stringify(routing), now, executionId]);

    // Global eviction
    const totalResult = await getOne(`SELECT COUNT(*) as c FROM repeat_cache`);
    const totalCount = parseInt(totalResult?.c || 0, 10);
    if (totalCount > MAX_TOTAL_ENTRIES) {
      const excess = totalCount - MAX_TOTAL_ENTRIES;
      await run(`
        DELETE FROM repeat_cache WHERE ctid IN (
          SELECT ctid FROM repeat_cache ORDER BY updated_at ASC LIMIT $1
        )
      `, [excess]);
    }
  } catch {
    // Never fail because of cache update
  }
}

/**
 * Get repeat stats for a specific agent.
 */
export async function getAgentRepeatStats(did) {
  // Evict expired
  const cutoff = Date.now() - CACHE_TTL_MS;
  await run(`DELETE FROM repeat_cache WHERE agent_did = $1 AND updated_at < $2`, [did, cutoff]);

  const rows = await getAll(`SELECT * FROM repeat_cache WHERE agent_did = $1 ORDER BY execution_count DESC`, [did]);

  let repeatCount = 0;
  const entries = rows.map(r => {
    if (r.execution_count >= REPEAT_THRESHOLD) repeatCount++;
    return {
      intent_hash: r.intent_hash,
      intent_type: r.intent_type,
      provider_did: r.provider_did,
      cost: r.cost,
      execution_count: r.execution_count,
      last_execution: new Date(parseInt(r.updated_at, 10)).toISOString(),
    };
  });

  return {
    total_cached: rows.length,
    repeat_intents: repeatCount,
    entries,
  };
}

/**
 * Track repeat execution savings.
 */
export async function trackRepeatSavings(savingsUsdc) {
  await run(`
    UPDATE repeat_stats SET
      total_repeat_executions = total_repeat_executions + 1,
      total_repeat_savings_usdc = total_repeat_savings_usdc + $1
    WHERE id = 1
  `, [savingsUsdc]);
}

/**
 * Get global repeat optimization stats.
 */
export async function getRepeatStats() {
  // Evict expired across all agents
  const cutoff = Date.now() - CACHE_TTL_MS;
  await run(`DELETE FROM repeat_cache WHERE updated_at < $1`, [cutoff]);

  const totalCachedResult = await getOne(`SELECT COUNT(*) as c FROM repeat_cache`);
  const totalCached = parseInt(totalCachedResult?.c || 0, 10);

  const repeatRows = await getAll(`
    SELECT agent_did, intent_type, execution_count, cost FROM repeat_cache
    WHERE execution_count >= $1
    ORDER BY execution_count DESC
    LIMIT 10
  `, [REPEAT_THRESHOLD]);

  const totalRepeatsResult = await getOne(`SELECT COUNT(*) as c FROM repeat_cache WHERE execution_count >= $1`, [REPEAT_THRESHOLD]);
  const totalRepeats = parseInt(totalRepeatsResult?.c || 0, 10);

  const statsRow = await getOne(`SELECT * FROM repeat_stats WHERE id = 1`);

  return {
    repeat_executions: statsRow?.total_repeat_executions || 0,
    repeat_savings_usdc: Math.round((statsRow?.total_repeat_savings_usdc || 0) * 10000) / 10000,
    total_cached_intents: totalCached,
    total_repeat_patterns: totalRepeats,
    top_patterns: repeatRows.map(r => ({
      did: r.agent_did,
      intent_type: r.intent_type,
      execution_count: r.execution_count,
      cost: r.cost,
    })),
  };
}

/**
 * Look up a cached execution by execution_id across all agents.
 */
export async function findCachedExecution(executionId) {
  const row = await getOne(`SELECT * FROM repeat_cache WHERE last_execution_id = $1`, [executionId]);
  if (!row) return null;
  let routing = null;
  try { routing = JSON.parse(row.routing); } catch { routing = null; }
  return {
    did: row.agent_did,
    intent_hash: row.intent_hash,
    intent_type: row.intent_type,
    provider_did: row.provider_did,
    cost: row.cost,
    routing,
    timestamp: parseInt(row.updated_at, 10),
    execution_count: row.execution_count,
    last_execution_id: row.last_execution_id,
  };
}

export { CACHE_TTL_MS, MAX_ENTRIES_PER_AGENT, MAX_TOTAL_ENTRIES, REPEAT_THRESHOLD };

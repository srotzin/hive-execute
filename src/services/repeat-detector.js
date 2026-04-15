import crypto from 'crypto';

// In-memory cache: Map<agentDid, Map<intentHash, CacheEntry>>
const agentCache = new Map();

// Global tracking counters
let totalRepeatExecutions = 0;
let totalRepeatSavingsUsdc = 0;

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
 * Get total entry count across all agents.
 */
function getTotalEntryCount() {
  let count = 0;
  for (const agentMap of agentCache.values()) {
    count += agentMap.size;
  }
  return count;
}

/**
 * Evict expired entries from a specific agent's cache.
 */
function evictExpired(agentMap) {
  const now = Date.now();
  for (const [hash, entry] of agentMap) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      agentMap.delete(hash);
    }
  }
}

/**
 * Evict oldest entries if we exceed global max.
 */
function evictGlobalIfNeeded() {
  if (getTotalEntryCount() <= MAX_TOTAL_ENTRIES) return;

  // Collect all entries with their agent key
  const allEntries = [];
  for (const [agentDid, agentMap] of agentCache) {
    for (const [hash, entry] of agentMap) {
      allEntries.push({ agentDid, hash, timestamp: entry.timestamp });
    }
  }

  // Sort by timestamp ascending (oldest first) and remove excess
  allEntries.sort((a, b) => a.timestamp - b.timestamp);
  const toRemove = allEntries.length - MAX_TOTAL_ENTRIES;
  for (let i = 0; i < toRemove; i++) {
    const e = allEntries[i];
    const agentMap = agentCache.get(e.agentDid);
    if (agentMap) {
      agentMap.delete(e.hash);
      if (agentMap.size === 0) agentCache.delete(e.agentDid);
    }
  }
}

/**
 * Detect if this is a repeat execution.
 * Returns cached routing info if repeat, null otherwise.
 */
export function detectRepeat(did, intentType, parameters) {
  try {
    const intentHash = hashIntent(did, intentType, parameters);
    const agentMap = agentCache.get(did);
    if (!agentMap) return null;

    const entry = agentMap.get(intentHash);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      agentMap.delete(intentHash);
      return null;
    }

    // Check threshold
    if (entry.execution_count >= REPEAT_THRESHOLD) {
      return {
        intent_hash: intentHash,
        intent_type: entry.intent_type,
        provider_did: entry.provider_did,
        cost: entry.cost,
        routing: entry.routing,
        execution_count: entry.execution_count,
        last_execution: new Date(entry.timestamp).toISOString(),
      };
    }

    return null;
  } catch {
    // Never fail execution because of repeat detection
    return null;
  }
}

/**
 * Record an execution in the repeat cache.
 */
export function recordExecution(did, intentType, parameters, providerDid, cost, routing, executionId) {
  try {
    const intentHash = hashIntent(did, intentType, parameters);

    if (!agentCache.has(did)) {
      agentCache.set(did, new Map());
    }
    const agentMap = agentCache.get(did);

    // Evict expired first
    evictExpired(agentMap);

    // Check per-agent limit
    if (agentMap.size >= MAX_ENTRIES_PER_AGENT && !agentMap.has(intentHash)) {
      // Evict oldest entry for this agent
      let oldestHash = null;
      let oldestTime = Infinity;
      for (const [hash, entry] of agentMap) {
        if (entry.timestamp < oldestTime) {
          oldestTime = entry.timestamp;
          oldestHash = hash;
        }
      }
      if (oldestHash) agentMap.delete(oldestHash);
    }

    const existing = agentMap.get(intentHash);
    agentMap.set(intentHash, {
      intent_hash: intentHash,
      intent_type: intentType,
      provider_did: providerDid,
      cost,
      routing,
      timestamp: Date.now(),
      execution_count: (existing?.execution_count || 0) + 1,
      last_execution_id: executionId,
    });

    // Global eviction
    evictGlobalIfNeeded();
  } catch {
    // Never fail because of cache update
  }
}

/**
 * Get repeat stats for a specific agent.
 */
export function getAgentRepeatStats(did) {
  const agentMap = agentCache.get(did);
  if (!agentMap) {
    return { total_cached: 0, repeat_intents: 0, entries: [] };
  }

  evictExpired(agentMap);

  const entries = [];
  let repeatCount = 0;
  for (const [, entry] of agentMap) {
    if (entry.execution_count >= REPEAT_THRESHOLD) {
      repeatCount++;
    }
    entries.push({
      intent_hash: entry.intent_hash,
      intent_type: entry.intent_type,
      provider_did: entry.provider_did,
      cost: entry.cost,
      execution_count: entry.execution_count,
      last_execution: new Date(entry.timestamp).toISOString(),
    });
  }

  return {
    total_cached: agentMap.size,
    repeat_intents: repeatCount,
    entries: entries.sort((a, b) => b.execution_count - a.execution_count),
  };
}

/**
 * Track repeat execution savings.
 */
export function trackRepeatSavings(savingsUsdc) {
  totalRepeatExecutions++;
  totalRepeatSavingsUsdc += savingsUsdc;
}

/**
 * Get global repeat optimization stats.
 */
export function getRepeatStats() {
  let totalCached = 0;
  let totalRepeats = 0;
  const topPatterns = [];

  for (const [did, agentMap] of agentCache) {
    evictExpired(agentMap);
    totalCached += agentMap.size;
    for (const [, entry] of agentMap) {
      if (entry.execution_count >= REPEAT_THRESHOLD) {
        totalRepeats++;
        topPatterns.push({
          did,
          intent_type: entry.intent_type,
          execution_count: entry.execution_count,
          cost: entry.cost,
        });
      }
    }
  }

  topPatterns.sort((a, b) => b.execution_count - a.execution_count);

  return {
    repeat_executions: totalRepeatExecutions,
    repeat_savings_usdc: Math.round(totalRepeatSavingsUsdc * 10000) / 10000,
    total_cached_intents: totalCached,
    total_repeat_patterns: totalRepeats,
    top_patterns: topPatterns.slice(0, 10),
  };
}

/**
 * Look up a cached execution by execution_id across all agents.
 */
export function findCachedExecution(executionId) {
  for (const [did, agentMap] of agentCache) {
    for (const [, entry] of agentMap) {
      if (entry.last_execution_id === executionId) {
        return { did, ...entry };
      }
    }
  }
  return null;
}

// Export for testing
export { agentCache, CACHE_TTL_MS, MAX_ENTRIES_PER_AGENT, MAX_TOTAL_ENTRIES, REPEAT_THRESHOLD };

/**
 * Pattern Analyzer — analyzes execution history to find optimization patterns.
 *
 * Pattern types:
 * - recurring_payment: same recipient + similar amount
 * - periodic_lookup:   same query/intent type repeated
 * - batch_operation:   multiple similar intents in a short window
 */

const BATCH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MIN_RECURRENCES = 2;

/**
 * Analyze an agent's execution history and detect patterns.
 *
 * @param {string} did - Agent DID
 * @param {Array} history - Array of execution log rows from DB
 * @returns {Array} Detected patterns with optimization suggestions
 */
export function detectPatterns(did, history) {
  try {
    if (!history || history.length === 0) return [];

    const patterns = [];

    const recurring = detectRecurringPayments(history);
    const periodic = detectPeriodicLookups(history);
    const batches = detectBatchOperations(history);

    patterns.push(...recurring, ...periodic, ...batches);

    // Sort by frequency descending
    patterns.sort((a, b) => b.frequency - a.frequency);

    return patterns;
  } catch {
    // Never fail because of pattern analysis
    return [];
  }
}

/**
 * Detect recurring payments — same recipient and similar amount.
 */
function detectRecurringPayments(history) {
  const payments = history.filter(e =>
    e.intent_type === 'payment_transfer' && e.status === 'success'
  );

  // Group by recipient (extracted from intent or result)
  const recipientMap = new Map();

  for (const exec of payments) {
    const recipient = extractRecipient(exec);
    if (!recipient) continue;

    if (!recipientMap.has(recipient)) {
      recipientMap.set(recipient, []);
    }
    recipientMap.get(recipient).push(exec);
  }

  const patterns = [];
  for (const [recipient, executions] of recipientMap) {
    if (executions.length < MIN_RECURRENCES) continue;

    const costs = executions.map(e => e.cost_usdc || 0);
    const avgCost = costs.reduce((a, b) => a + b, 0) / costs.length;
    const totalCost = costs.reduce((a, b) => a + b, 0);

    // Check if amounts are similar (within 20% of average)
    const similarAmounts = costs.filter(c => Math.abs(c - avgCost) / (avgCost || 1) < 0.2).length;
    const isSimilar = similarAmounts >= costs.length * 0.6;

    patterns.push({
      pattern_type: 'recurring_payment',
      frequency: executions.length,
      avg_cost: Math.round(avgCost * 10000) / 10000,
      total_cost: Math.round(totalCost * 10000) / 10000,
      details: {
        recipient,
        similar_amounts: isSimilar,
        first_seen: executions[executions.length - 1]?.created_at,
        last_seen: executions[0]?.created_at,
      },
      suggested_optimization: isSimilar
        ? 'cached_routing — pre-approve this payment path for instant execution'
        : 'cached_routing — cache provider selection for this recipient',
    });
  }

  return patterns;
}

/**
 * Detect periodic lookups — same intent type repeated over time.
 */
function detectPeriodicLookups(history) {
  const typeMap = new Map();

  for (const exec of history) {
    if (!exec.intent_type || exec.status !== 'success') continue;
    if (!typeMap.has(exec.intent_type)) {
      typeMap.set(exec.intent_type, []);
    }
    typeMap.get(exec.intent_type).push(exec);
  }

  const patterns = [];
  for (const [intentType, executions] of typeMap) {
    if (executions.length < MIN_RECURRENCES) continue;

    const costs = executions.map(e => e.cost_usdc || 0);
    const avgCost = costs.reduce((a, b) => a + b, 0) / costs.length;
    const latencies = executions.map(e => e.latency_ms || 0);
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

    // Estimate savings from caching: skip provider negotiation = ~15% cost reduction
    const estimatedSavings = avgCost * 0.15 * executions.length;

    patterns.push({
      pattern_type: 'periodic_lookup',
      frequency: executions.length,
      avg_cost: Math.round(avgCost * 10000) / 10000,
      avg_latency_ms: Math.round(avgLatency),
      details: {
        intent_type: intentType,
        total_executions: executions.length,
        first_seen: executions[executions.length - 1]?.created_at,
        last_seen: executions[0]?.created_at,
      },
      suggested_optimization: `cached_routing — cache optimal provider for ${intentType}, estimated savings: $${(Math.round(estimatedSavings * 10000) / 10000)}`,
    });
  }

  return patterns;
}

/**
 * Detect batch operations — multiple similar intents in a short time window.
 */
function detectBatchOperations(history) {
  if (history.length < 2) return [];

  // Sort by creation time ascending
  const sorted = [...history]
    .filter(e => e.status === 'success' && e.created_at)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const batches = [];
  let currentBatch = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]?.created_at).getTime();
    const curr = new Date(sorted[i]?.created_at).getTime();

    if (curr - prev <= BATCH_WINDOW_MS && sorted[i].intent_type === sorted[i - 1]?.intent_type) {
      currentBatch.push(sorted[i]);
    } else {
      if (currentBatch.length >= MIN_RECURRENCES) {
        batches.push([...currentBatch]);
      }
      currentBatch = [sorted[i]];
    }
  }
  // Don't forget the last batch
  if (currentBatch.length >= MIN_RECURRENCES) {
    batches.push(currentBatch);
  }

  const patterns = [];
  for (const batch of batches) {
    const costs = batch.map(e => e.cost_usdc || 0);
    const avgCost = costs.reduce((a, b) => a + b, 0) / costs.length;
    const totalCost = costs.reduce((a, b) => a + b, 0);

    patterns.push({
      pattern_type: 'batch_operation',
      frequency: batch.length,
      avg_cost: Math.round(avgCost * 10000) / 10000,
      total_cost: Math.round(totalCost * 10000) / 10000,
      details: {
        intent_type: batch[0]?.intent_type,
        window_start: batch[0]?.created_at,
        window_end: batch[batch.length - 1]?.created_at,
        executions_in_window: batch.length,
      },
      suggested_optimization: 'batch_discount — group these operations for volume pricing',
    });
  }

  return patterns;
}

/**
 * Extract recipient DID from an execution's intent or result fields.
 */
function extractRecipient(exec) {
  // Try parsing intent JSON
  try {
    if (exec.intent) {
      const intent = typeof exec.intent === 'string' ? JSON.parse(exec.intent) : exec.intent;
      if (intent.to) return intent.to;
      if (intent.recipient_did) return intent.recipient_did;
    }
  } catch {
    // Not JSON, try keyword extraction
  }

  // Try parsing result JSON
  try {
    if (exec.result) {
      const result = typeof exec.result === 'string' ? JSON.parse(exec.result) : exec.result;
      if (result.provider_response?.recipient_did) return result.provider_response.recipient_did;
    }
  } catch {
    // ignore
  }

  // Fall back to provider_did
  return exec.provider_did || null;
}

export { extractRecipient, BATCH_WINDOW_MS, MIN_RECURRENCES };

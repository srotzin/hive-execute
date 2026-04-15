// Promotion tracking — BOGO welcome bonus + loyalty freebies
// Uses in-memory Map (no external DB dependency required)

const executionCounts = new Map();

/**
 * Check if an agent qualifies for a promotional free execution.
 * - First execution (count === 0): BOGO welcome bonus
 * - Sixth execution (count === 5): Loyalty reward
 */
export function checkPromotion(did) {
  const count = executionCounts.get(did) || 0;

  if (count === 0) {
    return {
      promo_type: 'bogo_welcome',
      promo_active: true,
      executions_count: count,
      free_execution: true,
      message: 'Welcome bonus: this execution is on us!',
      next_free_at: 6,
    };
  }

  if (count === 5) {
    return {
      promo_type: 'loyalty_reward',
      promo_active: true,
      executions_count: count,
      free_execution: true,
      message: 'Loyalty reward: this one\'s free!',
      next_free_at: 12,
    };
  }

  return {
    promo_type: null,
    promo_active: false,
    executions_count: count,
    free_execution: false,
    next_free_at: count < 5 ? 6 : 12,
  };
}

/**
 * Record an execution for promotion tracking.
 */
export function recordExecution(did) {
  const current = executionCounts.get(did) || 0;
  executionCounts.set(did, current + 1);
  return current + 1;
}

/**
 * Get the raw execution count for a DID.
 */
export function getExecutionCount(did) {
  return executionCounts.get(did) || 0;
}

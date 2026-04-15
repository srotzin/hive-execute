import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getAll, getOne, run } from '../services/db.js';
import { detectPatterns } from '../services/pattern-analyzer.js';
import { getAgentRepeatStats, findCachedExecution, recordExecution, trackRepeatSavings } from '../services/repeat-detector.js';
import { executeIntent, calculatePlatformFee } from '../services/executor.js';
import { generateProof } from '../services/proof-generator.js';
import { storeExecution } from '../services/memory-store.js';
import { updateProviderScore } from '../services/provider-selector.js';
import { requirePayment } from '../middleware/auth.js';

const router = Router();

// GET /v1/execute_intent/patterns/:did — detected patterns for an agent
router.get('/v1/execute_intent/patterns/:did', requirePayment('stats'), async (req, res) => {
  const { did } = req.params;

  // Fetch execution history from DB
  const history = await getAll(`
    SELECT execution_id, did, intent, intent_type, status, cost_usdc, savings_usdc,
           latency_ms, execution_hash, provider_did, result, error_reason, created_at, completed_at
    FROM execution_logs
    WHERE did = $1
    ORDER BY created_at DESC
    LIMIT 500
  `, [did]);

  // Analyze patterns
  const patterns = detectPatterns(did, history);

  // Get repeat stats for this agent
  const repeatStats = await getAgentRepeatStats(did);

  // Calculate total savings from repeat executions for this agent
  const totalRepeatExecs = repeatStats.entries.reduce((sum, e) => sum + Math.max(0, e.execution_count - 1), 0);
  const totalRepeatSavings = repeatStats.entries.reduce((sum, e) => {
    const repeatCount = Math.max(0, e.execution_count - 1);
    return sum + (e.cost * 0.15 * repeatCount);
  }, 0);

  res.json({
    did,
    patterns,
    total_repeat_executions: totalRepeatExecs,
    total_savings_from_repeats: Math.round(totalRepeatSavings * 10000) / 10000,
    cached_intents: repeatStats.total_cached,
    repeat_intents: repeatStats.repeat_intents,
  });
});

// POST /v1/execute_intent/repeat/:execution_id — re-execute using cached routing
router.post('/v1/execute_intent/repeat/:execution_id', requirePayment('execute_intent'), async (req, res) => {
  const startTime = Date.now();
  const { execution_id: originalExecutionId } = req.params;
  const newExecutionId = 'exec_' + uuidv4().replace(/-/g, '').slice(0, 20);

  // Look up original execution in DB
  const original = await getOne(`
    SELECT * FROM execution_logs WHERE execution_id = $1 AND status = 'success'
  `, [originalExecutionId]);

  if (!original) {
    return res.status(404).json({
      error: 'execution_not_found',
      details: `No successful execution found with id: ${originalExecutionId}`,
    });
  }

  const did = original.did;
  const intentType = original.intent_type;
  const intentString = original.intent;
  const constraints = JSON.parse(original.constraints || '{}');

  // Parse original execution plan for provider info
  let provider;
  try {
    const plan = JSON.parse(original.execution_plan || '{}');
    const selectedProvider = plan.selected_providers?.[0];
    if (selectedProvider) {
      provider = {
        did: selectedProvider.did,
        service: selectedProvider.service,
        price_usdc: selectedProvider.price_usdc,
      };
    }
  } catch {
    // Fall back to provider_did from the log
  }

  if (!provider && original.provider_did) {
    provider = {
      did: original.provider_did,
      service: 'cached_provider',
      price_usdc: original.cost_usdc || 0,
    };
  }

  if (!provider) {
    return res.status(400).json({
      error: 'no_cached_routing',
      details: 'Could not reconstruct provider routing from original execution',
    });
  }

  const now = new Date().toISOString();

  // Create log entry for the repeat execution
  await run(`
    INSERT INTO execution_logs (execution_id, did, intent, intent_type, constraints, budget_usdc, status, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, 'executing', $7)
  `, [newExecutionId, did, intentString, intentType, JSON.stringify(constraints), original.budget_usdc || 0, now]);

  try {
    // Parse original intent for metadata
    let intent;
    try { intent = JSON.parse(intentString); } catch { intent = intentString; }
    const metadata = typeof intent === 'object'
      ? { recipient_did: intent.to, amount_usdc: intent.amount_usdc, ...intent }
      : {};

    // Execute directly against the cached provider — skip all negotiation
    const execution = await executeIntent(intentType, provider, did, constraints, metadata);

    if (!execution.success) {
      const latency = Date.now() - startTime;
      await run(`
        UPDATE execution_logs SET status = 'fail', error_reason = $1, latency_ms = $2, completed_at = $3
        WHERE execution_id = $4
      `, [execution.error || 'execution_failed', latency, new Date().toISOString(), newExecutionId]);

      return res.status(200).json({
        execution_id: newExecutionId,
        repeat_of: originalExecutionId,
        status: 'fail',
        reason: execution.error || 'execution_failed',
        latency_ms: latency,
      });
    }

    const cost = execution.cost || provider.price_usdc;
    const platformFee = calculatePlatformFee(cost);
    const totalCost = cost + platformFee;
    const marketRate = cost * 1.2;
    const savings = Math.max(0, marketRate - totalCost);

    // Estimate savings from skipping negotiation (15% of cost)
    const repeatSavings = totalCost * 0.15;

    const executionPlan = {
      intent_interpreted: intentType,
      interpretation_reason: `Repeat of ${originalExecutionId} — cached routing`,
      selected_providers: [{ did: provider.did, service: provider.service, price_usdc: provider.price_usdc }],
      selected_payment_rail: 'x402_base_usdc',
      routing_reason: 'Repeat-optimized: direct cached routing, negotiation skipped',
    };

    const result = {
      transaction_id: execution.transaction_id,
      provider_response: execution.provider_response,
      settlement_id: execution.settlement_id || null,
    };

    // Generate proof
    const timestamp = new Date().toISOString();
    const proof = await generateProof(newExecutionId, did, intentString, result, totalCost, timestamp);

    // Store memory
    const memory = await storeExecution(newExecutionId, did, intentType, executionPlan, result, totalCost);

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
      timestamp, newExecutionId
    ]);

    // Record in repeat cache
    try {
      await recordExecution(did, intentType, intent, provider.did, totalCost, provider, newExecutionId);
      await trackRepeatSavings(repeatSavings);
    } catch {
      // Never fail execution because of cache recording
    }

    return res.json({
      execution_id: newExecutionId,
      repeat_of: originalExecutionId,
      repeat_optimized: true,
      status: 'success',
      execution_plan: executionPlan,
      result,
      cost: totalCost,
      platform_fee: platformFee,
      savings_vs_market: savings,
      savings_from_cache: Math.round(repeatSavings * 10000) / 10000,
      latency_ms: latencyMs,
      execution_hash: proof.hash,
      memory_id: memory.memory_id,
    });
  } catch (err) {
    const latency = Date.now() - startTime;
    await run(`
      UPDATE execution_logs SET status = 'fail', error_reason = $1, latency_ms = $2, completed_at = $3
      WHERE execution_id = $4
    `, [err.message, latency, new Date().toISOString(), newExecutionId]);

    return res.status(500).json({
      execution_id: newExecutionId,
      repeat_of: originalExecutionId,
      status: 'fail',
      reason: 'internal_error',
      error: err.message,
      latency_ms: latency,
    });
  }
});

export default router;

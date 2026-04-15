import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { run, getOne } from '../services/db.js';
import { interpretIntent } from '../services/intent-interpreter.js';
import { validateIdentity } from '../services/identity-validator.js';
import { checkBudget, reserveFunds, releaseFunds } from '../services/budget-checker.js';
import { checkCompliance } from '../services/compliance-checker.js';
import { selectProvider, updateProviderScore } from '../services/provider-selector.js';
import { executeIntent, calculatePlatformFee } from '../services/executor.js';
import { generateProof } from '../services/proof-generator.js';
import { storeExecution } from '../services/memory-store.js';
import { fetchPerformanceProfile, storeExecutionToMemory } from '../services/memory-performance.js';
import { requirePayment } from '../middleware/auth.js';
import {
  findMatchingFastLane,
  recordFastLaneExecution,
  trackExecution,
  isFastLaneEligible,
} from '../services/fast-lanes.js';
import { detectRepeat, recordExecution, trackRepeatSavings } from '../services/repeat-detector.js';

// Map shorthand intent type names to canonical types
function resolveIntentType(type) {
  const t = (type || '').toLowerCase().trim();
  if (['transfer', 'pay', 'send', 'payment', 'payment_transfer'].includes(t)) return 'payment_transfer';
  if (['settle', 'settlement', 'contract', 'contract_settlement'].includes(t)) return 'contract_settlement';
  if (['compute', 'compute_job', 'run', 'execute'].includes(t)) return 'compute_job';
  return null;
}

const router = Router();

router.post('/v1/execute_intent', requirePayment('execute_intent'), async (req, res) => {
  const startTime = Date.now();
  const executionId = 'exec_' + uuidv4().replace(/-/g, '').slice(0, 20);
  const { did, intent, constraints, metadata } = req.body;
  const budget = req.body.budget || (typeof intent === 'object' ? intent.amount_usdc : undefined);

  // Validate input
  if (!did || !intent) {
    return res.status(400).json({ error: 'missing_required_fields', details: 'did and intent are required' });
  }

  // Normalize intent to a string for DB storage and interpretation
  const intentString = typeof intent === 'string' ? intent : JSON.stringify(intent);

  const now = new Date().toISOString();
  let stepFailed = 0;
  let fundsReserved = false;

  // Create initial log entry
  await run(`
    INSERT INTO execution_logs (execution_id, did, intent, constraints, budget_usdc, status, created_at)
    VALUES ($1, $2, $3, $4, $5, 'pending', $6)
  `, [executionId, did, intentString, JSON.stringify(constraints || {}), budget || 0, now]);

  const fail = async (reason, step) => {
    const latency = Date.now() - startTime;
    await run(`
      UPDATE execution_logs SET status = 'fail', error_reason = $1, step_failed = $2,
        latency_ms = $3, completed_at = $4 WHERE execution_id = $5
    `, [reason, step, latency, new Date().toISOString(), executionId]);

    return res.status(200).json({
      execution_id: executionId,
      status: 'fail',
      reason,
      step_failed: step,
      latency_ms: latency,
    });
  };

  let repeatOptimized = false;
  let savingsFromCache = 0;

  try {
    // Step 1: Validate identity
    await run('UPDATE execution_logs SET status = $1 WHERE execution_id = $2', ['executing', executionId]);

    const identity = await validateIdentity(did);
    if (!identity.valid) {
      return await fail(identity.reason || 'invalid_did', 1);
    }

    // Step 2: Interpret intent
    // Support object-form intents with a "type" field (e.g. {"type":"transfer",...})
    const interpreted = typeof intent === 'object' && intent.type
      ? { type: resolveIntentType(intent.type), reason: `Object intent type: "${intent.type}"` }
      : interpretIntent(intentString);
    if (!interpreted.type) {
      return await fail('unrecognized_intent', 2);
    }
    const intentType = interpreted.type;

    await run('UPDATE execution_logs SET intent_type = $1 WHERE execution_id = $2', [intentType, executionId]);

    // Fast lane check: see if this agent has a pre-approved path for this intent type
    let useFastLane = false;
    let matchedLane = null;
    try {
      matchedLane = await findMatchingFastLane(did, intentType, budget || 0);
      if (matchedLane) {
        useFastLane = true;
      }
    } catch (_) {
      // Never fail because fast lane check fails — fall back to normal path
    }

    // Repeat detection: check if this intent has been executed before
    const repeatResult = await detectRepeat(did, intentType, intent);

    // Step 3: Check budget
    const budgetCheck = await checkBudget(did, budget || 0);
    if (!budgetCheck.sufficient) {
      return await fail(budgetCheck.reason || 'insufficient_funds', 3);
    }

    // Step 4: Check compliance (skipped if fast lane)
    let compliance = { compliant: true, reason: 'fast_lane_bypass' };
    if (!useFastLane) {
      compliance = await checkCompliance(did, intentType, constraints);
      if (!compliance.compliant) {
        return await fail(compliance.reason || 'compliance_violation', 4);
      }
    }

    // Step 4.5: Fetch agent performance profile from HiveMind memory
    const performanceProfile = await fetchPerformanceProfile(did);

    // Step 5: Select provider — use cached routing if repeat detected, with memory optimization
    let providerResult;
    let provider;
    if (repeatResult && repeatResult.routing) {
      // Skip provider selection negotiation — use cached routing
      repeatOptimized = true;
      provider = repeatResult.routing;
      providerResult = {
        selected: provider,
        reason: `Repeat-optimized: cached routing from ${repeatResult.execution_count} prior executions`,
        alternatives: [],
        memory_enhanced: !!performanceProfile,
      };
      // Estimate 15% savings from skipping negotiation
      savingsFromCache = (repeatResult.cost || provider.price_usdc || 0) * 0.15;
    } else {
      providerResult = await selectProvider(intentType, constraints, performanceProfile);
      if (!providerResult.selected) {
        return await fail(providerResult.reason || 'no_providers_available', 5);
      }
      provider = providerResult.selected;
    }

    // Step 6: Reserve funds
    const reservation = await reserveFunds(did, budget || provider.price_usdc, executionId);
    if (!reservation.reserved) {
      return await fail('fund_reservation_failed', 6);
    }
    fundsReserved = true;

    // Step 7: Execute against provider
    // Merge object-form intent fields into metadata for the executor
    const execMetadata = typeof intent === 'object'
      ? { ...metadata, recipient_did: intent.to, amount_usdc: intent.amount_usdc, ...intent }
      : metadata;
    const execution = await executeIntent(intentType, provider, did, constraints, execMetadata);
    if (!execution.success) {
      // Compensating transaction: release reserved funds
      await releaseFunds(did, budget || provider.price_usdc, executionId);
      fundsReserved = false;
      return await fail(execution.error || 'execution_failed', 7);
    }

    // Step 8: Settlement (already handled in executor for most types)
    const cost = execution.cost || provider.price_usdc;
    const platformFee = calculatePlatformFee(cost);
    const totalCost = cost + platformFee;

    // Calculate market savings (estimated 15-25% savings vs traditional routing)
    const marketRate = cost * 1.2; // estimate 20% more expensive without optimization
    const savings = Math.max(0, marketRate - totalCost);

    const executionPlan = {
      intent_interpreted: intentType,
      interpretation_reason: useFastLane ? 'fast_lane_execution' : interpreted.reason,
      selected_providers: [{ did: provider.did, service: provider.service, price_usdc: provider.price_usdc }],
      selected_payment_rail: 'x402_base_usdc',
      routing_reason: useFastLane ? 'fast_lane_pre_approved' : providerResult.reason,
      compliance_status: compliance.reason,
      identity_reputation: identity.reputation,
      memory_enhanced: providerResult.memory_enhanced || false,
      performance_tier: performanceProfile.performance_tier,
    };

    const result = {
      transaction_id: execution.transaction_id,
      provider_response: execution.provider_response,
      settlement_id: execution.settlement_id || null,
    };

    // Step 9: Generate proof
    const timestamp = new Date().toISOString();
    const proof = await generateProof(executionId, did, intentString, result, totalCost, timestamp);

    // Step 10: Store memory
    const memory = await storeExecution(executionId, did, intentType, executionPlan, result, totalCost);

    // Step 11: Update stats
    const latencyMs = Date.now() - startTime;
    await updateProviderScore(provider.did, intentType, true, latencyMs, cost);

    // Update global stats
    await run(`
      UPDATE execution_stats SET
        total_executions = total_executions + 1,
        total_volume_usdc = total_volume_usdc + $1,
        total_savings_usdc = total_savings_usdc + $2,
        executions_today = executions_today + 1,
        last_updated = $3
      WHERE id = 1
    `, [totalCost, savings, timestamp]);

    // Step 11.5: Store execution result back to HiveMind for performance learning
    storeExecutionToMemory(did, {
      execution_id: executionId,
      intent_type: intentType,
      provider: provider.did,
      cost: totalCost,
      success: true,
      latency_ms: latencyMs,
      timestamp,
    }).catch(() => {}); // fire-and-forget, never block

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

    // Track execution for fast lane auto-creation
    if (useFastLane) {
      await recordFastLaneExecution(matchedLane.lane_id, savings);
    }
    let autoCreatedLane = null;
    try {
      autoCreatedLane = await trackExecution(did, intentType, totalCost);
    } catch (_) {
      // Never fail because tracking fails
    }

    // Record in repeat cache for future optimization
    try {
      await recordExecution(did, intentType, intent, provider.did, totalCost, provider, executionId);
      if (repeatOptimized) {
        await trackRepeatSavings(savingsFromCache);
      }
    } catch {
      // Never fail execution because of cache recording
    }

    // Step 12: Return result
    const response = {
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
      performance_tier: performanceProfile ? performanceProfile.performance_tier : 'bronze',
      memory_enhanced: providerResult.memory_enhanced || false,
    };

    // Add fast lane info to response
    if (useFastLane) {
      response.fast_lane = true;
      response.lane_id = matchedLane.lane_id;
    } else {
      let eligible = false;
      try { eligible = await isFastLaneEligible(did, intentType); } catch { eligible = false; }
      response.fast_lane_eligible = eligible;
    }

    if (autoCreatedLane) {
      response.fast_lane_created = autoCreatedLane.lane_id;
    }

    // Add repeat optimization info
    if (repeatOptimized) {
      response.repeat_optimized = true;
      response.savings_from_cache = Math.round(savingsFromCache * 10000) / 10000;
    }

    return res.json(response);
  } catch (err) {
    // Compensating transaction on unexpected errors
    if (fundsReserved) {
      await releaseFunds(did, budget || 0, executionId).catch(() => {});
    }
    const latency = Date.now() - startTime;
    const failTs = new Date().toISOString();
    await run(`
      UPDATE execution_logs SET status = 'fail', error_reason = $1, latency_ms = $2, completed_at = $3
      WHERE execution_id = $4
    `, [err.message, latency, failTs, executionId]);

    // Store failed execution to HiveMind for performance learning
    if (did) {
      storeExecutionToMemory(did, {
        execution_id: executionId,
        intent_type: 'unknown',
        provider: null,
        cost: 0,
        success: false,
        latency_ms: latency,
        timestamp: failTs,
      }).catch(() => {});
    }

    return res.status(500).json({
      execution_id: executionId,
      status: 'fail',
      reason: 'internal_error',
      error: err.message,
      latency_ms: latency,
    });
  }
});

export default router;

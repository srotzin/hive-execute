import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getTier, buildPerformanceProfile, TIER_THRESHOLDS } from '../src/services/memory-performance.js';

describe('getTier', () => {
  it('returns bronze for 0 executions', () => {
    assert.equal(getTier(0), 'bronze');
  });

  it('returns bronze for < 20 executions', () => {
    assert.equal(getTier(19), 'bronze');
  });

  it('returns silver at 20 executions', () => {
    assert.equal(getTier(20), 'silver');
  });

  it('returns gold at 50 executions', () => {
    assert.equal(getTier(50), 'gold');
  });

  it('returns platinum at 100 executions', () => {
    assert.equal(getTier(100), 'platinum');
  });

  it('returns platinum for large counts', () => {
    assert.equal(getTier(999), 'platinum');
  });
});

describe('buildPerformanceProfile', () => {
  it('returns empty profile for empty memories', () => {
    const profile = buildPerformanceProfile([]);
    assert.equal(profile.execution_count, 0);
    assert.equal(profile.performance_tier, 'bronze');
    assert.equal(profile.has_history, false);
    assert.deepEqual(profile.preferred_providers, []);
    assert.deepEqual(profile.avg_cost_by_intent, {});
    assert.deepEqual(profile.success_rate_by_provider, {});
  });

  it('counts executions correctly', () => {
    const memories = [
      { content: { provider: 'did:hive:p1', intent_type: 'compute_job', cost_usdc: 0.05, success: true } },
      { content: { provider: 'did:hive:p1', intent_type: 'compute_job', cost_usdc: 0.03, success: true } },
      { content: { provider: 'did:hive:p2', intent_type: 'payment_transfer', cost_usdc: 0.01, success: true } },
    ];
    const profile = buildPerformanceProfile(memories);
    assert.equal(profile.execution_count, 3);
    assert.equal(profile.has_history, true);
    assert.equal(profile.performance_tier, 'bronze');
  });

  it('computes avg cost by intent type', () => {
    const memories = [
      { content: { provider: 'did:hive:p1', intent_type: 'compute_job', cost_usdc: 0.04 } },
      { content: { provider: 'did:hive:p1', intent_type: 'compute_job', cost_usdc: 0.06 } },
      { content: { provider: 'did:hive:p2', intent_type: 'payment_transfer', cost_usdc: 0.01 } },
    ];
    const profile = buildPerformanceProfile(memories);
    assert.equal(profile.avg_cost_by_intent.compute_job, 0.05);
    assert.equal(profile.avg_cost_by_intent.payment_transfer, 0.01);
  });

  it('computes success rate by provider', () => {
    const memories = [
      { content: { provider: 'did:hive:p1', intent_type: 'compute_job', cost_usdc: 0.05, success: true } },
      { content: { provider: 'did:hive:p1', intent_type: 'compute_job', cost_usdc: 0.05, success: true } },
      { content: { provider: 'did:hive:p1', intent_type: 'compute_job', cost_usdc: 0.05, status: 'fail' } },
    ];
    const profile = buildPerformanceProfile(memories);
    // 2 successes, 1 failure (status: 'fail') = 2/3
    assert.ok(Math.abs(profile.success_rate_by_provider['did:hive:p1'] - 2/3) < 0.001);
  });

  it('only includes preferred providers with >= 2 executions', () => {
    const memories = [
      { content: { provider: 'did:hive:p1', intent_type: 'compute_job', cost_usdc: 0.05 } },
      { content: { provider: 'did:hive:p1', intent_type: 'compute_job', cost_usdc: 0.05 } },
      { content: { provider: 'did:hive:p2', intent_type: 'compute_job', cost_usdc: 0.05 } },
    ];
    const profile = buildPerformanceProfile(memories);
    assert.equal(profile.preferred_providers.length, 1);
    assert.equal(profile.preferred_providers[0].did, 'did:hive:p1');
    assert.equal(profile.preferred_providers[0].executions, 2);
  });

  it('sorts preferred providers by success rate descending', () => {
    const memories = [
      // p1: 2/3 success rate
      { content: { provider: 'did:hive:p1', intent_type: 'compute_job', cost_usdc: 0.05, success: true } },
      { content: { provider: 'did:hive:p1', intent_type: 'compute_job', cost_usdc: 0.05, success: true } },
      { content: { provider: 'did:hive:p1', intent_type: 'compute_job', cost_usdc: 0.05, status: 'fail' } },
      // p2: 2/2 success rate
      { content: { provider: 'did:hive:p2', intent_type: 'compute_job', cost_usdc: 0.03, success: true } },
      { content: { provider: 'did:hive:p2', intent_type: 'compute_job', cost_usdc: 0.03, success: true } },
    ];
    const profile = buildPerformanceProfile(memories);
    assert.equal(profile.preferred_providers.length, 2);
    assert.equal(profile.preferred_providers[0].did, 'did:hive:p2'); // 100% success
    assert.equal(profile.preferred_providers[1].did, 'did:hive:p1'); // 66% success
  });

  it('returns correct tier based on execution count', () => {
    const memories = Array.from({ length: 55 }, (_, i) => ({
      content: { provider: 'did:hive:p1', intent_type: 'compute_job', cost_usdc: 0.05 },
    }));
    const profile = buildPerformanceProfile(memories);
    assert.equal(profile.performance_tier, 'gold');
    assert.equal(profile.execution_count, 55);
  });

  it('handles memories with data field instead of content', () => {
    const memories = [
      { data: { provider: 'did:hive:p1', intent_type: 'compute_job', cost_usdc: 0.05 } },
      { data: { provider: 'did:hive:p1', intent_type: 'compute_job', cost_usdc: 0.03 } },
    ];
    const profile = buildPerformanceProfile(memories);
    assert.equal(profile.execution_count, 2);
    assert.equal(profile.preferred_providers.length, 1);
  });

  it('handles flat memory objects (no content/data wrapper)', () => {
    const memories = [
      { provider: 'did:hive:p1', intent_type: 'compute_job', cost_usdc: 0.05 },
      { provider: 'did:hive:p1', intent_type: 'compute_job', cost_usdc: 0.03 },
    ];
    const profile = buildPerformanceProfile(memories);
    assert.equal(profile.execution_count, 2);
  });

  it('handles missing cost gracefully', () => {
    const memories = [
      { content: { provider: 'did:hive:p1', intent_type: 'compute_job' } },
      { content: { provider: 'did:hive:p1', intent_type: 'compute_job', cost_usdc: 0.10 } },
    ];
    const profile = buildPerformanceProfile(memories);
    assert.equal(profile.avg_cost_by_intent.compute_job, 0.05);
  });
});

describe('TIER_THRESHOLDS', () => {
  it('has correct threshold values', () => {
    assert.equal(TIER_THRESHOLDS.platinum, 100);
    assert.equal(TIER_THRESHOLDS.gold, 50);
    assert.equal(TIER_THRESHOLDS.silver, 20);
    assert.equal(TIER_THRESHOLDS.bronze, 0);
  });
});

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, teardownTestDb, pool } from './test-setup.js';
import {
  hashIntent,
  detectRepeat,
  recordExecution,
  getAgentRepeatStats,
  findCachedExecution,
  getRepeatStats,
  trackRepeatSavings,
  CACHE_TTL_MS,
} from '../src/services/repeat-detector.js';

describe('repeat-detector', () => {
  before(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM repeat_cache');
    await pool.query(`
      UPDATE repeat_stats SET total_repeat_executions = 0, total_repeat_savings_usdc = 0 WHERE id = 1
    `);
  });

  after(async () => {
    await teardownTestDb();
  });

  describe('hashIntent', () => {
    it('should produce deterministic hashes for same inputs', () => {
      const h1 = hashIntent('did:hive:agent-1', 'payment_transfer', { to: 'did:hive:agent-2', amount: 10 });
      const h2 = hashIntent('did:hive:agent-1', 'payment_transfer', { to: 'did:hive:agent-2', amount: 10 });
      assert.equal(h1, h2);
    });

    it('should produce different hashes for different inputs', () => {
      const h1 = hashIntent('did:hive:agent-1', 'payment_transfer', { to: 'did:hive:agent-2', amount: 10 });
      const h2 = hashIntent('did:hive:agent-1', 'payment_transfer', { to: 'did:hive:agent-3', amount: 10 });
      assert.notEqual(h1, h2);
    });

    it('should produce same hash regardless of key order', () => {
      const h1 = hashIntent('did:hive:agent-1', 'payment_transfer', { amount: 10, to: 'did:hive:agent-2' });
      const h2 = hashIntent('did:hive:agent-1', 'payment_transfer', { to: 'did:hive:agent-2', amount: 10 });
      assert.equal(h1, h2);
    });

    it('should handle string parameters', () => {
      const h1 = hashIntent('did:hive:agent-1', 'compute_job', 'run inference');
      const h2 = hashIntent('did:hive:agent-1', 'compute_job', 'Run Inference');
      assert.equal(h1, h2);
    });

    it('should handle null/undefined parameters', () => {
      const h1 = hashIntent('did:hive:agent-1', 'compute_job', null);
      const h2 = hashIntent('did:hive:agent-1', 'compute_job', undefined);
      assert.equal(h1, h2);
    });
  });

  describe('detectRepeat', () => {
    it('should return null for first execution', async () => {
      const result = await detectRepeat('did:hive:agent-1', 'payment_transfer', { to: 'agent-2' });
      assert.equal(result, null);
    });

    it('should return null after only one execution (below threshold)', async () => {
      const params = { to: 'did:hive:agent-2', amount: 10 };
      const provider = { did: 'did:hive:pay-001', service: 'vault_transfer', price_usdc: 0.005 };
      await recordExecution('did:hive:agent-1', 'payment_transfer', params, provider.did, 0.005, provider, 'exec_001');

      const result = await detectRepeat('did:hive:agent-1', 'payment_transfer', params);
      assert.equal(result, null);
    });

    it('should return cached routing after threshold met (2 executions)', async () => {
      const params = { to: 'did:hive:agent-2', amount: 10 };
      const provider = { did: 'did:hive:pay-001', service: 'vault_transfer', price_usdc: 0.005 };

      await recordExecution('did:hive:agent-1', 'payment_transfer', params, provider.did, 0.005, provider, 'exec_001');
      await recordExecution('did:hive:agent-1', 'payment_transfer', params, provider.did, 0.005, provider, 'exec_002');

      const result = await detectRepeat('did:hive:agent-1', 'payment_transfer', params);
      assert.notEqual(result, null);
      assert.equal(result.provider_did, 'did:hive:pay-001');
      assert.equal(result.execution_count, 2);
      assert.equal(result.intent_type, 'payment_transfer');
    });

    it('should not cross-contaminate between agents', async () => {
      const params = { to: 'did:hive:agent-2', amount: 10 };
      const provider = { did: 'did:hive:pay-001', service: 'vault_transfer', price_usdc: 0.005 };

      await recordExecution('did:hive:agent-1', 'payment_transfer', params, provider.did, 0.005, provider, 'exec_001');
      await recordExecution('did:hive:agent-1', 'payment_transfer', params, provider.did, 0.005, provider, 'exec_002');

      // Agent-2 should not see agent-1's cache
      const result = await detectRepeat('did:hive:agent-2', 'payment_transfer', params);
      assert.equal(result, null);
    });

    it('should not return expired entries', async () => {
      const params = { to: 'did:hive:agent-2', amount: 10 };
      const provider = { did: 'did:hive:pay-001', service: 'vault_transfer', price_usdc: 0.005 };

      await recordExecution('did:hive:agent-1', 'payment_transfer', params, provider.did, 0.005, provider, 'exec_001');
      await recordExecution('did:hive:agent-1', 'payment_transfer', params, provider.did, 0.005, provider, 'exec_002');

      // Manually expire the entry
      const expiredTimestamp = Date.now() - CACHE_TTL_MS - 1000;
      await pool.query(`UPDATE repeat_cache SET updated_at = $1 WHERE agent_did = $2`, [expiredTimestamp, 'did:hive:agent-1']);

      const result = await detectRepeat('did:hive:agent-1', 'payment_transfer', params);
      assert.equal(result, null);
    });
  });

  describe('recordExecution', () => {
    it('should increment execution count for repeated intents', async () => {
      const params = { to: 'did:hive:agent-2' };
      const provider = { did: 'did:hive:pay-001', service: 'vault_transfer', price_usdc: 0.005 };

      await recordExecution('did:hive:agent-1', 'payment_transfer', params, provider.did, 0.005, provider, 'exec_001');
      await recordExecution('did:hive:agent-1', 'payment_transfer', params, provider.did, 0.005, provider, 'exec_002');
      await recordExecution('did:hive:agent-1', 'payment_transfer', params, provider.did, 0.005, provider, 'exec_003');

      const stats = await getAgentRepeatStats('did:hive:agent-1');
      assert.equal(stats.entries[0].execution_count, 3);
    });

    it('should track different intents separately', async () => {
      const provider = { did: 'did:hive:pay-001', service: 'vault_transfer', price_usdc: 0.005 };

      await recordExecution('did:hive:agent-1', 'payment_transfer', { to: 'agent-2' }, provider.did, 0.005, provider, 'exec_001');
      await recordExecution('did:hive:agent-1', 'compute_job', { task: 'inference' }, provider.did, 0.05, provider, 'exec_002');

      const stats = await getAgentRepeatStats('did:hive:agent-1');
      assert.equal(stats.total_cached, 2);
      assert.equal(stats.entries.length, 2);
    });
  });

  describe('getAgentRepeatStats', () => {
    it('should return empty stats for unknown agent', async () => {
      const stats = await getAgentRepeatStats('did:hive:unknown');
      assert.equal(stats.total_cached, 0);
      assert.equal(stats.repeat_intents, 0);
      assert.deepEqual(stats.entries, []);
    });

    it('should return correct repeat count', async () => {
      const params = { to: 'did:hive:agent-2' };
      const provider = { did: 'did:hive:pay-001', service: 'vault_transfer', price_usdc: 0.005 };

      await recordExecution('did:hive:agent-1', 'payment_transfer', params, provider.did, 0.005, provider, 'exec_001');
      await recordExecution('did:hive:agent-1', 'payment_transfer', params, provider.did, 0.005, provider, 'exec_002');

      const stats = await getAgentRepeatStats('did:hive:agent-1');
      assert.equal(stats.total_cached, 1);
      assert.equal(stats.repeat_intents, 1);
    });
  });

  describe('findCachedExecution', () => {
    it('should find cached execution by execution_id', async () => {
      const params = { to: 'did:hive:agent-2' };
      const provider = { did: 'did:hive:pay-001', service: 'vault_transfer', price_usdc: 0.005 };

      await recordExecution('did:hive:agent-1', 'payment_transfer', params, provider.did, 0.005, provider, 'exec_001');

      const found = await findCachedExecution('exec_001');
      assert.notEqual(found, null);
      assert.equal(found.did, 'did:hive:agent-1');
      assert.equal(found.provider_did, 'did:hive:pay-001');
    });

    it('should return null for unknown execution_id', async () => {
      const found = await findCachedExecution('exec_unknown');
      assert.equal(found, null);
    });
  });

  describe('getRepeatStats', () => {
    it('should return global stats including tracked savings', async () => {
      await trackRepeatSavings(0.001);
      await trackRepeatSavings(0.002);

      const stats = await getRepeatStats();
      assert.equal(stats.repeat_executions >= 2, true);
      assert.equal(stats.repeat_savings_usdc >= 0.003, true);
    });
  });
});

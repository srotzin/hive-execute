import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectPatterns, extractRecipient } from '../src/services/pattern-analyzer.js';

describe('pattern-analyzer', () => {
  describe('detectPatterns', () => {
    it('should return empty array for empty history', () => {
      const patterns = detectPatterns('did:hive:agent-1', []);
      assert.deepEqual(patterns, []);
    });

    it('should return empty array for null history', () => {
      const patterns = detectPatterns('did:hive:agent-1', null);
      assert.deepEqual(patterns, []);
    });

    it('should detect recurring_payment pattern', () => {
      const history = [
        {
          execution_id: 'exec_001',
          intent_type: 'payment_transfer',
          status: 'success',
          cost_usdc: 0.005,
          latency_ms: 120,
          provider_did: 'did:hive:pay-001',
          intent: JSON.stringify({ to: 'did:hive:agent-2', amount_usdc: 10 }),
          created_at: '2026-04-15T10:00:00Z',
        },
        {
          execution_id: 'exec_002',
          intent_type: 'payment_transfer',
          status: 'success',
          cost_usdc: 0.005,
          latency_ms: 130,
          provider_did: 'did:hive:pay-001',
          intent: JSON.stringify({ to: 'did:hive:agent-2', amount_usdc: 10 }),
          created_at: '2026-04-15T11:00:00Z',
        },
      ];

      const patterns = detectPatterns('did:hive:agent-1', history);
      const recurring = patterns.filter(p => p.pattern_type === 'recurring_payment');
      assert.equal(recurring.length >= 1, true);
      assert.equal(recurring[0].frequency, 2);
    });

    it('should detect periodic_lookup pattern', () => {
      const history = [
        {
          execution_id: 'exec_001',
          intent_type: 'compute_job',
          status: 'success',
          cost_usdc: 0.05,
          latency_ms: 200,
          created_at: '2026-04-15T10:00:00Z',
        },
        {
          execution_id: 'exec_002',
          intent_type: 'compute_job',
          status: 'success',
          cost_usdc: 0.05,
          latency_ms: 210,
          created_at: '2026-04-15T12:00:00Z',
        },
        {
          execution_id: 'exec_003',
          intent_type: 'compute_job',
          status: 'success',
          cost_usdc: 0.04,
          latency_ms: 190,
          created_at: '2026-04-15T14:00:00Z',
        },
      ];

      const patterns = detectPatterns('did:hive:agent-1', history);
      const periodic = patterns.filter(p => p.pattern_type === 'periodic_lookup');
      assert.equal(periodic.length >= 1, true);
      assert.equal(periodic[0].frequency, 3);
      assert.equal(periodic[0].details.intent_type, 'compute_job');
    });

    it('should detect batch_operation pattern', () => {
      // 3 executions within 5 minutes of each other
      const history = [
        {
          execution_id: 'exec_001',
          intent_type: 'payment_transfer',
          status: 'success',
          cost_usdc: 0.005,
          latency_ms: 100,
          created_at: '2026-04-15T10:00:00Z',
        },
        {
          execution_id: 'exec_002',
          intent_type: 'payment_transfer',
          status: 'success',
          cost_usdc: 0.005,
          latency_ms: 100,
          created_at: '2026-04-15T10:01:00Z',
        },
        {
          execution_id: 'exec_003',
          intent_type: 'payment_transfer',
          status: 'success',
          cost_usdc: 0.005,
          latency_ms: 100,
          created_at: '2026-04-15T10:02:00Z',
        },
      ];

      const patterns = detectPatterns('did:hive:agent-1', history);
      const batch = patterns.filter(p => p.pattern_type === 'batch_operation');
      assert.equal(batch.length >= 1, true);
      assert.equal(batch[0].frequency, 3);
    });

    it('should skip failed executions for recurring payment detection', () => {
      const history = [
        {
          execution_id: 'exec_001',
          intent_type: 'payment_transfer',
          status: 'fail',
          cost_usdc: 0,
          provider_did: 'did:hive:pay-001',
          created_at: '2026-04-15T10:00:00Z',
        },
        {
          execution_id: 'exec_002',
          intent_type: 'payment_transfer',
          status: 'success',
          cost_usdc: 0.005,
          provider_did: 'did:hive:pay-001',
          created_at: '2026-04-15T11:00:00Z',
        },
      ];

      const patterns = detectPatterns('did:hive:agent-1', history);
      const recurring = patterns.filter(p => p.pattern_type === 'recurring_payment');
      // Only 1 successful payment to same recipient, below threshold
      assert.equal(recurring.length, 0);
    });
  });

  describe('extractRecipient', () => {
    it('should extract recipient from JSON intent with "to" field', () => {
      const exec = { intent: JSON.stringify({ to: 'did:hive:agent-2', amount_usdc: 10 }) };
      assert.equal(extractRecipient(exec), 'did:hive:agent-2');
    });

    it('should extract recipient from JSON intent with "recipient_did" field', () => {
      const exec = { intent: JSON.stringify({ recipient_did: 'did:hive:agent-3' }) };
      assert.equal(extractRecipient(exec), 'did:hive:agent-3');
    });

    it('should fall back to provider_did', () => {
      const exec = { intent: 'pay 10 USDC', provider_did: 'did:hive:pay-001' };
      assert.equal(extractRecipient(exec), 'did:hive:pay-001');
    });

    it('should return null if no recipient found', () => {
      const exec = { intent: 'do something' };
      assert.equal(extractRecipient(exec), null);
    });
  });
});

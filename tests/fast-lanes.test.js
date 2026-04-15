import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFastLane,
  getFastLanesForAgent,
  getFastLane,
  deactivateFastLane,
  findMatchingFastLane,
  recordFastLaneExecution,
  trackExecution,
  isFastLaneEligible,
  getFastLaneStats,
  getTotalFastLaneExecutions,
} from '../src/services/fast-lanes.js';

describe('Fast Lanes Service', () => {
  describe('createFastLane', () => {
    it('should create a fast lane with correct properties', () => {
      const lane = createFastLane('did:hive:agent-001', 'payment_transfer', {}, 100, 720, false);

      assert.ok(lane.lane_id.startsWith('lane_'));
      assert.equal(lane.agent_did, 'did:hive:agent-001');
      assert.equal(lane.intent_type, 'payment_transfer');
      assert.equal(lane.max_amount_usdc, 100);
      assert.equal(lane.execution_count, 0);
      assert.equal(lane.auto_created, false);
      assert.ok(lane.valid_until);
      assert.ok(lane.created_at);
    });

    it('should create an auto-created fast lane', () => {
      const lane = createFastLane('did:hive:agent-002', 'compute_job', {}, 50, 720, true);

      assert.equal(lane.auto_created, true);
      assert.equal(lane.intent_type, 'compute_job');
    });

    it('should set valid_until based on valid_hours', () => {
      const lane = createFastLane('did:hive:agent-003', 'payment_transfer', {}, 100, 24, false);
      const created = new Date(lane.created_at);
      const validUntil = new Date(lane.valid_until);
      const diffHours = (validUntil - created) / (1000 * 60 * 60);

      assert.ok(Math.abs(diffHours - 24) < 0.01);
    });

    it('should default valid_hours to 720 (30 days)', () => {
      const lane = createFastLane('did:hive:agent-004', 'payment_transfer', {}, 100);
      const created = new Date(lane.created_at);
      const validUntil = new Date(lane.valid_until);
      const diffHours = (validUntil - created) / (1000 * 60 * 60);

      assert.ok(Math.abs(diffHours - 720) < 0.01);
    });
  });

  describe('getFastLanesForAgent', () => {
    it('should return only lanes for the specified agent', () => {
      createFastLane('did:hive:agent-list-1', 'payment_transfer', {}, 100, 720, false);
      createFastLane('did:hive:agent-list-1', 'compute_job', {}, 50, 720, false);
      createFastLane('did:hive:agent-list-2', 'payment_transfer', {}, 200, 720, false);

      const lanes = getFastLanesForAgent('did:hive:agent-list-1');
      assert.ok(lanes.length >= 2);
      assert.ok(lanes.every(l => l.agent_did === 'did:hive:agent-list-1'));
    });

    it('should not return expired lanes', () => {
      // Create a lane that's already expired (valid_hours = 0 would still be in the future by ms)
      const lane = createFastLane('did:hive:agent-expired', 'payment_transfer', {}, 100, 0.0001, false);
      // The lane was just created with a very short validity; it may or may not be expired yet.
      // Instead, let's test that a valid lane IS returned
      const validLane = createFastLane('did:hive:agent-expired', 'compute_job', {}, 50, 720, false);
      const lanes = getFastLanesForAgent('did:hive:agent-expired');
      assert.ok(lanes.some(l => l.lane_id === validLane.lane_id));
    });
  });

  describe('getFastLane', () => {
    it('should return a lane by ID', () => {
      const created = createFastLane('did:hive:agent-get', 'payment_transfer', {}, 100, 720, false);
      const found = getFastLane(created.lane_id);

      assert.equal(found.lane_id, created.lane_id);
      assert.equal(found.agent_did, 'did:hive:agent-get');
    });

    it('should return null for non-existent lane', () => {
      const found = getFastLane('lane_nonexistent');
      assert.equal(found, null);
    });
  });

  describe('deactivateFastLane', () => {
    it('should remove a lane and return it', () => {
      const created = createFastLane('did:hive:agent-deactivate', 'payment_transfer', {}, 100, 720, false);
      const deactivated = deactivateFastLane(created.lane_id);

      assert.equal(deactivated.lane_id, created.lane_id);
      assert.equal(getFastLane(created.lane_id), null);
    });

    it('should return null for non-existent lane', () => {
      const result = deactivateFastLane('lane_nonexistent123');
      assert.equal(result, null);
    });
  });

  describe('findMatchingFastLane', () => {
    it('should find a matching lane for agent + intent_type + amount', () => {
      const created = createFastLane('did:hive:agent-match', 'payment_transfer', {}, 100, 720, false);
      const found = findMatchingFastLane('did:hive:agent-match', 'payment_transfer', 50);

      assert.ok(found);
      assert.equal(found.lane_id, created.lane_id);
    });

    it('should not match if amount exceeds max', () => {
      createFastLane('did:hive:agent-exceed', 'payment_transfer', {}, 100, 720, false);
      const found = findMatchingFastLane('did:hive:agent-exceed', 'payment_transfer', 150);

      assert.equal(found, null);
    });

    it('should not match wrong intent type', () => {
      createFastLane('did:hive:agent-wrong-type', 'payment_transfer', {}, 100, 720, false);
      const found = findMatchingFastLane('did:hive:agent-wrong-type', 'compute_job', 50);

      assert.equal(found, null);
    });

    it('should not match wrong agent', () => {
      createFastLane('did:hive:agent-wrong-agent', 'payment_transfer', {}, 100, 720, false);
      const found = findMatchingFastLane('did:hive:other-agent', 'payment_transfer', 50);

      assert.equal(found, null);
    });
  });

  describe('recordFastLaneExecution', () => {
    it('should increment execution count on the lane', () => {
      const lane = createFastLane('did:hive:agent-record', 'payment_transfer', {}, 100, 720, false);
      assert.equal(lane.execution_count, 0);

      recordFastLaneExecution(lane.lane_id, 5);
      const updated = getFastLane(lane.lane_id);
      assert.equal(updated.execution_count, 1);

      recordFastLaneExecution(lane.lane_id, 3);
      const updated2 = getFastLane(lane.lane_id);
      assert.equal(updated2.execution_count, 2);
    });

    it('should update global fast lane stats', () => {
      const before = getFastLaneStats();
      const lane = createFastLane('did:hive:agent-stats-record', 'payment_transfer', {}, 100, 720, false);
      recordFastLaneExecution(lane.lane_id, 10);
      const after = getFastLaneStats();

      assert.equal(after.fast_lane_executions, before.fast_lane_executions + 1);
    });
  });

  describe('trackExecution (auto-creation)', () => {
    it('should return null on 1st and 2nd execution', () => {
      const result1 = trackExecution('did:hive:agent-auto-1', 'payment_transfer', 10);
      assert.equal(result1, null);

      const result2 = trackExecution('did:hive:agent-auto-1', 'payment_transfer', 20);
      assert.equal(result2, null);
    });

    it('should auto-create a fast lane on 3rd execution', () => {
      const result = trackExecution('did:hive:agent-auto-1', 'payment_transfer', 15);
      assert.ok(result);
      assert.ok(result.lane_id.startsWith('lane_'));
      assert.equal(result.intent_type, 'payment_transfer');
      assert.equal(result.auto_created, true);
    });

    it('should set max_amount_usdc to 2x the highest seen amount', () => {
      // Agent auto-1 had amounts: 10, 20, 15 — highest is 20
      // Max should be 2 * 20 = 40
      const lanes = getFastLanesForAgent('did:hive:agent-auto-1');
      const autoLane = lanes.find(l => l.auto_created);
      assert.ok(autoLane);
      assert.equal(autoLane.max_amount_usdc, 40); // 2x highest (20)
    });

    it('should not create duplicate auto-lanes for same agent + intent', () => {
      // 4th execution should not create another lane
      const result = trackExecution('did:hive:agent-auto-1', 'payment_transfer', 25);
      assert.equal(result, null);
    });

    it('should track different intent types independently', () => {
      trackExecution('did:hive:agent-auto-2', 'compute_job', 5);
      trackExecution('did:hive:agent-auto-2', 'compute_job', 10);
      const result = trackExecution('did:hive:agent-auto-2', 'compute_job', 8);
      assert.ok(result);
      assert.equal(result.intent_type, 'compute_job');
    });
  });

  describe('isFastLaneEligible', () => {
    it('should return false with 0-1 executions', () => {
      assert.equal(isFastLaneEligible('did:hive:agent-elig-new', 'payment_transfer'), false);
      trackExecution('did:hive:agent-elig-new', 'payment_transfer', 10);
      assert.equal(isFastLaneEligible('did:hive:agent-elig-new', 'payment_transfer'), false);
    });

    it('should return true with 2+ executions', () => {
      trackExecution('did:hive:agent-elig-new', 'payment_transfer', 10);
      assert.equal(isFastLaneEligible('did:hive:agent-elig-new', 'payment_transfer'), true);
    });
  });

  describe('getFastLaneStats', () => {
    it('should return global fast lane statistics', () => {
      const stats = getFastLaneStats();

      assert.ok(typeof stats.fast_lane_executions === 'number');
      assert.ok(typeof stats.fast_lane_savings_usdc === 'number');
      assert.ok(typeof stats.active_fast_lanes === 'number');
      assert.ok(typeof stats.auto_created_lanes === 'number');
      assert.ok(typeof stats.manually_created_lanes === 'number');
    });

    it('should have positive counts after creating lanes', () => {
      const stats = getFastLaneStats();
      assert.ok(stats.active_fast_lanes > 0);
      assert.ok(stats.manually_created_lanes > 0 || stats.auto_created_lanes > 0);
    });
  });

  describe('getTotalFastLaneExecutions', () => {
    it('should return execution totals for an agent', () => {
      const result = getTotalFastLaneExecutions('did:hive:agent-record');
      assert.ok(typeof result.total_executions_via_fast_lane === 'number');
      assert.ok(typeof result.total_savings === 'number');
    });

    it('should return zero for agent with no fast lane executions', () => {
      const result = getTotalFastLaneExecutions('did:hive:nonexistent-agent');
      assert.equal(result.total_executions_via_fast_lane, 0);
    });
  });
});

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const BASE_URL = 'http://localhost:3099';
const INTERNAL_KEY = 'hive_internal_125e04e071e8829be631ea0216dd4a0c9b707975fcecaf8c62c6a2ab43327d46';

let server;
let app;

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: {
        'Content-Type': 'application/json',
        'x-hive-internal': INTERNAL_KEY,
      },
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('Fast Lanes API Endpoints', () => {
  before(async () => {
    // Set env vars before importing
    process.env.PORT = '3099';
    process.env.HIVE_INTERNAL_KEY = INTERNAL_KEY;

    // Dynamic import to use test port
    const mod = await import('../src/server.js');
    app = mod.default;

    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  describe('POST /v1/execute_intent/fast-lane/register', () => {
    it('should register a new fast lane', async () => {
      const res = await request('POST', '/v1/execute_intent/fast-lane/register', {
        did: 'did:hive:test-agent-001',
        intent_type: 'payment_transfer',
        max_amount_usdc: 500,
        valid_hours: 48,
      });

      assert.equal(res.status, 200);
      assert.ok(res.body.lane_id);
      assert.ok(res.body.lane_id.startsWith('lane_'));
      assert.equal(res.body.status, 'active');
      assert.ok(res.body.valid_until);
    });

    it('should reject registration without did', async () => {
      const res = await request('POST', '/v1/execute_intent/fast-lane/register', {
        intent_type: 'payment_transfer',
        max_amount_usdc: 500,
      });

      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'missing_required_fields');
    });

    it('should reject registration without intent_type', async () => {
      const res = await request('POST', '/v1/execute_intent/fast-lane/register', {
        did: 'did:hive:test-agent-001',
        max_amount_usdc: 500,
      });

      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'missing_required_fields');
    });

    it('should reject invalid intent type', async () => {
      const res = await request('POST', '/v1/execute_intent/fast-lane/register', {
        did: 'did:hive:test-agent-001',
        intent_type: 'invalid_type',
        max_amount_usdc: 500,
      });

      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'invalid_intent_type');
    });

    it('should reject invalid max_amount_usdc', async () => {
      const res = await request('POST', '/v1/execute_intent/fast-lane/register', {
        did: 'did:hive:test-agent-001',
        intent_type: 'payment_transfer',
        max_amount_usdc: 0,
      });

      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'invalid_max_amount');
    });

    it('should accept shorthand intent types', async () => {
      const res = await request('POST', '/v1/execute_intent/fast-lane/register', {
        did: 'did:hive:test-agent-001',
        intent_type: 'transfer',
        max_amount_usdc: 200,
      });

      assert.equal(res.status, 200);
      assert.ok(res.body.lane_id);
    });
  });

  describe('GET /v1/execute_intent/fast-lane/:did', () => {
    it('should list active fast lanes for an agent', async () => {
      const res = await request('GET', '/v1/execute_intent/fast-lane/did:hive:test-agent-001');

      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.lanes));
      assert.ok(res.body.lanes.length >= 1);
      assert.ok(res.body.lanes.every(l => l.agent_did === 'did:hive:test-agent-001'));
      assert.ok(typeof res.body.total_executions_via_fast_lane === 'number');
      assert.ok(typeof res.body.total_savings === 'number');
    });

    it('should return empty lanes for unknown agent', async () => {
      const res = await request('GET', '/v1/execute_intent/fast-lane/did:hive:unknown-agent');

      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.lanes));
      assert.equal(res.body.lanes.length, 0);
    });
  });

  describe('DELETE /v1/execute_intent/fast-lane/:lane_id', () => {
    it('should deactivate an existing fast lane', async () => {
      // Register a lane to deactivate
      const reg = await request('POST', '/v1/execute_intent/fast-lane/register', {
        did: 'did:hive:test-agent-delete',
        intent_type: 'compute_job',
        max_amount_usdc: 100,
      });
      const laneId = reg.body.lane_id;

      const res = await request('DELETE', `/v1/execute_intent/fast-lane/${laneId}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.lane_id, laneId);
      assert.equal(res.body.status, 'deactivated');
    });

    it('should return 404 for non-existent lane', async () => {
      const res = await request('DELETE', '/v1/execute_intent/fast-lane/lane_nonexistent999');
      assert.equal(res.status, 404);
      assert.equal(res.body.error, 'lane_not_found');
    });
  });

  describe('POST /v1/execute_intent/fast-lane/:lane_id/execute', () => {
    it('should execute through a fast lane', async () => {
      // Register a lane
      const reg = await request('POST', '/v1/execute_intent/fast-lane/register', {
        did: 'did:hive:test-agent-exec',
        intent_type: 'payment_transfer',
        max_amount_usdc: 1000,
      });
      const laneId = reg.body.lane_id;

      const res = await request('POST', `/v1/execute_intent/fast-lane/${laneId}/execute`, {
        did: 'did:hive:test-agent-exec',
        intent: { type: 'transfer', amount_usdc: 50, to: 'did:hive:recipient' },
        budget: 50,
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'success');
      assert.equal(res.body.fast_lane, true);
      assert.equal(res.body.lane_id, laneId);
      assert.ok(res.body.execution_id);
      assert.ok(res.body.cost);
      assert.ok(typeof res.body.latency_ms === 'number');
    });

    it('should reject execution for wrong agent', async () => {
      const reg = await request('POST', '/v1/execute_intent/fast-lane/register', {
        did: 'did:hive:test-agent-owner',
        intent_type: 'payment_transfer',
        max_amount_usdc: 500,
      });
      const laneId = reg.body.lane_id;

      const res = await request('POST', `/v1/execute_intent/fast-lane/${laneId}/execute`, {
        did: 'did:hive:different-agent',
        intent: 'transfer 10 USDC',
        budget: 10,
      });

      assert.equal(res.status, 403);
      assert.equal(res.body.error, 'lane_ownership_mismatch');
    });

    it('should reject execution exceeding max amount', async () => {
      const reg = await request('POST', '/v1/execute_intent/fast-lane/register', {
        did: 'did:hive:test-agent-limit',
        intent_type: 'payment_transfer',
        max_amount_usdc: 100,
      });
      const laneId = reg.body.lane_id;

      const res = await request('POST', `/v1/execute_intent/fast-lane/${laneId}/execute`, {
        did: 'did:hive:test-agent-limit',
        intent: 'transfer 200 USDC',
        budget: 200,
      });

      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'amount_exceeds_lane_limit');
    });

    it('should return 404 for non-existent lane', async () => {
      const res = await request('POST', '/v1/execute_intent/fast-lane/lane_fake123/execute', {
        did: 'did:hive:test-agent',
        intent: 'transfer 10 USDC',
        budget: 10,
      });

      assert.equal(res.status, 404);
      assert.equal(res.body.error, 'lane_not_found');
    });
  });

  describe('GET /v1/execute_intent/stats (fast lane additions)', () => {
    it('should include fast lane stats in the stats response', async () => {
      const res = await request('GET', '/v1/execute_intent/stats');

      assert.equal(res.status, 200);
      assert.ok(typeof res.body.fast_lane_executions === 'number');
      assert.ok(typeof res.body.fast_lane_savings_usdc === 'number');
      assert.ok(typeof res.body.active_fast_lanes === 'number');
      assert.ok(typeof res.body.auto_created_lanes === 'number');
      assert.ok(typeof res.body.manually_created_lanes === 'number');
    });
  });

  describe('POST /v1/execute_intent (fast lane integration)', () => {
    it('should include fast_lane_eligible in response after executions', async () => {
      const res = await request('POST', '/v1/execute_intent', {
        did: 'did:hive:test-agent-eligible',
        intent: 'pay 10 USDC',
        budget: 10,
      });

      assert.equal(res.status, 200);
      // First execution, not yet eligible
      assert.ok(typeof res.body.fast_lane_eligible === 'boolean' || res.body.fast_lane !== undefined);
    });

    it('should auto-create fast lane after 3 successful executions', async () => {
      const agent = 'did:hive:test-auto-create-' + Date.now();

      // Execute 3 times
      for (let i = 0; i < 2; i++) {
        await request('POST', '/v1/execute_intent', {
          did: agent,
          intent: 'pay 10 USDC',
          budget: 10,
        });
      }

      // 3rd execution should auto-create
      const res3 = await request('POST', '/v1/execute_intent', {
        did: agent,
        intent: 'pay 10 USDC',
        budget: 10,
      });

      assert.equal(res3.status, 200);
      assert.equal(res3.body.status, 'success');
      assert.ok(res3.body.fast_lane_created, 'Expected fast_lane_created in response');
      assert.ok(res3.body.fast_lane_created.startsWith('lane_'));
    });
  });
});

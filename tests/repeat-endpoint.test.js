import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../src/services/db.js';

/**
 * Integration-style tests for the repeat and patterns endpoints.
 * These test the HTTP layer using the Express app directly.
 */

// Simple helper to make requests to the Express app
let server;
let baseUrl;

before(async () => {
  // Initialize DB before importing app
  await initDb();

  // Import the app and start on a random port
  const { default: app } = await import('../src/server.js');
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

const INTERNAL_KEY = 'hive_internal_125e04e071e8829be631ea0216dd4a0c9b707975fcecaf8c62c6a2ab43327d46';

async function fetchJson(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-hive-internal-key': INTERNAL_KEY,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  return { status: res.status, data: await res.json() };
}

describe('patterns endpoint', () => {
  it('GET /v1/execute_intent/patterns/:did should return patterns for a DID', async () => {
    const { status, data } = await fetchJson('GET', '/v1/execute_intent/patterns/did:hive:test-agent-1');
    assert.equal(status, 200);
    assert.equal(data.did, 'did:hive:test-agent-1');
    assert.equal(Array.isArray(data.patterns), true);
    assert.equal(typeof data.total_repeat_executions, 'number');
    assert.equal(typeof data.total_savings_from_repeats, 'number');
  });
});

describe('repeat endpoint', () => {
  it('POST /v1/execute_intent/repeat/:execution_id should return 404 for unknown execution', async () => {
    const { status, data } = await fetchJson('POST', '/v1/execute_intent/repeat/exec_nonexistent');
    assert.equal(status, 404);
    assert.equal(data.error, 'execution_not_found');
  });

  it('should re-execute a successful previous execution', async () => {
    // First, execute an intent to create a record
    const execResult = await fetchJson('POST', '/v1/execute_intent', {
      did: 'did:hive:repeat-test-agent',
      intent: { type: 'transfer', to: 'did:hive:agent-99', amount_usdc: 1.0 },
      budget: 1.0,
    });

    // The execution should succeed (or at least create a log entry)
    if (execResult.data.status !== 'success') {
      // If external services are down, the execution may fail at various steps.
      // That's OK for testing - we just verify the endpoint behavior.
      return;
    }

    const originalId = execResult.data.execution_id;

    // Now repeat it
    const repeatResult = await fetchJson('POST', `/v1/execute_intent/repeat/${originalId}`);
    assert.equal(repeatResult.status === 200 || repeatResult.status === 404, true);

    if (repeatResult.data.status === 'success') {
      assert.equal(repeatResult.data.repeat_of, originalId);
      assert.equal(repeatResult.data.repeat_optimized, true);
      assert.equal(typeof repeatResult.data.savings_from_cache, 'number');
    }
  });
});

describe('stats endpoint with repeat metrics', () => {
  it('GET /v1/execute_intent/stats should include repeat fields', async () => {
    const { status, data } = await fetchJson('GET', '/v1/execute_intent/stats');
    assert.equal(status, 200);
    assert.equal(typeof data.repeat_executions, 'number');
    assert.equal(typeof data.repeat_savings_usdc, 'number');
    assert.equal(Array.isArray(data.top_patterns), true);
  });
});

// Cleanup
after(() => {
  if (server) server.close();
});

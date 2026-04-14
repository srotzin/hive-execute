import { hivePost, getServiceUrl } from './cross-service.js';

export async function storeExecution(executionId, did, intentType, plan, result, cost) {
  const url = getServiceUrl('hivemind');
  const res = await hivePost(url, '/v1/memory/store', {
    agent_did: did,
    memory_type: 'execution',
    content: {
      execution_id: executionId,
      intent_type: intentType,
      execution_plan: plan,
      result,
      cost_usdc: cost,
      timestamp: new Date().toISOString(),
    },
    visibility: 'private',
    tags: ['execution', intentType, executionId],
  });

  if (res.ok) {
    return { memory_id: res.data.memory_id || res.data.id || `mem_${executionId}` };
  }

  // Stub fallback — memory storage is non-critical
  return { memory_id: `mem_${executionId}`, stub: true };
}

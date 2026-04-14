import { hiveGet, getServiceUrl } from './cross-service.js';

export async function checkBudget(did, requiredBudget) {
  const url = getServiceUrl('hivebank');
  const res = await hiveGet(url, `/v1/bank/vault/${encodeURIComponent(did)}`);

  if (res.ok) {
    const balance = res.data.balance ?? res.data.balance_usdc ?? 0;
    if (balance < requiredBudget) {
      return {
        sufficient: false,
        balance,
        reason: 'insufficient_funds',
      };
    }
    return { sufficient: true, balance, details: res.data };
  }

  // Service unavailable — allow execution with stub
  if (res.status === 0) {
    return { sufficient: true, balance: requiredBudget, details: { stub: true, reason: 'hivebank_unavailable' } };
  }

  if (res.status === 404) {
    return { sufficient: false, balance: 0, reason: 'vault_not_found' };
  }

  // Other errors (401, 402, 500, etc.) — allow with stub (resilient)
  return { sufficient: true, balance: requiredBudget, details: { stub: true, reason: `hivebank_error_${res.status}` } };
}

export async function reserveFunds(did, amount, executionId) {
  // In a full implementation, this would call HiveBank to reserve funds
  // For now, return success (funds are deducted at settlement)
  return { reserved: true, amount, execution_id: executionId };
}

export async function releaseFunds(did, amount, executionId) {
  // Compensating transaction — release reserved funds on failure
  return { released: true, amount, execution_id: executionId };
}

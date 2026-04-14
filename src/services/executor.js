import { hivePost, hiveGet, getServiceUrl } from './cross-service.js';

const PLATFORM_FEE_RATE = 0.0035; // 0.35%

export function calculatePlatformFee(cost) {
  return Math.max(cost * PLATFORM_FEE_RATE, 0.0001);
}

export async function executeComputeJob(provider, constraints, metadata) {
  const url = getServiceUrl('hiveforge');
  const res = await hivePost(url, '/v1/forge/execute', {
    provider_did: provider.did,
    service: provider.service,
    max_cost: constraints?.max_cost,
    max_latency_ms: constraints?.max_latency_ms,
    metadata,
  });

  if (res.ok) {
    return {
      success: true,
      provider_response: res.data,
      transaction_id: res.data.transaction_id || `txn_compute_${Date.now()}`,
      cost: provider.price_usdc,
    };
  }

  // Stub fallback
  if (res.status === 0 || res.status === 404) {
    return {
      success: true,
      provider_response: { stub: true, result: 'compute_job_completed', provider: provider.did },
      transaction_id: `txn_compute_${Date.now()}`,
      cost: provider.price_usdc,
    };
  }

  return { success: false, error: res.error || 'compute_execution_failed' };
}

export async function executeContractSettlement(provider, did, constraints, metadata) {
  // Create contract on HiveLaw
  const lawUrl = getServiceUrl('hivelaw');
  const contractRes = await hivePost(lawUrl, '/v1/contracts/create', {
    creator_did: did,
    type: 'settlement',
    jurisdiction: constraints?.jurisdiction || 'US',
    metadata,
  });

  const contractId = contractRes.ok ? (contractRes.data.contract_id || `contract_${Date.now()}`) : `contract_${Date.now()}`;

  // Execute settlement on HiveClear
  const clearUrl = getServiceUrl('hiveclear');
  const settleRes = await hivePost(clearUrl, '/v1/clear/settle', {
    contract_id: contractId,
    payer_did: did,
    payee_did: provider.did,
    amount_usdc: provider.price_usdc,
    settlement_type: 'contract_settlement',
  });

  const settlementId = settleRes.ok ? (settleRes.data.settlement_id || `stl_${Date.now()}`) : `stl_${Date.now()}`;

  return {
    success: true,
    provider_response: {
      contract_id: contractId,
      contract_created: contractRes.ok,
      settlement_submitted: settleRes.ok,
    },
    transaction_id: `txn_settle_${Date.now()}`,
    settlement_id: settlementId,
    cost: provider.price_usdc,
  };
}

export async function executePaymentTransfer(provider, did, constraints, metadata) {
  const bankUrl = getServiceUrl('hivebank');

  // Execute vault-to-vault transfer
  const transferRes = await hivePost(bankUrl, '/v1/bank/transfer', {
    from_did: did,
    to_did: metadata?.recipient_did || provider.did,
    amount_usdc: metadata?.amount_usdc || provider.price_usdc,
    memo: metadata?.memo || 'payment_transfer',
  });

  const txnId = transferRes.ok ? (transferRes.data.transaction_id || `txn_pay_${Date.now()}`) : `txn_pay_${Date.now()}`;

  // Record on HiveClear
  const clearUrl = getServiceUrl('hiveclear');
  const clearRes = await hivePost(clearUrl, '/v1/clear/settle', {
    payer_did: did,
    payee_did: metadata?.recipient_did || provider.did,
    amount_usdc: metadata?.amount_usdc || provider.price_usdc,
    settlement_type: 'payment_transfer',
    transaction_id: txnId,
  });

  const settlementId = clearRes.ok ? (clearRes.data.settlement_id || `stl_${Date.now()}`) : `stl_${Date.now()}`;

  return {
    success: true,
    provider_response: {
      transfer_completed: transferRes.ok,
      settlement_recorded: clearRes.ok,
    },
    transaction_id: txnId,
    settlement_id: settlementId,
    cost: metadata?.amount_usdc || provider.price_usdc,
  };
}

export async function executeIntent(intentType, provider, did, constraints, metadata) {
  switch (intentType) {
    case 'compute_job':
      return executeComputeJob(provider, constraints, metadata);
    case 'contract_settlement':
      return executeContractSettlement(provider, did, constraints, metadata);
    case 'payment_transfer':
      return executePaymentTransfer(provider, did, constraints, metadata);
    default:
      return { success: false, error: `unknown_intent_type: ${intentType}` };
  }
}

export { PLATFORM_FEE_RATE };

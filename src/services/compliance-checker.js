import { hivePost, getServiceUrl } from './cross-service.js';

export async function checkCompliance(did, intentType, constraints) {
  const url = getServiceUrl('hivelaw');
  const res = await hivePost(url, '/v1/compliance/check', {
    did,
    action: intentType,
    jurisdiction: constraints?.jurisdiction || 'US',
    transaction_type: intentType,
    privacy_required: constraints?.privacy_required || false,
  });

  if (res.ok) {
    const compliant = res.data.compliant !== false && res.data.status !== 'non_compliant';
    return {
      compliant,
      details: res.data,
      reason: compliant ? 'compliant' : (res.data.reason || 'compliance_violation'),
    };
  }

  // Service unavailable — allow with warning
  if (res.status === 0) {
    return { compliant: true, details: { stub: true, reason: 'hivelaw_unavailable' }, reason: 'stub_pass' };
  }

  // Other errors (401, 404, 500, etc.) — allow with warning (resilient stub)
  return { compliant: true, details: { stub: true, reason: `hivelaw_error_${res.status}` }, reason: 'stub_pass' };
}

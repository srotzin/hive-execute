import { hiveGet, getServiceUrl } from './cross-service.js';

export async function validateIdentity(did) {
  if (!did || !did.startsWith('did:hive:')) {
    return { valid: false, reason: 'invalid_did', reputation: 0 };
  }

  const url = getServiceUrl('hivetrust');
  const res = await hiveGet(url, `/v1/reputation/status/${encodeURIComponent(did)}`);

  if (res.ok) {
    return {
      valid: true,
      reputation: res.data.reputation_score ?? res.data.score ?? 500,
      details: res.data,
    };
  }

  // Service unavailable — allow with default reputation
  if (res.status === 0) {
    return { valid: true, reputation: 500, details: { stub: true, reason: 'hivetrust_unavailable' } };
  }

  // 404 = DID not found
  if (res.status === 404) {
    return { valid: false, reason: 'did_not_found', reputation: 0 };
  }

  // Other errors (401, 500, etc.) — allow with default reputation (resilient stub)
  return { valid: true, reputation: 500, details: { stub: true, reason: `hivetrust_error_${res.status}` } };
}

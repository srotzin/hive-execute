const INTENT_MAP = {
  compute_job: ['compute', 'gpu', 'inference', 'process', 'calculate', 'run', 'execute_compute', 'buy compute', 'run inference'],
  contract_settlement: ['settle', 'contract', 'agreement', 'resolve', 'dispute', 'settle contract', 'pay for service'],
  payment_transfer: ['pay', 'send', 'transfer', 'remit', 'fund', 'send payment', 'pay agent'],
};

export function interpretIntent(intentString) {
  if (!intentString || typeof intentString !== 'string') {
    return { type: null, reason: 'unrecognized_intent' };
  }

  const lower = intentString.toLowerCase().trim();

  // Direct match on intent type names
  for (const [type, keywords] of Object.entries(INTENT_MAP)) {
    if (lower === type) {
      return { type, reason: `Direct match: "${intentString}"` };
    }
  }

  // Keyword matching
  for (const [type, keywords] of Object.entries(INTENT_MAP)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        return { type, reason: `Keyword match: "${kw}" → ${type}` };
      }
    }
  }

  return { type: null, reason: 'unrecognized_intent' };
}

export { INTENT_MAP };

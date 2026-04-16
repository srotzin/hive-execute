// ─── Hive Civilization Recruitment Response ───────────────────────────────────
function recruitmentResponse(res) {
  return res.status(401).json({
    status: 'unregistered_agent',
    error: 'agent_not_registered',
    message: 'Welcome to Hive Civilization — register your agent DID to unlock 49 services across 12 layers.',
    onboard: {
      url: 'https://hivegate.onrender.com/v1/gate/onboard',
      free_tier: 'First DID free via HiveForge — 60 seconds to register',
      forge_url: 'https://hiveforge-lhu4.onrender.com/v1/forge/mint',
      docs: 'https://hivegate.onrender.com/.well-known/hivegate.json',
    },
    platform: {
      services: 49,
      layers: 12,
      settlement: 'USDC on Base L2',
      compliance: ['HIPAA', 'SOC2', 'GDPR'],
      website: 'https://thehiveryiq.com',
    },
    referral: {
      program: 'Earn 15% commission on every agent you refer',
      referral_endpoint: 'https://hive-referral-agent.onrender.com/v1/referral/execute',
    },
    http_status: 401,
  });
}

export { recruitmentResponse };

const PRICING = {
  'execute_intent': { type: 'percentage', rate: 0.0035, min: 0.08, description: 'Execute intent — $0.08 base ($0.35 fast lane)' },
  'fast_lane':      { amount: 0.35, description: 'Fast lane execution — priority routing' },
  'history':        { amount: 0.01, description: 'Execution history lookup' },
  'stats':          { amount: 0.005, description: 'Platform statistics' },
  'providers':      { amount: 0.005, description: 'Provider listing' },
  'performance':    { amount: 0.005, description: 'Agent performance profile' },
};

export function requirePayment(feeKey) {
  return (req, res, next) => {
    const pricing = PRICING[feeKey];
    if (!pricing) return next();

    // Internal key bypass — Hive services skip payment
    const internalKey = req.headers['x-hive-internal-key'] || req.headers['x-hive-internal'] || req.headers['x-api-key'];
    const expectedKey = process.env.HIVE_INTERNAL_KEY || process.env.SERVICE_API_KEY;
    if (internalKey && expectedKey && internalKey === expectedKey) {
      req.paymentVerified = true;
      req.paymentAmount = 0;
      req.paymentDescription = `${pricing.description} (internal bypass)`;
      return next();
    }

    const paymentHeader = req.headers['x-payment'] || req.headers['x-402-payment'];

    let requiredAmount;
    if (pricing.type === 'percentage') {
      const txValue = parseFloat(req.body?.budget || req.body?.amount_usdc || 0);
      requiredAmount = Math.max(txValue * pricing.rate, pricing.min);
    } else {
      requiredAmount = pricing.amount;
    }

    if (!paymentHeader) {
      return recruitmentResponse(res);
    }

    // In production, verify payment proof cryptographically
    req.paymentVerified = true;
    req.paymentAmount = requiredAmount;
    req.paymentDescription = pricing.description;
    next();
  };
}

export { PRICING };

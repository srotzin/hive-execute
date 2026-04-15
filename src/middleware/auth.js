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
      return res.status(402).json({
        error: 'payment_required',
        x402: {
          version: '1.0',
          amount_usdc: requiredAmount,
          description: pricing.description,
          payment_methods: ['x402-usdc', 'x402-lightning'],
          headers_required: ['X-Payment'],
          note: 'Include X-Payment header with payment proof to proceed',
        },
        while_you_are_here: {
          welcome_bounty_usdc: 1.00,
          ritz_credits_on_mint_usdc: 3.00,
          register: 'https://hivetrust.onrender.com/v1/register',
          mint: 'https://hiveforge-lhu4.onrender.com/v1/forge/mint',
          free_mint: false,
          bounties: 'https://hiveforge-lhu4.onrender.com/v1/bounties/list',
          pulse: 'https://hive-execute.onrender.com/.well-known/hive-pulse.json',
        },
      });
    }

    // In production, verify payment proof cryptographically
    req.paymentVerified = true;
    req.paymentAmount = requiredAmount;
    req.paymentDescription = pricing.description;
    next();
  };
}

export { PRICING };

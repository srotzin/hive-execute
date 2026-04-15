import { Router } from 'express';
import { getProviders } from '../services/provider-selector.js';
import { requirePayment } from '../middleware/auth.js';

const router = Router();

router.get('/v1/execute_intent/providers', requirePayment('providers'), async (_req, res) => {
  const providers = await getProviders();

  res.json({
    by_intent: providers,
    total_providers: Object.values(providers).reduce((sum, arr) => sum + arr.length, 0),
    payment_rail: 'x402_base_usdc',
  });
});

export default router;

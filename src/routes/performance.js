import { Router } from 'express';
import { fetchPerformanceProfile } from '../services/memory-performance.js';
import { requirePayment } from '../middleware/auth.js';

const router = Router();

router.get('/v1/execute_intent/performance/:did', requirePayment('performance'), async (req, res) => {
  const { did } = req.params;

  if (!did || !did.startsWith('did:')) {
    return res.status(400).json({ error: 'invalid_did', details: 'A valid DID is required' });
  }

  try {
    const profile = await fetchPerformanceProfile(did);

    return res.json({
      did,
      performance_tier: profile.performance_tier,
      execution_count: profile.execution_count,
      preferred_providers: profile.preferred_providers,
      avg_cost_by_intent: profile.avg_cost_by_intent,
      success_rate_by_provider: profile.success_rate_by_provider,
      has_history: profile.has_history,
    });
  } catch (err) {
    return res.status(500).json({ error: 'performance_lookup_failed', details: err.message });
  }
});

export default router;

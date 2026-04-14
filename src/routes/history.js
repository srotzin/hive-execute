import { Router } from 'express';
import db from '../services/db.js';
import { requirePayment } from '../middleware/auth.js';

const router = Router();

router.get('/v1/execute_intent/history/:did', requirePayment('history'), (req, res) => {
  const { did } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;

  const executions = db.prepare(`
    SELECT execution_id, intent, intent_type, status, cost_usdc, savings_usdc,
           latency_ms, execution_hash, provider_did, error_reason, created_at, completed_at
    FROM execution_logs
    WHERE did = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(did, limit, offset);

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      COALESCE(SUM(cost_usdc), 0) as total_cost_usdc,
      COALESCE(AVG(latency_ms), 0) as avg_latency_ms,
      COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) * 1.0 / MAX(COUNT(*), 1), 0) as success_rate
    FROM execution_logs
    WHERE did = ?
  `).get(did);

  res.json({
    did,
    executions,
    total: stats.total,
    total_cost_usdc: stats.total_cost_usdc,
    avg_latency_ms: Math.round(stats.avg_latency_ms),
    success_rate: Math.round(stats.success_rate * 1000) / 1000,
  });
});

export default router;

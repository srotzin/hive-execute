import { Router } from 'express';
import db from '../services/db.js';
import { requirePayment } from '../middleware/auth.js';
import { getFastLaneStats } from '../services/fast-lanes.js';

const router = Router();

router.get('/v1/execute_intent/stats', requirePayment('stats'), (_req, res) => {
  const global = db.prepare('SELECT * FROM execution_stats WHERE id = 1').get();

  const topIntents = db.prepare(`
    SELECT intent_type, COUNT(*) as count, SUM(cost_usdc) as volume_usdc,
           AVG(latency_ms) as avg_latency_ms
    FROM execution_logs
    WHERE status = 'success' AND intent_type IS NOT NULL
    GROUP BY intent_type
    ORDER BY count DESC
    LIMIT 10
  `).all();

  const successCount = db.prepare(
    "SELECT COUNT(*) as c FROM execution_logs WHERE status = 'success'"
  ).get().c;
  const totalCount = db.prepare('SELECT COUNT(*) as c FROM execution_logs').get().c;
  const successRate = totalCount > 0 ? successCount / totalCount : 0;

  const avgCost = db.prepare(
    "SELECT COALESCE(AVG(cost_usdc), 0) as avg FROM execution_logs WHERE status = 'success'"
  ).get().avg;

  const avgLatency = db.prepare(
    "SELECT COALESCE(AVG(latency_ms), 0) as avg FROM execution_logs WHERE status = 'success'"
  ).get().avg;

  const fastLaneStats = getFastLaneStats();

  res.json({
    total_executions: global?.total_executions || 0,
    executions_today: global?.executions_today || 0,
    total_volume_usdc: global?.total_volume_usdc || 0,
    total_savings_usdc: global?.total_savings_usdc || 0,
    avg_cost_usdc: Math.round(avgCost * 10000) / 10000,
    avg_latency_ms: Math.round(avgLatency),
    success_rate: Math.round(successRate * 1000) / 1000,
    top_intents: topIntents,
    savings_generated_usdc: global?.total_savings_usdc || 0,
    fast_lane_executions: fastLaneStats.fast_lane_executions,
    fast_lane_savings_usdc: fastLaneStats.fast_lane_savings_usdc,
    active_fast_lanes: fastLaneStats.active_fast_lanes,
    auto_created_lanes: fastLaneStats.auto_created_lanes,
    manually_created_lanes: fastLaneStats.manually_created_lanes,
  });
});

export default router;

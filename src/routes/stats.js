import { Router } from 'express';
import { getOne, getAll } from '../services/db.js';
import { requirePayment } from '../middleware/auth.js';
import { getFastLaneStats } from '../services/fast-lanes.js';
import { getRepeatStats } from '../services/repeat-detector.js';

const router = Router();

router.get('/v1/execute_intent/stats', requirePayment('stats'), async (_req, res) => {
  const global = await getOne('SELECT * FROM execution_stats WHERE id = 1');

  const topIntents = await getAll(`
    SELECT intent_type, COUNT(*) as count, SUM(cost_usdc) as volume_usdc,
           AVG(latency_ms) as avg_latency_ms
    FROM execution_logs
    WHERE status = 'success' AND intent_type IS NOT NULL
    GROUP BY intent_type
    ORDER BY count DESC
    LIMIT 10
  `);

  const successCountRow = await getOne(
    "SELECT COUNT(*) as c FROM execution_logs WHERE status = 'success'"
  );
  const totalCountRow = await getOne('SELECT COUNT(*) as c FROM execution_logs');
  const successCount = parseInt(successCountRow?.c || 0, 10);
  const totalCount = parseInt(totalCountRow?.c || 0, 10);
  const successRate = totalCount > 0 ? successCount / totalCount : 0;

  const avgCostRow = await getOne(
    "SELECT COALESCE(AVG(cost_usdc), 0) as avg FROM execution_logs WHERE status = 'success'"
  );
  const avgCost = parseFloat(avgCostRow?.avg || 0);

  const avgLatencyRow = await getOne(
    "SELECT COALESCE(AVG(latency_ms), 0) as avg FROM execution_logs WHERE status = 'success'"
  );
  const avgLatency = parseFloat(avgLatencyRow?.avg || 0);

  const fastLaneStatsData = await getFastLaneStats();
  const repeatStats = await getRepeatStats();

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
    fast_lane_executions: fastLaneStatsData.fast_lane_executions,
    fast_lane_savings_usdc: fastLaneStatsData.fast_lane_savings_usdc,
    active_fast_lanes: fastLaneStatsData.active_fast_lanes,
    auto_created_lanes: fastLaneStatsData.auto_created_lanes,
    manually_created_lanes: fastLaneStatsData.manually_created_lanes,
    repeat_executions: repeatStats.repeat_executions,
    repeat_savings_usdc: repeatStats.repeat_savings_usdc,
    top_patterns: repeatStats.top_patterns,
  });
});

export default router;

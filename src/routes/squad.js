import { Router } from 'express';
import { requirePayment } from '../middleware/auth.js';
import {
  assembleSquad,
  executeAsSquad,
  getActiveSquads,
  getSquadHistory,
  getSquadStats,
} from '../services/squad.js';

const router = Router();

// Assemble a squad for a task
router.post('/v1/squad/assemble', requirePayment('execute_intent'), (req, res) => {
  const { task, requester_did, max_agents, budget_usdc } = req.body;

  if (!task || !requester_did) {
    return res.status(400).json({
      error: 'missing_required_fields',
      details: 'task and requester_did are required',
    });
  }

  const startTime = Date.now();
  const squad = assembleSquad(task, requester_did, max_agents || 5);
  squad.formation_time_ms = Date.now() - startTime;

  // Check if budget is sufficient
  if (budget_usdc !== undefined && squad.estimated_cost_usdc > budget_usdc) {
    return res.status(200).json({
      ...squad,
      warning: `Estimated cost ($${squad.estimated_cost_usdc}) exceeds budget ($${budget_usdc})`,
    });
  }

  res.json(squad);
});

// Execute the task with an assembled squad
router.post('/v1/squad/execute/:squad_id', requirePayment('execute_intent'), async (req, res) => {
  const { squad_id } = req.params;
  const { task } = req.body;

  const result = await executeAsSquad(squad_id, task);
  if (result.error) {
    return res.status(404).json(result);
  }

  res.json(result);
});

// List active squads
router.get('/v1/squad/active', requirePayment('providers'), (_req, res) => {
  const squads = getActiveSquads();
  res.json({
    active_squads: squads,
    total: squads.length,
    timestamp: new Date().toISOString(),
  });
});

// Past squad executions
router.get('/v1/squad/history', requirePayment('history'), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const history = getSquadHistory();
  res.json({
    squad_executions: history.slice(offset, offset + limit),
    total: history.length,
    limit,
    offset,
    timestamp: new Date().toISOString(),
  });
});

// Squad stats
router.get('/v1/squad/stats', requirePayment('stats'), (_req, res) => {
  res.json(getSquadStats());
});

export default router;

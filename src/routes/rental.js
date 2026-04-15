import { Router } from 'express';
import { requirePayment } from '../middleware/auth.js';
import {
  getAvailableAgents,
  createRental,
  checkRental,
  endRental,
  getActiveRentals,
  getRentalStats,
} from '../services/rental.js';

const router = Router();

// List all agents available for rent with rates
router.get('/v1/rental/available', requirePayment('providers'), (_req, res) => {
  const agents = getAvailableAgents();
  res.json({
    available_agents: agents,
    total: agents.length,
    timestamp: new Date().toISOString(),
  });
});

// Lease an agent
router.post('/v1/rental/lease', requirePayment('execute_intent'), (req, res) => {
  const { renter_did, agent_did, duration_hours } = req.body;

  if (!renter_did || !agent_did || !duration_hours) {
    return res.status(400).json({
      error: 'missing_required_fields',
      details: 'renter_did, agent_did, and duration_hours are required',
    });
  }

  const result = createRental(renter_did, agent_did, duration_hours);
  if (result.error) {
    return res.status(400).json(result);
  }

  res.json(result);
});

// List active rentals
router.get('/v1/rental/active', requirePayment('providers'), (_req, res) => {
  const rentals = getActiveRentals();
  res.json({
    active_rentals: rentals,
    total: rentals.length,
    timestamp: new Date().toISOString(),
  });
});

// Get rental details
router.get('/v1/rental/active/:rental_id', requirePayment('providers'), (req, res) => {
  const result = checkRental(req.params.rental_id);
  if (result.error) {
    return res.status(404).json(result);
  }
  res.json(result);
});

// End rental early
router.delete('/v1/rental/:rental_id', requirePayment('execute_intent'), (req, res) => {
  const result = endRental(req.params.rental_id);
  if (result.error) {
    return res.status(404).json(result);
  }
  res.json(result);
});

// Rental stats
router.get('/v1/rental/stats', requirePayment('stats'), (_req, res) => {
  res.json(getRentalStats());
});

export default router;

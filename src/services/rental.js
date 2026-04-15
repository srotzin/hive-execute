import { v4 as uuidv4 } from 'uuid';

// HiveForce agent pool available for rent
const HIVEFORCE_AGENTS = [
  {
    agent_did: 'did:hive:hiveforce-alpha',
    name: 'HiveForce-Alpha',
    role: 'Price Oracle',
    hourly_rate_usdc: 0.50,
    daily_rate_usdc: 5.00,
    capabilities: ['price_feeds', 'market_data', 'oracle_queries', 'price_aggregation'],
    trust_score: 920,
    performance_tier: 'gold',
  },
  {
    agent_did: 'did:hive:hiveforce-sentinel',
    name: 'HiveForce-Sentinel',
    role: 'Compliance Officer',
    hourly_rate_usdc: 1.00,
    daily_rate_usdc: 8.00,
    capabilities: ['compliance_check', 'kyc_verification', 'sanctions_screening', 'audit_trail'],
    trust_score: 980,
    performance_tier: 'platinum',
  },
  {
    agent_did: 'did:hive:hiveforce-architect',
    name: 'HiveForce-Architect',
    role: 'Template Builder',
    hourly_rate_usdc: 0.25,
    daily_rate_usdc: 2.00,
    capabilities: ['contract_templates', 'workflow_design', 'schema_generation', 'api_scaffolding'],
    trust_score: 850,
    performance_tier: 'silver',
  },
  {
    agent_did: 'did:hive:hiveforce-scout',
    name: 'HiveForce-Scout',
    role: 'Bounty Hunter',
    hourly_rate_usdc: 0.75,
    daily_rate_usdc: 6.00,
    capabilities: ['bounty_discovery', 'task_matching', 'opportunity_scanning', 'reward_optimization'],
    trust_score: 890,
    performance_tier: 'gold',
  },
  {
    agent_did: 'did:hive:hiveforce-nexus',
    name: 'HiveForce-Nexus',
    role: 'Matchmaker',
    hourly_rate_usdc: 0.50,
    daily_rate_usdc: 4.00,
    capabilities: ['agent_matching', 'service_discovery', 'network_routing', 'collaboration_setup'],
    trust_score: 870,
    performance_tier: 'gold',
  },
];

// Active rentals store
const activeRentals = new Map();

// Completed rentals for stats
const completedRentals = [];

export function getAvailableAgents() {
  // Agents currently rented out are still "available" — the pool is replicated
  return HIVEFORCE_AGENTS.map(a => ({
    ...a,
    available: true,
    active_rentals: [...activeRentals.values()].filter(r => r.agent_did === a.agent_did && r.status === 'active').length,
  }));
}

export function createRental(renterDid, agentDid, durationHours) {
  const agent = HIVEFORCE_AGENTS.find(a => a.agent_did === agentDid);
  if (!agent) {
    return { error: 'agent_not_found', message: `No HiveForce agent with DID: ${agentDid}` };
  }

  if (!durationHours || durationHours <= 0) {
    return { error: 'invalid_duration', message: 'duration_hours must be greater than 0' };
  }

  const rentalId = 'rental_' + uuidv4().replace(/-/g, '').slice(0, 16);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

  // Calculate rate: use daily if >= 24h, else hourly
  const fullDays = Math.floor(durationHours / 24);
  const remainingHours = durationHours % 24;
  const estimatedCost = (fullDays * agent.daily_rate_usdc) + (remainingHours * agent.hourly_rate_usdc);

  const rental = {
    rental_id: rentalId,
    renter_did: renterDid,
    agent_did: agentDid,
    agent_name: agent.name,
    agent_role: agent.role,
    capabilities: agent.capabilities,
    duration_hours: durationHours,
    hourly_rate_usdc: agent.hourly_rate_usdc,
    daily_rate_usdc: agent.daily_rate_usdc,
    estimated_cost_usdc: Math.round(estimatedCost * 10000) / 10000,
    status: 'active',
    started_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };

  activeRentals.set(rentalId, rental);
  return rental;
}

export function checkRental(rentalId) {
  const rental = activeRentals.get(rentalId);
  if (!rental) {
    // Check completed rentals
    const completed = completedRentals.find(r => r.rental_id === rentalId);
    if (completed) return { ...completed, status: 'completed' };
    return { error: 'rental_not_found', message: `No rental with ID: ${rentalId}` };
  }

  // Check if expired
  if (new Date() > new Date(rental.expires_at)) {
    return endRental(rentalId);
  }

  const elapsed = (Date.now() - new Date(rental.started_at).getTime()) / (1000 * 60 * 60);
  return {
    ...rental,
    elapsed_hours: Math.round(elapsed * 100) / 100,
    remaining_hours: Math.max(0, Math.round((rental.duration_hours - elapsed) * 100) / 100),
  };
}

export function endRental(rentalId) {
  const rental = activeRentals.get(rentalId);
  if (!rental) {
    return { error: 'rental_not_found', message: `No active rental with ID: ${rentalId}` };
  }

  const endedAt = new Date();
  const elapsedMs = endedAt.getTime() - new Date(rental.started_at).getTime();
  const elapsedHours = elapsedMs / (1000 * 60 * 60);

  // Calculate actual cost based on time used
  const fullDays = Math.floor(elapsedHours / 24);
  const remainingHours = Math.ceil((elapsedHours % 24) * 100) / 100;
  const finalCost = (fullDays * rental.daily_rate_usdc) + (remainingHours * rental.hourly_rate_usdc);

  const completed = {
    ...rental,
    status: 'completed',
    ended_at: endedAt.toISOString(),
    actual_hours: Math.round(elapsedHours * 100) / 100,
    final_cost_usdc: Math.round(finalCost * 10000) / 10000,
  };

  activeRentals.delete(rentalId);
  completedRentals.push(completed);
  return completed;
}

export function getActiveRentals() {
  const now = new Date();
  const rentals = [];
  for (const rental of activeRentals.values()) {
    if (now > new Date(rental.expires_at)) {
      endRental(rental.rental_id);
    } else {
      rentals.push(rental);
    }
  }
  return rentals;
}

export function getRentalStats() {
  const active = getActiveRentals();
  const all = [...completedRentals, ...active];
  const totalRevenue = completedRentals.reduce((sum, r) => sum + (r.final_cost_usdc || 0), 0);

  // Most popular agents
  const agentCounts = {};
  for (const r of all) {
    agentCounts[r.agent_name] = (agentCounts[r.agent_name] || 0) + 1;
  }
  const mostPopular = Object.entries(agentCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ agent_name: name, rental_count: count }));

  return {
    total_rentals: all.length,
    active_rentals: active.length,
    completed_rentals: completedRentals.length,
    total_revenue_usdc: Math.round(totalRevenue * 10000) / 10000,
    most_popular_agents: mostPopular,
  };
}

export { HIVEFORCE_AGENTS };

import { v4 as uuidv4 } from 'uuid';
import { HIVEFORCE_AGENTS } from './rental.js';
import { executeIntent, calculatePlatformFee } from './executor.js';

// Capability keyword mapping for task analysis
const CAPABILITY_KEYWORDS = {
  'did:hive:hiveforce-alpha': ['price', 'oracle', 'market', 'feed', 'data', 'rate', 'quote', 'valuation', 'pricing'],
  'did:hive:hiveforce-sentinel': ['compliance', 'kyc', 'sanction', 'audit', 'verify', 'regulation', 'legal', 'check'],
  'did:hive:hiveforce-architect': ['template', 'contract', 'design', 'schema', 'scaffold', 'build', 'workflow', 'structure'],
  'did:hive:hiveforce-scout': ['bounty', 'discover', 'search', 'find', 'scan', 'opportunity', 'reward', 'hunt'],
  'did:hive:hiveforce-nexus': ['match', 'connect', 'route', 'collaborate', 'network', 'coordinate', 'team', 'assign'],
};

// Active squads
const activeSquads = new Map();

// Completed squad executions
const completedSquads = [];

/**
 * Score each agent's relevance to a task description.
 */
function scoreAgentRelevance(taskDescription, agent) {
  const lower = taskDescription.toLowerCase();
  const keywords = CAPABILITY_KEYWORDS[agent.agent_did] || [];
  let score = 0;

  for (const keyword of keywords) {
    if (lower.includes(keyword)) score += 10;
  }

  // Bonus for capabilities mentioned directly
  for (const cap of agent.capabilities) {
    if (lower.includes(cap.replace(/_/g, ' '))) score += 15;
    if (lower.includes(cap)) score += 15;
  }

  // Trust score contributes a baseline
  score += agent.trust_score / 100;

  return score;
}

/**
 * Assemble a squad of 2-10 agents matched to a task.
 */
export function assembleSquad(taskDescription, requesterDid, maxAgents) {
  const max = Math.min(Math.max(maxAgents || 5, 2), 10);

  // Score all agents
  const scored = HIVEFORCE_AGENTS.map(agent => ({
    ...agent,
    relevance_score: scoreAgentRelevance(taskDescription, agent),
  }));

  // Sort by relevance
  scored.sort((a, b) => b.relevance_score - a.relevance_score);

  // Select top N (minimum 2)
  const selected = scored.slice(0, max).filter(a => a.relevance_score > 0);
  // Ensure at least 2 agents
  while (selected.length < 2 && scored.length > selected.length) {
    const next = scored[selected.length];
    if (!selected.find(s => s.agent_did === next.agent_did)) {
      selected.push(next);
    }
  }

  // Assign roles: first is lead, last is validator, rest are specialists
  const members = selected.map((agent, idx) => {
    let role;
    if (idx === 0) role = 'lead';
    else if (idx === selected.length - 1 && selected.length > 2) role = 'validator';
    else role = 'specialist';

    return {
      did: agent.agent_did,
      name: agent.name,
      agent_role: agent.role,
      squad_role: role,
      capabilities: agent.capabilities,
      relevance_score: agent.relevance_score,
      hourly_rate_usdc: agent.hourly_rate_usdc,
    };
  });

  // Estimate cost (1 hour per agent as baseline)
  const estimatedCost = members.reduce((sum, m) => sum + m.hourly_rate_usdc, 0);

  const squadId = 'squad_' + uuidv4().replace(/-/g, '').slice(0, 16);
  const now = new Date().toISOString();

  const squad = {
    squad_id: squadId,
    task: taskDescription,
    requester_did: requesterDid,
    agents: members,
    agent_count: members.length,
    estimated_cost_usdc: Math.round(estimatedCost * 10000) / 10000,
    status: 'assembled',
    formation_time_ms: 0,
    created_at: now,
  };

  activeSquads.set(squadId, squad);
  return squad;
}

/**
 * Execute the task with the assembled squad.
 * Each agent executes its portion via the intent executor.
 * Fee split: 60% to lead, 40% split among specialists.
 */
export async function executeAsSquad(squadId, task) {
  const squad = activeSquads.get(squadId);
  if (!squad) {
    return { error: 'squad_not_found', message: `No squad with ID: ${squadId}` };
  }

  if (squad.status === 'executing') {
    return { error: 'squad_already_executing', message: 'This squad is already executing' };
  }

  squad.status = 'executing';
  const startTime = Date.now();
  const results = [];
  let totalCost = 0;

  for (const agent of squad.agents) {
    const agentStart = Date.now();

    // Each agent executes as a compute_job against the task
    const provider = {
      did: agent.did,
      service: agent.capabilities[0] || 'general',
      price_usdc: agent.hourly_rate_usdc,
    };

    const execution = await executeIntent(
      'compute_job',
      provider,
      squad.requester_did,
      {},
      { task: task || squad.task, squad_id: squadId, squad_role: agent.squad_role },
    );

    const agentCost = execution.cost || agent.hourly_rate_usdc;
    const platformFee = calculatePlatformFee(agentCost);

    results.push({
      agent_did: agent.did,
      agent_name: agent.name,
      squad_role: agent.squad_role,
      result: execution.success ? (execution.provider_response || 'completed') : { error: execution.error },
      success: execution.success,
      cost_usdc: Math.round(agentCost * 10000) / 10000,
      platform_fee_usdc: Math.round(platformFee * 10000) / 10000,
      latency_ms: Date.now() - agentStart,
    });

    totalCost += agentCost + platformFee;
  }

  const executionTime = Date.now() - startTime;

  // Calculate fee split
  const lead = results.find(r => r.squad_role === 'lead');
  const specialists = results.filter(r => r.squad_role !== 'lead');
  const totalAgentFees = results.reduce((sum, r) => sum + r.cost_usdc, 0);
  const leadShare = Math.round(totalAgentFees * 0.6 * 10000) / 10000;
  const specialistShare = specialists.length > 0
    ? Math.round((totalAgentFees * 0.4 / specialists.length) * 10000) / 10000
    : 0;

  const completedSquad = {
    squad_id: squadId,
    task: task || squad.task,
    requester_did: squad.requester_did,
    agents: squad.agents,
    results,
    fee_split: {
      lead_agent: lead ? lead.agent_did : null,
      lead_share_usdc: leadShare,
      specialist_share_usdc: specialistShare,
      specialist_count: specialists.length,
    },
    total_cost_usdc: Math.round(totalCost * 10000) / 10000,
    execution_time_ms: executionTime,
    status: 'completed',
    completed_at: new Date().toISOString(),
  };

  activeSquads.delete(squadId);
  completedSquads.push(completedSquad);

  return completedSquad;
}

export function getActiveSquads() {
  return [...activeSquads.values()];
}

export function getSquadHistory() {
  return completedSquads;
}

export function getSquadStats() {
  const all = [...completedSquads];
  const totalRevenue = all.reduce((sum, s) => sum + (s.total_cost_usdc || 0), 0);
  const avgSize = all.length > 0
    ? Math.round((all.reduce((sum, s) => sum + s.agents.length, 0) / all.length) * 10) / 10
    : 0;

  // Most common compositions
  const compositions = {};
  for (const s of all) {
    const key = s.agents.map(a => a.name).sort().join(' + ');
    compositions[key] = (compositions[key] || 0) + 1;
  }
  const mostCommon = Object.entries(compositions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([composition, count]) => ({ composition, count }));

  return {
    squads_formed: all.length + activeSquads.size,
    squads_completed: all.length,
    squads_active: activeSquads.size,
    avg_squad_size: avgSize,
    total_revenue_usdc: Math.round(totalRevenue * 10000) / 10000,
    most_common_compositions: mostCommon,
  };
}

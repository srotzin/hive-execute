import db from './db.js';
import { hiveGet, getServiceUrl } from './cross-service.js';

// Scoring weights
const WEIGHTS = { price: 0.4, reputation: 0.3, latency: 0.2, jurisdiction: 0.1 };

const DEFAULT_PROVIDERS = {
  compute_job: [
    { did: 'did:hive:compute-001', service: 'gpu_inference', base_price: 0.05, latency_ms: 200, jurisdiction: 'US-CA' },
    { did: 'did:hive:compute-002', service: 'gpu_batch', base_price: 0.03, latency_ms: 500, jurisdiction: 'US-NY' },
    { did: 'did:hive:compute-003', service: 'cpu_general', base_price: 0.01, latency_ms: 100, jurisdiction: 'EU-DE' },
  ],
  contract_settlement: [
    { did: 'did:hive:settle-001', service: 'smart_contract', base_price: 0.10, latency_ms: 300, jurisdiction: 'US-CA' },
    { did: 'did:hive:settle-002', service: 'escrow_settle', base_price: 0.08, latency_ms: 400, jurisdiction: 'US-NY' },
  ],
  payment_transfer: [
    { did: 'did:hive:pay-001', service: 'vault_transfer', base_price: 0.005, latency_ms: 50, jurisdiction: 'US-CA' },
    { did: 'did:hive:pay-002', service: 'vault_transfer', base_price: 0.003, latency_ms: 80, jurisdiction: 'EU-DE' },
  ],
};

function getProviderScore(providerDid) {
  const row = db.prepare('SELECT * FROM provider_scores WHERE did = ?').get(providerDid);
  return row || { reliability_score: 500, avg_latency_ms: 300, avg_cost_usdc: 0.05 };
}

function scoreProvider(provider, constraints, scores) {
  const maxCost = constraints?.max_cost || 1000;
  const maxLatency = constraints?.max_latency_ms || 10000;
  const jurisdiction = constraints?.jurisdiction || '';

  // Price score: lower is better (0-100)
  const priceScore = Math.max(0, 100 - (provider.base_price / maxCost) * 100);

  // Reputation score: from provider_scores table (0-1000 → 0-100)
  const repScore = Math.min(100, (scores.reliability_score / 1000) * 100);

  // Latency score: lower is better (0-100)
  const latencyScore = Math.max(0, 100 - (scores.avg_latency_ms / maxLatency) * 100);

  // Jurisdiction match score
  const jurisScore = jurisdiction && provider.jurisdiction === jurisdiction ? 100 :
                     jurisdiction && provider.jurisdiction?.startsWith(jurisdiction.split('-')[0]) ? 50 : 25;

  const total = (priceScore * WEIGHTS.price) +
                (repScore * WEIGHTS.reputation) +
                (latencyScore * WEIGHTS.latency) +
                (jurisScore * WEIGHTS.jurisdiction);

  return { total, breakdown: { priceScore, repScore, latencyScore, jurisScore } };
}

// Premium provider pool unlocked for gold/platinum tier agents
const PREMIUM_PROVIDERS = {
  compute_job: [
    { did: 'did:hive:compute-premium-001', service: 'gpu_inference_premium', base_price: 0.04, latency_ms: 100, jurisdiction: 'US-CA' },
  ],
  payment_transfer: [
    { did: 'did:hive:pay-premium-001', service: 'vault_transfer_priority', base_price: 0.002, latency_ms: 30, jurisdiction: 'US-CA' },
  ],
};

export async function selectProvider(intentType, constraints, performanceProfile) {
  // Try fetching live providers from HiveForge for compute jobs
  let providers = DEFAULT_PROVIDERS[intentType] || [];

  if (intentType === 'compute_job') {
    const url = getServiceUrl('hiveforge');
    const res = await hiveGet(url, '/v1/forge/providers');
    if (res.ok && Array.isArray(res.data?.providers)) {
      const live = res.data.providers.map(p => ({
        did: p.did || p.provider_id,
        service: p.service || 'compute',
        base_price: p.price_usdc || p.base_price || 0.05,
        latency_ms: p.latency_ms || 200,
        jurisdiction: p.jurisdiction || 'US',
      }));
      if (live.length > 0) providers = live;
    }
  }

  // Unlock premium providers for gold/platinum tier agents
  const tier = performanceProfile?.performance_tier;
  if ((tier === 'gold' || tier === 'platinum') && PREMIUM_PROVIDERS[intentType]) {
    providers = [...providers, ...PREMIUM_PROVIDERS[intentType]];
  }

  // Filter by constraints
  const maxCost = constraints?.max_cost ?? Infinity;
  const maxLatency = constraints?.max_latency_ms ?? Infinity;
  let eligible = providers.filter(p => p.base_price <= maxCost && p.latency_ms <= maxLatency);

  // If agent has a known avg cost for this intent type, filter out providers that are
  // significantly more expensive (>50% above avg) — only when agent has history
  if (performanceProfile?.has_history && performanceProfile.avg_cost_by_intent?.[intentType]) {
    const avgCost = performanceProfile.avg_cost_by_intent[intentType];
    const costCeiling = avgCost * 1.5;
    const filtered = eligible.filter(p => p.base_price <= costCeiling);
    // Only apply cost filter if it doesn't eliminate all providers
    if (filtered.length > 0) eligible = filtered;
  }

  if (eligible.length === 0) {
    return { selected: null, reason: 'no_eligible_providers', candidates: providers.length };
  }

  // Score and rank
  const scored = eligible.map(p => {
    const scores = getProviderScore(p.did);
    let { total, breakdown } = scoreProvider(p, constraints, scores);

    // Memory-based boost: if agent has good history with this provider, boost score by 15%
    if (performanceProfile?.success_rate_by_provider?.[p.did] !== undefined) {
      const agentSuccessRate = performanceProfile.success_rate_by_provider[p.did];
      if (agentSuccessRate >= 0.7) {
        const boost = total * 0.15;
        total += boost;
        breakdown.memoryBoost = +boost.toFixed(2);
      }
    }

    return { ...p, score: total, breakdown, historicalScores: scores };
  });

  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0];

  const reason = performanceProfile?.has_history
    ? `Memory-optimized provider (${winner.score.toFixed(1)}/100, tier=${tier}): price=${winner.base_price}, service=${winner.service}`
    : `Best scored provider (${winner.score.toFixed(1)}/100): price=${winner.base_price}, service=${winner.service}`;

  return {
    selected: {
      did: winner.did,
      service: winner.service,
      price_usdc: winner.base_price,
      score: winner.score,
      breakdown: winner.breakdown,
    },
    reason,
    alternatives: scored.slice(1, 3).map(s => ({ did: s.did, score: s.score.toFixed(1) })),
    memory_enhanced: performanceProfile?.has_history || false,
  };
}

export function updateProviderScore(providerDid, intentType, success, latencyMs, costUsdc) {
  const existing = db.prepare('SELECT * FROM provider_scores WHERE did = ?').get(providerDid);
  const now = new Date().toISOString();

  if (existing) {
    const total = existing.executions_total + 1;
    const successes = existing.executions_success + (success ? 1 : 0);
    const avgLatency = ((existing.avg_latency_ms * existing.executions_total) + latencyMs) / total;
    const avgCost = ((existing.avg_cost_usdc * existing.executions_total) + costUsdc) / total;
    const reliability = (successes / total) * 1000;

    db.prepare(`
      UPDATE provider_scores
      SET executions_total = ?, executions_success = ?, avg_latency_ms = ?,
          avg_cost_usdc = ?, reliability_score = ?, last_updated = ?
      WHERE did = ?
    `).run(total, successes, avgLatency, avgCost, reliability, now, providerDid);
  } else {
    db.prepare(`
      INSERT INTO provider_scores (did, intent_type, executions_total, executions_success,
        avg_latency_ms, avg_cost_usdc, reliability_score, last_updated)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?)
    `).run(providerDid, intentType, success ? 1 : 0, latencyMs, costUsdc, success ? 1000 : 0, now);
  }
}

export function getProviders() {
  const allScores = db.prepare('SELECT * FROM provider_scores').all();
  const scoreMap = {};
  for (const s of allScores) scoreMap[s.did] = s;

  const result = {};
  for (const [type, providers] of Object.entries(DEFAULT_PROVIDERS)) {
    result[type] = providers.map(p => ({
      ...p,
      scores: scoreMap[p.did] || { reliability_score: 500, executions_total: 0 },
    }));
  }
  return result;
}

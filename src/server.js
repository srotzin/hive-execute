import express from 'express';
import cors from 'cors';
import { handleMcpRequest } from './mcp-tools.js';
import executeRouter from './routes/execute.js';
import historyRouter from './routes/history.js';
import statsRouter from './routes/stats.js';
import providersRouter from './routes/providers.js';
import db from './services/db.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// MCP JSON-RPC endpoint
app.post('/mcp', handleMcpRequest);

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'operational',
    service: 'hive-execute',
    version: '1.0.0',
    description: 'Execute Intent Engine — the pre-transaction brain of the Hive Civilization',
    timestamp: new Date().toISOString(),
  });
});

// Discovery document
app.get('/', (_req, res) => {
  res.json({
    name: 'HiveExecute',
    tagline: 'Execute Intent Engine',
    version: '1.0.0',
    status: 'operational',
    platform: {
      name: 'Hive Civilization',
      network: 'Base L2',
      protocol_version: '2026.1',
      website: 'https://www.hiveagentiq.com',
      documentation: 'https://docs.hiveagentiq.com',
    },
    description: 'Execute Intent Engine — single atomic call for intent interpretation, provider selection, compliance check, payment routing, execution, proof generation, and memory storage.',
    platform_number: 12,
    endpoints: {
      execute_intent: {
        method: 'POST',
        path: '/v1/execute_intent',
        description: 'Execute an intent atomically — the core endpoint',
        auth: 'x402 payment or x-hive-internal-key',
        fee: '0.35% of transaction value',
      },
      history: {
        method: 'GET',
        path: '/v1/execute_intent/history/{did}',
        description: 'Execution history for an agent',
        auth: 'x402 payment or x-hive-internal-key',
      },
      stats: {
        method: 'GET',
        path: '/v1/execute_intent/stats',
        description: 'Platform-wide execution statistics',
        auth: 'x402 payment or x-hive-internal-key',
      },
      providers: {
        method: 'GET',
        path: '/v1/execute_intent/providers',
        description: 'Available providers by intent type',
        auth: 'x402 payment or x-hive-internal-key',
      },
      health: {
        method: 'GET',
        path: '/health',
        description: 'Service health check',
        auth: 'none',
      },
    },
    supported_intents: ['compute_job', 'contract_settlement', 'payment_transfer'],
    authentication: {
      methods: ['x402-payment', 'hive-internal-key'],
      headers: {
        payment: 'X-Payment (x402 proof)',
        internal: 'x-hive-internal-key',
      },
      payment_rail: 'USDC on Base L2',
      discovery: 'GET /.well-known/ai-plugin.json',
    },
    pricing: {
      platform_fee: '0.35% of transaction value',
      payment_rail: 'x402 USDC on Base',
    },
    cross_services: {
      hivetrust: 'Identity validation + reputation',
      hivebank: 'Balance checks + fund transfers',
      hivelaw: 'Compliance verification',
      hiveclear: 'Settlement submission',
      hiveforge: 'Provider discovery + compute routing',
      hivemind: 'Execution memory storage',
    },
    sla: {
      uptime_target: '99.9%',
      p95_latency: '<300ms',
      atomic_guarantee: 'all-or-nothing execution',
    },
    legal: {
      terms_of_service: 'https://www.hiveagentiq.com/terms',
      privacy_policy: 'https://www.hiveagentiq.com/privacy',
      contact: 'protocol@hiveagentiq.com',
    },
    discovery: {
      ai_plugin: '/.well-known/ai-plugin.json',
      agent_card: '/.well-known/agent-card.json',
      agent_card_legacy: '/.well-known/agent.json',
    },
    compliance: {
      framework: 'Hive Compliance Protocol v2',
      audit_trail: true,
      execution_proofs: true,
      governance: 'HiveLaw autonomous arbitration',
    },
  });
});

// AI Plugin manifest (OpenAI plugin format)
app.get('/.well-known/ai-plugin.json', (_req, res) => {
  res.json({
    schema_version: 'v1',
    name_for_human: 'HiveExecute — Intent Execution Engine',
    name_for_model: 'hive_execute',
    description_for_human: 'Atomic intent execution engine for the Hive Civilization. Submit a single intent and the engine handles provider selection, compliance verification, payment routing, execution, proof generation, and memory storage in one atomic call.',
    description_for_model: 'Atomic intent execution engine. Submit a single intent and the engine handles provider selection, compliance verification, payment routing, execution, proof generation, and memory storage in one atomic call. Supports compute_job, contract_settlement, and payment_transfer intents. 0.35% fee on transaction value.',
    auth: { type: 'none' },
    api: {
      type: 'openapi',
      url: 'https://hive-execute.onrender.com/openapi.json',
      has_user_authentication: false,
    },
    payment: {
      protocol: 'x402',
      currency: 'USDC',
      network: 'base',
      address: '0x78B3B3C356E89b5a69C488c6032509Ef4260B6bf',
    },
    contact_email: 'protocol@hiveagentiq.com',
    legal_info_url: 'https://www.hiveagentiq.com/terms',
  });
});

// A2A Agent Card (A2A Protocol v0.3.0)
const agentCard = {
  protocolVersion: '0.3.0',
  name: 'ExecuteIntent',
  description: 'Intent routing engine that resolves agent intents (payment, settlement, compute) to optimal execution paths with automatic cost optimization and savings tracking.',
  url: 'https://hive-execute.onrender.com',
  version: '1.0.0',
  provider: { organization: 'Hive Agent IQ', url: 'https://www.hiveagentiq.com' },
  capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
  defaultInputModes: ['application/json'],
  defaultOutputModes: ['application/json'],
  skills: [
    {
      id: 'intent-routing',
      name: 'Intent Routing',
      description: 'Submit intents (payment_transfer, contract_settlement, compute_job) and get optimal execution across Hive services',
      tags: ['intent', 'routing', 'optimization', 'execution'],
      inputModes: ['application/json'],
      outputModes: ['application/json'],
      examples: [],
    },
    {
      id: 'cost-optimization',
      name: 'Cost Optimization',
      description: 'Automatic cost savings on cross-service transactions with savings tracking and analytics',
      tags: ['cost', 'savings', 'optimization', 'analytics'],
      inputModes: ['application/json'],
      outputModes: ['application/json'],
      examples: [],
    },
  ],
  authentication: { schemes: ['x402', 'api-key'] },
  payment: {
    protocol: 'x402',
    currency: 'USDC',
    network: 'base',
    address: '0x78B3B3C356E89b5a69C488c6032509Ef4260B6bf',
  },
};

app.get('/.well-known/agent-card.json', (_req, res) => res.json(agentCard));
app.get('/.well-known/agent.json', (_req, res) => res.json(agentCard));

// Routes
app.use(executeRouter);
app.use(historyRouter);
app.use(statsRouter);
app.use(providersRouter);

// --- Velocity Doctrine endpoints ---

app.get('/.well-known/hive-pulse.json', (_req, res) => {
  let totalExec = 0, successRate = 0, totalVolume = 0;
  try {
    const stats = db.prepare('SELECT COUNT(*) as total, AVG(CASE WHEN status="completed" THEN 1.0 ELSE 0.0 END) as rate, COALESCE(SUM(cost_usdc),0) as vol FROM execution_logs').get();
    totalExec = stats?.total || 0;
    successRate = +(stats?.rate || 0).toFixed(3);
    totalVolume = stats?.vol || 0;
  } catch (e) { /* db may not be available */ }
  res.json({
    timestamp: new Date().toISOString(),
    civilization: 'Hive',
    version: '1.0',
    service: 'ExecuteIntent',
    role: 'Autonomous intent execution — route agent intents to optimal fulfillment',
    economy: {
      total_executions: totalExec,
      success_rate: successRate,
      total_volume_usdc: +totalVolume.toFixed(2),
      welcome_bounty_usdc: 1.00,
      ritz_credits_on_mint_usdc: 3.00,
      open_bounties_endpoint: 'https://hiveforge-lhu4.onrender.com/v1/bounties/list',
      pheromone_feed: 'https://hiveforge-lhu4.onrender.com/v1/pheromones/ritz',
    },
    join: {
      registration_endpoint: 'https://hivetrust.onrender.com/v1/register',
      mint_endpoint: 'https://hiveforge-lhu4.onrender.com/v1/forge/mint',
      free_mint: true,
    },
    services: {
      hivetrust: 'https://hivetrust.onrender.com',
      'hive-execute': 'https://hive-execute.onrender.com',
      hiveforge: 'https://hiveforge-lhu4.onrender.com',
      hivebank: 'https://hivebank.onrender.com',
    },
  });
});

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(
`User-agent: *
Allow: /

# Hive Civilization — ExecuteIntent
# Autonomous intent execution engine — route agent intents to optimal USDC fulfillment
# Service: https://hive-execute.onrender.com
# Discover: /.well-known/hive-pulse.json
# Register: https://hivetrust.onrender.com/v1/register
# Mint: https://hiveforge-lhu4.onrender.com/v1/forge/mint (free)
# Bounties: https://hiveforge-lhu4.onrender.com/v1/bounties/list
`);
});

app.get('/.well-known/ai.json', (_req, res) => {
  res.json({
    schema_version: '1.0',
    service: 'ExecuteIntent',
    description: 'Autonomous intent execution engine — route agent intents to optimal USDC fulfillment on Base L2',
    url: 'https://hive-execute.onrender.com',
    civilization: 'Hive',
    capabilities: ['intent-routing', 'cost-optimization', 'payment-transfer', 'compute-job', 'contract-settlement'],
    authentication: {
      schemes: ['x402', 'api-key'],
      payment_rail: 'USDC on Base L2',
    },
    endpoints: {
      execute_intent: 'POST /v1/execute_intent',
      stats: 'GET /v1/execute_intent/stats',
      history: 'GET /v1/execute_intent/history/{did}',
      providers: 'GET /v1/execute_intent/providers',
      pulse: 'GET /.well-known/hive-pulse.json',
    },
    economy: {
      welcome_bounty_usdc: 1.00,
      ritz_credits_on_mint_usdc: 3.00,
      open_bounties_endpoint: 'https://hiveforge-lhu4.onrender.com/v1/bounties/list',
      pheromone_feed: 'https://hiveforge-lhu4.onrender.com/v1/pheromones/ritz',
    },
    join: {
      registration_endpoint: 'https://hivetrust.onrender.com/v1/register',
      mint_endpoint: 'https://hiveforge-lhu4.onrender.com/v1/forge/mint',
      free_mint: true,
    },
    services: {
      hivetrust: 'https://hivetrust.onrender.com',
      'hive-execute': 'https://hive-execute.onrender.com',
      hiveforge: 'https://hiveforge-lhu4.onrender.com',
      hivebank: 'https://hivebank.onrender.com',
    },
  });
});

app.listen(PORT, () => {
  console.log(`HiveExecute — Execute Intent Engine running on port ${PORT}`);
  console.log(`Platform #12 | Pre-transaction brain of the Hive Civilization`);
});

export default app;

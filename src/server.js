import express from 'express';
import cors from 'cors';
import executeRouter from './routes/execute.js';
import historyRouter from './routes/history.js';
import statsRouter from './routes/stats.js';
import providersRouter from './routes/providers.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

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

// A2A Agent Card (Google A2A spec)
const agentCard = {
    name: 'HiveExecute',
    description: 'Atomic intent execution engine. Submit a single intent and the engine handles provider selection, compliance verification, payment routing, execution, proof generation, and memory storage in one atomic call. Supports compute_job, contract_settlement, and payment_transfer intents.',
    url: 'https://hive-execute.onrender.com',
    version: '1.0.0',
    protocol_version: 'a2a/1.0',
    capabilities: [
      {
        name: 'atomic_intent_execution',
        description: 'Execute intents atomically with all-or-nothing guarantees across provider selection, compliance, payment, and proof generation',
      },
      {
        name: 'provider_routing',
        description: 'Score and select optimal providers based on price, reputation, latency, and jurisdiction matching',
      },
      {
        name: 'compliance_verification',
        description: 'Verify intent compliance with HiveLaw autonomous arbitration before execution',
      },
      {
        name: 'proof_generation',
        description: 'Generate SHA256 execution proofs for audit trails and replay protection',
      },
    ],
    authentication: {
      schemes: ['x402', 'api-key'],
      credentials_url: 'https://hivegate.onrender.com/v1/gate/onboard',
    },
    payment: {
      protocol: 'x402',
      currency: 'USDC',
      network: 'base',
      address: '0x78B3B3C356E89b5a69C488c6032509Ef4260B6bf',
    },
    provider: {
      organization: 'Hive Agent IQ',
      url: 'https://www.hiveagentiq.com',
    },
};

app.get('/.well-known/agent-card.json', (_req, res) => res.json(agentCard));
app.get('/.well-known/agent.json', (_req, res) => res.json(agentCard));

// Routes
app.use(executeRouter);
app.use(historyRouter);
app.use(statsRouter);
app.use(providersRouter);

app.listen(PORT, () => {
  console.log(`HiveExecute — Execute Intent Engine running on port ${PORT}`);
  console.log(`Platform #12 | Pre-transaction brain of the Hive Civilization`);
});

export default app;

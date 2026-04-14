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
    version: '1.0.0',
    description: 'Execute Intent Engine — single atomic call for intent interpretation, provider selection, compliance check, payment routing, execution, proof generation, and memory storage.',
    protocol: 'Hive Civilization Protocol',
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
  });
});

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

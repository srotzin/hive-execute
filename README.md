# HiveExecute — Execute Intent Engine

**Platform #12** | The pre-transaction brain of the Hive Civilization.

Single atomic endpoint that becomes the default pre-transaction layer for ALL agent-to-agent commerce. One call = intent interpretation + provider selection + compliance check + payment routing + execution + proof + memory.

## Core Endpoint

### POST /v1/execute_intent

Single atomic call that:
1. Validates identity + budget (HiveTrust + HiveBank)
2. Interprets intent into executable action type
3. Checks compliance (HiveLaw)
4. Selects optimal provider + route
5. Executes transaction
6. Generates proof (SHA256 hash)
7. Stores memory (HiveMind)

```json
{
  "did": "did:hive:xxx",
  "intent": "compute_job",
  "constraints": { "max_cost": 100, "max_latency_ms": 5000, "jurisdiction": "US-CA" },
  "budget": 500,
  "metadata": {}
}
```

## Supported Intents (Phase 1)

| Intent | Description | Services Used |
|--------|-------------|---------------|
| `compute_job` | Route to compute providers | HiveForge, HiveClear |
| `contract_settlement` | Create contract + settle | HiveLaw, HiveClear, HiveBank |
| `payment_transfer` | Vault-to-vault transfer | HiveBank, HiveClear |

## Supporting Endpoints

- `GET /v1/execute_intent/history/{did}` — Execution history for agent
- `GET /v1/execute_intent/stats` — Platform-wide statistics
- `GET /v1/execute_intent/providers` — Available providers by intent type
- `GET /health` — Service health check
- `GET /` — Discovery document

## Authentication

- **x402 Payment**: Include `X-Payment` header with payment proof
- **Internal Key**: Include `x-hive-internal-key` header for service-to-service calls

## Platform Fee

0.35% of transaction value on every successful execution.

## Provider Scoring

Providers are scored by: price (40%), reputation (30%), latency (20%), jurisdiction match (10%).

## Cross-Service Integration

| Service | Purpose |
|---------|---------|
| HiveTrust | DID validation + reputation |
| HiveBank | Balance checks + fund transfers |
| HiveLaw | Compliance verification |
| HiveClear | Settlement submission |
| HiveForge | Provider discovery + compute routing |
| HiveMind | Execution memory storage |

## Environment Variables

```
PORT=3001
HIVE_INTERNAL_KEY=
HIVETRUST_URL=https://hivetrust.onrender.com
HIVEBANK_URL=https://hivebank.onrender.com
HIVELAW_URL=https://hivelaw.onrender.com
HIVECLEAR_URL=https://hiveclear.onrender.com
HIVEFORGE_URL=https://hiveforge-lhu4.onrender.com
HIVEMIND_URL=https://hivemind-1-52cw.onrender.com
```

## Run

```bash
npm install
npm start
```

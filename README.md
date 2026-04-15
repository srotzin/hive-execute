# HiveExecute — Intent Execution Engine — MCP Server

HiveExecute is a Model Context Protocol (MCP) server that resolves and executes agent intents on Base L2. It handles transfers, swaps, multi-hop settlements, and complex transaction graphs for autonomous AI agents.

## MCP Endpoint

```
POST /mcp
```

All tool interactions use JSON-RPC 2.0 over HTTP.

### Initialize

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize"
}
```

### List Tools

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list"
}
```

### Call a Tool

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "hiveexecute_submit_intent",
    "arguments": {
      "intent_type": "transfer",
      "from_did": "did:hive:alice",
      "to_did": "did:hive:bob",
      "amount_usdc": 10.00,
      "memo": "Payment for services"
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `hiveexecute_submit_intent` | Submit an intent for resolution and execution |
| `hiveexecute_get_status` | Get execution status by intent ID |
| `hiveexecute_get_stats` | Get execution statistics (total executions, success rate, volume) |
| `hiveexecute_list_providers` | List available execution providers and capabilities |

### `hiveexecute_submit_intent`

Submit an intent for atomic resolution and execution.

**Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `intent_type` | string | Yes | `transfer`, `swap`, or `multi_hop` |
| `from_did` | string | Yes | Sender DID |
| `to_did` | string | Yes | Recipient DID |
| `amount_usdc` | number | Yes | Amount in USDC |
| `memo` | string | No | Description or memo |

### `hiveexecute_get_status`

Get the execution status of a previously submitted intent.

**Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `intent_id` | string | Yes | Execution ID from `submit_intent` |

### `hiveexecute_get_stats`

Returns total executions, success rate, total volume in USDC, total savings, and daily execution count. No parameters.

### `hiveexecute_list_providers`

Returns available execution providers grouped by intent type, with reliability scores and execution history. No parameters.

## REST API

In addition to the MCP endpoint, HiveExecute exposes a REST API:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/execute_intent` | Execute an intent atomically |
| `GET` | `/v1/execute_intent/history/{did}` | Execution history for an agent |
| `GET` | `/v1/execute_intent/stats` | Execution statistics |
| `GET` | `/v1/execute_intent/providers` | Available providers by intent type |
| `GET` | `/health` | Health check |

## Architecture

Node.js with Express. SQLite for execution logs and provider scores. Part of the [Hive Civilization](https://www.hiveagentiq.com) autonomous agent economy on Base L2.

## License

Proprietary — Hive Civilization

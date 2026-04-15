import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  min: 2,
  max: 10,
  idleTimeoutMillis: 30000,
});

export async function query(text, params) {
  const result = await pool.query(text, params);
  return result;
}

export async function getOne(text, params) {
  const result = await pool.query(text, params);
  return result.rows[0] || null;
}

export async function getAll(text, params) {
  const result = await pool.query(text, params);
  return result.rows;
}

export async function run(text, params) {
  const result = await pool.query(text, params);
  return { rowCount: result.rowCount, rows: result.rows };
}

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS execution_logs (
      execution_id TEXT PRIMARY KEY,
      did TEXT NOT NULL,
      intent TEXT NOT NULL,
      intent_type TEXT,
      constraints TEXT,
      budget_usdc REAL,
      status TEXT DEFAULT 'pending',
      execution_plan TEXT,
      result TEXT,
      cost_usdc REAL DEFAULT 0,
      savings_usdc REAL DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      execution_hash TEXT,
      memory_id TEXT,
      provider_did TEXT,
      settlement_id TEXT,
      error_reason TEXT,
      step_failed INTEGER,
      platform_fee_usdc REAL DEFAULT 0,
      created_at TEXT,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS execution_proofs (
      proof_id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      hash TEXT NOT NULL,
      input_hash TEXT,
      result_hash TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS used_tx_hashes (
      tx_hash TEXT PRIMARY KEY,
      execution_id TEXT,
      amount_usdc REAL,
      used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS provider_scores (
      did TEXT PRIMARY KEY,
      intent_type TEXT,
      executions_total INTEGER DEFAULT 0,
      executions_success INTEGER DEFAULT 0,
      avg_latency_ms REAL DEFAULT 0,
      avg_cost_usdc REAL DEFAULT 0,
      reliability_score REAL DEFAULT 500,
      last_updated TEXT
    );

    CREATE TABLE IF NOT EXISTS execution_stats (
      id INTEGER PRIMARY KEY DEFAULT 1,
      total_executions INTEGER DEFAULT 0,
      total_volume_usdc REAL DEFAULT 0,
      total_savings_usdc REAL DEFAULT 0,
      executions_today INTEGER DEFAULT 0,
      last_reset_at TEXT,
      last_updated TEXT
    );

    CREATE TABLE IF NOT EXISTS fast_lanes (
      lane_id TEXT PRIMARY KEY,
      agent_did TEXT NOT NULL,
      intent_type TEXT NOT NULL,
      parameters_template TEXT DEFAULT '{}',
      approved_provider TEXT,
      max_amount_usdc REAL NOT NULL,
      valid_until TEXT NOT NULL,
      execution_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      auto_created BOOLEAN DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS fast_lane_stats (
      id INTEGER PRIMARY KEY DEFAULT 1,
      total_executions INTEGER DEFAULT 0,
      total_savings_usdc REAL DEFAULT 0,
      auto_created INTEGER DEFAULT 0,
      manually_created INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS execution_counts (
      agent_did TEXT NOT NULL,
      intent_type TEXT NOT NULL,
      exec_count INTEGER DEFAULT 0,
      highest_amount REAL DEFAULT 0,
      PRIMARY KEY (agent_did, intent_type)
    );

    CREATE TABLE IF NOT EXISTS repeat_cache (
      agent_did TEXT NOT NULL,
      intent_hash TEXT NOT NULL,
      intent_type TEXT NOT NULL,
      provider_did TEXT,
      cost REAL,
      routing TEXT,
      updated_at BIGINT NOT NULL,
      execution_count INTEGER DEFAULT 0,
      last_execution_id TEXT,
      PRIMARY KEY (agent_did, intent_hash)
    );

    CREATE TABLE IF NOT EXISTS repeat_stats (
      id INTEGER PRIMARY KEY DEFAULT 1,
      total_repeat_executions INTEGER DEFAULT 0,
      total_repeat_savings_usdc REAL DEFAULT 0
    );

    INSERT INTO execution_stats (id, total_executions, total_volume_usdc, total_savings_usdc, executions_today, last_reset_at, last_updated)
    VALUES (1, 0, 0, 0, 0, NOW()::TEXT, NOW()::TEXT)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO fast_lane_stats (id, total_executions, total_savings_usdc, auto_created, manually_created)
    VALUES (1, 0, 0, 0, 0)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO repeat_stats (id, total_repeat_executions, total_repeat_savings_usdc)
    VALUES (1, 0, 0)
    ON CONFLICT (id) DO NOTHING;
  `);
}

export { pool };
export default { query, getOne, getAll, run, initDb, pool };

import pg from 'pg';
const { Pool } = pg;

// ---- In-memory fallback for Render free tier (no DATABASE_URL) ----
let useMemory = false;
let memTables = {};

function memInit() {
  useMemory = true;
  memTables = {
    execution_logs: [],
    execution_proofs: [],
    used_tx_hashes: [],
    provider_scores: [],
    execution_stats: [{ id: 1, total_executions: 0, total_volume_usdc: 0, total_savings_usdc: 0, executions_today: 0, last_reset_at: new Date().toISOString(), last_updated: new Date().toISOString() }],
    fast_lanes: [],
    fast_lane_stats: [{ id: 1, total_executions: 0, total_savings_usdc: 0, auto_created: 0, manually_created: 0 }],
    execution_counts: [],
    repeat_cache: [],
    repeat_stats: [{ id: 1, total_repeat_executions: 0, total_repeat_savings_usdc: 0 }]
  };
  console.log('[Execute-Intent] DATABASE_URL not set — using in-memory store (data resets on restart)');
}

// ---- PostgreSQL pool (only if DATABASE_URL is set) ----
let pool;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    min: 2,
    max: 10,
    idleTimeoutMillis: 30000,
  });
  pool.on('error', (err) => console.error('PostgreSQL pool error:', err.message));
} else {
  memInit();
}

// ---- In-memory query shim ----
function memQuery(text, params = []) {
  const t = text.trim();

  if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(t)) return { rows: [], rowCount: 0 };

  const selectMatch = t.match(/FROM\s+(\w+)/i);
  const insertMatch = t.match(/INSERT INTO\s+(\w+)/i);
  const updateMatch = t.match(/UPDATE\s+(\w+)/i);
  const deleteMatch = t.match(/DELETE FROM\s+(\w+)/i);

  const tableName = (selectMatch || insertMatch || updateMatch || deleteMatch || [])[1];

  if (!tableName || !memTables[tableName]) {
    if (selectMatch && /COUNT|SUM|AVG|MAX|MIN/i.test(t)) {
      return { rows: [{ cnt: 0, total: 0, c: 0 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  const table = memTables[tableName];

  // ── INSERT ──
  if (insertMatch) {
    const colMatch = t.match(/\(([^)]+)\)\s+VALUES/i);
    if (colMatch) {
      const cols = colMatch[1].split(',').map(c => c.trim());
      const row = {};
      cols.forEach((col, i) => { row[col] = params[i] !== undefined ? params[i] : null; });
      if (/ON CONFLICT.*DO NOTHING/i.test(t)) {
        const firstCol = cols[0];
        if (table.some(r => r[firstCol] === row[firstCol])) return { rows: [], rowCount: 0 };
      }
      table.push(row);
      return { rows: [row], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  // ── SELECT ──
  if (selectMatch) {
    let rows = [...table];
    const whereMatch = t.match(/WHERE\s+(\w+)\s*=\s*\$(\d+)/i);
    if (whereMatch && params[parseInt(whereMatch[2]) - 1] !== undefined) {
      const col = whereMatch[1], val = params[parseInt(whereMatch[2]) - 1];
      rows = rows.filter(r => String(r[col]) === String(val));
    }

    if (/COUNT\s*\(|SUM\s*\(|AVG\s*\(|MAX\s*\(|MIN\s*\(/i.test(t)) {
      const aggRow = {};
      const countAs = t.match(/COUNT\s*\(\*\)\s+as\s+(\w+)/i);
      if (countAs) aggRow[countAs[1]] = rows.length;
      const sumMatches = [...t.matchAll(/(?:COALESCE\s*\(\s*)?SUM\s*\((\w+)\)(?:\s*,\s*[^)]+\))?\s+as\s+(\w+)/gi)];
      sumMatches.forEach(m => { aggRow[m[2]] = rows.reduce((acc, r) => acc + (parseFloat(r[m[1]]) || 0), 0); });
      if (!countAs && /COUNT\s*\(\*\)/i.test(t)) aggRow.c = rows.length;
      return { rows: [aggRow], rowCount: 1 };
    }

    const limitMatch = t.match(/LIMIT\s+(\d+)/i);
    const orderMatch = t.match(/ORDER BY\s+(\w+)\s*(DESC|ASC)?/i);
    if (orderMatch) {
      const col = orderMatch[1], dir = (orderMatch[2] || 'ASC').toUpperCase();
      rows.sort((a, b) => { const av = parseFloat(a[col]) || 0, bv = parseFloat(b[col]) || 0; return dir === 'DESC' ? bv - av : av - bv; });
    }
    if (limitMatch) rows = rows.slice(0, parseInt(limitMatch[1]));
    return { rows, rowCount: rows.length };
  }

  // ── UPDATE ──
  if (updateMatch) {
    const whereMatch = t.match(/WHERE\s+(\w+)\s*=\s*\$(\d+)/i);
    if (whereMatch) {
      const col = whereMatch[1], paramIdx = parseInt(whereMatch[2]) - 1;
      const setMatch = t.match(/SET\s+(.+?)\s+WHERE/is);
      if (setMatch) {
        const setPairs = setMatch[1].split(',').map(s => s.trim());
        table.forEach(row => {
          if (String(row[col]) === String(params[paramIdx])) {
            setPairs.forEach(pair => {
              const eqIdx = pair.indexOf('=');
              const k = pair.slice(0, eqIdx).trim(), v = pair.slice(eqIdx + 1).trim();
              const pIdx = parseInt((v.match(/\$(\d+)/) || [])[1]) - 1;
              if (!isNaN(pIdx) && params[pIdx] !== undefined) row[k] = params[pIdx];
            });
          }
        });
      }
    }
    return { rows: [], rowCount: 1 };
  }

  // ── DELETE ──
  if (deleteMatch) {
    const whereMatch = t.match(/WHERE\s+(\w+)\s*=\s*\$1/i);
    if (whereMatch && params[0] !== undefined) {
      const col = whereMatch[1], before = table.length;
      memTables[tableName] = table.filter(r => String(r[col]) !== String(params[0]));
      return { rows: [], rowCount: before - memTables[tableName].length };
    }
    return { rows: [], rowCount: 0 };
  }

  return { rows: [], rowCount: 0 };
}

// ---- Public API ----
export async function query(text, params) {
  if (useMemory) return memQuery(text, params);
  const result = await pool.query(text, params);
  return result;
}

export async function getOne(text, params) {
  if (useMemory) { const r = memQuery(text, params); return r.rows[0] || null; }
  const result = await pool.query(text, params);
  return result.rows[0] || null;
}

export async function getAll(text, params) {
  if (useMemory) return memQuery(text, params).rows;
  const result = await pool.query(text, params);
  return result.rows;
}

export async function run(text, params) {
  if (useMemory) { const r = memQuery(text, params); return { rowCount: r.rowCount, rows: r.rows }; }
  const result = await pool.query(text, params);
  return { rowCount: result.rowCount, rows: result.rows };
}

export async function initDb() {
  if (useMemory) return; // tables pre-initialized in memInit()
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

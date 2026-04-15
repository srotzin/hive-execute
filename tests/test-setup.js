import { initDb, pool } from '../src/services/db.js';

export async function setupTestDb() {
  await initDb();
  // Clean tables for test isolation
  await pool.query('DELETE FROM fast_lanes');
  await pool.query('DELETE FROM fast_lane_stats WHERE id = 1');
  await pool.query('DELETE FROM execution_counts');
  await pool.query('DELETE FROM repeat_cache');
  await pool.query('DELETE FROM repeat_stats WHERE id = 1');
  await pool.query('DELETE FROM execution_logs');
  await pool.query('DELETE FROM execution_proofs');
  await pool.query('DELETE FROM used_tx_hashes');
  await pool.query('DELETE FROM provider_scores');
  // Re-seed stats rows
  await pool.query(`
    INSERT INTO fast_lane_stats (id, total_executions, total_savings_usdc, auto_created, manually_created)
    VALUES (1, 0, 0, 0, 0)
    ON CONFLICT (id) DO UPDATE SET total_executions = 0, total_savings_usdc = 0, auto_created = 0, manually_created = 0
  `);
  await pool.query(`
    INSERT INTO repeat_stats (id, total_repeat_executions, total_repeat_savings_usdc)
    VALUES (1, 0, 0)
    ON CONFLICT (id) DO UPDATE SET total_repeat_executions = 0, total_repeat_savings_usdc = 0
  `);
  await pool.query(`
    INSERT INTO execution_stats (id, total_executions, total_volume_usdc, total_savings_usdc, executions_today, last_reset_at, last_updated)
    VALUES (1, 0, 0, 0, 0, NOW()::TEXT, NOW()::TEXT)
    ON CONFLICT (id) DO UPDATE SET total_executions = 0, total_volume_usdc = 0, total_savings_usdc = 0, executions_today = 0
  `);
}

export async function teardownTestDb() {
  await pool.end();
}

export { pool };

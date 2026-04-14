import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import db from './db.js';

export function generateProof(executionId, did, intent, result, cost, timestamp) {
  const payload = executionId + did + intent + JSON.stringify(result) + cost + timestamp;
  const hash = '0x' + createHash('sha256').update(payload).digest('hex');

  const proofId = 'proof_' + uuidv4().replace(/-/g, '').slice(0, 16);
  const inputHash = '0x' + createHash('sha256').update(executionId + did + intent).digest('hex');
  const resultHash = '0x' + createHash('sha256').update(JSON.stringify(result) + cost).digest('hex');

  db.prepare(`
    INSERT INTO execution_proofs (proof_id, execution_id, hash, input_hash, result_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(proofId, executionId, hash, inputHash, resultHash, timestamp);

  // Replay protection: store tx hash
  db.prepare(`
    INSERT OR IGNORE INTO used_tx_hashes (tx_hash, execution_id, amount_usdc, used_at)
    VALUES (?, ?, ?, ?)
  `).run(hash, executionId, cost, timestamp);

  return { hash, proofId };
}

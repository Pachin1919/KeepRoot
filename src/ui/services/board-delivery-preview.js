import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MAX_PREVIEW_BYTES = 1024 * 1024;
export function boardDeliveryPreview(saveService, record) {
  if (record.source?.kind !== 'board_delivery' || path.extname(record.target?.path ?? '').toLowerCase() !== '.html') return null;
  const snapshot = saveService.candidateSnapshot(record.save_id);
  if (snapshot.bytes > MAX_PREVIEW_BYTES) return { bounded: true, bytes: snapshot.bytes };
  const stat = fs.lstatSync(snapshot.path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PREVIEW_BYTES) throw new Error('Board delivery preview changed or is unavailable.');
  const bytes = fs.readFileSync(snapshot.path);
  if (bytes.length > MAX_PREVIEW_BYTES || crypto.createHash('sha256').update(bytes).digest('hex') !== snapshot.sha256) throw new Error('Board delivery preview changed after verification.');
  return { html: bytes.toString('utf8'), bytes: bytes.length };
}

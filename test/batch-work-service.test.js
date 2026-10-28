import test from 'node:test';
import assert from 'node:assert/strict';
import { createBatchWorkService } from '../src/ui/services/batch-work-service.js';

test('batch inspection and import retain individual results after a failure', async () => {
  const service = createBatchWorkService({
    fileWork: {
      async inspectAsync({ filePath }) {
        if (filePath === 'missing') throw Object.assign(new Error('File missing'), { code: 'ENOENT' });
        return { inspection: { extraction: { status: 'success' } }, work: { work_id: filePath } };
      },
    },
    projectImport: {
      async saveAsync(prepared) {
        if (prepared === 'bad') throw new Error('Save failed');
        return { work_id: prepared };
      },
    },
    inspectionFact: () => 'read',
  });
  const inspected = await service.inspectQueueAsync([
    { item_id: '1', path: 'missing', name: 'missing' },
    { item_id: '2', path: 'good', name: 'good' },
    { item_id: '3', path: 'folder', name: 'folder', supported: false, reason: 'folder' },
  ]);
  assert.deepEqual(inspected.map(({ status }) => status), ['failed', 'inspected', 'unsupported']);
  assert.equal(inspected[0].kind, 'missing');
  assert.equal(inspected[1].work_id, 'good');
  const saved = await service.saveImportsAsync([
    { work_id: '1', prepared: 'bad' },
    { work_id: '2', prepared: 'good' },
  ]);
  assert.deepEqual(saved.map(({ status }) => status), ['failed', 'saved']);
  assert.equal(saved[1].work.work_id, 'good');
});

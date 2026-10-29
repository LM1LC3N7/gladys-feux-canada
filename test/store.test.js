// -----------------------------------------------------------------------------
// /data on a real file system: written through a temporary file, read back,
// an unreadable file kept aside before it is replaced, never fatal.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileStore } from '../src/store.js';

const dir = async (t) => {
  const path = await mkdtemp(join(tmpdir(), 'feux-canada-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
};

test('missing, then written and read back', async (t) => {
  const file = join(await dir(t), 'state.json');
  const store = createFileStore(file);
  assert.deepEqual(store.load(), { data: {}, state: 'missing' });
  await Promise.all([store.save({ a: 1 }), store.save({ a: 2 })]);
  assert.deepEqual(createFileStore(file).load(), { data: { a: 2 }, state: 'ok' });
});

test('an unreadable file is kept aside once, then replaced', async (t) => {
  const file = join(await dir(t), 'state.json');
  await writeFile(file, '{ not json');
  const store = createFileStore(file);
  assert.equal(store.load().state, 'unreadable');
  await store.save({ a: 1 });
  assert.equal(await readFile(`${file}.unreadable`, 'utf8'), '{ not json');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { a: 1 });
});

test('a save in a directory that does not exist fails without throwing elsewhere', async (t) => {
  const file = join(await dir(t), 'missing', 'state.json');
  const store = createFileStore(file);
  await assert.rejects(store.save({ a: 1 }));
  await assert.rejects(store.save({ a: 2 }), 'the queue goes on after a failure');
});

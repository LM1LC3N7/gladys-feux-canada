// -----------------------------------------------------------------------------
// The state kept in /data (the only writable place of the container): the
// time of the last read (a restart never reads sooner than the interval), the
// pause asked by the server (429/5xx), and the memory of the triggers of each
// house (a restart does not lose "the danger was moderate"). A small JSON
// file, written through a temporary file and a rename, one save after the
// other. An unreadable file is kept aside once (`.unreadable`) before the
// first save replaces it. Taken from gladys-iskra (approved).
// -----------------------------------------------------------------------------

import { copyFileSync, readFileSync, statSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';

export const DEFAULT_STATE_FILE = '/data/feux-canada-state.json';
/** A larger file is not ours: ignored (read bounded). */
const MAX_STATE_BYTES = 256 * 1024;

export function createFileStore(file = DEFAULT_STATE_FILE) {
  /** The saves one after the other: two never share the temporary file. */
  let queue = Promise.resolve();
  let unreadable = false;
  const write = async (data) => {
    if (unreadable) {
      try {
        copyFileSync(file, `${file}.unreadable`);
      } catch {
        // Nothing to keep aside (gone meanwhile): the save goes on.
      }
      unreadable = false;
    }
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(data), 'utf8');
    await rename(tmp, file);
  };
  return {
    /** `{ data, state: 'ok' | 'missing' | 'unreadable' }`. */
    load() {
      try {
        if (statSync(file).size > MAX_STATE_BYTES) {
          unreadable = true;
          return { data: {}, state: 'unreadable' };
        }
        const data = JSON.parse(readFileSync(file, 'utf8'));
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          return { data, state: 'ok' };
        }
        unreadable = true;
        return { data: {}, state: 'unreadable' };
      } catch (err) {
        if (err?.code === 'ENOENT') {
          return { data: {}, state: 'missing' };
        }
        unreadable = true;
        return { data: {}, state: 'unreadable' };
      }
    },
    save(data) {
      const job = queue.then(
        () => write(data),
        () => write(data),
      );
      queue = job.catch(() => {});
      return job;
    },
  };
}

/** The same in memory (tests): `failSave` makes the next saves fail. */
export function createMemoryStore(initial = {}) {
  let data = structuredClone(initial);
  const store = {
    failSave: false,
    saves: 0,
    load: () => ({ data: structuredClone(data), state: 'ok' }),
    async save(next) {
      store.saves += 1;
      if (store.failSave) {
        throw new Error('EROFS');
      }
      data = structuredClone(next);
    },
    get data() {
      return data;
    },
  };
  return store;
}

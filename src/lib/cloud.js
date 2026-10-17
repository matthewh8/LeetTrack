// Device sync through chrome.storage.sync: Chrome carries it between every
// browser signed into the same Google account. No server, no token.
//
// One round: read the remote snapshot, merge it with local state, write back
// whatever changed on either side. Rounds are serialised, and a round that
// changes nothing writes nothing, so the storage events it causes settle.

import { readAll, applyMergedSnapshot, syncDayWindow, patchMeta } from './storage.js';
import {
  toSnapshot, mergeSnapshots, fitSnapshot, encodeSnapshot, decodeSnapshot, checksum, canonical,
} from './sync.js';

const HEAD = 'leettrack:sync:head';
const CHUNK = (i) => `leettrack:sync:${i}`;
const LOCAL_ATTEMPTS = 5000;

export const SYNC_PREFIX = 'leettrack:sync:';

async function readRemote() {
  const { [HEAD]: head } = await chrome.storage.sync.get(HEAD);
  if (!head) return { head: null, snap: null };
  const keys = Array.from({ length: head.n }, (_, i) => CHUNK(i));
  const raw = await chrome.storage.sync.get(keys);
  const snap = await decodeSnapshot(head, keys.map((k) => raw[k]));
  return { head, snap };
}

async function writeRemote(chunks, previous) {
  const text = chunks.join('');
  const items = { [HEAD]: { n: chunks.length, sum: checksum(text), at: Date.now() } };
  chunks.forEach((c, i) => { items[CHUNK(i)] = c; });
  await chrome.storage.sync.set(items);
  const stale = [];
  for (let i = chunks.length; i < (previous?.n || 0); i++) stale.push(CHUNK(i));
  if (stale.length) await chrome.storage.sync.remove(stale);
}

async function round() {
  const { head, snap: remote } = await readRemote();
  // Chunks still arriving from the other device: leave everything alone, the
  // rest of them will trigger another round.
  if (head && !remote) return { pending: true };

  const local = toSnapshot(await readAll(), LOCAL_ATTEMPTS);
  const merged = mergeSnapshots(local, remote);

  const wrote = await applyMergedSnapshot(merged);
  // New settings from the other device may move the day window; re-file our
  // days before sending them, so they're filed the way the settings say.
  await syncDayWindow();

  // Push what is stored now, which includes anything saved during the round.
  // Compare it against what is there, not the whole state: the remote copy
  // only ever holds the trimmed snapshot.
  const { snap: outgoing, chunks } = await fitSnapshot(await readAll(), encodeSnapshot);
  const pushed = !remote || canonical(outgoing) !== canonical(toSnapshot(remote, outgoing.attempts.length));
  if (pushed) await writeRemote(chunks, head);

  return { pulled: wrote, pushed };
}

let running = null;
let again = false;

/** Run a sync round, or queue one behind the round already running. */
export function syncDevices() {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      let result;
      do {
        again = false;
        result = await round();
      } while (again);
      await patchMeta({ deviceSyncAt: Date.now(), deviceSyncError: null });
      return result;
    } catch (err) {
      await patchMeta({ deviceSyncError: err?.message || String(err), deviceSyncErrorAt: Date.now() });
      throw err;
    } finally {
      running = null;
    }
  })();
  return running;
}

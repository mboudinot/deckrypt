/* Pending-write queue for the optimistic-double-write strategy.
 *
 * The flow is:
 *   1. The user mutates a deck -> we write to localStorage immediately
 *      so the UI never blocks on the network.
 *   2. If logged in, we enqueue a "push to Firestore" entry and try to
 *      drain right away. If the push fails (offline, timeout, auth
 *      hiccup), the entry stays in the queue for retry on the next
 *      `online` event, the next save, or the next login.
 *
 * Dedup is critical to avoid amplifying load when the user edits a
 * deck rapidly: only the LATEST intent per `deckId` is kept. A delete
 * that follows a save voids the save (and vice-versa) -- pushing the
 * stale save then the delete would still converge, but it would burn
 * a useless write and briefly recreate a deleted doc.
 *
 * The pure logic (dedup) is exported for vitest. I/O (localStorage
 * read/write) lives at the bottom and is exercised in the browser.
 */

/* Per-user queue key. Tying the queue to the uid prevents a logged-out
 * user's pending writes from being drained into the next user's
 * account when a shared browser switches accounts (the auth check
 * inside drainQueue is not enough: cachedUser updates BEFORE the
 * drain reads the queue, so without partitioning, user B would
 * receive user A's pushes). */
function queueKeyForUid(uid) {
  if (typeof uid !== "string" || uid.length === 0) {
    throw new Error("queueKeyForUid: uid is required");
  }
  return `mtg-hand-sim:pending-writes:${uid}:v1`;
}

function isValidQueueEntry(e) {
  if (!e || typeof e !== "object") return false;
  if (e.op !== "save" && e.op !== "delete") return false;
  if (typeof e.deckId !== "string" || e.deckId.length === 0) return false;
  if (e.op === "save" && (!e.deck || typeof e.deck !== "object")) return false;
  return true;
}

/* Pure: returns a new queue with `entry` appended, after dropping any
 * prior entry targeting the same `deckId`. Last-write-wins per id,
 * regardless of operation type -- the latest intent is the only one
 * that matters once we get a chance to talk to the server. */
function dedupEnqueue(queue, entry) {
  const withoutId = queue.filter((e) => e.deckId !== entry.deckId);
  withoutId.push(entry);
  return withoutId;
}

/* Browser-only I/O. Returns [] on any failure (corrupted JSON,
 * localStorage disabled, etc.) -- a missing queue is indistinguishable
 * from an empty one for our purposes. */
function readQueue(uid) {
  try {
    const raw = localStorage.getItem(queueKeyForUid(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidQueueEntry);
  } catch (e) {
    console.warn("sync queue read failed, treating as empty:", e);
    return [];
  }
}

function writeQueue(uid, queue) {
  try {
    localStorage.setItem(queueKeyForUid(uid), JSON.stringify(queue));
    return true;
  } catch (e) {
    console.error("sync queue write failed:", e);
    return false;
  }
}

/* Expose to ES modules (sync.js) via window. */
if (typeof window !== "undefined") {
  window.syncQueue = {
    queueKeyForUid,
    isValidQueueEntry,
    dedupEnqueue,
    readQueue,
    writeQueue,
  };
}

/* CommonJS export for vitest. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    queueKeyForUid,
    isValidQueueEntry,
    dedupEnqueue,
  };
}

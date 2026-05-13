/* Backend façade — the ONLY place the Firebase SDK is imported.
 * Everything else in the app calls window.sync.* and never sees a
 * Firestore type. If we ever swap Firebase out (Supabase, custom
 * backend), this file is the entire migration surface.
 *
 * Contract:
 *  - All returned values are plain JS (Date, strings, numbers, arrays,
 *    objects). No DocumentReference, Timestamp, or User from Firebase.
 *  - Auth errors and Firestore errors bubble up as thrown Errors with
 *    a `.code` string when meaningful, so callers can branch on
 *    "auth/wrong-password" etc. without importing the SDK.
 *
 * High-level orchestration (commitDeck, drain, migrate) lives here too
 * so callers never need to know whether the source of truth is local
 * or cloud. The pending-write queue (window.syncQueue) handles
 * resilience: every mutation hits localStorage first for instant UI,
 * then is queued + pushed to Firestore on a best-effort basis.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  collection,
  setDoc,
  getDocs,
  deleteDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAE7mPmXOdLpn_tLdZfjOM4Yj2WqkPoEVE",
  authDomain: "deckrypt-f8718.firebaseapp.com",
  projectId: "deckrypt-f8718",
  storageBucket: "deckrypt-f8718.firebasestorage.app",
  messagingSenderId: "412865464982",
  appId: "1:412865464982:web:8a2ece9f087ef692d550b7",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* Neutral user shape — never expose Firebase's User object. */
function toUser(fbUser) {
  if (!fbUser) return null;
  return {
    uid: fbUser.uid,
    email: fbUser.email || null,
    displayName: fbUser.displayName || null,
    photoURL: fbUser.photoURL || null,
  };
}

/* Cached auth snapshot so the synchronous orchestrators
 * (commitDeck, etc.) don't have to await onAuthStateChanged. */
let cachedUser = null;
const authSubscribers = new Set();
/* True once Firebase has fired onAuthStateChanged at least once.
 * Until then, cachedUser=null means "unknown", not "signed out" —
 * `onAuthChange` skips the immediate replay so subscribers don't
 * mistakenly lock the UI before persistence resolves. */
let authResolved = false;

/* The session hint drives the synchronous boot gate in boot-theme.js
 * — present = "we expect a session" = render the app shell
 * optimistically. Set on every login transition, cleared on every
 * logout. Kept in localStorage so it survives the page reload that
 * the user triggers (F5). */
const SESSION_HINT_KEY = "mtg-hand-sim:has-session-v1";
function setSessionHint(authed) {
  try {
    if (authed) localStorage.setItem(SESSION_HINT_KEY, "1");
    else localStorage.removeItem(SESSION_HINT_KEY);
  } catch (e) { /* localStorage blocked — falls back to flash, acceptable */ }
}

/* Test seam — Playwright sets window.__deckryptTestUser via
 * addInitScript so the auth-gated boot works without hitting real
 * Firebase. In test mode we skip the onAuthStateChanged subscription
 * entirely and prime cachedUser directly; Firestore CRUD is also
 * short-circuited below so tests stay localStorage-only. The flag
 * is read once at module init — tests must set it BEFORE the page
 * loads sync.js. */
const TEST_MODE = typeof window !== "undefined" && !!window.__deckryptTestUser;
if (TEST_MODE) {
  cachedUser = { ...window.__deckryptTestUser };
  authResolved = true;
  setSessionHint(true);
} else {
  onAuthStateChanged(auth, (fbUser) => {
    const next = toUser(fbUser);
    const wasLoggedIn = !!cachedUser;
    cachedUser = next;
    authResolved = true;
    setSessionHint(!!next);
    /* Logout transition (token expired, signed-out from another tab,
     * etc.): wipe the localStorage deck cache so the next user on
     * this browser can't read the previous one's data. Same defense
     * as signOut(), but covers paths we don't drive ourselves. */
    if (wasLoggedIn && !next) {
      try { localStorage.removeItem("mtg-hand-sim:user-decks-v1"); } catch (e) {}
    }
    for (const cb of authSubscribers) {
      try { cb(next); } catch (e) { console.error("auth subscriber threw:", e); }
    }
    /* Login transition: drain anything queued while we were offline /
     * not authed yet. Login itself triggers a drain even with an empty
     * queue, which is cheap and keeps the contract simple. */
    if (!wasLoggedIn && next) void drainQueue();
  });
}

function currentUser() {
  return cachedUser;
}

function onAuthChange(cb) {
  authSubscribers.add(cb);
  /* Replay the current snapshot ONLY if Firebase has already resolved
   * persistence. Subscribing during boot (before resolution) waits for
   * the real callback — that's what avoids the "flash of login overlay
   * for an already-signed-in user" race: a premature cb(null) would
   * lock the UI just before Firebase reports the actual user. */
  if (authResolved) {
    try { cb(cachedUser); } catch (e) { console.error("auth subscriber threw:", e); }
  }
  return () => authSubscribers.delete(cb);
}

/* Pending-queue change observers. Fires when the queue grows (an
 * entry was enqueued via commitDeck/commitDeleteDeck) and when it
 * shrinks (an entry was successfully drained to Firestore, or the
 * queue was cleared on signOut). Callers don't get the queue
 * contents — just a "something changed, re-check via readQueue if
 * you care" signal. Used by the manage view's sync indicator to
 * refresh from `Sync en attente (N)` to `Synchronisé` once the
 * push actually lands. */
const queueSubscribers = new Set();
function onQueueChange(cb) {
  queueSubscribers.add(cb);
  return () => queueSubscribers.delete(cb);
}
function notifyQueueChange() {
  for (const cb of queueSubscribers) {
    try { cb(); } catch (e) { console.error("queue subscriber threw:", e); }
  }
}

async function signInWithGoogle() {
  const result = await signInWithPopup(auth, new GoogleAuthProvider());
  return toUser(result.user);
}

async function signInWithEmail(email, password) {
  const result = await signInWithEmailAndPassword(auth, email, password);
  return toUser(result.user);
}

async function signUpWithEmail(email, password) {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  return toUser(result.user);
}

async function signOut() {
  /* Wipe the local deck cache + queue BEFORE firing Firebase signOut.
   * Login-obligatoire model: anonymous users must NEVER see another
   * user's data in the same browser. Cache the uid first so we can
   * clean the per-uid queue entry as well. */
  const uidToCleanup = cachedUser?.uid || null;
  try { localStorage.removeItem("mtg-hand-sim:user-decks-v1"); } catch (e) {}
  setSessionHint(false);
  if (uidToCleanup && window.syncQueue?.queueKeyForUid) {
    try { localStorage.removeItem(window.syncQueue.queueKeyForUid(uidToCleanup)); } catch (e) {}
    notifyQueueChange();
  }
  if (TEST_MODE) {
    /* In tests we skipped the Firebase Auth subscription, so we have
     * to fan out the null transition manually for subscribers (which
     * is what onAuthStateChanged would do in production). Lets e2e
     * tests assert the post-signOut UI state. */
    cachedUser = null;
    for (const cb of authSubscribers) {
      try { cb(null); } catch (e) { console.error("auth subscriber threw:", e); }
    }
    return;
  }
  await fbSignOut(auth);
}

/* ============================================================
 * Per-deck Firestore CRUD — low-level, exposed for tests and the
 * occasional direct caller. Most code should use the higher-level
 * commitDeck / commitDeleteDeck below instead, which handle local
 * caching, auth gating, and the retry queue automatically.
 * Decks live at /users/{uid}/decks/{deckId}; the id is the doc id,
 * the rest goes in the body.
 * ============================================================ */
function decksCollection(uid) {
  return collection(db, "users", uid, "decks");
}

async function loadDecks(uid) {
  if (TEST_MODE) return [];
  const snap = await getDocs(decksCollection(uid));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function saveDeck(uid, deck) {
  if (TEST_MODE) return;
  const { id, ...body } = deck;
  if (!id) throw new Error("saveDeck: deck.id is required");
  await setDoc(doc(db, "users", uid, "decks", id), body);
}

async function deleteDeck(uid, deckId) {
  if (TEST_MODE) return;
  await deleteDoc(doc(db, "users", uid, "decks", deckId));
}

/* ============================================================
 * High-level orchestration — what the rest of the app calls.
 *
 * Login-obligatoire model: there is always a signed-in user when
 * these are called (the app shell is gated behind the auth lock).
 * Firestore is the source of truth; localStorage is the cache that
 * fuels the optimistic boot render. Every mutation writes both,
 * with the cloud write queued for retry if it fails.
 * ============================================================ */

/* Writes the deck to localStorage and, when logged in, enqueues a
 * push to Firestore. Returns { ok, reason? }. Local write failure
 * (storage full / disabled) is the only blocking error — cloud
 * pushes are best-effort by design, the queue absorbs failures. */
function commitDeck(deck) {
  if (!deck || typeof deck !== "object" || typeof deck.id !== "string") {
    return { ok: false, reason: "invalid-deck" };
  }
  const all = window.loadUserDecks();
  const idx = all.findIndex((d) => d.id === deck.id);
  if (idx === -1) all.push(deck); else all[idx] = deck;
  if (!window.saveUserDecks(all)) {
    return { ok: false, reason: "local-storage-unavailable" };
  }
  if (cachedUser) {
    enqueueAndDrain(cachedUser.uid, { op: "save", deckId: deck.id, deck });
  }
  return { ok: true };
}

/* Removes the deck from localStorage and, when logged in, enqueues a
 * cloud delete. Same contract as commitDeck. */
function commitDeleteDeck(deckId) {
  if (typeof deckId !== "string" || deckId.length === 0) {
    return { ok: false, reason: "invalid-deck-id" };
  }
  const remaining = window.loadUserDecks().filter((d) => d.id !== deckId);
  if (!window.saveUserDecks(remaining)) {
    return { ok: false, reason: "local-storage-unavailable" };
  }
  if (cachedUser) {
    enqueueAndDrain(cachedUser.uid, { op: "delete", deckId });
  }
  return { ok: true };
}

/* Returns the canonical deck list as a plain array. Firestore is
 * authoritative; we fetch from there, mirror the result into the
 * localStorage cache (so the next boot-theme.js + optimistic render
 * has fresh data), and return what's now in the cache. When the
 * cloud is empty (fresh signup) or unreachable we just return what's
 * already in localStorage. */
async function loadAllDecks() {
  if (!cachedUser) return window.loadUserDecks();
  const cloud = await loadDecks(cachedUser.uid);
  if (cloud.length > 0) {
    window.saveUserDecks(cloud);
    return cloud;
  }
  return window.loadUserDecks();
}

/* ============================================================
 * Pending-write queue glue. The pure dedup lives in
 * js/sync-queue.js (testable); the I/O + Firebase calls live here.
 * ============================================================ */

function enqueueAndDrain(uid, entry) {
  const q = window.syncQueue.readQueue(uid);
  window.syncQueue.writeQueue(uid, window.syncQueue.dedupEnqueue(q, entry));
  notifyQueueChange();
  void drainQueue();
}

let drainInFlight = false;
async function drainQueue() {
  if (drainInFlight) return;
  if (!cachedUser) return;
  /* Capture the uid at drain start. If the user logs out (or worse,
   * a different user logs in) while we're iterating, we MUST stop
   * processing this queue — otherwise we'd push the original user's
   * pending writes to whoever happens to be authed now. */
  const uid = cachedUser.uid;
  drainInFlight = true;
  try {
    let queue = window.syncQueue.readQueue(uid);
    while (queue.length > 0) {
      if (!cachedUser || cachedUser.uid !== uid) return;
      const entry = queue[0];
      try {
        if (entry.op === "save") {
          await saveDeck(uid, entry.deck);
        } else {
          await deleteDeck(uid, entry.deckId);
        }
      } catch (e) {
        /* Stop on first failure — retry on next `online`, next login,
         * or next commitDeck call. The entry stays at the head of the
         * queue so order is preserved. */
        console.warn("sync drain paused (will retry):", e?.message || e);
        return;
      }
      queue = queue.slice(1);
      window.syncQueue.writeQueue(uid, queue);
      notifyQueueChange();
    }
  } finally {
    drainInFlight = false;
  }
}

/* Auto-retry when connectivity comes back. Login-triggered drains
 * are handled in the onAuthStateChanged callback above. */
if (typeof window !== "undefined") {
  window.addEventListener("online", () => { void drainQueue(); });
}

window.sync = {
  /* Auth */
  currentUser,
  onAuthChange,
  signInWithGoogle,
  signInWithEmail,
  signUpWithEmail,
  signOut,
  /* Low-level CRUD (advanced / tests) */
  loadDecks,
  saveDeck,
  deleteDeck,
  /* High-level orchestration (what app code uses) */
  commitDeck,
  commitDeleteDeck,
  loadAllDecks,
  /* Queue state observer (sync indicator in the manage view) */
  onQueueChange,
  /* Manual queue control (debugging / migration UI) */
  drainQueue,
};

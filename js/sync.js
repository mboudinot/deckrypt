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
onAuthStateChanged(auth, (fbUser) => {
  const next = toUser(fbUser);
  const wasLoggedIn = !!cachedUser;
  cachedUser = next;
  for (const cb of authSubscribers) {
    try { cb(next); } catch (e) { console.error("auth subscriber threw:", e); }
  }
  /* Login transition: drain anything queued while we were offline /
   * not authed yet. Login itself triggers a drain even with an empty
   * queue, which is cheap and keeps the contract simple. */
  if (!wasLoggedIn && next) void drainQueue();
});

function currentUser() {
  return cachedUser;
}

function onAuthChange(cb) {
  authSubscribers.add(cb);
  /* Replay the current snapshot so subscribers don't have to wait for
   * the next change to learn the initial state. */
  try { cb(cachedUser); } catch (e) { console.error("auth subscriber threw:", e); }
  return () => authSubscribers.delete(cb);
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
  const snap = await getDocs(decksCollection(uid));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function saveDeck(uid, deck) {
  const { id, ...body } = deck;
  if (!id) throw new Error("saveDeck: deck.id is required");
  await setDoc(doc(db, "users", uid, "decks", id), body);
}

async function deleteDeck(uid, deckId) {
  await deleteDoc(doc(db, "users", uid, "decks", deckId));
}

/* ============================================================
 * High-level orchestration — what the rest of the app calls.
 * Mode rules (per the auth/persistence model memory):
 *   - Anonymous: localStorage only (sandbox mode).
 *   - Logged in: localStorage is the cache; Firestore is the source
 *     of truth. Every mutation writes both, with the cloud write
 *     queued for retry if it fails.
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

/* Returns the canonical deck list. Anonymous = whatever's in local
 * storage (with the demo seeded defaults). Logged in = Firestore is
 * authoritative; we fetch it, mirror the result into localStorage
 * for the next instant boot, and return the cloud list. The boot
 * code in app.js can call this in the background and rerender when
 * it lands, so the user sees the cached UI immediately. */
/* Returns { decks, source } so the caller can react accordingly:
 *   - source === "cloud": Firestore returned decks, localStorage was
 *     mirrored. Caller should typically rebuild the UI.
 *   - source === "local": Firestore was empty OR no user is logged
 *     in. Local was left untouched. Caller should NOT trigger any
 *     re-render — the visible state didn't change. This matters at
 *     boot for a fresh signup: the previous "always re-render"
 *     behavior fired a switchDeck() that raced with any in-flight
 *     refreshResolved (e.g., the user pasting cards right after
 *     login), leaving the new cards stuck unresolved. */
async function loadAllDecks() {
  if (!cachedUser) {
    return { decks: window.loadUserDecks(), source: "local" };
  }
  const cloud = await loadDecks(cachedUser.uid);
  if (cloud.length > 0) {
    window.saveUserDecks(cloud);
    return { decks: cloud, source: "cloud" };
  }
  return { decks: window.loadUserDecks(), source: "local" };
}

/* Push every localStorage deck to Firestore. Used at the moment the
 * user signs in for the first time and decides to keep their demo
 * decks. Returns { pushed, queued } so the UI can surface how many
 * went through immediately vs. ended up retried later. */
async function migrateLocalDecksToCloud() {
  if (!cachedUser) return { pushed: 0, queued: 0 };
  const decks = window.loadUserDecks();
  let pushed = 0;
  let queued = 0;
  for (const d of decks) {
    try {
      await saveDeck(cachedUser.uid, d);
      pushed++;
    } catch (e) {
      const q = window.syncQueue.readQueue(cachedUser.uid);
      window.syncQueue.writeQueue(
        cachedUser.uid,
        window.syncQueue.dedupEnqueue(q, { op: "save", deckId: d.id, deck: d })
      );
      queued++;
    }
  }
  /* Best-effort drain in case some succeeded after retries earlier. */
  void drainQueue();
  return { pushed, queued };
}

/* ============================================================
 * Pending-write queue glue. The pure dedup lives in
 * js/sync-queue.js (testable); the I/O + Firebase calls live here.
 * ============================================================ */

function enqueueAndDrain(uid, entry) {
  const q = window.syncQueue.readQueue(uid);
  window.syncQueue.writeQueue(uid, window.syncQueue.dedupEnqueue(q, entry));
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
  migrateLocalDecksToCloud,
  /* Manual queue control (debugging / migration UI) */
  drainQueue,
};

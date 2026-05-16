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
  EmailAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  updateProfile,
  updatePassword as fbUpdatePassword,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  deleteUser as fbDeleteUser,
  sendPasswordResetEmail as fbSendPasswordResetEmail,
  verifyPasswordResetCode as fbVerifyPasswordResetCode,
  confirmPasswordReset as fbConfirmPasswordReset,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  collection,
  setDoc,
  getDoc,
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
/* Firebase Auth sends transactional emails (verification, password
 * reset) in English by default. Force French so the password-reset
 * email lands in the user's language. The Console template language
 * can still override this per template, but this covers the case
 * where the FR template isn't configured. */
auth.languageCode = "fr";
const db = getFirestore(app);

/* Neutral user shape — never expose Firebase's User object.
 * `providers` is a flat list of provider IDs ("password", "google.com")
 * so callers can branch on auth-type without importing the SDK
 * (used by the settings UI to gate "change password" when the user
 * signed in with Google). */
function toUser(fbUser) {
  if (!fbUser) return null;
  return {
    uid: fbUser.uid,
    email: fbUser.email || null,
    displayName: fbUser.displayName || null,
    photoURL: fbUser.photoURL || null,
    providers: (fbUser.providerData || []).map((p) => p.providerId),
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
      try { localStorage.removeItem("mtg-hand-sim:active-deck-id:v1"); } catch (e) {}
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

/* Password-reset flow. Three façade functions for the three steps:
 *
 *   1. sendPasswordReset(email)         — UI: user clicks "Mot de
 *      passe oublié" on the login overlay, Firebase emails a reset
 *      link with an `oobCode` query param. We pass an `actionCodeSettings`
 *      so Firebase's hosted action page hands control back to our app
 *      (mode=resetPassword&oobCode=… on index.html) instead of using
 *      Firebase's generic page.
 *
 *   2. verifyPasswordResetCode(oobCode) — UI: user lands back on
 *      index.html with ?mode=resetPassword&oobCode=…, we call this
 *      before showing the new-password form to (a) reject bad/expired
 *      codes early and (b) display the target email so the user sees
 *      whose password they're resetting. Returns the email on success.
 *
 *   3. confirmPasswordReset(oobCode, newPassword) — UI: user submits
 *      the new password. Firebase atomically validates the code and
 *      sets the new password; on success we redirect the user to the
 *      signin form with a success message.
 *
 * TEST_MODE short-circuits to keep e2e tests off the network — the
 * test harness owns the auth state via window.__deckryptTestUser. */
async function sendPasswordReset(email) {
  if (TEST_MODE) return;
  const actionCodeSettings = {
    /* Where Firebase's action page redirects after a successful reset
     * (we override the whole action page below, but ContinueUrl is a
     * required field for the in-app handler flow). Must be on an
     * authorized domain — `window.location.origin` always is by
     * construction since the app loaded from it. */
    url: window.location.origin + window.location.pathname,
    handleCodeInApp: true,
  };
  await fbSendPasswordResetEmail(auth, email, actionCodeSettings);
}

async function verifyPasswordResetCode(oobCode) {
  if (TEST_MODE) return "test@example.com";
  return await fbVerifyPasswordResetCode(auth, oobCode);
}

async function confirmPasswordReset(oobCode, newPassword) {
  if (TEST_MODE) return;
  await fbConfirmPasswordReset(auth, oobCode, newPassword);
}

/* Update the user's display name (rendered as "Pseudo" in the
 * settings UI). Pushes the cached snapshot and notifies auth
 * subscribers so the rest of the app refreshes. */
async function updateDisplayName(name) {
  if (TEST_MODE) {
    if (cachedUser) cachedUser = { ...cachedUser, displayName: name || null };
    for (const cb of authSubscribers) {
      try { cb(cachedUser); } catch (e) { console.error("auth subscriber threw:", e); }
    }
    return;
  }
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error("not signed in");
  await updateProfile(fbUser, { displayName: name || "" });
  cachedUser = toUser(fbUser);
  for (const cb of authSubscribers) {
    try { cb(cachedUser); } catch (e) { console.error("auth subscriber threw:", e); }
  }
}

/* Change the user's password. Firebase requires a recent sign-in for
 * password updates, so we re-auth with the user's current password
 * first — that turns "stale session" 401s into a clean
 * `auth/wrong-password` the caller can show inline. Throws if the
 * provider isn't email/password (Google users have no password to
 * change here — they manage it on their Google account). */
async function changePassword(currentPassword, newPassword) {
  if (TEST_MODE) return;
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error("not signed in");
  if (!fbUser.email) throw new Error("auth/no-email");
  const cred = EmailAuthProvider.credential(fbUser.email, currentPassword);
  await reauthenticateWithCredential(fbUser, cred);
  await fbUpdatePassword(fbUser, newPassword);
}

/* Per-user preferences. Single doc at /users/{uid}/meta/preferences,
 * fields are merged (setDoc(..., { merge: true })). Falls back to {}
 * on read errors / missing doc / TEST_MODE. */
function preferencesRef(uid) {
  return doc(db, "users", uid, "meta", "preferences");
}

async function loadPreferences() {
  if (TEST_MODE) return {};
  if (!cachedUser) return {};
  try {
    const snap = await getDoc(preferencesRef(cachedUser.uid));
    return snap.exists() ? snap.data() : {};
  } catch (e) {
    /* Best-effort: offline or rules glitch shouldn't crash the boot
     * path — the local cache is enough to keep the app usable. */
    console.warn("loadPreferences failed:", e?.message || e);
    return {};
  }
}

async function savePreference(key, value) {
  if (TEST_MODE) return;
  if (!cachedUser) return;
  await setDoc(preferencesRef(cachedUser.uid), { [key]: value }, { merge: true });
}

/* RGPD art. 17 — right to erasure. Hard-deletes the user's data
 * AND identity. Reauth first (Firebase refuses a stale-session
 * deleteUser with `auth/requires-recent-login`); deletion order
 * matters: Firestore subtree FIRST so a mid-flight failure doesn't
 * leave us with an orphaned auth account but no way to retry the
 * data wipe (the user could log back in to clean up). Auth account
 * LAST because once it's gone there's no `request.auth.uid` to
 * authorise further Firestore writes. */
async function deleteAccount({ currentPassword } = {}) {
  if (TEST_MODE) {
    /* Mirror what onAuthStateChanged(null) would do in production:
     * wipe the local cache + queue, drop the cached user, fan out
     * the null transition to subscribers. Tests use this to assert
     * the post-deletion UI without touching Firebase. */
    const uid = cachedUser?.uid;
    try { localStorage.removeItem("mtg-hand-sim:user-decks-v1"); } catch (e) {}
    try { localStorage.removeItem("mtg-hand-sim:active-deck-id:v1"); } catch (e) {}
    if (uid && window.syncQueue?.queueKeyForUid) {
      try { localStorage.removeItem(window.syncQueue.queueKeyForUid(uid)); } catch (e) {}
    }
    setSessionHint(false);
    cachedUser = null;
    for (const cb of authSubscribers) {
      try { cb(null); } catch (e) { console.error("auth subscriber threw:", e); }
    }
    return;
  }
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error("not signed in");

  /* Reauth path depends on the provider — password users re-enter
   * their password, OAuth users go back through their provider's
   * popup. Other providers (Apple, GitHub, …) aren't enabled in
   * Firebase Console yet so we don't handle them. */
  const providerIds = (fbUser.providerData || []).map((p) => p.providerId);
  if (providerIds.includes("password")) {
    if (!currentPassword) throw new Error("auth/missing-password");
    if (!fbUser.email) throw new Error("auth/no-email");
    const cred = EmailAuthProvider.credential(fbUser.email, currentPassword);
    await reauthenticateWithCredential(fbUser, cred);
  } else if (providerIds.includes("google.com")) {
    await reauthenticateWithPopup(fbUser, new GoogleAuthProvider());
  } else {
    throw new Error("auth/unsupported-provider");
  }

  const uid = fbUser.uid;

  /* Firestore wipe — enumerate and delete every doc under the
   * user's tree. Today that's decks + meta/preferences; if more
   * collections land later, list them here. Sequential awaits keep
   * the order deterministic for tests and bound concurrent writes. */
  const decksSnap = await getDocs(decksCollection(uid));
  for (const d of decksSnap.docs) {
    await deleteDoc(doc(db, "users", uid, "decks", d.id));
  }
  try {
    await deleteDoc(preferencesRef(uid));
  } catch (e) {
    /* Not-found is fine — the user may never have changed a
     * preference. Anything else, we still want to fall through to
     * the Auth deletion so the user isn't stuck with an account
     * that can't be removed. */
    console.warn("preferences delete failed (ignored):", e?.message || e);
  }

  /* Wipe local cache + per-uid queue. onAuthStateChanged would do
   * it after the auth delete fires, but we beat it so the next
   * deleteUser-triggered subscriber call sees an empty cache. */
  try { localStorage.removeItem("mtg-hand-sim:user-decks-v1"); } catch (e) {}
  try { localStorage.removeItem("mtg-hand-sim:active-deck-id:v1"); } catch (e) {}
  if (window.syncQueue?.queueKeyForUid) {
    try { localStorage.removeItem(window.syncQueue.queueKeyForUid(uid)); } catch (e) {}
  }

  await fbDeleteUser(fbUser);
  /* No manual cleanup needed past this point — onAuthStateChanged
   * fires with null, the subscriber in app.js re-locks the shell
   * and re-opens the login overlay. */
}

async function signOut() {
  /* Wipe the local deck cache + queue BEFORE firing Firebase signOut.
   * Login-obligatoire model: anonymous users must NEVER see another
   * user's data in the same browser. Cache the uid first so we can
   * clean the per-uid queue entry as well. */
  const uidToCleanup = cachedUser?.uid || null;
  try { localStorage.removeItem("mtg-hand-sim:user-decks-v1"); } catch (e) {}
  try { localStorage.removeItem("mtg-hand-sim:active-deck-id:v1"); } catch (e) {}
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
  sendPasswordReset,
  verifyPasswordResetCode,
  confirmPasswordReset,
  /* Profile */
  updateDisplayName,
  changePassword,
  deleteAccount,
  /* Per-user preferences (theme, …) */
  loadPreferences,
  savePreference,
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

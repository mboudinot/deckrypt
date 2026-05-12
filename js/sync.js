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

function currentUser() {
  return toUser(auth.currentUser);
}

function onAuthChange(cb) {
  return onAuthStateChanged(auth, (fbUser) => cb(toUser(fbUser)));
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

/* Deck CRUD — per-user, stored at /users/{uid}/decks/{deckId}.
 * Mirrors the deck shape used by storage.js (id, name, commanders[],
 * cards[], optional format). The id is the doc id; the rest goes in
 * the document body. */
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

window.sync = {
  currentUser,
  onAuthChange,
  signInWithGoogle,
  signInWithEmail,
  signUpWithEmail,
  signOut,
  loadDecks,
  saveDeck,
  deleteDeck,
};

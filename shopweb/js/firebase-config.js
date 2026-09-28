// js/firebase-config.js — Firebase initialization, shared across the app.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDjGPvkoqfsRfFvMEJfVc-p2BXedp5zHLo",
  authDomain: "shopkeeper-4c572.firebaseapp.com",
  projectId: "shopkeeper-4c572",
  storageBucket: "shopkeeper-4c572.firebasestorage.app",
  messagingSenderId: "775346678978",
  appId: "1:775346678978:web:c14afb7fe07955bf6a5f5b",
  measurementId: "G-YL73RBF7TB",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

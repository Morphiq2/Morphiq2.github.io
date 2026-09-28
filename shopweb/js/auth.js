// js/auth.js — sign in / create account, mirrors lib/pages/auth/login_page.dart:
// same owner + business document shape, same NAME-YYMMDD-msSS business ID.
import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, collection, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { businessService } from "./services/business-service.js";

// Already signed in? Skip straight to the app.
onAuthStateChanged(auth, (user) => { if (user) window.location.href = "app.html"; });

document.querySelectorAll(".auth-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.getElementById("loginPanel").style.display = tab.dataset.tab === "login" ? "block" : "none";
    document.getElementById("signupPanel").style.display = tab.dataset.tab === "signup" ? "block" : "none";
  });
});

function showErr(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg; el.style.display = msg ? "block" : "none";
}
function friendlyAuthError(e) {
  const code = e.code || "";
  if (code.includes("user-not-found")) return "No account found for that email.";
  if (code.includes("wrong-password") || code.includes("invalid-credential")) return "Wrong email or password.";
  if (code.includes("invalid-email")) return "Invalid email address.";
  if (code.includes("too-many-requests")) return "Too many attempts. Please try again later.";
  if (code.includes("email-already-in-use")) return "An account already exists for that email.";
  if (code.includes("weak-password")) return "Password is too weak (min 6 characters).";
  return e.message || "Something went wrong.";
}

document.getElementById("loginBtn").addEventListener("click", async () => {
  showErr("loginErr", "");
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  if (!email || !password) { showErr("loginErr", "Enter your email and password."); return; }
  const btn = document.getElementById("loginBtn");
  btn.disabled = true; btn.textContent = "Signing in…";
  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = "app.html";
  } catch (e) {
    showErr("loginErr", friendlyAuthError(e));
  } finally {
    btn.disabled = false; btn.textContent = "Sign in";
  }
});

document.getElementById("signupBtn").addEventListener("click", async () => {
  showErr("signupErr", "");
  const ownerName = document.getElementById("suName").value.trim();
  const ownerEmail = document.getElementById("suEmail").value.trim();
  const ownerPhone = document.getElementById("suPhone").value.trim();
  const ownerAddress = document.getElementById("suAddress").value.trim();
  const password = document.getElementById("suPassword").value;
  const password2 = document.getElementById("suPassword2").value;
  const businessName = document.getElementById("suBizName").value.trim();
  const businessTax = document.getElementById("suBizTax").value.trim();

  if (!ownerName || !ownerEmail || !password) { showErr("signupErr", "Fill in your name, email and password."); return; }
  if (password.length < 6) { showErr("signupErr", "Password must be at least 6 characters."); return; }
  if (password !== password2) { showErr("signupErr", "Passwords don't match."); return; }
  if (!businessName) { showErr("signupErr", "Business name is required."); return; }

  const btn = document.getElementById("signupBtn");
  btn.disabled = true; btn.textContent = "Creating account…";
  let createdUser = null;
  try {
    const cred = await createUserWithEmailAndPassword(auth, ownerEmail, password);
    createdUser = cred.user;

    const businessPublicId = await businessService.generateUniqueBusinessId(businessName);
    const batch = writeBatch(db);

    batch.set(doc(db, "owners", createdUser.uid), {
      uid: createdUser.uid, email: ownerEmail, fullName: ownerName,
      phone: ownerPhone, address: ownerAddress, userType: "owner",
      createdAt: serverTimestamp(), lastLogin: serverTimestamp(),
      isActive: true, emailVerified: true,
    });

    const businessRef = doc(collection(db, "businesses"));
    batch.set(businessRef, {
      name: businessName, businessId: businessPublicId,
      phone: "", email: "", address: "",
      taxId: businessTax || null,
      ownerId: createdUser.uid, ownerName, ownerEmail, ownerPhone, ownerAddress,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      settings: { currency: "K", taxRate: 0 },
    });

    batch.set(doc(db, "business_ids", businessPublicId), {
      businessId: businessPublicId, businessDocId: businessRef.id, businessName,
      ownerId: createdUser.uid, createdAt: serverTimestamp(), isActive: true,
    });

    batch.set(doc(db, "owners", createdUser.uid, "businesses", businessRef.id), {
      name: businessName, businessId: businessPublicId, role: "owner",
      joinedAt: serverTimestamp(), isActive: true,
    });

    await batch.commit();
    await businessService.switchBusiness(businessRef.id, businessName);
    window.location.href = "app.html";
  } catch (e) {
    // Roll back the auth account if Firestore setup failed, so a retry
    // doesn't hit "email already in use" for a half-created account.
    if (createdUser) { try { await createdUser.delete(); } catch (_) {} }
    showErr("signupErr", friendlyAuthError(e));
  } finally {
    btn.disabled = false; btn.textContent = "Create account";
  }
});

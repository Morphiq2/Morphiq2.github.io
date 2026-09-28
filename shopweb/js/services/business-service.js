// js/services/business-service.js — mirrors lib/services/business_service.dart:
// same Firestore paths, field names, and the NAME-YYMMDD-msSS business-ID scheme.
import { auth, db } from "../firebase-config.js";
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  query, where, orderBy, limit, onSnapshot, runTransaction, writeBatch,
  serverTimestamp, Timestamp, collectionGroup,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  query, where, orderBy, limit, onSnapshot, runTransaction, writeBatch,
  serverTimestamp, Timestamp,
};

const CUR_BIZ_ID_KEY = "sk_current_business_id";
const CUR_BIZ_NAME_KEY = "sk_current_business_name";

function sha256Hex(str) {
  // Small dependency-free SHA-256 (matches Dart's crypto sha256 used for lockPinHash).
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)).then((buf) =>
    Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("")
  );
}

class BusinessService {
  constructor() {
    this.currentBusinessId = localStorage.getItem(CUR_BIZ_ID_KEY) || null;
    this.currentBusinessName = localStorage.getItem(CUR_BIZ_NAME_KEY) || null;
    this._listeners = [];
  }

  addListener(fn) { this._listeners.push(fn); }
  removeListener(fn) { this._listeners = this._listeners.filter((f) => f !== fn); }
  _notify() { this._listeners.forEach((f) => f()); }

  async initialize() {
    if (!this.currentBusinessId) await this._loadFirstBusiness();
  }

  async _loadFirstBusiness() {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const snap = await getDocs(query(collection(db, "owners", uid, "businesses"), limit(1)));
    if (!snap.empty) {
      const d = snap.docs[0];
      await this.switchBusiness(d.id, d.data().name || "Business");
    }
  }

  async switchBusiness(businessId, businessName) {
    if (!auth.currentUser) return;
    localStorage.setItem(CUR_BIZ_ID_KEY, businessId);
    localStorage.setItem(CUR_BIZ_NAME_KEY, businessName);
    this.currentBusinessId = businessId;
    this.currentBusinessName = businessName;
    this._notify();
  }

  // NAME-YYMMDD-msSS, reserved atomically in `business_ids` to avoid collisions.
  async generateUniqueBusinessId(businessName) {
    let base = businessName.toUpperCase().replace(/[^A-Z0-9]/g, "");
    base = base.length > 4 ? base.slice(0, 4) : base.padEnd(4, "X");
    for (let attempt = 0; attempt < 20; attempt++) {
      const now = new Date();
      const dateSeg = String(now.getFullYear() % 100).padStart(2, "0") +
        String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0");
      const msSeg = String(Math.floor(now.getMilliseconds() / 10)).padStart(2, "0");
      const secSeg = String(now.getSeconds()).padStart(2, "0");
      const candidate = `${base}-${dateSeg}-${msSeg}${secSeg}`;
      try {
        const reserved = await runTransaction(db, async (tx) => {
          const idRef = doc(db, "business_ids", candidate);
          const snap = await tx.get(idRef);
          if (snap.exists()) return false;
          tx.set(idRef, { reserved: true, reservedAt: serverTimestamp() });
          return true;
        });
        if (reserved) return candidate;
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Could not generate a unique business ID. Please try again.");
  }

  _itemNameCode(name) {
    let code = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return code.length > 4 ? code.slice(0, 4) : code.padEnd(4, "X");
  }

  async generateNextItemId(businessId, itemName) {
    const bizRef = doc(db, "businesses", businessId);
    const next = await runTransaction(db, async (tx) => {
      const snap = await tx.get(bizRef);
      const current = snap.data()?.itemIdCounter || 0;
      const n = current + 1;
      tx.update(bizRef, { itemIdCounter: n });
      return n;
    });
    return `${this._itemNameCode(itemName)}-${next}`;
  }

  async addBusiness({ name, phone, email, address, taxId }) {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error("User not authenticated");
    const ownerSnap = await getDoc(doc(db, "owners", uid));
    if (!ownerSnap.exists()) throw new Error("Owner record not found. Please complete your profile first.");
    const owner = ownerSnap.data();
    const businessPublicId = await this.generateUniqueBusinessId(name);

    const businessRef = doc(collection(db, "businesses"));
    const batch = writeBatch(db);
    batch.set(businessRef, {
      name, businessId: businessPublicId, phone: phone || "", email: email || "",
      address: address || "", taxId: taxId || "", ownerId: uid,
      ownerName: owner.fullName || "", ownerEmail: owner.email || "",
      ownerPhone: owner.phone || "", ownerAddress: owner.address || "",
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      settings: { currency: "K", taxRate: 0 },
    });
    batch.set(doc(db, "business_ids", businessPublicId), {
      businessId: businessPublicId, businessDocId: businessRef.id, businessName: name,
      ownerId: uid, createdAt: serverTimestamp(), isActive: true,
    });
    batch.set(doc(db, "owners", uid, "businesses", businessRef.id), {
      name, businessId: businessPublicId, role: "owner",
      joinedAt: serverTimestamp(), isActive: true,
    });
    await batch.commit();
    return businessRef.id;
  }

  async getBusinessDetails(businessId) {
    const snap = await getDoc(doc(db, "businesses", businessId));
    return snap.exists() ? snap.data() : null;
  }

  async updateBusinessDetails({ businessId, name, phone, email, address, taxId }) {
    const update = { updatedAt: serverTimestamp() };
    if (name != null) update.name = name;
    if (phone != null) update.phone = phone;
    if (email != null) update.email = email;
    if (address != null) update.address = address;
    if (taxId != null) update.taxId = taxId;
    await updateDoc(doc(db, "businesses", businessId), update);
    if (name != null) {
      const bizSnap = await getDoc(doc(db, "businesses", businessId));
      const bizData = bizSnap.data();
      if (bizData?.businessId) {
        await updateDoc(doc(db, "business_ids", bizData.businessId), { businessName: name });
      }
    }
  }

  async setLockPin(businessId, pin) {
    await updateDoc(doc(db, "businesses", businessId), { lockPinHash: await sha256Hex(pin) });
  }
  async clearLockPin(businessId) {
    await updateDoc(doc(db, "businesses", businessId), { lockPinHash: null });
  }
  async hasLockPin(businessId) {
    const snap = await getDoc(doc(db, "businesses", businessId));
    return !!snap.data()?.lockPinHash;
  }
  async verifyLockPin(businessId, pin) {
    const snap = await getDoc(doc(db, "businesses", businessId));
    const stored = snap.data()?.lockPinHash;
    if (!stored) return false;
    return stored === (await sha256Hex(pin));
  }

  async getUserBusinesses() {
    const uid = auth.currentUser?.uid;
    if (!uid) return [];
    const snap = await getDocs(collection(db, "owners", uid, "businesses"));
    const out = [];
    for (const d of snap.docs) {
      const details = await this.getBusinessDetails(d.id);
      out.push({ id: d.id, ...d.data(), details });
    }
    return out;
  }

  businessesStream(cb, onError) {
    const uid = auth.currentUser?.uid;
    if (!uid) { cb([]); return () => {}; }
    return onSnapshot(collection(db, "owners", uid, "businesses"), async (snap) => {
      const businesses = [];
      for (const d of snap.docs) {
        let details = null;
        try { details = await this.getBusinessDetails(d.id); } catch (_) {}
        businesses.push({ id: d.id, ...d.data(), details });
      }
      cb(businesses);
    }, onError);
  }

  async deleteBusinessData(businessId) {
    for (const col of ["inventory", "history", "expenses", "customers", "losses"]) {
      const snap = await getDocs(collection(db, "businesses", businessId, col));
      let batch = writeBatch(db); let n = 0;
      for (const d of snap.docs) {
        batch.delete(d.ref); n++;
        if (n >= 400) { await batch.commit(); batch = writeBatch(db); n = 0; }
      }
      if (n > 0) await batch.commit();
    }
  }

  // ── collection helpers ────────────────────────────────────────────────
  inventoryCol() { return collection(db, "businesses", this.currentBusinessId, "inventory"); }
  historyCol()   { return collection(db, "businesses", this.currentBusinessId, "history"); }
  expensesCol()  { return collection(db, "businesses", this.currentBusinessId, "expenses"); }
  customersCol() { return collection(db, "businesses", this.currentBusinessId, "customers"); }
  lossesCol()    { return collection(db, "businesses", this.currentBusinessId, "losses"); }
}

export const businessService = new BusinessService();

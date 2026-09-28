// js/pages/profile.js — Profile & Settings: personal info, business details,
// lock PIN, financial report, businesses list, support, danger zone.
// Mirrors lib/pages/desktop/profile.dart (and the mobile OwnerProfilePage).
import { auth, db } from "../firebase-config.js";
import {
  businessService, doc, getDoc, updateDoc, getDocs, query, where, collection,
} from "../services/business-service.js";
import { lockService } from "../services/lock-service.js";
import { icon, toast, openModal, confirmDialog, escapeHtml, fmtMoney, fmtDate } from "../services/ui.js";

export async function renderPage(container) {
  const state = { owner: null, business: null, businesses: [] };

  container.innerHTML = `<div style="padding:60px 0;text-align:center;color:var(--text-sub)">Loading…</div>`;
  await loadAll();
  render();

  async function loadAll() {
    const uid = auth.currentUser?.uid;
    if (uid) {
      const oSnap = await getDoc(doc(db, "owners", uid));
      state.owner = oSnap.exists() ? oSnap.data() : {};
    }
    if (businessService.currentBusinessId) {
      state.business = await businessService.getBusinessDetails(businessService.currentBusinessId);
    }
    state.businesses = await businessService.getUserBusinesses();
  }

  function render() {
    const bizId = businessService.currentBusinessId;
    const hasPin = !!(state.business && state.business.lockPinHash);
    const sorted = [...state.businesses].sort((a, b) => (a.id === bizId ? -1 : b.id === bizId ? 1 : 0));

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:7fr 4fr;gap:20px;max-width:1180px;margin:0 auto" id="profGrid">
        <div>
          ${personalCard()}
          ${businessCard()}
          ${lockCard(hasPin)}
          ${reportCard()}
        </div>
        <div>
          ${businessesCard(sorted, bizId)}
          ${supportCard()}
          ${dangerCard()}
        </div>
      </div>`;
    if (window.innerWidth <= 900) document.getElementById("profGrid").style.gridTemplateColumns = "1fr";
    wire();
  }

  function personalCard() {
    const o = state.owner || {};
    const initial = (o.fullName || auth.currentUser?.email || "?").trim().charAt(0).toUpperCase();
    return `
      <div class="card card-pad mb-16">
        <div class="flex" style="align-items:center;gap:14px;margin-bottom:16px">
          <div style="width:56px;height:56px;border-radius:14px;background:var(--blue-soft);color:var(--blue);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800">${escapeHtml(initial)}</div>
          <div>
            <div class="fw-700" style="font-size:16px">${escapeHtml(o.fullName || "—")}</div>
            <span class="badge badge-blue">Owner</span>
          </div>
        </div>
        <div style="border-top:1px solid var(--divider);padding-top:14px" class="grid grid-2" style="gap:14px">
          ${detailRow("mail", "Email", o.email)}
          ${detailRow("phone", "Phone", o.phone)}
        </div>
        <div style="margin-top:12px">${detailRow("pin", "Address", o.address)}</div>
      </div>`;
  }

  function businessCard() {
    const b = state.business || {};
    return `
      <div class="card card-pad mb-16">
        <div class="flex-between mb-12">
          <div class="flex" style="align-items:center;gap:8px">${icon("store")}<h3 style="font-size:15px;font-weight:700">Business Details</h3></div>
          <button class="btn btn-outline btn-sm" id="editBizBtn">${icon("edit")}<span>Edit</span></button>
        </div>
        ${b.businessId ? `
          <div class="flex-between" style="background:var(--page-bg);border-radius:9px;padding:9px 12px;margin-bottom:14px">
            <span class="text-muted" style="font-size:12px">Business ID</span>
            <div class="flex" style="align-items:center;gap:8px">
              <span class="fw-700" style="font-size:12.5px">${escapeHtml(b.businessId)}</span>
              <button class="btn-icon topbar-btn" id="copyBizId" style="border:none;padding:2px;width:22px;height:22px">${icon("copy")}</button>
            </div>
          </div>` : ""}
        <div class="grid grid-2 mb-12" style="gap:14px">
          ${detailRow("store", "Name", b.name)}
          ${detailRow("phone", "Phone", b.phone)}
        </div>
        ${detailRow("mail", "Email", b.email)}
        <div class="mt-8">${detailRow("pin", "Address", b.address)}</div>
        ${b.taxId ? `<div class="mt-8">${detailRow("fileText", "Tax ID", b.taxId)}</div>` : ""}
      </div>`;
  }

  function detailRow(iconName, label, value) {
    return `
      <div class="flex" style="align-items:flex-start;gap:9px">
        <span style="color:var(--text-faint);margin-top:1px">${icon(iconName)}</span>
        <div style="min-width:0">
          <div class="text-muted" style="font-size:11px;font-weight:600">${label}</div>
          <div style="font-size:13px;${value ? "" : "color:var(--text-faint)"}">${value ? escapeHtml(value) : "—"}</div>
        </div>
      </div>`;
  }

  function lockCard(hasPin) {
    return `
      <div class="card card-pad mb-16">
        <div class="flex-between mb-8">
          <div class="flex" style="align-items:center;gap:8px">${icon("lock")}<h3 style="font-size:15px;font-weight:700">Lock PIN</h3></div>
          ${hasPin ? `<span class="badge badge-green">PIN set</span>` : ""}
        </div>
        <p class="text-muted mb-16" style="font-size:12.5px">Require a PIN before editing inventory, viewing revenue figures, or opening this Profile page.</p>
        <div class="flex-gap-8">
          <button class="btn btn-outline" id="pinBtn" style="border-color:var(--purple);color:var(--purple)">${hasPin ? "Change PIN" : "Set PIN"}</button>
          ${hasPin ? `<button class="btn btn-outline" id="pinRemoveBtn" style="color:var(--red)">Remove</button>` : ""}
        </div>
      </div>`;
  }

  function reportCard() {
    return `
      <div class="card mb-16" id="reportBtn" style="cursor:pointer;background:var(--purple-soft);border-color:rgba(124,58,237,.25)">
        <div class="flex-between" style="padding:16px 18px">
          <div class="flex" style="align-items:center;gap:12px">
            <div style="width:42px;height:42px;border-radius:10px;background:#fff;display:flex;align-items:center;justify-content:center;color:var(--purple)">${icon("fileText")}</div>
            <div>
              <div class="fw-700" style="font-size:13.5px;color:var(--purple)">Download Financial Report</div>
              <div class="text-muted" style="font-size:11.5px">This month's revenue, expenses &amp; profit summary</div>
            </div>
          </div>
          ${icon("chevronRight")}
        </div>
      </div>`;
  }

  function businessesCard(list, bizId) {
    return `
      <div class="card card-pad mb-16">
        <div class="flex-between mb-14">
          <h3 style="font-size:14.5px;font-weight:700">Your Businesses</h3>
          <button class="btn btn-outline btn-sm" id="addBizBtn">${icon("plus")}<span>Add</span></button>
        </div>
        <div id="bizListWrap">
          ${list.length === 0 ? `<p class="text-muted" style="font-size:12.5px">No businesses yet.</p>` :
            list.map((b) => `
              <div class="flex-between biz-tile" data-switch="${b.id}" data-name="${escapeHtml(b.name)}" style="padding:11px 12px;border-radius:9px;margin-bottom:6px;${b.id === bizId ? "background:var(--blue-soft)" : "cursor:pointer"}">
                <div style="min-width:0">
                  <div class="fw-600" style="font-size:13px">${escapeHtml(b.name)}</div>
                  <div class="text-muted" style="font-size:11px">${escapeHtml(b.businessId || "")}</div>
                </div>
                ${b.id === bizId ? `<span class="badge badge-green">Active</span>` : ""}
              </div>`).join("")}
        </div>
      </div>`;
  }

  function supportCard() {
    return `
      <div class="card card-pad mb-16">
        <h3 style="font-size:14.5px;font-weight:700;margin-bottom:10px">Need help?</h3>
        <button class="btn btn-outline btn-block" id="whatsappBtn" style="color:var(--green);border-color:rgba(5,150,105,.3)">${icon("whatsapp")}<span>Chat on WhatsApp</span></button>
      </div>`;
  }

  function dangerCard() {
    return `
      <div class="card card-pad" style="border-color:rgba(220,38,38,.3)">
        <div class="flex" style="align-items:center;gap:8px;margin-bottom:8px">${icon("alert")}<h3 style="font-size:14.5px;font-weight:700;color:var(--red)">Danger Zone</h3></div>
        <p class="text-muted mb-16" style="font-size:12px">Permanently deletes all inventory, sales, expenses, customers and losses for this business. This cannot be undone.</p>
        <button class="btn btn-outline btn-block" id="wipeBtn" style="color:var(--red);border-color:rgba(220,38,38,.35)">Clear All Business Data</button>
      </div>`;
  }

  function wire() {
    const editBiz = document.getElementById("editBizBtn");
    if (editBiz) editBiz.addEventListener("click", openEditBusinessModal);

    const copyBtn = document.getElementById("copyBizId");
    if (copyBtn) copyBtn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(state.business.businessId); toast("Business ID copied", "success"); }
      catch (_) { toast("Couldn't copy", "error"); }
    });

    document.getElementById("pinBtn")?.addEventListener("click", openPinModal);
    document.getElementById("pinRemoveBtn")?.addEventListener("click", async () => {
      const ok = await confirmDialog({ title: "Remove lock PIN?", message: "Anyone with access to this device will be able to edit inventory, view revenue and open Profile without a PIN." });
      if (!ok) return;
      try { await businessService.clearLockPin(businessService.currentBusinessId); toast("Lock PIN removed", "success"); await loadAll(); render(); }
      catch (e) { toast("Error: " + e.message, "error"); }
    });

    document.getElementById("reportBtn")?.addEventListener("click", downloadFinancialReport);
    document.getElementById("addBizBtn")?.addEventListener("click", openAddBusinessModal);
    document.getElementById("whatsappBtn")?.addEventListener("click", () => {
      window.open("https://wa.me/260000000000?text=" + encodeURIComponent("Hi, I need help with Shopkeeper."), "_blank");
    });
    document.getElementById("wipeBtn")?.addEventListener("click", openWipeDataModal);

    container.querySelectorAll("[data-switch]").forEach((row) => {
      if (row.dataset.switch === businessService.currentBusinessId) return;
      row.addEventListener("click", async () => {
        await businessService.switchBusiness(row.dataset.switch, row.dataset.name);
        toast(`Switched to ${row.dataset.name}`, "success");
        await loadAll(); render();
      });
    });
  }

  function openEditBusinessModal() {
    const b = state.business || {};
    openModal({
      title: "Edit Business Details",
      width: 460,
      bodyHTML: `
        <div class="field mb-12"><label>Business name</label><input class="input" id="ebName" value="${escapeHtml(b.name || "")}" /></div>
        <div class="field mb-12"><label>Phone</label><input class="input" id="ebPhone" value="${escapeHtml(b.phone || "")}" /></div>
        <div class="field mb-12"><label>Email</label><input class="input" id="ebEmail" value="${escapeHtml(b.email || "")}" /></div>
        <div class="field mb-12"><label>Address</label><input class="input" id="ebAddress" value="${escapeHtml(b.address || "")}" /></div>
        <div class="field"><label>Tax ID</label><input class="input" id="ebTax" value="${escapeHtml(b.taxId || "")}" /></div>`,
      footHTML: `<button class="btn btn-outline" data-cancel>Cancel</button><button class="btn btn-primary" id="ebSave">Save changes</button>`,
      onMount: (el, close) => {
        el.querySelector("[data-cancel]").addEventListener("click", close);
        el.querySelector("#ebSave").addEventListener("click", async () => {
          const name = el.querySelector("#ebName").value.trim();
          if (!name) { toast("Business name is required", "error"); return; }
          try {
            await businessService.updateBusinessDetails({
              businessId: businessService.currentBusinessId, name,
              phone: el.querySelector("#ebPhone").value.trim(),
              email: el.querySelector("#ebEmail").value.trim(),
              address: el.querySelector("#ebAddress").value.trim(),
              taxId: el.querySelector("#ebTax").value.trim(),
            });
            businessService.switchBusiness(businessService.currentBusinessId, name);
            toast("Business details updated", "success");
            close(); await loadAll(); render();
          } catch (e) { toast("Error: " + e.message, "error"); }
        });
      },
    });
  }

  function openPinModal() {
    openModal({
      title: "Set Lock PIN",
      bodyHTML: `
        <div class="field mb-12"><label>New PIN (4–6 digits)</label><input class="input" type="password" inputmode="numeric" id="pin1" maxlength="6" /></div>
        <div class="field"><label>Confirm PIN</label><input class="input" type="password" inputmode="numeric" id="pin2" maxlength="6" /></div>`,
      footHTML: `<button class="btn btn-outline" data-cancel>Cancel</button><button class="btn btn-primary" id="pinSave">Save PIN</button>`,
      onMount: (el, close) => {
        el.querySelector("[data-cancel]").addEventListener("click", close);
        el.querySelector("#pinSave").addEventListener("click", async () => {
          const p1 = el.querySelector("#pin1").value.trim(), p2 = el.querySelector("#pin2").value.trim();
          if (p1.length < 4 || !/^\d+$/.test(p1)) { toast("PIN must be 4–6 digits", "error"); return; }
          if (p1 !== p2) { toast("PINs don't match", "error"); return; }
          try {
            await businessService.setLockPin(businessService.currentBusinessId, p1);
            toast("Lock PIN set", "success");
            close(); await loadAll(); render();
          } catch (e) { toast("Error: " + e.message, "error"); }
        });
      },
    });
  }

  function openAddBusinessModal() {
    openModal({
      title: "Add a Business",
      bodyHTML: `
        <div class="field mb-12"><label>Business name *</label><input class="input" id="nbName" /></div>
        <div class="field"><label>Tax ID <span class="text-faint">(optional)</span></label><input class="input" id="nbTax" /></div>`,
      footHTML: `<button class="btn btn-outline" data-cancel>Cancel</button><button class="btn btn-primary" id="nbSave">Create</button>`,
      onMount: (el, close) => {
        el.querySelector("[data-cancel]").addEventListener("click", close);
        el.querySelector("#nbSave").addEventListener("click", async () => {
          const name = el.querySelector("#nbName").value.trim();
          if (!name) { toast("Business name is required", "error"); return; }
          try {
            const o = state.owner || {};
            const newId = await businessService.addBusiness({
              name, taxId: el.querySelector("#nbTax").value.trim(),
              phone: o.phone || "", email: o.email || "", address: o.address || "",
            });
            await businessService.switchBusiness(newId, name);
            toast(`${name} created`, "success");
            close(); await loadAll(); render();
          } catch (e) { toast("Error: " + e.message, "error"); }
        });
      },
    });
  }

  function openWipeDataModal() {
    openModal({
      title: "Clear All Business Data",
      bodyHTML: `
        <div class="alert alert-danger mb-16">${icon("alert")}<span>This permanently deletes all inventory, sales, expenses, customers and losses for <strong>${escapeHtml(state.business?.name || "this business")}</strong>. This cannot be undone.</span></div>
        <div class="field"><label>Type DELETE to confirm</label><input class="input" id="wipeConfirm" placeholder="DELETE" /></div>`,
      footHTML: `<button class="btn btn-outline" data-cancel>Cancel</button><button class="btn btn-danger" id="wipeGo">Delete everything</button>`,
      onMount: (el, close) => {
        el.querySelector("[data-cancel]").addEventListener("click", close);
        el.querySelector("#wipeGo").addEventListener("click", async () => {
          if (el.querySelector("#wipeConfirm").value.trim() !== "DELETE") { toast('Type DELETE to confirm', "error"); return; }
          const btn = el.querySelector("#wipeGo");
          btn.disabled = true; btn.textContent = "Deleting…";
          try {
            await businessService.deleteBusinessData(businessService.currentBusinessId);
            toast("Business data cleared", "success");
            close();
          } catch (e) { toast("Error: " + e.message, "error"); btn.disabled = false; btn.textContent = "Delete everything"; }
        });
      },
    });
  }

  // Simplified financial report — the Flutter app's pdf_service.dart builds
  // a full multi-page PDF; here we generate a clean printable summary the
  // browser can save as PDF via its own print dialog (Ctrl/Cmd+P → Save as PDF).
  async function downloadFinancialReport() {
    toast("Preparing report…");
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const [historySnap, expensesSnap] = await Promise.all([
        getDocs(query(businessService.historyCol(), where("createdAt", ">=", monthStart))),
        getDocs(query(businessService.expensesCol(), where("createdAt", ">=", monthStart))),
      ]);
      let revenue = 0, profit = 0, salesCount = 0;
      historySnap.docs.forEach((d) => {
        const data = d.data();
        if (data.type === "sale" || (data.type === "credit_payment" && data.status !== "cancelled")) {
          revenue += data.total || 0; profit += data.totalProfit || 0; salesCount++;
        }
        if (data.type === "return") profit += data.totalProfit || 0;
      });
      let expenses = 0;
      expensesSnap.docs.forEach((d) => {
        const data = d.data();
        if (data.status !== "refunded" && data.status !== "cancelled") expenses += data.amount || 0;
      });
      const netProfit = profit - expenses;
      const win = window.open("", "_blank");
      win.document.write(`
        <html><head><title>Financial Report — ${escapeHtml(state.business?.name || "")}</title>
        <style>
          body{font-family:Arial,sans-serif;padding:40px;color:#1A1D23}
          h1{font-size:20px;margin-bottom:2px} p.sub{color:#8A94A6;margin-top:0;margin-bottom:28px;font-size:13px}
          table{width:100%;border-collapse:collapse;margin-top:10px}
          td{padding:10px 0;border-bottom:1px solid #EDF0F7;font-size:14px}
          td:last-child{text-align:right;font-weight:700}
          .total td{font-size:16px;font-weight:800;border-top:2px solid #1A1D23;border-bottom:none}
        </style></head><body>
        <h1>${escapeHtml(state.business?.name || "Financial Report")}</h1>
        <p class="sub">${monthStart.toLocaleDateString("en-GB",{month:"long",year:"numeric"})} · Generated ${fmtDate(now)}</p>
        <table>
          <tr><td>Sales this month</td><td>${salesCount}</td></tr>
          <tr><td>Revenue</td><td>${fmtMoney(revenue)}</td></tr>
          <tr><td>Gross profit</td><td>${fmtMoney(profit)}</td></tr>
          <tr><td>Expenses</td><td>${fmtMoney(expenses)}</td></tr>
          <tr class="total"><td>Net profit</td><td>${fmtMoney(netProfit)}</td></tr>
        </table>
        <script>window.onload = () => window.print();</script>
        </body></html>`);
      win.document.close();
    } catch (e) {
      toast("Couldn't generate report: " + e.message, "error");
    }
  }
}

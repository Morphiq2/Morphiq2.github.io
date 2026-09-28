// js/pages/inventory.js — product catalog CRUD.
import { businessService, onSnapshot, query, orderBy, addDoc, updateDoc, deleteDoc,
         doc, getDocs, where, limit, serverTimestamp } from "../services/business-service.js";
import { auth } from "../firebase-config.js";
import { icon, fmtMoney, fmtDate, toast, openModal, confirmDialog, debounce, escapeHtml, toDate } from "../services/ui.js";

const CATEGORIES = ["Groceries", "Beverages", "Household", "Personal Care", "Snacks", "Electronics", "Other"];

export async function renderPage(container, ctx) {
  if (!businessService.currentBusinessId) {
    container.innerHTML = emptyState(icon("box"), "No business selected", "Select a business first.");
    return;
  }

  const state = { items: [], search: "", category: "All" };

  ctx.setTopbarActions(`<button class="btn btn-primary" id="addItemBtn">${icon("plus")}<span class="btn-label">Add product</span></button>`);

  container.innerHTML = `
    <div id="expiringBanner"></div>
    <div class="card mb-16">
      <div class="card-pad flex-gap-12" style="flex-wrap:wrap;align-items:center">
        <div class="input-group" style="flex:1;min-width:220px">
          <span class="icon-left">${icon("search")}</span>
          <input class="input" id="invSearch" placeholder="Search by name or code…" />
        </div>
        <select class="input" id="invCategory" style="max-width:180px">
          <option value="All">All categories</option>
          ${CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="card"><div class="table-wrap" id="invTableWrap"></div></div>
  `;

  loadExpiringSoon();
  async function loadExpiringSoon() {
    try {
      const now = new Date();
      const in90 = new Date(now.getTime() + 90 * 86400000);
      const snap = await getDocs(query(businessService.inventoryCol(),
        where("expiryDate", ">=", now), where("expiryDate", "<", in90), orderBy("expiryDate")));
      if (snap.empty) return;
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      document.getElementById("expiringBanner").innerHTML = `
        <div class="alert alert-warn mb-16" style="align-items:flex-start;flex-wrap:wrap">
          ${icon("alert")}
          <span><strong>${items.length} item${items.length === 1 ? "" : "s"}</strong> expiring within 90 days: ${
            items.slice(0, 5).map((p) => `${escapeHtml(p.name)} (${fmtDate(p.expiryDate)})`).join(", ")
          }${items.length > 5 ? `, +${items.length - 5} more` : ""}</span>
        </div>`;
    } catch (_) { /* index may not exist yet — non-critical banner */ }
  }

  document.getElementById("addItemBtn").addEventListener("click", () => openItemModal(null, state));
  container.querySelector("#invSearch").addEventListener("input", debounce((e) => {
    state.search = e.target.value; renderTable();
  }, 150));
  container.querySelector("#invCategory").addEventListener("change", (e) => {
    state.category = e.target.value; renderTable();
  });

  const tableWrap = container.querySelector("#invTableWrap");

  const unsub = onSnapshot(
    query(businessService.inventoryCol(), orderBy("name")),
    (snap) => { state.items = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderTable(); },
    (err) => toast("Couldn't load inventory: " + err.message, "error")
  );
  return () => unsub();

  function renderTable() {
    const q = state.search.trim().toLowerCase();
    const rows = state.items.filter(p => {
      if (state.category !== "All" && p.category !== state.category) return false;
      if (!q) return true;
      return (p.name || "").toLowerCase().includes(q) || (p.searchCode || "").toLowerCase().includes(q);
    });

    if (state.items.length === 0) {
      tableWrap.innerHTML = emptyState(icon("box"), "No products yet", "Add your first product to get started.");
      return;
    }
    if (rows.length === 0) {
      tableWrap.innerHTML = emptyState(icon("search"), "No matches", "Try a different search or category.");
      return;
    }

    tableWrap.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>Product</th><th>Category</th><th>Item ID</th>
          <th class="num">Stock</th><th class="num">Cost</th><th class="num">Price</th><th></th>
        </tr></thead>
        <tbody>
          ${rows.map(rowHtml).join("")}
        </tbody>
      </table>`;

    tableWrap.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => {
      const item = state.items.find(i => i.id === b.dataset.edit);
      openItemModal(item, state);
    }));
    tableWrap.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
      const item = state.items.find(i => i.id === b.dataset.del);
      const ok = await confirmDialog({ title: "Delete product?", message: `This permanently removes <strong>${escapeHtml(item.name)}</strong> from your inventory.`, confirmLabel: "Delete" });
      if (!ok) return;
      try {
        await deleteDoc(doc(businessService.inventoryCol(), item.id));
        toast("Product deleted", "success");
      } catch (e) { toast("Error: " + e.message, "error"); }
    }));
    tableWrap.querySelectorAll("[data-loss]").forEach(b => b.addEventListener("click", () => {
      const item = state.items.find(i => i.id === b.dataset.loss);
      openReportLossModal(item);
    }));
  }

  // ── Report Loss (expired/damaged/stolen) ────────────────────────────────
  function openReportLossModal(item) {
    openModal({
      title: `Report Loss — ${item.name}`,
      bodyHTML: `
        <div class="field mb-12">
          <label>Loss type</label>
          <select class="input" id="lossType">
            <option value="expired">Expired</option>
            <option value="damaged">Damaged</option>
            <option value="stolen">Stolen</option>
          </select>
        </div>
        <div class="field mb-12"><label>Quantity (of ${item.quantity ?? 0} in stock)</label><input class="input" type="number" id="lossQty" value="1" min="1" max="${item.quantity ?? 0}" /></div>
        <div class="field"><label>Reason <span class="text-faint">(optional)</span></label><input class="input" id="lossReason" placeholder="Leave blank to use the loss type" /></div>`,
      footHTML: `<button class="btn btn-outline" data-cancel>Cancel</button><button class="btn btn-danger" id="lossSave">Record loss</button>`,
      onMount: (el, close) => {
        el.querySelector("[data-cancel]").addEventListener("click", close);
        el.querySelector("#lossSave").addEventListener("click", async () => {
          const lossType = el.querySelector("#lossType").value;
          const qty = parseInt(el.querySelector("#lossQty").value, 10);
          const reasonInput = el.querySelector("#lossReason").value.trim();
          const max = item.quantity ?? 0;
          if (!qty || qty <= 0 || qty > max) { toast(`Enter a quantity between 1 and ${max}`, "error"); return; }
          const btn = el.querySelector("#lossSave");
          btn.disabled = true; btn.textContent = "Recording…";
          try {
            const currentQty = item.quantity ?? 0;
            const newQty = Math.max(0, currentQty - qty);
            const lossValue = qty * (item.purchasePrice || 0);
            const reason = reasonInput || (lossType === "expired" ? "Expired" : lossType === "damaged" ? "Damaged" : "Stolen");
            await updateDoc(doc(businessService.inventoryCol(), item.id), { quantity: newQty, updatedAt: serverTimestamp() });
            await addDoc(businessService.lossesCol(), {
              productId: item.id, productName: item.name, productCode: item.searchCode || null,
              quantity: qty, lossType, reason,
              purchasePrice: item.purchasePrice || 0, retailPrice: item.retailPrice || 0,
              totalValue: lossValue, businessId: businessService.currentBusinessId,
              recordedAt: serverTimestamp(), recordedBy: auth.currentUser?.uid || null,
            });
            await addDoc(businessService.historyCol(), {
              type: "loss", productId: item.id, productName: item.name,
              quantity: qty, lossType, reason, value: lossValue,
              businessId: businessService.currentBusinessId, createdAt: serverTimestamp(),
              recordedBy: auth.currentUser?.uid || null,
            });
            toast(`Loss recorded: ${qty} ${lossType} item(s) — ${fmtMoney(lossValue)}`, "success");
            close();
          } catch (e) {
            toast("Error: " + e.message, "error");
            btn.disabled = false; btn.textContent = "Record loss";
          }
        });
      },
    });
  }

  function rowHtml(p) {
    const isLow = (p.quantity || 0) < 5;
    const details = [p.volume, p.weight, p.flavor, p.size].filter(Boolean).join(" · ");
    return `
      <tr>
        <td data-label="Product">
          <div class="fw-700">${escapeHtml(p.name)}</div>
          ${p.searchCode ? `<div class="text-muted" style="font-size:11.5px">${escapeHtml(p.searchCode)}</div>` : ""}
          ${details ? `<div class="text-faint" style="font-size:11px">${escapeHtml(details)}</div>` : ""}
        </td>
        <td data-label="Category"><span class="badge badge-blue">${escapeHtml(p.category || "Other")}</span></td>
        <td data-label="Item ID"><span class="text-muted" style="font-size:12px">${escapeHtml(p.itemId || "—")}</span></td>
        <td data-label="Stock" class="num"><span class="badge ${isLow ? "badge-amber" : "badge-green"}">${p.quantity ?? 0}</span></td>
        <td data-label="Cost" class="num">${fmtMoney(p.purchasePrice)}</td>
        <td data-label="Price" class="num fw-700">${fmtMoney(p.retailPrice)}</td>
        <td data-label="" style="text-align:right;white-space:nowrap">
          <button class="btn btn-ghost btn-icon btn-sm" data-loss="${p.id}" title="Report loss" style="color:var(--amber)">${icon("alert")}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-edit="${p.id}">${icon("edit")}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-del="${p.id}" style="color:var(--danger)">${icon("trash")}</button>
        </td>
      </tr>`;
  }
}

// ── Add / Edit modal ───────────────────────────────────────────────────
function openItemModal(item, state) {
  const isEdit = !!item;
  const body = `
    <div class="grid grid-2 mb-16">
      <div class="field" style="grid-column:1/-1">
        <label>Product name *</label>
        <input class="input" id="fName" value="${escapeHtml(item?.name || "")}" required />
      </div>
      <div class="field">
        <label>Category</label>
        <select class="input" id="fCategory">
          ${CATEGORIES.map(c => `<option value="${c}" ${item?.category === c ? "selected" : ""}>${c}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>Search code</label>
        <input class="input" id="fCode" value="${escapeHtml(item?.searchCode || "")}" placeholder="e.g. 12345" />
      </div>
      ${!isEdit ? `
      <div class="field" style="grid-column:1/-1">
        <label style="display:flex;align-items:center;gap:7px;cursor:pointer"><input type="checkbox" id="fBulkToggle" /> Enter by case (bulk stock-in)</label>
      </div>
      <div id="fBulkFields" style="display:none;grid-column:1/-1" class="grid grid-2">
        <div class="field"><label>No. of cases</label><input class="input" type="number" id="fCases" min="1" /></div>
        <div class="field"><label>Units per case</label><input class="input" type="number" id="fUnitsPerCase" min="1" /></div>
        <div class="field" style="grid-column:1/-1"><label>Cost per case</label><input class="input" type="number" step="0.01" id="fCasePrice" min="0" /></div>
        <div class="field" style="grid-column:1/-1"><p class="hint">Computed unit cost: <strong id="fUnitCostPreview">K0.00</strong></p></div>
      </div>` : ""}
      <div class="field" id="fQtyWrap">
        <label>Quantity *</label>
        <input class="input" type="number" id="fQty" value="${item?.quantity ?? ""}" required />
      </div>
      <div class="field" id="fCostWrap">
        <label>Purchase price *</label>
        <input class="input" type="number" step="0.01" id="fCost" value="${item?.purchasePrice ?? ""}" required />
      </div>
      <div class="field">
        <label>Retail price *</label>
        <input class="input" type="number" step="0.01" id="fPrice" value="${item?.retailPrice ?? ""}" required />
      </div>
      <div class="field">
        <label>Expiry date</label>
        <input class="input" type="date" id="fExpiry" value="${item?.expiryDate ? toDateInput(item.expiryDate) : ""}" />
      </div>
    </div>
    <div class="card-header" style="padding:0;border:none;margin-bottom:12px"><h3 style="font-size:13px;color:var(--text-muted)">Additional details (optional)</h3></div>
    <div class="grid grid-2">
      <div class="field"><label>Volume</label><input class="input" id="fVolume" value="${escapeHtml(item?.volume || "")}" placeholder="e.g. 500ml" /></div>
      <div class="field"><label>Weight</label><input class="input" id="fWeight" value="${escapeHtml(item?.weight || "")}" placeholder="e.g. 1kg" /></div>
      <div class="field"><label>Flavor / Variety</label><input class="input" id="fFlavor" value="${escapeHtml(item?.flavor || "")}" placeholder="e.g. Vanilla" /></div>
      <div class="field"><label>Size</label><input class="input" id="fSize" value="${escapeHtml(item?.size || "")}" placeholder="e.g. M, L, XL" /></div>
    </div>
  `;

  const { close } = openModal({
    title: isEdit ? "Edit product" : "Add new product",
    large: true,
    bodyHTML: body,
    footHTML: `<button class="btn btn-outline" data-cancel>Cancel</button><button class="btn btn-primary" id="saveItem">${isEdit ? "Save changes" : "Add product"}</button>`,
    onMount: (el) => {
      el.querySelector("[data-cancel]").addEventListener("click", close);
      el.querySelector("#saveItem").addEventListener("click", () => saveItem(el, item, close));

      const bulkToggle = el.querySelector("#fBulkToggle");
      if (bulkToggle) {
        const bulkFields = el.querySelector("#fBulkFields");
        const qtyWrap = el.querySelector("#fQtyWrap");
        const costWrap = el.querySelector("#fCostWrap");
        const recompute = () => {
          const cases = parseInt(el.querySelector("#fCases").value, 10) || 0;
          const perCase = parseInt(el.querySelector("#fUnitsPerCase").value, 10) || 0;
          const casePrice = parseFloat(el.querySelector("#fCasePrice").value) || 0;
          const totalUnits = cases * perCase;
          const unitCost = totalUnits > 0 ? casePrice / totalUnits : 0;
          el.querySelector("#fUnitCostPreview").textContent = fmtMoney(unitCost);
          if (bulkToggle.checked) {
            el.querySelector("#fQty").value = totalUnits || "";
            el.querySelector("#fCost").value = totalUnits > 0 ? unitCost.toFixed(2) : "";
          }
        };
        bulkToggle.addEventListener("change", () => {
          bulkFields.style.display = bulkToggle.checked ? "grid" : "none";
          qtyWrap.style.display = bulkToggle.checked ? "none" : "block";
          costWrap.style.display = bulkToggle.checked ? "none" : "block";
          recompute();
        });
        ["#fCases", "#fUnitsPerCase", "#fCasePrice"].forEach((sel) => el.querySelector(sel).addEventListener("input", recompute));
      }
    },
  });
}

async function saveItem(modalEl, existingItem, close) {
  const val = (id) => modalEl.querySelector(id).value.trim();
  const name = val("#fName");
  const category = val("#fCategory");
  const quantity = parseInt(val("#fQty"), 10) || 0;
  const purchasePrice = parseFloat(val("#fCost")) || 0;
  const retailPrice = parseFloat(val("#fPrice")) || 0;
  const searchCode = val("#fCode") || null;
  const expiry = val("#fExpiry");
  const volume = val("#fVolume") || null;
  const weight = val("#fWeight") || null;
  const flavor = val("#fFlavor") || null;
  const size = val("#fSize") || null;

  if (!name) { toast("Product name is required", "error"); return; }

  const saveBtn = modalEl.querySelector("#saveItem");
  saveBtn.disabled = true; saveBtn.textContent = "Saving…";

  try {
    if (existingItem) {
      const update = {
        name, nameLower: name.toLowerCase(), category, quantity,
        purchasePrice, retailPrice, updatedAt: serverTimestamp(),
      };
      update.searchCode = searchCode; update.searchCodeLower = searchCode ? searchCode.toLowerCase() : null;
      update.volume = volume; update.weight = weight; update.flavor = flavor; update.size = size;
      update.expiryDate = expiry ? new Date(expiry) : null;
      await updateDoc(doc(businessService.inventoryCol(), existingItem.id), update);
      toast("Product updated", "success");
    } else {
      const nameLower = name.toLowerCase();
      const productKey = [nameLower, category, purchasePrice.toFixed(2), retailPrice.toFixed(2), volume || "", weight || "", flavor || "", size || ""].join("|");

      const dupSnap = await getDocs(query(businessService.inventoryCol(), where("productKey", "==", productKey), limit(1)));
      if (!dupSnap.empty) {
        const d = dupSnap.docs[0];
        const currentQty = d.data().quantity || 0;
        await updateDoc(d.ref, { quantity: currentQty + quantity, updatedAt: serverTimestamp() });
        toast(`Product found! Quantity increased from ${currentQty} to ${currentQty + quantity}`, "success");
      } else {
        const itemId = await businessService.generateNextItemId(businessService.currentBusinessId, name);
        const newProduct = {
          productKey, itemId, name, nameLower, category, quantity, purchasePrice, retailPrice,
          businessId: businessService.currentBusinessId,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        };
        if (searchCode) { newProduct.searchCode = searchCode; newProduct.searchCodeLower = searchCode.toLowerCase(); }
        if (expiry) newProduct.expiryDate = new Date(expiry);
        if (volume) newProduct.volume = volume;
        if (weight) newProduct.weight = weight;
        if (flavor) newProduct.flavor = flavor;
        if (size) newProduct.size = size;
        await addDoc(businessService.inventoryCol(), newProduct);
        toast("New product added", "success");
      }
    }
    close();
  } catch (e) {
    toast("Error: " + e.message, "error");
    saveBtn.disabled = false; saveBtn.textContent = existingItem ? "Save changes" : "Add product";
  }
}

function toDateInput(ts) {
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toISOString().slice(0, 10);
}

function emptyState(iconSvg, title, sub) {
  return `<div class="empty-state"><div class="icon-wrap">${iconSvg}</div><h4>${title}</h4><p>${sub}</p></div>`;
}

// js/pages/sales.js — sales history, returns/exchange, credit-sale cancellation.
import { businessService, onSnapshot, query, orderBy, where, limit, getDocs,
         doc, serverTimestamp } from "../services/business-service.js";
import { db } from "../firebase-config.js";
import { runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { icon, fmtMoney, fmtDateTime, toast, openModal, confirmDialog, escapeHtml, toDate, sameDay } from "../services/ui.js";

const FILTERS = ["All", "Sales", "Credit", "Returns"];

export async function renderPage(container, ctx) {
  if (!businessService.currentBusinessId) {
    container.innerHTML = emptyState(icon("history"), "No business selected", "Select a business first.");
    return;
  }

  const state = { sales: [], filter: "All" };

  container.innerHTML = `
    <div class="card mb-16">
      <div class="card-pad flex-between" style="flex-wrap:wrap;gap:10px">
        <div class="flex-gap-8" style="flex-wrap:wrap">
          ${FILTERS.map(f => `<button class="pill-tab-btn ${f === "All" ? "active" : ""}" data-filter="${f}">${f}</button>`).join("")}
        </div>
        <button class="btn btn-outline btn-sm" id="bestSellersBtn">${icon("trending")}<span>Best Sellers</span></button>
      </div>
    </div>
    <div id="salesList"></div>
  `;
  injectStyle();

  container.querySelectorAll("[data-filter]").forEach(b => b.addEventListener("click", () => {
    state.filter = b.dataset.filter;
    container.querySelectorAll("[data-filter]").forEach(x => x.classList.toggle("active", x === b));
    render();
  }));

  container.querySelector("#bestSellersBtn").addEventListener("click", () => openBestSellersModal());

  const unsub = onSnapshot(
    query(businessService.historyCol(), orderBy("createdAt", "desc"), limit(200)),
    (snap) => { state.sales = snap.docs.map(d => ({ id: d.id, ...d.data() })); render(); },
    (err) => toast("Couldn't load sales history: " + err.message, "error")
  );
  return () => unsub();

  function render() {
    const list = document.getElementById("salesList");
    const rows = state.sales.filter(s => {
      if (state.filter === "Sales") return s.type === "sale";
      if (state.filter === "Credit") return s.type === "credit_sale" || s.type === "credit_payment";
      if (state.filter === "Returns") return s.type === "return";
      return true;
    });

    if (state.sales.length === 0) {
      list.innerHTML = emptyState(icon("history"), "No sales yet", "Completed sales will show up here.");
      return;
    }
    if (rows.length === 0) {
      list.innerHTML = emptyState(icon("search"), "Nothing in this filter", "Try a different tab.");
      return;
    }

    // A very small demarcation between sales of different dates: a
    // blue-tinted top border on the first card of each new calendar day.
    list.innerHTML = rows.map((s, i) => {
      const prevDate = i > 0 ? toDate(rows[i - 1].createdAt) : null;
      const thisDate = toDate(s.createdAt);
      const isNewDay = i === 0 || !sameDay(prevDate, thisDate);
      return saleCard(s, isNewDay);
    }).join("");
    list.querySelectorAll("[data-expand]").forEach(b => b.addEventListener("click", () => {
      const body = list.querySelector(`#detail-${b.dataset.expand}`);
      body.style.display = body.style.display === "block" ? "none" : "block";
    }));
    list.querySelectorAll("[data-return]").forEach(b => b.addEventListener("click", () => {
      const sale = state.sales.find(s => s.id === b.dataset.saleId);
      const item = sale.items[Number(b.dataset.itemIdx)];
      openReturnModal(sale, item, Number(b.dataset.itemIdx));
    }));
    list.querySelectorAll("[data-cancel-credit]").forEach(b => b.addEventListener("click", () => cancelCreditSale(b.dataset.cancelCredit)));
  }

  function saleCard(s, isNewDay) {
    const typeMeta = typeInfo(s.type);
    const itemsCount = (s.items || []).length;
    return `
      <div class="card mb-12 sale-card" style="${isNewDay ? "border-top:1.5px solid rgba(37,99,235,.35)" : ""}">
        <div class="sale-row" data-expand="${s.id}">
          <div class="flex" style="align-items:center;gap:12px;min-width:0">
            <span class="badge badge-${typeMeta.color}">${typeMeta.label}</span>
            <div style="min-width:0">
              <div class="fw-700" style="font-size:13.5px">${escapeHtml(s.customerName || typeMeta.label)}</div>
              <div class="text-muted" style="font-size:11.5px">${fmtDateTime(s.createdAt)} · ${itemsCount} item${itemsCount === 1 ? "" : "s"}</div>
            </div>
          </div>
          <div class="flex" style="align-items:center;gap:12px">
            <div style="text-align:right">
              <div class="fw-700" style="font-size:14.5px">${fmtMoney(s.total)}</div>
              ${s.hasReturns ? `<div class="text-danger" style="font-size:11px">−${fmtMoney(s.returnedTotal)} returned</div>` : ""}
            </div>
            ${icon("chevronRight")}
          </div>
        </div>
        <div class="sale-detail" id="detail-${s.id}" style="display:none">
          ${itemsRows(s)}
          ${s.type === "credit_sale" && s.status === "pending" ? `
            <div class="flex-between" style="padding:12px 16px;border-top:1px solid var(--border)">
              <span class="text-muted" style="font-size:12px">Outstanding credit sale</span>
              <button class="btn btn-outline btn-sm" data-cancel-credit="${s.id}" style="color:var(--danger)">Cancel sale</button>
            </div>` : ""}
        </div>
      </div>`;
  }

  function itemsRows(s) {
    if (!s.items || !s.items.length) return `<div style="padding:14px 16px" class="text-muted">No item detail available.</div>`;
    return `<div style="padding:6px 16px 12px">
      ${s.items.map((it, idx) => {
        const returned = it.originalReturnedQty || 0;
        const remaining = (it.quantity || 0) - returned;
        const canReturn = (s.type === "sale" || s.type === "credit_sale") && remaining > 0;
        return `
          <div class="flex-between" style="padding:9px 0;border-bottom:1px solid var(--border)">
            <div>
              <div class="fw-600" style="font-size:13px">${escapeHtml(it.name)}</div>
              <div class="text-muted" style="font-size:11.5px">${it.quantity} × ${fmtMoney(it.retailPrice)} ${returned ? `· ${returned} returned` : ""}</div>
            </div>
            <div class="flex" style="align-items:center;gap:10px">
              <span class="fw-700" style="font-size:13px">${fmtMoney((it.quantity || 0) * (it.retailPrice || 0))}</span>
              ${canReturn ? `<button class="btn btn-outline btn-sm" data-return data-sale-id="${s.id}" data-item-idx="${idx}">Return</button>` : ""}
            </div>
          </div>`;
      }).join("")}
    </div>`;
  }

  // ── Return / exchange flow ────────────────────────────────────────────
  async function openReturnModal(sale, item, itemIdx) {
    const returned = item.originalReturnedQty || 0;
    const maxQty = (item.quantity || 0) - returned;
    let reason = "Damaged";
    let exchangeItem = null;
    let exchangeCandidates = [];

    try {
      const invSnap = await getDocs(query(businessService.inventoryCol(), where("quantity", ">", 0)));
      exchangeCandidates = invSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(p => (p.retailPrice || 0) <= (item.retailPrice || 0));
    } catch (_) {}

    const { close, el } = openModal({
      title: `Return — ${item.name}`,
      bodyHTML: `
        <div class="grid grid-2 mb-16">
          <div class="field"><label>Quantity (max ${maxQty})</label><input class="input" type="number" id="rQty" value="1" min="1" max="${maxQty}" /></div>
          <div class="field"><label>Reason</label>
            <select class="input" id="rReason">
              <option value="Damaged">Damaged</option>
              <option value="Wrong item">Wrong item</option>
              <option value="Exchange">Exchange</option>
            </select>
          </div>
        </div>
        <div id="exchangeWrap" style="display:none">
          <label class="mb-8" style="font-size:12.5px;font-weight:600;color:var(--text-sub);display:block">Select replacement item</label>
          <div style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--r-md)" id="exchangeList">
            ${exchangeCandidates.length ? exchangeCandidates.map(p => `
              <label class="exchange-row">
                <input type="radio" name="exchangeItem" value="${p.id}" />
                <span style="flex:1">${escapeHtml(p.name)}</span>
                <span class="text-muted" style="font-size:12px">${fmtMoney(p.retailPrice)} · ${p.quantity} in stock</span>
              </label>`).join("") : `<div class="text-muted" style="padding:14px">No eligible replacement items (price must be ≤ original).</div>`}
          </div>
        </div>
        <div class="alert alert-danger mt-16">
          <span>Refund amount:</span>
          <strong id="refundPreview" style="margin-left:auto">${fmtMoney(item.retailPrice)}</strong>
        </div>
      `,
      footHTML: `<button class="btn btn-outline" data-cancel>Cancel</button><button class="btn btn-danger" id="rSubmit">Return</button>`,
      onMount: (modalEl) => {
        const qtyInput = modalEl.querySelector("#rQty");
        const reasonSelect = modalEl.querySelector("#rReason");
        const exchangeWrap = modalEl.querySelector("#exchangeWrap");
        const refundPreview = modalEl.querySelector("#refundPreview");
        const submitBtn = modalEl.querySelector("#rSubmit");

        function updatePreview() {
          const qty = parseInt(qtyInput.value, 10) || 0;
          refundPreview.textContent = fmtMoney(qty * item.retailPrice);
          exchangeWrap.style.display = reasonSelect.value === "Exchange" ? "block" : "none";
          submitBtn.textContent = reasonSelect.value === "Exchange" ? "Exchange" : "Return";
        }
        qtyInput.addEventListener("input", updatePreview);
        reasonSelect.addEventListener("change", updatePreview);
        updatePreview();

        modalEl.querySelector("[data-cancel]").addEventListener("click", close);
        submitBtn.addEventListener("click", async () => {
          const qty = parseInt(qtyInput.value, 10) || 0;
          if (qty <= 0 || qty > maxQty) { toast("Invalid quantity", "error"); return; }
          const r = reasonSelect.value;
          let ex = null;
          if (r === "Exchange") {
            const checked = modalEl.querySelector('input[name="exchangeItem"]:checked');
            if (!checked) { toast("Select a replacement item", "error"); return; }
            ex = exchangeCandidates.find(c => c.id === checked.value);
          }
          submitBtn.disabled = true; submitBtn.textContent = "Processing…";
          try {
            await processReturn(sale, item, qty, r, ex);
            toast(`${r === "Exchange" ? "Exchange" : "Return"} processed: −${fmtMoney(qty * item.retailPrice)}`, "success");
            close();
          } catch (e) {
            toast("Error: " + e.message, "error");
            submitBtn.disabled = false; submitBtn.textContent = r === "Exchange" ? "Exchange" : "Return";
          }
        });
      },
    });
  }

  // Finds the inventory doc to restock into: prefers the item's stamped
  // itemId (survives later price changes), falls back to name+price match
  // for sales recorded before itemId existed.
  async function findInventoryDocForItem(item) {
    if (item.itemId) {
      const byId = await getDocs(query(businessService.inventoryCol(), where("itemId", "==", item.itemId), limit(1)));
      if (!byId.empty) return byId.docs[0];
    }
    const byNamePrice = await getDocs(query(
      businessService.inventoryCol(),
      where("name", "==", item.name),
      where("retailPrice", "==", item.retailPrice),
      where("purchasePrice", "==", item.purchasePrice),
      limit(1)
    ));
    return byNamePrice.empty ? null : byNamePrice.docs[0];
  }

  async function processReturn(sale, item, returnQty, reason, exchangeItem) {
    const refundAmount = item.retailPrice * returnQty;
    const profitAdj = (item.retailPrice - item.purchasePrice) * returnQty;
    const inventoryDoc = await findInventoryDocForItem(item);

    await runTransaction(db, async (tx) => {
      const saleRef = doc(businessService.historyCol(), sale.id);
      const saleSnap = await tx.get(saleRef);
      if (!saleSnap.exists()) throw new Error("Sale not found");
      const existing = saleSnap.data();

      const updatedItems = (existing.items || []).map((it, idx) => {
        if (idx !== sale.items.indexOf(item)) return it;
        return { ...it, originalReturnedQty: (it.originalReturnedQty || 0) + returnQty };
      });

      tx.update(saleRef, {
        items: updatedItems,
        hasReturns: true,
        returnedTotal: (existing.returnedTotal || 0) + refundAmount,
        returnedProfit: (existing.returnedProfit || 0) + profitAdj,
      });

      if (reason === "Wrong item" || reason === "Exchange") {
        if (inventoryDoc) {
          tx.update(inventoryDoc.ref, { quantity: (inventoryDoc.data().quantity || 0) + returnQty });
        } else {
          tx.set(doc(businessService.inventoryCol()), {
            name: item.name, searchCode: item.searchCode || null,
            category: "Other", quantity: returnQty,
            purchasePrice: item.purchasePrice, retailPrice: item.retailPrice,
            businessId: businessService.currentBusinessId,
            createdAt: serverTimestamp(),
          });
        }
      }

      if (reason === "Exchange" && exchangeItem) {
        const exRef = doc(businessService.inventoryCol(), exchangeItem.id);
        tx.update(exRef, { quantity: Math.max(0, (exchangeItem.quantity || 0) - returnQty) });
      }

      tx.set(doc(businessService.historyCol()), {
        type: "return", originalSaleId: sale.id, saleDate: existing.createdAt,
        items: [{ name: item.name, searchCode: item.searchCode || null, retailPrice: item.retailPrice,
          purchasePrice: item.purchasePrice, quantity: returnQty, reason, date: new Date().toISOString() }],
        total: refundAmount, totalProfit: -profitAdj, reason,
        createdAt: serverTimestamp(), businessId: businessService.currentBusinessId,
        ...(reason === "Exchange" && exchangeItem ? {
          exchangeItem: { name: exchangeItem.name, id: exchangeItem.id, retailPrice: exchangeItem.retailPrice, purchasePrice: exchangeItem.purchasePrice },
        } : {}),
      });
    });
  }

  async function cancelCreditSale(saleId) {
    const ok = await confirmDialog({ title: "Cancel credit sale?", message: "This restocks all items and removes the outstanding credit from the customer." });
    if (!ok) return;
    const sale = state.sales.find(s => s.id === saleId);
    if (!sale) return;
    try {
      const restockByDocId = new Map();
      const refByDocId = new Map();
      for (const item of sale.items || []) {
        const invDoc = await findInventoryDocForItem(item);
        if (invDoc) {
          restockByDocId.set(invDoc.id, (restockByDocId.get(invDoc.id) || 0) + (item.quantity || 0));
          refByDocId.set(invDoc.id, invDoc);
        }
      }
      await runTransaction(db, async (tx) => {
        const saleRef = doc(businessService.historyCol(), saleId);
        const saleSnap = await tx.get(saleRef);
        if (!saleSnap.exists()) throw new Error("Sale not found");
        for (const [docId, addQty] of restockByDocId.entries()) {
          const invRef = refByDocId.get(docId).ref;
          const invSnap = await tx.get(invRef);
          tx.update(invRef, { quantity: (invSnap.data().quantity || 0) + addQty });
        }
        tx.update(saleRef, { status: "cancelled" });
        if (sale.customerId) {
          const custRef = doc(businessService.customersCol(), sale.customerId);
          const custSnap = await tx.get(custRef);
          if (custSnap.exists()) {
            tx.update(custRef, { currentCredit: Math.max(0, (custSnap.data().currentCredit || 0) - (sale.total || 0)) });
          }
        }
      });
      toast("Credit sale cancelled and items restocked", "success");
    } catch (e) {
      toast("Error: " + e.message, "error");
    }
  }

  // ── Best Sellers ─────────────────────────────────────────────────────
  // Every product sold this month, ranked by quantity — no cap, scrollable.
  async function openBestSellersModal() {
    const { close } = openModal({
      title: "Best Sellers",
      width: 440,
      bodyHTML: `<div id="bsBody" style="max-height:420px;overflow-y:auto">Loading…</div>`,
      onMount: async (el) => {
        try {
          const now = new Date();
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          const snap = await getDocs(query(
            businessService.historyCol(), orderBy("createdAt", "desc"), limit(200)
          ));
          const tally = new Map(); // name -> { qty, revenue }
          snap.docs.forEach((d) => {
            const data = d.data();
            if (data.type !== "sale" && data.type !== "credit_sale") return;
            const created = toDate(data.createdAt);
            if (!created || created < monthStart) return;
            (data.items || []).forEach((it) => {
              const key = it.name || "Unknown";
              const cur = tally.get(key) || { qty: 0, revenue: 0 };
              const qty = it.quantity || 0;
              cur.qty += qty;
              cur.revenue += qty * (it.retailPrice || 0);
              tally.set(key, cur);
            });
          });
          const ranked = [...tally.entries()].sort((a, b) => b[1].qty - a[1].qty);
          const body = el.querySelector("#bsBody");
          if (ranked.length === 0) {
            body.innerHTML = emptyState(icon("trending"), "No sales this month yet", "Sold items will be ranked here.");
            return;
          }
          body.innerHTML = ranked.map(([name, v], i) => `
            <div class="flex-between" style="padding:10px 2px;border-bottom:1px solid var(--divider)">
              <div class="flex" style="align-items:center;gap:10px;min-width:0">
                <span class="badge badge-blue" style="min-width:24px;justify-content:center">${i + 1}</span>
                <span class="fw-600" style="font-size:13px">${escapeHtml(name)}</span>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div class="fw-700" style="font-size:13px">${v.qty} sold</div>
                <div class="text-muted" style="font-size:11px">${fmtMoney(v.revenue)}</div>
              </div>
            </div>`).join("");
        } catch (e) {
          el.querySelector("#bsBody").innerHTML = `<p class="text-danger">Couldn't load: ${escapeHtml(e.message)}</p>`;
        }
      },
    });
  }
}

function typeInfo(type) {
  switch (type) {
    case "sale": return { label: "Sale", color: "green" };
    case "credit_sale": return { label: "Credit sale", color: "purple" };
    case "credit_payment": return { label: "Credit payment", color: "blue" };
    case "return": return { label: "Return", color: "red" };
    default: return { label: "Transaction", color: "gray" };
  }
}

function emptyState(iconSvg, title, sub) {
  return `<div class="empty-state"><div class="icon-wrap">${iconSvg}</div><h4>${title}</h4><p>${sub}</p></div>`;
}

function injectStyle() {
  if (document.getElementById("sales-inline-style")) return;
  const style = document.createElement("style");
  style.id = "sales-inline-style";
  style.textContent = `
    .pill-tab-btn { padding:7px 14px; border-radius:999px; border:1px solid var(--border); background:var(--bg-surface); font-size:12.5px; font-weight:600; color:var(--text-muted); }
    .pill-tab-btn.active { background:var(--accent); border-color:var(--accent); color:#fff; }
    .sale-row { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; cursor:pointer; }
    .sale-row:hover { background: var(--sk-gray-25); }
    .sale-detail { border-top:1px solid var(--border); }
    .exchange-row { display:flex; align-items:center; gap:10px; padding:10px 12px; border-bottom:1px solid var(--border); cursor:pointer; font-size:13px; }
    .exchange-row:last-child { border-bottom:none; }
    .exchange-row:hover { background: var(--sk-gray-25); }
  `;
  document.head.appendChild(style);
}

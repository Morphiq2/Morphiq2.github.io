// js/pages/dashboard.js — Point of sale: product grid + cart + checkout.
import { businessService, onSnapshot, query, where, orderBy, addDoc, updateDoc, doc,
         getDocs, serverTimestamp, writeBatch } from "../services/business-service.js";
import { db } from "../firebase-config.js";
import { icon, fmtMoney, toast, openModal, debounce, escapeHtml } from "../services/ui.js";

export async function renderPage(container, ctx) {
  if (!businessService.currentBusinessId) {
    container.innerHTML = noBusinessState();
    return;
  }

  const state = {
    products: [],
    search: "",
    cart: [],          // {id, itemId, name, searchCode, retailPrice, purchasePrice, availableQty, cartQty}
    mode: "Normal",     // Normal | Credit
    paidAmount: 0,
    customerName: "",
    customerPhone: "",
    dueDate: "",
    processing: false,
    cartOpenMobile: false,
  };

  container.innerHTML = `
    <div class="pos-layout">
      <div id="posCatalog"></div>
    </div>
    <button class="btn btn-primary btn-icon" id="mobileCartFab" style="
      display:none;position:fixed;right:18px;bottom:76px;z-index:70;
      width:54px;height:54px;border-radius:50%;box-shadow:var(--shadow-lg);">
      ${icon("cart")}
      <span id="mobileCartCount" style="
        position:absolute;top:-4px;right:-4px;background:var(--danger);color:#fff;
        font-size:10px;font-weight:800;min-width:18px;height:18px;border-radius:9px;
        display:flex;align-items:center;justify-content:center;padding:0 4px;">0</span>
    </button>
    <div id="posStyle"></div>
  `;

  injectPosStyles();

  const catalogEl = document.createElement("div");
  const cartEl = document.createElement("div");
  buildLayout(container, catalogEl, cartEl);

  renderCatalog(catalogEl, state);
  renderCart(cartEl, state);
  wireMobileFab(container, state, cartEl);

  const unsub = onSnapshot(
    query(businessService.inventoryCol(), where("quantity", ">", 0), orderBy("name")),
    (snap) => {
      state.products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderCatalog(catalogEl, state);
    },
    (err) => toast("Couldn't load inventory: " + err.message, "error")
  );

  return () => unsub();

  // ── Layout ───────────────────────────────────────────────────────────
  function buildLayout(root, catalog, cart) {
    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "pos-wrap";
    catalog.className = "pos-catalog";
    cart.className = "pos-cart";
    wrap.appendChild(catalog);
    wrap.appendChild(cart);
    root.appendChild(wrap);
  }

  // ── Catalog ──────────────────────────────────────────────────────────
  function renderCatalog(el, s) {
    const q = s.search.trim().toLowerCase();
    const filtered = s.products.filter(p =>
      (p.name || "").toLowerCase().includes(q) ||
      (p.searchCode || "").toLowerCase().includes(q));

    el.innerHTML = `
      <div class="pos-search-bar">
        <div class="input-group">
          <span class="icon-left">${icon("search")}</span>
          <input class="input" id="posSearch" placeholder="Search by product name or code…" value="${escapeHtml(s.search)}" />
        </div>
      </div>
      <div class="pos-grid" id="posGrid"></div>
    `;
    const grid = el.querySelector("#posGrid");

    if (s.products.length === 0) {
      grid.innerHTML = emptyBlock(icon("box"), "No products in stock", "Add products from the Inventory page.");
    } else if (filtered.length === 0) {
      grid.innerHTML = emptyBlock(icon("search"), "No matching products", "Try a different name or product code.");
    } else {
      grid.innerHTML = filtered.map(p => productCard(p, s)).join("");
    }

    el.querySelector("#posSearch").addEventListener("input", debounce((e) => {
      s.search = e.target.value;
      renderCatalog(el, s);
    }, 150));

    grid.querySelectorAll("[data-add]").forEach(cardEl => {
      cardEl.addEventListener("click", () => {
        const p = s.products.find(x => x.id === cardEl.dataset.add);
        addToCart(s, p);
        renderCatalog(el, s);
        renderCart(cartEl, s);
        updateMobileCount(container, s);
      });
    });
  }

  function productCard(p, s) {
    const cartItem = s.cart.find(c => c.id === p.id);
    const cartQty = cartItem ? cartItem.cartQty : 0;
    const isLow = (p.quantity || 0) < 5;
    const profit = (p.retailPrice || 0) - (p.purchasePrice || 0);
    const details = [p.volume, p.weight, p.flavor, p.size].filter(Boolean).join(" · ");
    return `
      <div class="pos-card ${cartQty > 0 ? "in-cart" : ""}" data-add="${p.id}">
        ${cartQty > 0 ? `<span class="pos-card-qty">${cartQty}</span>` : ""}
        <div class="pos-card-name">${escapeHtml(p.name)}</div>
        ${p.searchCode ? `<div class="pos-card-code">${escapeHtml(p.searchCode)}</div>` : ""}
        ${details ? `<div class="pos-card-details">${escapeHtml(details)}</div>` : ""}
        <div class="pos-card-spacer"></div>
        <div class="flex-between">
          <div>
            <div class="pos-card-price">${fmtMoney(p.retailPrice)}</div>
            <div class="pos-card-cost">${fmtMoney(p.purchasePrice)} cost</div>
          </div>
          <span class="badge ${isLow ? "badge-amber" : "badge-green"}">${p.quantity}</span>
        </div>
        <div class="pos-card-profit ${profit >= 0 ? "text-success" : "text-danger"}">
          ${profit >= 0 ? "▲" : "▼"} ${fmtMoney(profit)}
        </div>
      </div>`;
  }

  function addToCart(s, p) {
    if (!p) return;
    if ((p.quantity || 0) <= 0) { toast("Item out of stock!", "error"); return; }
    const existing = s.cart.find(c => c.id === p.id);
    if (existing) {
      if (existing.cartQty < p.quantity) existing.cartQty++;
      else toast("Not enough stock!", "error");
    } else {
      s.cart.push({
        id: p.id, itemId: p.itemId || null, name: p.name, searchCode: p.searchCode || null,
        retailPrice: Number(p.retailPrice) || 0, purchasePrice: Number(p.purchasePrice) || 0,
        availableQty: p.quantity, cartQty: 1,
      });
    }
  }

  // ── Cart ─────────────────────────────────────────────────────────────
  function cartTotal(s) { return s.cart.reduce((sum, e) => sum + e.cartQty * e.retailPrice, 0); }
  function change(s) { const c = cartTotal(s); return s.paidAmount > c ? s.paidAmount - c : 0; }

  function renderCart(el, s) {
    const total = cartTotal(s);
    el.innerHTML = `
      <div class="pos-cart-header">
        <div class="pill-tabs">
          <div class="pill-tab ${s.mode === "Normal" ? "active" : ""}" data-mode="Normal">Normal</div>
          <div class="pill-tab ${s.mode === "Credit" ? "active" : ""}" data-mode="Credit">Credit</div>
        </div>
        ${s.cart.length ? `<span class="badge badge-red">${s.cart.length}</span>` : ""}
        <button class="btn btn-ghost btn-icon" id="posClearCart" title="Clear cart">${icon("trash")}</button>
      </div>
      <div class="pos-cart-list" id="posCartList"></div>
      ${s.cart.length ? cartFooter(s, total) : ""}
    `;

    el.querySelectorAll("[data-mode]").forEach(t => t.addEventListener("click", () => {
      s.mode = t.dataset.mode; renderCart(el, s);
    }));
    el.querySelector("#posClearCart").addEventListener("click", () => {
      s.cart = []; s.paidAmount = 0; s.customerName = ""; s.customerPhone = ""; s.dueDate = "";
      renderCart(el, s); renderCatalog(catalogEl, s); updateMobileCount(container, s);
    });

    const list = el.querySelector("#posCartList");
    if (s.cart.length === 0) {
      list.innerHTML = emptyBlock(icon("cart"), "Cart is empty", "Tap a product to add it.");
    } else {
      list.innerHTML = s.cart.map(item => cartRow(item)).join("");
      wireCartRows(list, el, s);
    }

    if (s.cart.length) wireFooter(el, s);
  }

  function cartRow(item) {
    return `
      <div class="pos-cart-item" data-id="${item.id}">
        <div class="flex-between">
          <div style="min-width:0">
            <div class="fw-700" style="font-size:13px">${escapeHtml(item.name)}</div>
            ${item.searchCode ? `<div class="text-muted" style="font-size:11px">${escapeHtml(item.searchCode)}</div>` : ""}
          </div>
          <button class="btn btn-ghost btn-icon" data-remove style="color:var(--danger)">${icon("x")}</button>
        </div>
        <div class="flex-between mt-8">
          <div class="qty-stepper">
            <button class="qty-btn" data-dec>${icon("minus")}</button>
            <button class="qty-val" data-edit-qty>${item.cartQty}</button>
            <button class="qty-btn" data-inc>${icon("plus")}</button>
          </div>
          <div class="flex" style="align-items:center;gap:6px;cursor:pointer" data-edit-price title="Tap to change price">
            <span class="fw-700">${fmtMoney(item.cartQty * item.retailPrice)}</span>
            ${icon("edit")}
          </div>
        </div>
      </div>`;
  }

  function wireCartRows(list, cartElRoot, s) {
    list.querySelectorAll(".pos-cart-item").forEach(rowEl => {
      const id = rowEl.dataset.id;
      const item = s.cart.find(c => c.id === id);
      rowEl.querySelector("[data-remove]").addEventListener("click", () => {
        s.cart = s.cart.filter(c => c.id !== id);
        renderCart(cartElRoot, s); renderCatalog(catalogEl, s); updateMobileCount(container, s);
      });
      rowEl.querySelector("[data-inc]").addEventListener("click", () => {
        if (item.cartQty < item.availableQty) item.cartQty++; else toast("Not enough stock!", "error");
        renderCart(cartElRoot, s); renderCatalog(catalogEl, s); updateMobileCount(container, s);
      });
      rowEl.querySelector("[data-dec]").addEventListener("click", () => {
        if (item.cartQty > 1) item.cartQty--;
        else { s.cart = s.cart.filter(c => c.id !== id); }
        renderCart(cartElRoot, s); renderCatalog(catalogEl, s); updateMobileCount(container, s);
      });
      rowEl.querySelector("[data-edit-qty]").addEventListener("click", () => openQtyModal(item, s, cartElRoot));
      rowEl.querySelector("[data-edit-price]").addEventListener("click", () => openPriceModal(item, s, cartElRoot));
    });
  }

  function openQtyModal(item, s, cartElRoot) {
    const { close } = openModal({
      title: "Set quantity",
      bodyHTML: `
        <div class="field">
          <label>Quantity (of ${item.availableQty})</label>
          <input class="input" type="number" id="qtyInput" value="${item.cartQty}" min="1" max="${item.availableQty}" autofocus />
        </div>`,
      footHTML: `<button class="btn btn-outline" data-cancel>Cancel</button><button class="btn btn-primary" id="qtySave">Update</button>`,
      onMount: (el) => {
        el.querySelector("[data-cancel]").addEventListener("click", close);
        el.querySelector("#qtySave").addEventListener("click", () => {
          const v = parseInt(el.querySelector("#qtyInput").value, 10);
          if (!v || v <= 0) { close(); return; }
          if (v > item.availableQty) { toast(`Max available: ${item.availableQty}`, "error"); return; }
          item.cartQty = v;
          close(); renderCart(cartElRoot, s);
        });
      },
    });
  }

  // Price override — permanently updates inventory too, matching the
  // mobile app's behaviour. No floor: a loss-making price is allowed.
  function openPriceModal(item, s, cartElRoot) {
    const { close } = openModal({
      title: `Change price — ${item.name}`,
      bodyHTML: `
        <div class="field">
          <label>New price for this sale</label>
          <input class="input" type="number" step="0.01" id="priceInput" value="${item.retailPrice}" autofocus />
          <p class="hint">This also updates the item's price in Inventory going forward.</p>
        </div>`,
      footHTML: `<button class="btn btn-outline" data-cancel>Cancel</button><button class="btn btn-primary" id="priceSave">Apply</button>`,
      onMount: (el) => {
        el.querySelector("[data-cancel]").addEventListener("click", close);
        el.querySelector("#priceSave").addEventListener("click", async () => {
          const v = parseFloat(el.querySelector("#priceInput").value);
          if (isNaN(v) || v < 0) { toast("Enter a valid price", "error"); return; }
          item.retailPrice = v;
          close(); renderCart(cartElRoot, s);
          try {
            await updateDoc(doc(businessService.inventoryCol(), item.id), {
              retailPrice: v, updatedAt: serverTimestamp(),
            });
          } catch (e) {
            toast("Price applied to this sale, but failed to save to inventory: " + e.message, "error");
          }
        });
      },
    });
  }

  function cartFooter(s, total) {
    if (s.mode === "Credit") {
      return `
        <div class="pos-cart-footer">
          <div class="field mb-8"><input class="input" id="custName" placeholder="Customer name *" value="${escapeHtml(s.customerName)}" /></div>
          <div class="field mb-8"><input class="input" id="custPhone" placeholder="Phone (optional)" value="${escapeHtml(s.customerPhone)}" /></div>
          <div class="field mb-12"><input class="input" type="date" id="custDue" value="${s.dueDate}" /></div>
          <div class="flex-between mb-12"><span class="fw-600">Total</span><span class="fw-700" style="font-size:18px">${fmtMoney(total)}</span></div>
          <button class="btn btn-primary btn-block btn-lg" id="posCheckout" ${s.processing ? "disabled" : ""}>
            ${s.processing ? "Processing…" : "Record credit sale"}
          </button>
        </div>`;
    }
    return `
      <div class="pos-cart-footer">
        <div class="flex-between mb-8"><span class="text-muted">Total</span><span class="fw-700" style="font-size:20px">${fmtMoney(total)}</span></div>
        <div class="field mb-8">
          <input class="input" type="number" step="0.01" id="paidInput" placeholder="Amount paid" value="${s.paidAmount || ""}" />
        </div>
        <div class="flex-gap-8 mb-12" style="flex-wrap:wrap">
          ${[5,10,20,50,100].map(a => `<button class="btn btn-outline btn-sm" data-quick="${a}">+K${a}</button>`).join("")}
          <button class="btn btn-ghost btn-sm" id="posClearPaid">Clear</button>
        </div>
        ${s.paidAmount > total ? `<div class="alert alert-info mb-12">Change due: ${fmtMoney(change(s))}</div>` : ""}
        <button class="btn btn-success btn-block btn-lg" id="posCheckout" ${s.processing ? "disabled" : ""}>
          ${s.processing ? "Processing…" : "Checkout"}
        </button>
      </div>`;
  }

  function wireFooter(el, s) {
    const paidInput = el.querySelector("#paidInput");
    if (paidInput) paidInput.addEventListener("input", (e) => { s.paidAmount = parseFloat(e.target.value) || 0; renderCart(el, s); });
    el.querySelectorAll("[data-quick]").forEach(b => b.addEventListener("click", () => {
      s.paidAmount = (s.paidAmount || 0) + Number(b.dataset.quick); renderCart(el, s);
    }));
    const clearPaid = el.querySelector("#posClearPaid");
    if (clearPaid) clearPaid.addEventListener("click", () => { s.paidAmount = 0; renderCart(el, s); });

    const custName = el.querySelector("#custName");
    if (custName) custName.addEventListener("input", (e) => s.customerName = e.target.value);
    const custPhone = el.querySelector("#custPhone");
    if (custPhone) custPhone.addEventListener("input", (e) => s.customerPhone = e.target.value);
    const custDue = el.querySelector("#custDue");
    if (custDue) custDue.addEventListener("input", (e) => s.dueDate = e.target.value);

    el.querySelector("#posCheckout").addEventListener("click", () => {
      if (s.mode === "Credit") processCreditSale(s, el); else processCheckout(s, el);
    });
  }

  async function processCheckout(s, cartElRoot) {
    if (!s.cart.length || s.processing) return;
    const total = cartTotal(s);
    if (s.paidAmount < total) { toast("Insufficient payment!", "error"); return; }
    s.processing = true; renderCart(cartElRoot, s);
    try {
      const batch = writeBatch(db);
      let totalProfit = 0;
      for (const e of s.cart) {
        batch.update(doc(businessService.inventoryCol(), e.id), { quantity: Math.max(0, e.availableQty - e.cartQty) });
        totalProfit += e.cartQty * (e.retailPrice - e.purchasePrice);
      }
      await batch.commit();
      await addDoc(businessService.historyCol(), {
        type: "sale", businessId: businessService.currentBusinessId,
        items: s.cart.map(e => ({
          itemId: e.itemId, name: e.name, searchCode: e.searchCode,
          retailPrice: e.retailPrice, purchasePrice: e.purchasePrice,
          quantity: e.cartQty, originalReturnedQty: 0, returnedItems: [],
        })),
        total, totalProfit, paidAmount: s.paidAmount, change: change(s),
        paymentMethod: "Cash", createdAt: serverTimestamp(),
        hasReturns: false, returnedTotal: 0, returnedProfit: 0, status: "completed",
      });
      toast(`Sale complete! ${fmtMoney(total)}`, "success");
      s.cart = []; s.paidAmount = 0;
    } catch (e) {
      toast("Error: " + e.message, "error");
    } finally {
      s.processing = false;
      renderCart(cartElRoot, s); renderCatalog(catalogEl, s); updateMobileCount(container, s);
    }
  }

  async function processCreditSale(s, cartElRoot) {
    if (!s.cart.length || s.processing) return;
    if (!s.customerName.trim()) { toast("Customer name is required", "error"); return; }
    s.processing = true; renderCart(cartElRoot, s);
    try {
      const batch = writeBatch(db);
      let total = 0;
      for (const e of s.cart) {
        batch.update(doc(businessService.inventoryCol(), e.id), { quantity: Math.max(0, e.availableQty - e.cartQty) });
        total += e.cartQty * e.retailPrice;
      }
      await batch.commit();

      let customerId;
      let cq;
      if (s.customerPhone.trim()) {
        cq = await getDocs(query(businessService.customersCol(), where("name", "==", s.customerName.trim()), where("phone", "==", s.customerPhone.trim())));
      } else {
        cq = await getDocs(query(businessService.customersCol(), where("name", "==", s.customerName.trim())));
      }
      if (!cq.empty) {
        customerId = cq.docs[0].id;
        await updateDoc(doc(businessService.customersCol(), customerId), {
          currentCredit: (cq.docs[0].data().currentCredit || 0) + total,
          updatedAt: serverTimestamp(),
        });
      } else {
        const nd = { name: s.customerName.trim(), currentCredit: total, creditLimit: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
        if (s.customerPhone.trim()) nd.phone = s.customerPhone.trim();
        const ref = await addDoc(businessService.customersCol(), nd);
        customerId = ref.id;
      }

      const data = {
        type: "credit_sale", businessId: businessService.currentBusinessId,
        customerId, customerName: s.customerName.trim(),
        items: s.cart.map(e => ({
          itemId: e.itemId, name: e.name, searchCode: e.searchCode,
          retailPrice: e.retailPrice, purchasePrice: e.purchasePrice,
          quantity: e.cartQty, originalReturnedQty: 0, returnedItems: [],
        })),
        total, createdAt: serverTimestamp(), status: "pending",
        hasReturns: false, returnedTotal: 0, isCreditSale: true, paidAmount: 0,
      };
      if (s.customerPhone.trim()) data.customerPhone = s.customerPhone.trim();
      if (s.dueDate) data.dueDate = new Date(s.dueDate);
      await addDoc(businessService.historyCol(), data);

      toast(`Credit sale recorded! Total: ${fmtMoney(total)}`, "success");
      s.cart = []; s.customerName = ""; s.customerPhone = ""; s.dueDate = "";
    } catch (e) {
      toast("Error: " + e.message, "error");
    } finally {
      s.processing = false;
      renderCart(cartElRoot, s); renderCatalog(catalogEl, s); updateMobileCount(container, s);
    }
  }

  function wireMobileFab(root, s, cartElRoot) {
    const fab = root.querySelector("#mobileCartFab");
    fab.addEventListener("click", () => {
      s.cartOpenMobile = !s.cartOpenMobile;
      root.querySelector(".pos-cart").classList.toggle("mobile-open", s.cartOpenMobile);
    });
    updateMobileCount(root, s);
  }
  function updateMobileCount(root, s) {
    const el = root.querySelector("#mobileCartCount");
    if (el) el.textContent = String(s.cart.reduce((n, i) => n + i.cartQty, 0));
    const fab = root.querySelector("#mobileCartFab");
    if (fab) fab.style.display = window.innerWidth <= 760 ? "flex" : "none";
  }
}

function emptyBlock(iconSvg, title, sub) {
  return `<div class="empty-state" style="grid-column:1/-1">
    <div class="icon-wrap">${iconSvg}</div><h4>${title}</h4><p>${sub}</p>
  </div>`;
}

function noBusinessState() {
  return `<div class="empty-state">
    <div class="icon-wrap">${icon("store")}</div>
    <h4>No business selected</h4>
    <p>Create or select a business to start selling.</p>
  </div>`;
}

function injectPosStyles() {
  if (document.getElementById("pos-inline-style")) return;
  const style = document.createElement("style");
  style.id = "pos-inline-style";
  style.textContent = `
    .pos-wrap { display:flex; gap:20px; align-items:flex-start; }
    .pos-catalog { flex:1; min-width:0; }
    .pos-cart {
      width: 360px; flex-shrink:0; background:var(--bg-surface); border:1px solid var(--border);
      border-radius: var(--r-lg); box-shadow: var(--shadow-xs); display:flex; flex-direction:column;
      position: sticky; top: calc(var(--topbar-h) + 12px); max-height: calc(100vh - var(--topbar-h) - 40px);
    }
    .pos-search-bar { margin-bottom: 16px; max-width: 480px; }
    .pos-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
    .pos-card {
      position:relative; background:var(--bg-surface); border:1px solid var(--border); border-radius: var(--r-md);
      padding: 12px; cursor:pointer; transition: all 140ms ease; display:flex; flex-direction:column; min-height:132px;
    }
    .pos-card:hover { box-shadow: var(--shadow-sm); border-color: var(--border-strong); }
    .pos-card.in-cart { background: var(--accent-soft); border-color: var(--accent); }
    .pos-card-qty {
      position:absolute; top:8px; right:8px; background:var(--accent); color:#fff; font-size:10px; font-weight:800;
      min-width:20px; height:20px; border-radius:10px; display:flex; align-items:center; justify-content:center; padding:0 5px;
    }
    .pos-card-name { font-size:12.5px; font-weight:700; color:var(--text-main); line-height:1.3; }
    .pos-card-code { font-size:10px; color:var(--accent); font-weight:700; margin-top:2px; }
    .pos-card-details { font-size:10.5px; color:var(--text-muted); margin-top:2px; }
    .pos-card-spacer { flex:1; }
    .pos-card-price { font-size:14px; font-weight:800; color:var(--success); }
    .pos-card-cost { font-size:10px; color:var(--text-muted); }
    .pos-card-profit { font-size:10.5px; font-weight:600; margin-top:6px; }

    .pos-cart-header { display:flex; align-items:center; gap:8px; padding:14px 16px; border-bottom:1px solid var(--border); }
    .pos-cart-list { flex:1; overflow-y:auto; padding: 12px; min-height: 120px; }
    .pos-cart-item { background:var(--bg-surface-alt); border-radius: var(--r-md); padding:11px; margin-bottom:8px; }
    .qty-stepper { display:flex; align-items:center; gap:6px; }
    .qty-btn { width:26px; height:26px; border-radius:7px; border:1px solid var(--border); background:var(--bg-surface); display:flex; align-items:center; justify-content:center; color:var(--text-sub); }
    .qty-btn svg { width:14px; height:14px; }
    .qty-val { min-width:32px; height:26px; border-radius:7px; border:1px solid var(--border-strong); background:var(--bg-surface); font-weight:800; font-size:12.5px; }
    .pos-cart-footer { padding: 14px 16px; border-top:1px solid var(--border); }

    @media (max-width: 900px) {
      .pos-wrap { flex-direction: column; }
      .pos-cart { width:100%; position:static; max-height:none; }
    }
    @media (max-width: 760px) {
      .pos-cart {
        position: fixed; left:0; right:0; bottom:0; top: auto; z-index: 75;
        border-radius: var(--r-xl) var(--r-xl) 0 0; max-height: 78vh;
        transform: translateY(110%); transition: transform 220ms ease; box-shadow: var(--shadow-lg);
      }
      .pos-cart.mobile-open { transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
  window.addEventListener("resize", () => {
    const fab = document.getElementById("mobileCartFab");
    if (fab) fab.style.display = window.innerWidth <= 760 ? "flex" : "none";
  });
}

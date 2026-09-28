// js/pages/expenses.js — expense tracking with categories & summary stats.
import { businessService, onSnapshot, query, orderBy, addDoc, updateDoc,
         doc, serverTimestamp } from "../services/business-service.js";
import { icon, fmtMoney, fmtDate, toast, openModal, confirmDialog, escapeHtml } from "../services/ui.js";

const CATEGORIES = ["Fixed", "Rent", "Utilities", "Supplies", "Transport", "Salaries", "Others"];
const CAT_COLORS = { Fixed: "blue", Rent: "purple", Utilities: "amber", Supplies: "green", Transport: "blue", Salaries: "red", Others: "gray" };

export async function renderPage(container, ctx) {
  if (!businessService.currentBusinessId) {
    container.innerHTML = emptyState(icon("receipt"), "No business selected", "Select a business first.");
    return;
  }

  const state = { expenses: [], filter: "All" };

  ctx.setTopbarActions(`<button class="btn btn-primary" id="addExpBtn">${icon("plus")}<span class="btn-label">Add expense</span></button>`);

  container.innerHTML = `
    <div class="grid grid-3 mb-16" id="expStats"></div>
    <div class="card mb-16">
      <div class="card-pad flex-gap-8" style="flex-wrap:wrap">
        <button class="pill-tab-btn active" data-filter="All">All</button>
        ${CATEGORIES.map(c => `<button class="pill-tab-btn" data-filter="${c}">${c}</button>`).join("")}
      </div>
    </div>
    <div class="card"><div class="table-wrap" id="expTableWrap"></div></div>
  `;
  injectStyle();

  document.getElementById("addExpBtn").addEventListener("click", () => openExpenseModal());

  container.querySelectorAll("[data-filter]").forEach(b => b.addEventListener("click", () => {
    state.filter = b.dataset.filter;
    container.querySelectorAll("[data-filter]").forEach(x => x.classList.toggle("active", x === b));
    render();
  }));

  const unsub = onSnapshot(
    query(businessService.expensesCol(), orderBy("date", "desc")),
    (snap) => { state.expenses = snap.docs.map(d => ({ id: d.id, ...d.data() })); render(); },
    (err) => toast("Couldn't load expenses: " + err.message, "error")
  );
  return () => unsub();

  function render() {
    renderStats();
    renderTable();
  }

  function renderStats() {
    const active = state.expenses.filter(e => e.status !== "refunded" && e.status !== "cancelled");
    const total = active.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const thisMonth = active.filter(e => sameMonth(e.date)).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const fixed = active.filter(e => e.category === "Fixed").reduce((s, e) => s + (Number(e.amount) || 0), 0);
    document.getElementById("expStats").innerHTML = `
      <div class="stat-card"><div class="label">Total expenses</div><div class="value">${fmtMoney(total)}</div></div>
      <div class="stat-card"><div class="label">This month</div><div class="value">${fmtMoney(thisMonth)}</div></div>
      <div class="stat-card"><div class="label">Fixed / recurring</div><div class="value">${fmtMoney(fixed)}</div></div>
    `;
  }

  function renderTable() {
    const tableWrap = document.getElementById("expTableWrap");
    const rows = state.expenses.filter(e => state.filter === "All" || e.category === state.filter);

    if (state.expenses.length === 0) {
      tableWrap.innerHTML = emptyState(icon("receipt"), "No expenses recorded", "Add your first expense to start tracking.");
      return;
    }
    if (rows.length === 0) {
      tableWrap.innerHTML = emptyState(icon("search"), "No expenses in this category", "Try a different filter.");
      return;
    }

    tableWrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Title</th><th>Category</th><th>Date</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows.map(rowHtml).join("")}</tbody>
      </table>`;

    tableWrap.querySelectorAll("[data-refund]").forEach(b => b.addEventListener("click", () => refundExpense(b.dataset.refund)));
    tableWrap.querySelectorAll("[data-cancel]").forEach(b => b.addEventListener("click", () => cancelExpense(b.dataset.cancel)));
  }

  function rowHtml(e) {
    const color = CAT_COLORS[e.category] || "gray";
    const statusBadge = e.status === "refunded" ? `<span class="badge badge-gray">Refunded</span>`
      : e.status === "cancelled" ? `<span class="badge badge-red">Cancelled</span>`
      : `<span class="badge badge-green">Active</span>`;
    const canAct = e.status !== "refunded" && e.status !== "cancelled";
    return `
      <tr>
        <td data-label="Title">
          <div class="fw-700">${escapeHtml(e.title || "Untitled")}</div>
          ${e.description ? `<div class="text-muted" style="font-size:11.5px">${escapeHtml(e.description)}</div>` : ""}
        </td>
        <td data-label="Category"><span class="badge badge-${color}">${escapeHtml(e.category || "Others")}</span></td>
        <td data-label="Date">${fmtDate(e.date)}</td>
        <td data-label="Amount" class="num fw-700">${fmtMoney(e.amount)}</td>
        <td data-label="Status">${statusBadge}</td>
        <td data-label="" style="text-align:right;white-space:nowrap">
          ${canAct ? `
            <button class="btn btn-ghost btn-sm" data-refund="${e.id}">Refund</button>
            <button class="btn btn-ghost btn-sm" data-cancel="${e.id}" style="color:var(--danger)">Cancel</button>` : ""}
        </td>
      </tr>`;
  }

  async function refundExpense(id) {
    const expense = state.expenses.find((e) => e.id === id);
    const created = expense && (expense.date?.toDate ? expense.date.toDate() : new Date(expense.date));
    if (created) {
      const oneMonthAgo = new Date(); oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      if (created < oneMonthAgo) { toast("Cannot refund expenses older than 1 month", "error"); return; }
    }
    let reason = "";
    const { close } = openModal({
      title: "Refund Expense",
      bodyHTML: `
        <p class="text-muted mb-12" style="font-size:13px">Please provide a reason for this refund:</p>
        <div class="field"><label>Reason</label><input class="input" id="refundReason" placeholder="e.g. Duplicate entry" /></div>`,
      footHTML: `<button class="btn btn-outline" data-cancel>Cancel</button><button class="btn btn-primary" id="refundGo" style="background:var(--amber);border-color:var(--amber)">Refund</button>`,
      onMount: (el, closeFn) => {
        el.querySelector("[data-cancel]").addEventListener("click", closeFn);
        el.querySelector("#refundGo").addEventListener("click", async () => {
          reason = el.querySelector("#refundReason").value.trim() || "No reason provided";
          const btn = el.querySelector("#refundGo");
          btn.disabled = true; btn.textContent = "Refunding…";
          try {
            await updateDoc(doc(businessService.expensesCol(), id), {
              status: "refunded", refundedAt: serverTimestamp(), refundReason: reason, refundedBy: "owner",
            });
            await addDoc(businessService.historyCol(), {
              type: "expense_refund", expenseId: id,
              amount: expense?.amount || 0, category: expense?.category || "Others",
              reason, refundedAt: serverTimestamp(), refundedBy: "owner",
              businessId: businessService.currentBusinessId,
            });
            toast("Expense refunded successfully", "success");
            closeFn();
          } catch (e) {
            toast("Error: " + e.message, "error");
            btn.disabled = false; btn.textContent = "Refund";
          }
        });
      },
    });
  }

  async function cancelExpense(id) {
    const ok = await confirmDialog({ title: "Cancel expense?", message: "This marks the expense as cancelled." });
    if (!ok) return;
    try {
      await updateDoc(doc(businessService.expensesCol(), id), { status: "cancelled", cancelledAt: serverTimestamp() });
      toast("Expense cancelled", "success");
    } catch (e) { toast("Error: " + e.message, "error"); }
  }
}

function openExpenseModal() {
  const today = new Date().toISOString().slice(0, 10);
  const body = `
    <div class="field mb-16"><label>Title *</label><input class="input" id="fTitle" placeholder="e.g. Shop rent" /></div>
    <div class="grid grid-2 mb-16">
      <div class="field"><label>Amount *</label><input class="input" type="number" step="0.01" id="fAmount" /></div>
      <div class="field"><label>Category</label>
        <select class="input" id="fCat">${CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join("")}</select>
      </div>
    </div>
    <div class="field mb-16"><label>Date</label><input class="input" type="date" id="fDate" value="${today}" /></div>
    <div class="field"><label>Description <span class="text-faint">(optional)</span></label><textarea class="input" id="fDesc" rows="2"></textarea></div>
  `;
  const { close } = openModal({
    title: "Add expense",
    bodyHTML: body,
    footHTML: `<button class="btn btn-outline" data-cancel>Cancel</button><button class="btn btn-primary" id="saveExp">Add expense</button>`,
    onMount: (el) => {
      el.querySelector("[data-cancel]").addEventListener("click", close);
      el.querySelector("#saveExp").addEventListener("click", async () => {
        const title = el.querySelector("#fTitle").value.trim();
        const amount = parseFloat(el.querySelector("#fAmount").value);
        const category = el.querySelector("#fCat").value;
        const date = el.querySelector("#fDate").value;
        const description = el.querySelector("#fDesc").value.trim();
        if (!title) { toast("Title is required", "error"); return; }
        if (!amount || amount <= 0) { toast("Enter a valid amount", "error"); return; }
        try {
          await addDoc(businessService.expensesCol(), {
            title, amount, category, description,
            date: date ? new Date(date) : new Date(),
            status: "active", createdAt: serverTimestamp(),
          });
          toast("Expense added", "success");
          close();
        } catch (e) { toast("Error: " + e.message, "error"); }
      });
    },
  });
}

function sameMonth(d) {
  if (!d) return false;
  const date = d.toDate ? d.toDate() : new Date(d);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function emptyState(iconSvg, title, sub) {
  return `<div class="empty-state"><div class="icon-wrap">${iconSvg}</div><h4>${title}</h4><p>${sub}</p></div>`;
}

function injectStyle() {
  if (document.getElementById("exp-inline-style")) return;
  const style = document.createElement("style");
  style.id = "exp-inline-style";
  style.textContent = `
    .pill-tab-btn { padding:7px 14px; border-radius:999px; border:1px solid var(--border); background:var(--bg-surface); font-size:12.5px; font-weight:600; color:var(--text-muted); }
    .pill-tab-btn.active { background:var(--accent); border-color:var(--accent); color:#fff; }
  `;
  document.head.appendChild(style);
}

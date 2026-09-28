// js/pages/revenue.js — mirrors lib/pages/desktop/revenue.dart: today/month
// stats with growth badges, credit summary, returns/losses/restocked,
// 4-week bar chart, recent transactions, and the Day/Week/Month/Historical
// explorer (calendar-week buckets 1–7/8–14/15–21/22–28/29–end, live for the
// current month, cached one-off fetch for past months).
import { businessService, getDocs, query, where, orderBy, limit } from "../services/business-service.js";
import { icon, fmtMoney, fmtDate, toast } from "../services/ui.js";

const WEEK_LABELS = { 1: "Week 1 (1–7)", 2: "Week 2 (8–14)", 3: "Week 3 (15–21)", 4: "Week 4 (22–28)", 5: "Week 5 (29–end)" };
function weekOfMonth(day) { return Math.floor((day - 1) / 7) + 1; }
function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function isSameMonth(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth(); }
function toDate(ts) { return ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null); }
function n(v) { return Number(v) || 0; }

export async function renderPage(container) {
  if (!businessService.currentBusinessId) {
    container.innerHTML = emptyState(icon("trendUp"), "No business selected", "Select a business first.");
    return;
  }

  const now = new Date();
  const state = {
    loading: true,
    today: { sales: 0, profit: 0, expenses: 0, returns: 0, losses: 0, restocked: 0, txns: 0 },
    month: { sales: 0, profit: 0, expenses: 0, creditSales: 0, creditPayments: 0, creditProfit: 0, txns: 0 },
    yesterday: { sales: 0, profit: 0 },
    lastMonth: { sales: 0, profit: 0 },
    credit: { outstanding: 0, customers: 0 },
    stock: { value: 0, items: 0 },
    weekBars: [],
    recent: [],
    // Day/Week/Month/Historical explorer
    historyViewMonth: new Date(now.getFullYear(), now.getMonth(), 1),
    historyCache: new Map(), // monthKey -> Map<day, {sales,profit,expenses}>
    currentMonthDaily: { sales: new Map(), profit: new Map(), expenses: new Map() },
    expandedWeeks: new Set([weekOfMonth(now.getDate())]),
    loadingHistoryMonth: false,
  };

  container.innerHTML = `<div style="padding:60px 0;text-align:center;color:var(--text-sub)">Loading…</div>`;
  await loadAll();
  render();

  async function loadAll() {
    state.loading = true;
    try {
      await Promise.all([
        loadStock(), loadMonth(), loadToday(), loadCredit(),
        loadComparisons(), loadWeekBars(), loadRecent(),
      ]);
    } catch (e) {
      toast("Error loading revenue data: " + e.message, "error");
    } finally {
      state.loading = false;
    }
  }

  async function loadStock() {
    const snap = await getDocs(businessService.inventoryCol());
    let v = 0, items = 0;
    snap.docs.forEach((d) => { const p = d.data(); const q = n(p.quantity); v += q * n(p.retailPrice); items += q; });
    state.stock = { value: v, items };
  }

  function categorize(docs) {
    // Same per-type categorization used everywhere on this page.
    let sales = 0, profit = 0, cS = 0, cP = 0, cPr = 0, txns = 0;
    const dailySales = new Map(), dailyProfit = new Map();
    docs.forEach((doc) => {
      const d = doc.data();
      const created = toDate(d.createdAt);
      const day = created ? created.getDate() : null;
      if (d.type === "credit_sale") {
        if (d.status !== "cancelled") cS += n(d.total);
      } else if (d.type === "credit_payment") {
        const pa = n(d.amount); cP += pa; sales += pa;
        if (day) dailySales.set(day, (dailySales.get(day) || 0) + pa);
        if (d.realizedProfit != null) {
          const rp = n(d.realizedProfit); profit += rp; cPr += rp;
          if (day) dailyProfit.set(day, (dailyProfit.get(day) || 0) + rp);
        }
      } else if (d.type === "return") {
        const rp = n(d.totalProfit); profit += rp;
        if (day) dailyProfit.set(day, (dailyProfit.get(day) || 0) + rp);
      } else if (d.type !== "credit_payment" && d.status !== "cancelled") {
        const net = n(d.total) - n(d.returnedTotal);
        sales += net; txns++;
        if (day) dailySales.set(day, (dailySales.get(day) || 0) + net);
        if (d.totalProfit != null) {
          const p = n(d.totalProfit) - n(d.returnedProfit);
          profit += p;
          if (day) dailyProfit.set(day, (dailyProfit.get(day) || 0) + p);
        }
      }
    });
    return { sales, profit, cS, cP, cPr, txns, dailySales, dailyProfit };
  }

  async function loadMonth() {
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    const e = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const [hSnap, xSnap] = await Promise.all([
      getDocs(query(businessService.historyCol(), where("createdAt", ">=", s), where("createdAt", "<", e))),
      getDocs(query(businessService.expensesCol(), where("date", ">=", s), where("date", "<", e))),
    ]);
    const c = categorize(hSnap.docs);
    let exp = 0; const dailyExp = new Map();
    xSnap.docs.forEach((doc) => {
      const d = doc.data();
      if (d.status === "refunded" || d.status === "cancelled") return;
      const amt = n(d.amount); exp += amt;
      const dt = toDate(d.date);
      if (dt) { const day = dt.getDate(); dailyExp.set(day, (dailyExp.get(day) || 0) + amt); }
    });
    state.month = { sales: c.sales, profit: c.profit - exp, expenses: exp, creditSales: c.cS, creditPayments: c.cP, creditProfit: c.cPr, txns: c.txns };
    state.currentMonthDaily = { sales: c.dailySales, profit: c.dailyProfit, expenses: dailyExp };
  }

  async function loadToday() {
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const e = new Date(s.getTime() + 86400000);
    const [hSnap, xSnap] = await Promise.all([
      getDocs(query(businessService.historyCol(), where("createdAt", ">=", s), where("createdAt", "<", e))),
      getDocs(query(businessService.expensesCol(), where("date", ">=", s), where("date", "<", e))),
    ]);
    let sales = 0, profit = 0, returns = 0, losses = 0, restocked = 0, txns = 0;
    hSnap.docs.forEach((doc) => {
      const d = doc.data();
      if (d.type === "credit_sale") { /* not counted in today's sales */ }
      else if (d.type === "credit_payment") { sales += n(d.amount); if (d.realizedProfit != null) profit += n(d.realizedProfit); }
      else if (d.type === "return") {
        returns += n(d.total);
        if ((d.reason || "") === "Damaged") losses += n(d.total); else restocked += n(d.total);
        profit += n(d.totalProfit);
      } else if (d.type !== "credit_payment" && d.status !== "cancelled") {
        sales += n(d.total) - n(d.returnedTotal); txns++;
        if (d.totalProfit != null) profit += n(d.totalProfit) - n(d.returnedProfit);
      }
    });
    let exp = 0;
    xSnap.docs.forEach((doc) => { const d = doc.data(); if (d.status !== "refunded" && d.status !== "cancelled") exp += n(d.amount); });
    state.today = { sales, profit: profit - exp, expenses: exp, returns, losses, restocked, txns };
  }

  async function loadComparisons() {
    const startLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const startThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startYesterday = new Date(startToday.getTime() - 86400000);
    try {
      const [lm, ye, lmX, yeX] = await Promise.all([
        getDocs(query(businessService.historyCol(), where("createdAt", ">=", startLastMonth), where("createdAt", "<", startThisMonth))),
        getDocs(query(businessService.historyCol(), where("createdAt", ">=", startYesterday), where("createdAt", "<", startToday))),
        getDocs(query(businessService.expensesCol(), where("date", ">=", startLastMonth), where("date", "<", startThisMonth))),
        getDocs(query(businessService.expensesCol(), where("date", ">=", startYesterday), where("date", "<", startToday))),
      ]);
      const lmTot = sumClosed(lm.docs), yeTot = sumClosed(ye.docs);
      const lmExp = sumExp(lmX.docs), yeExp = sumExp(yeX.docs);
      state.lastMonth = { sales: lmTot.sales, profit: lmTot.profit - lmExp };
      state.yesterday = { sales: yeTot.sales, profit: yeTot.profit - yeExp };
    } catch (_) { /* nice-to-have, don't block the page */ }
  }
  function sumClosed(docs) {
    let sales = 0, profit = 0;
    docs.forEach((doc) => {
      const d = doc.data();
      if (d.type === "credit_sale" || d.type === "return") return;
      if (d.type === "credit_payment") { sales += n(d.amount); if (d.realizedProfit != null) profit += n(d.realizedProfit); return; }
      if (d.status === "cancelled") return;
      sales += n(d.total) - n(d.returnedTotal);
      if (d.totalProfit != null) profit += n(d.totalProfit) - n(d.returnedProfit || 0);
    });
    return { sales, profit };
  }
  function sumExp(docs) {
    let exp = 0;
    docs.forEach((doc) => { const d = doc.data(); if (d.status !== "refunded" && d.status !== "cancelled") exp += n(d.amount); });
    return exp;
  }

  async function loadCredit() {
    const snap = await getDocs(query(businessService.customersCol(), where("currentCredit", ">", 0.01)));
    let total = 0; snap.docs.forEach((d) => total += n(d.data().currentCredit));
    state.credit = { outstanding: total, customers: snap.docs.length };
  }

  async function loadWeekBars() {
    const bars = [];
    for (let w = 3; w >= 0; w--) {
      const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 7 - (w * 7));
      const weekStart = new Date(weekEnd.getTime() - 6 * 86400000);
      const nextDay = new Date(weekEnd.getTime() + 86400000);
      const [snap, expSnap] = await Promise.all([
        getDocs(query(businessService.historyCol(), where("createdAt", ">=", weekStart), where("createdAt", "<", nextDay))),
        getDocs(query(businessService.expensesCol(), where("date", ">=", weekStart), where("date", "<", nextDay))),
      ]);
      let salesIn = 0;
      snap.docs.forEach((doc) => { const d = doc.data(); if (d.type !== "return" && d.status !== "cancelled") salesIn += n(d.total ?? d.amount); });
      let expOut = 0;
      expSnap.docs.forEach((doc) => { const d = doc.data(); if (d.status !== "refunded" && d.status !== "cancelled") expOut += n(d.amount); });
      const label = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + "–" + weekEnd.getDate();
      bars.push({ label, salesIn, expOut });
    }
    state.weekBars = bars;
  }

  async function loadRecent() {
    const snap = await getDocs(query(businessService.historyCol(), orderBy("createdAt", "desc"), limit(6)));
    state.recent = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  // ── Day/Week/Month/Historical explorer ──────────────────────────────────
  function dayStatsForViewMonth() {
    const month = state.historyViewMonth;
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const isCurrent = isSameMonth(month, now);
    const out = [];
    if (isCurrent) {
      const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(month.getFullYear(), month.getMonth(), day);
        out.push({
          date, sales: state.currentMonthDaily.sales.get(day) || 0,
          profit: state.currentMonthDaily.profit.get(day) || 0,
          expenses: state.currentMonthDaily.expenses.get(day) || 0,
          hasOccurred: date <= todayMid,
        });
      }
    } else {
      const cached = state.historyCache.get(monthKey(month));
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(month.getFullYear(), month.getMonth(), day);
        const c = cached?.get(day);
        out.push(c ? { date, ...c, hasOccurred: true } : { date, sales: 0, profit: 0, expenses: 0, hasOccurred: !!cached });
      }
    }
    return out;
  }
  function groupByWeek(days) {
    const weeks = new Map();
    days.forEach((d) => { const w = weekOfMonth(d.date.getDate()); if (!weeks.has(w)) weeks.set(w, []); weeks.get(w).push(d); });
    return weeks;
  }
  async function selectHistoryMonth(month) {
    state.historyViewMonth = month;
    state.expandedWeeks = new Set([isSameMonth(month, now) ? weekOfMonth(now.getDate()) : 1]);
    if (!isSameMonth(month, now)) await loadHistoricalMonth(month);
    render();
  }
  async function loadHistoricalMonth(month) {
    const key = monthKey(month);
    if (state.historyCache.has(key)) return;
    state.loadingHistoryMonth = true; render();
    try {
      const start = new Date(month.getFullYear(), month.getMonth(), 1);
      const end = new Date(month.getFullYear(), month.getMonth() + 1, 1);
      const [hSnap, xSnap] = await Promise.all([
        getDocs(query(businessService.historyCol(), where("createdAt", ">=", start), where("createdAt", "<", end))),
        getDocs(query(businessService.expensesCol(), where("date", ">=", start), where("date", "<", end))),
      ]);
      const sales = new Map(), profit = new Map(), expenses = new Map();
      hSnap.docs.forEach((doc) => {
        const d = doc.data();
        const created = toDate(d.createdAt); if (!created) return;
        const day = created.getDate();
        if (d.type === "credit_sale") return;
        if (d.type === "credit_payment") {
          sales.set(day, (sales.get(day) || 0) + n(d.amount));
          if (d.realizedProfit != null) profit.set(day, (profit.get(day) || 0) + n(d.realizedProfit));
        } else if (d.type === "return") {
          profit.set(day, (profit.get(day) || 0) + n(d.totalProfit));
        } else if (d.status !== "cancelled") {
          sales.set(day, (sales.get(day) || 0) + (n(d.total) - n(d.returnedTotal)));
          if (d.totalProfit != null) profit.set(day, (profit.get(day) || 0) + (n(d.totalProfit) - n(d.returnedProfit)));
        }
      });
      xSnap.docs.forEach((doc) => {
        const d = doc.data();
        if (d.status === "refunded" || d.status === "cancelled") return;
        const dt = toDate(d.date); if (!dt) return;
        const day = dt.getDate();
        expenses.set(day, (expenses.get(day) || 0) + n(d.amount));
      });
      const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
      const dayMap = new Map();
      for (let day = 1; day <= daysInMonth; day++) {
        dayMap.set(day, { sales: sales.get(day) || 0, profit: profit.get(day) || 0, expenses: expenses.get(day) || 0 });
      }
      state.historyCache.set(key, dayMap);
    } catch (e) {
      toast("Couldn't load that month: " + e.message, "error");
    } finally {
      state.loadingHistoryMonth = false; render();
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  function render() {
    container.innerHTML = `
      ${statsRow()}
      <div class="grid grid-2" style="gap:20px;margin-top:20px">
        <div>${weekChartCard()}${explorerCard()}</div>
        <div>${creditCard()}${todayExtraCard()}${recentCard()}</div>
      </div>
    `;
    wire();
  }

  function growthBadge(current, previous) {
    if (previous === 0 && current === 0) return "";
    if (previous === 0) return `<span class="badge badge-blue">New</span>`;
    const pct = ((current - previous) / Math.abs(previous)) * 100;
    const up = pct >= 0;
    return `<span class="badge ${up ? "badge-green" : "badge-red"}">${up ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)}%</span>`;
  }

  function statCard(label, value, sub, badgeHTML, accent) {
    return `
      <div class="card card-pad">
        <div class="flex-between mb-8"><span class="text-muted" style="font-size:12px;font-weight:600">${label}</span>${badgeHTML || ""}</div>
        <div class="fw-700" style="font-size:22px;color:${accent || "var(--text)"}">${fmtMoney(value)}</div>
        ${sub ? `<div class="text-muted" style="font-size:11.5px;margin-top:4px">${sub}</div>` : ""}
      </div>`;
  }

  function statsRow() {
    const t = state.today, m = state.month;
    return `
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px">
        ${statCard("Today's Sales", t.sales, `${t.txns} transaction${t.txns === 1 ? "" : "s"}`, growthBadge(t.sales, state.yesterday.sales))}
        ${statCard("Today's Profit", t.profit, "", growthBadge(t.profit, state.yesterday.profit), t.profit >= 0 ? "var(--green)" : "var(--red)")}
        ${statCard("This Month's Sales", m.sales, `${m.txns} transactions`, growthBadge(m.sales, state.lastMonth.sales))}
        ${statCard("This Month's Net Profit", m.profit, `Expenses: ${fmtMoney(m.expenses)}`, growthBadge(m.profit, state.lastMonth.profit), m.profit >= 0 ? "var(--green)" : "var(--red)")}
        ${statCard("Stock Value", state.stock.value, `${state.stock.items} items in stock`)}
      </div>`;
  }

  function weekChartCard() {
    const max = Math.max(1, ...state.weekBars.map((b) => Math.max(b.salesIn, b.expOut)));
    return `
      <div class="card card-pad mb-16">
        <h3 style="font-size:14.5px;font-weight:700;margin-bottom:14px">Last 4 Weeks</h3>
        <div style="display:flex;align-items:flex-end;gap:14px;height:140px">
          ${state.weekBars.map((b) => `
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end">
              <div style="display:flex;align-items:flex-end;gap:3px;height:100%">
                <div title="Sales: ${fmtMoney(b.salesIn)}" style="width:14px;border-radius:4px 4px 0 0;background:var(--blue);height:${Math.max(3, (b.salesIn / max) * 100)}%"></div>
                <div title="Expenses: ${fmtMoney(b.expOut)}" style="width:14px;border-radius:4px 4px 0 0;background:var(--red);opacity:.55;height:${Math.max(3, (b.expOut / max) * 100)}%"></div>
              </div>
              <span class="text-muted" style="font-size:10px;white-space:nowrap">${b.label}</span>
            </div>`).join("")}
        </div>
        <div class="flex-gap-8 mt-16" style="font-size:11.5px;color:var(--text-sub)">
          <span><span style="display:inline-block;width:9px;height:9px;background:var(--blue);border-radius:2px;margin-right:5px"></span>Sales</span>
          <span><span style="display:inline-block;width:9px;height:9px;background:var(--red);opacity:.55;border-radius:2px;margin-right:5px"></span>Expenses</span>
        </div>
      </div>`;
  }

  function explorerCard() {
    const month = state.historyViewMonth;
    const isCurrent = isSameMonth(month, now);
    const monthLabel = month.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const days = dayStatsForViewMonth();
    const weeks = groupByWeek(days);
    const weekKeys = [...weeks.keys()].sort((a, b) => a - b);

    return `
      <div class="card card-pad">
        <div class="flex-between mb-14">
          <h3 style="font-size:14.5px;font-weight:700">Day / Week / Month History</h3>
          <div class="flex" style="align-items:center;gap:6px">
            <button class="btn-icon topbar-btn" id="histPrev" style="width:30px;height:30px;transform:rotate(180deg)">${icon("chevronRight")}</button>
            <span class="fw-600" style="font-size:13px;min-width:130px;text-align:center">${monthLabel}</span>
            <button class="btn-icon topbar-btn" id="histNext" style="width:30px;height:30px" ${isCurrent ? "disabled" : ""}>${icon("chevronRight")}</button>
          </div>
        </div>
        ${state.loadingHistoryMonth ? `<div style="padding:30px;text-align:center;color:var(--text-sub)">Loading month…</div>` : `
          <div id="weekAccordion">
            ${weekKeys.map((wk) => weekSection(wk, weeks.get(wk), isCurrent)).join("")}
          </div>`}
      </div>`;
  }

  function weekSection(weekNum, days, isCurrent) {
    const expanded = state.expandedWeeks.has(weekNum);
    const totals = days.reduce((acc, d) => ({ sales: acc.sales + d.sales, profit: acc.profit + d.profit, expenses: acc.expenses + d.expenses }), { sales: 0, profit: 0, expenses: 0 });
    return `
      <div style="border-bottom:1px solid var(--divider)">
        <div class="flex-between" data-week-toggle="${weekNum}" style="padding:11px 4px;cursor:pointer">
          <span class="fw-600" style="font-size:12.5px">${WEEK_LABELS[weekNum] || `Week ${weekNum}`}</span>
          <div class="flex" style="align-items:center;gap:10px">
            <span class="fw-700" style="font-size:12.5px;color:${totals.profit - totals.expenses >= 0 ? "var(--green)" : "var(--red)"}">${fmtMoney(totals.sales)}</span>
            <span style="transform:rotate(${expanded ? "180deg" : "0deg"});transition:transform .15s">${icon("chevronDown") || "▾"}</span>
          </div>
        </div>
        ${expanded ? `<div style="padding-bottom:8px">${days.map(dayRow).join("")}</div>` : ""}
      </div>`;
  }

  function dayRow(d) {
    const netProfit = d.profit - d.expenses;
    const label = d.date.toLocaleDateString("en-US", { weekday: "short", day: "numeric" });
    return `
      <div class="flex-between" style="padding:7px 4px 7px 14px;font-size:12px">
        <span class="text-muted" style="min-width:70px">${label}</span>
        ${!d.hasOccurred
          ? `<span class="text-faint">—</span>`
          : `<span>${fmtMoney(d.sales)} sales</span><span style="color:${netProfit >= 0 ? "var(--green)" : "var(--red)"}">${fmtMoney(netProfit)} net</span>`}
      </div>`;
  }

  function creditCard() {
    const c = state.credit, m = state.month;
    return `
      <div class="card card-pad mb-16">
        <h3 style="font-size:14.5px;font-weight:700;margin-bottom:12px">Credit</h3>
        <div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--divider)"><span class="text-muted" style="font-size:12.5px">Outstanding credit</span><span class="fw-700" style="font-size:13px">${fmtMoney(c.outstanding)}</span></div>
        <div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--divider)"><span class="text-muted" style="font-size:12.5px">Customers owing</span><span class="fw-700" style="font-size:13px">${c.customers}</span></div>
        <div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--divider)"><span class="text-muted" style="font-size:12.5px">Credit sales this month</span><span class="fw-700" style="font-size:13px">${fmtMoney(m.creditSales)}</span></div>
        <div class="flex-between" style="padding:8px 0"><span class="text-muted" style="font-size:12.5px">Credit profit this month</span><span class="fw-700" style="font-size:13px;color:var(--green)">${fmtMoney(m.creditProfit)}</span></div>
      </div>`;
  }

  function todayExtraCard() {
    const t = state.today;
    return `
      <div class="card card-pad mb-16">
        <h3 style="font-size:14.5px;font-weight:700;margin-bottom:12px">Today — Returns &amp; Restocking</h3>
        <div class="grid grid-2" style="gap:12px">
          <div><div class="text-muted" style="font-size:11.5px">Total returns</div><div class="fw-700" style="font-size:16px">${fmtMoney(t.returns)}</div></div>
          <div><div class="text-muted" style="font-size:11.5px">Loss (damaged)</div><div class="fw-700 text-danger" style="font-size:16px">${fmtMoney(t.losses)}</div></div>
          <div><div class="text-muted" style="font-size:11.5px">Restocked</div><div class="fw-700 text-success" style="font-size:16px">${fmtMoney(t.restocked)}</div></div>
        </div>
      </div>`;
  }

  function recentCard() {
    return `
      <div class="card card-pad">
        <h3 style="font-size:14.5px;font-weight:700;margin-bottom:12px">Recent Activity</h3>
        ${state.recent.length === 0 ? `<p class="text-muted" style="font-size:12.5px">No transactions yet.</p>` :
          state.recent.map((tx) => `
            <div class="flex-between" style="padding:9px 0;border-bottom:1px solid var(--divider)">
              <div style="min-width:0">
                <div class="fw-600" style="font-size:12.5px">${txnLabel(tx.type)}</div>
                <div class="text-muted" style="font-size:11px">${fmtDate(tx.createdAt)}</div>
              </div>
              <span class="fw-700" style="font-size:12.5px">${fmtMoney(tx.total ?? tx.amount)}</span>
            </div>`).join("")}
      </div>`;
  }

  function wire() {
    document.getElementById("histPrev")?.addEventListener("click", () => {
      const m = state.historyViewMonth;
      selectHistoryMonth(new Date(m.getFullYear(), m.getMonth() - 1, 1));
    });
    document.getElementById("histNext")?.addEventListener("click", () => {
      const m = state.historyViewMonth;
      if (isSameMonth(m, now)) return;
      selectHistoryMonth(new Date(m.getFullYear(), m.getMonth() + 1, 1));
    });
    container.querySelectorAll("[data-week-toggle]").forEach((el) => el.addEventListener("click", () => {
      const wk = Number(el.dataset.weekToggle);
      if (state.expandedWeeks.has(wk)) state.expandedWeeks.delete(wk); else state.expandedWeeks.add(wk);
      render();
    }));
  }
}

function txnLabel(type) {
  return { credit_sale: "Credit sale", credit_payment: "Credit payment", return: "Return", sale: "Sale" }[type] || "Transaction";
}
function emptyState(iconSvg, title, sub) {
  return `<div class="empty-state"><div class="icon-wrap">${iconSvg}</div><h4>${title}</h4><p>${sub}</p></div>`;
}

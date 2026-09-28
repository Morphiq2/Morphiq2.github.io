// js/app.js — authenticated shell: sidebar (desktop) / bottom nav (mobile),
// routing between pages, business switching, sync banner. Mirrors main.dart's
// _buildDesktopLayout / _buildMobileLayout + Sidebar, with Profile as the
// 6th tab (not a separate full-screen route) so the sidebar always stays.
import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { businessService } from "./services/business-service.js";
import { lockService } from "./services/lock-service.js";
import { icon } from "./services/ui.js";

const NAV = [
  { key: "dashboard", label: "Dashboard",    iconOutline: "grid",     module: "./pages/dashboard.js" },
  { key: "inventory", label: "Inventory",    iconOutline: "box",      module: "./pages/inventory.js", gated: true },
  { key: "expenses",  label: "Expenses",     iconOutline: "receipt",  module: "./pages/expenses.js" },
  { key: "revenue",   label: "Revenue",      iconOutline: "trending", module: "./pages/revenue.js",   gated: true },
  { key: "sales",     label: "Sales History", iconOutline: "history", module: "./pages/sales.js" },
];
const PROFILE = { key: "profile", label: "Settings", iconOutline: "settings", module: "./pages/profile.js" };

let currentKey = "dashboard";
let currentCleanup = null;
let currentModule = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  await businessService.initialize();
  buildSidebar();
  buildBottomNav();
  lockService.addListener(() => { if (isGated(currentKey)) navigate(currentKey, true); });
  businessService.addListener(() => navigate(currentKey, true));
  navigate("dashboard");
  updateSyncBanner();
  window.addEventListener("online", updateSyncBanner);
  window.addEventListener("offline", updateSyncBanner);
});

function isGated(key) { return !!NAV.find((n) => n.key === key)?.gated; }

function buildSidebar() {
  const menu = document.getElementById("sidebarMenu");
  menu.innerHTML = NAV.map((n) => navItemHTML(n)).join("");
  document.getElementById("sidebarSettings").innerHTML = navItemHTML(PROFILE);
  wireNavClicks(document.getElementById("sidebar"));
}
function buildBottomNav() {
  const bar = document.getElementById("bottomNav");
  const items = [...NAV.slice(0, 4), PROFILE]; // 4 core tabs + profile on mobile (Sales reachable from More if needed)
  bar.innerHTML = [...NAV, PROFILE].slice(0, 5).map((n) => `
    <div class="bn-item" data-nav="${n.key}">${icon(n.iconOutline)}<span>${n.label.split(" ")[0]}</span></div>`).join("");
  wireNavClicks(bar);
}
function navItemHTML(n) {
  return `<div class="nav-item" data-nav="${n.key}">${icon(n.iconOutline)}<span>${n.label}</span></div>`;
}
function wireNavClicks(root) {
  root.querySelectorAll("[data-nav]").forEach((el) => el.addEventListener("click", () => navigate(el.dataset.nav)));
}

async function navigate(key, silent) {
  if (!silent && key === currentKey && currentModule) return;
  currentKey = key;
  document.querySelectorAll("[data-nav]").forEach((el) => el.classList.toggle("active", el.dataset.nav === key));
  const title = (key === "profile" ? PROFILE : NAV.find((n) => n.key === key))?.label.split(" ")[0] || "Shopkeeper";
  document.getElementById("mobileTitle").textContent = title;
  document.getElementById("topbarTitle").textContent = title;
  document.getElementById("topbar").style.display = "flex";
  document.getElementById("topbarActions").innerHTML = "";

  if (typeof currentCleanup === "function") { try { currentCleanup(); } catch (_) {} }
  const root = document.getElementById("pageRoot");
  const entry = key === "profile" ? PROFILE : NAV.find((n) => n.key === key);

  if (entry.gated && !lockService.isUnlocked && await lockService.hasPinSet()) {
    root.innerHTML = lockedStateHTML(entry.label);
    document.getElementById("lockedUnlockBtn").addEventListener("click", async () => {
      const { promptUnlock } = await import("./services/lock-service.js");
      const ok = await promptUnlock();
      if (ok) navigate(key, true);
    });
    currentCleanup = null;
    return;
  }

  root.innerHTML = `<div style="padding:60px 0;text-align:center;color:var(--text-sub)">Loading…</div>`;
  const mod = await import(entry.module);
  currentModule = mod;
  root.innerHTML = "";
  const ctx = {
    navigate,
    setTopbarActions(html) { document.getElementById("topbarActions").innerHTML = html; },
  };
  currentCleanup = await mod.renderPage(root, ctx);
}

function lockedStateHTML(label) {
  return `
    <div style="max-width:380px;margin:60px auto;text-align:center">
      <div class="empty-state" style="padding:0">
        <div class="icon-wrap" style="background:var(--purple-soft);color:var(--purple)">${icon("lock")}</div>
        <h4>${label} Locked</h4>
        <p class="mb-16">Enter the business PIN to continue.</p>
        <button class="btn btn-primary" id="lockedUnlockBtn">Enter PIN</button>
      </div>
    </div>`;
}

function updateSyncBanner() {
  const el = document.getElementById("syncBanner");
  if (navigator.onLine) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="sync-banner offline">${icon("cloudOff")}<span>Offline — changes will sync once you're back online</span></div>`;
}

document.getElementById("mobileProfileBtn")?.addEventListener("click", () => navigate("profile"));

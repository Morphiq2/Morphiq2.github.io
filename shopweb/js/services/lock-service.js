// js/services/lock-service.js — mirrors lib/services/lock_service.dart.
// One PIN gates Inventory editing, Revenue figures and Profile access
// together; it re-locks after 3 min idle on a gated page, or immediately
// on a business switch.
import { businessService } from "./business-service.js";

const IDLE_TIMEOUT_MS = 3 * 60 * 1000;

class LockService {
  constructor() {
    this._unlocked = false;
    this._idleTimer = null;
    this._listeners = [];
    businessService.addListener(() => this.lock());
  }

  get isUnlocked() { return this._unlocked; }
  addListener(fn) { this._listeners.push(fn); }
  removeListener(fn) { this._listeners = this._listeners.filter((f) => f !== fn); }
  _notify() { this._listeners.forEach((f) => f()); }

  async hasPinSet() {
    const id = businessService.currentBusinessId;
    if (!id) return false;
    return businessService.hasLockPin(id);
  }

  async unlock(pin) {
    const id = businessService.currentBusinessId;
    if (!id) return false;
    const ok = await businessService.verifyLockPin(id, pin);
    if (ok) { this._unlocked = true; this._resetIdle(); this._notify(); }
    return ok;
  }

  lock() {
    clearTimeout(this._idleTimer); this._idleTimer = null;
    if (this._unlocked) { this._unlocked = false; this._notify(); }
  }

  registerActivity() { if (this._unlocked) this._resetIdle(); }
  _resetIdle() {
    clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => this.lock(), IDLE_TIMEOUT_MS);
  }
}

export const lockService = new LockService();

/// Shows a small PIN-entry modal; resolves true if unlocked. Import lazily
/// to avoid a circular dependency with ui.js.
export async function promptUnlock() {
  const { openModal, toast } = await import("./ui.js");
  return new Promise((resolve) => {
    const { close } = openModal({
      title: "Enter PIN",
      bodyHTML: `
        <div class="field">
          <label>Business PIN</label>
          <input class="input" type="password" inputmode="numeric" id="unlockPin" maxlength="6" autofocus />
        </div>`,
      footHTML: `<button class="btn btn-outline" data-cancel>Cancel</button><button class="btn btn-primary" id="unlockGo">Unlock</button>`,
      onMount: (el) => {
        const submit = async () => {
          const pin = el.querySelector("#unlockPin").value.trim();
          const ok = await lockService.unlock(pin);
          if (ok) { close(); resolve(true); }
          else toast("Incorrect PIN", "error");
        };
        el.querySelector("[data-cancel]").addEventListener("click", () => { close(); resolve(false); });
        el.querySelector("#unlockGo").addEventListener("click", submit);
        el.querySelector("#unlockPin").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
      },
    });
  });
}

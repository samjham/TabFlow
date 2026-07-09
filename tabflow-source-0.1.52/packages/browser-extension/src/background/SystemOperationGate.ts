/**
 * Persistent "system operation in progress" flag.
 *
 * Used to suppress automatic DB writes (snapshots) while TabFlow's code is
 * mid-operation (workspace switch, history restore, claim materialization,
 * tab move, Chrome-restart cleanup). Persists across SW restart via
 * chrome.storage.session so an SW death mid-operation doesn't leave the
 * system in a confused state.
 *
 * Safety: a max-lifetime is enforced. If the gate has been set for more
 * than MAX_GATE_LIFETIME_MS, it's automatically cleared on next check.
 * Prevents a stuck gate from blocking all writes indefinitely.
 */

const GATE_STORAGE_KEY = 'tabflow_system_operation';
const MAX_GATE_LIFETIME_MS = 300_000; // 5 minutes (0.1.34: bumped from 60s to cover thumbnail backfill inside the gated operation; the modal is blocking so this never blocks the user)

interface GateState {
  operationName: string;
  startedAt: number;
}

let inMemoryGate: GateState | null = null;

export async function setGate(operationName: string): Promise<void> {
  const state: GateState = { operationName, startedAt: Date.now() };
  inMemoryGate = state;
  try {
    await chrome.storage.session.set({ [GATE_STORAGE_KEY]: state });
  } catch {
    // session storage unavailable — fall back to in-memory only
  }
  console.log(`[TabFlow] Gate SET: ${operationName}`);
}

export async function clearGate(operationName: string): Promise<void> {
  inMemoryGate = null;
  try {
    await chrome.storage.session.remove(GATE_STORAGE_KEY);
  } catch { /* non-fatal */ }
  console.log(`[TabFlow] Gate CLEAR: ${operationName}`);
}

export async function isGateSet(): Promise<boolean> {
  // Check in-memory first (fast path)
  if (inMemoryGate) {
    if (Date.now() - inMemoryGate.startedAt > MAX_GATE_LIFETIME_MS) {
      console.warn(`[TabFlow] Gate exceeded max lifetime for "${inMemoryGate.operationName}" — auto-clearing`);
      await clearGate(inMemoryGate.operationName + ' (auto)');
      return false;
    }
    return true;
  }
  // Fall back to persisted state (after SW restart)
  try {
    const stored = await chrome.storage.session.get(GATE_STORAGE_KEY);
    const state = stored?.[GATE_STORAGE_KEY] as GateState | undefined;
    if (state) {
      if (Date.now() - state.startedAt > MAX_GATE_LIFETIME_MS) {
        console.warn(`[TabFlow] Gate (persisted) exceeded max lifetime for "${state.operationName}" — auto-clearing`);
        await chrome.storage.session.remove(GATE_STORAGE_KEY);
        return false;
      }
      inMemoryGate = state;
      return true;
    }
  } catch { /* non-fatal */ }
  return false;
}

/**
 * Read-only access to the current gate state, for UI polling.
 * Returns the persisted/in-memory state object or null. Respects the same
 * max-lifetime auto-clear logic as isGateSet so the UI never sees a stuck
 * gate as "in progress" forever.
 */
export async function getGateStateRaw(): Promise<{ operationName: string; startedAt: number } | null> {
  if (inMemoryGate) {
    if (Date.now() - inMemoryGate.startedAt > MAX_GATE_LIFETIME_MS) {
      await clearGate(inMemoryGate.operationName + ' (auto)');
      return null;
    }
    return { operationName: inMemoryGate.operationName, startedAt: inMemoryGate.startedAt };
  }
  try {
    const stored = await chrome.storage.session.get(GATE_STORAGE_KEY);
    const state = stored?.[GATE_STORAGE_KEY] as GateState | undefined;
    if (state) {
      if (Date.now() - state.startedAt > MAX_GATE_LIFETIME_MS) {
        await chrome.storage.session.remove(GATE_STORAGE_KEY);
        return null;
      }
      inMemoryGate = state;
      return { operationName: state.operationName, startedAt: state.startedAt };
    }
  } catch { /* non-fatal */ }
  return null;
}

/**
 * Synchronous check for tab event listeners that can't easily await.
 * Returns the last known state. May be stale right after SW startup
 * (before isGateSet has been called), but tab event handlers also check
 * the in-memory isSwitchingWorkspaces flag as a fast path.
 */
export function isGateSetSync(): boolean {
  if (!inMemoryGate) return false;
  if (Date.now() - inMemoryGate.startedAt > MAX_GATE_LIFETIME_MS) {
    inMemoryGate = null;
    return false;
  }
  return true;
}

/**
 * Pre-warm the in-memory gate from persistent storage. Call this in the
 * SW IIFE early so synchronous checks (isGateSetSync) work correctly.
 */
export async function preloadGate(): Promise<void> {
  try {
    const stored = await chrome.storage.session.get(GATE_STORAGE_KEY);
    const state = stored?.[GATE_STORAGE_KEY] as GateState | undefined;
    if (state) {
      if (Date.now() - state.startedAt > MAX_GATE_LIFETIME_MS) {
        console.warn(`[TabFlow] Stale gate "${state.operationName}" found on SW startup — clearing`);
        await chrome.storage.session.remove(GATE_STORAGE_KEY);
      } else {
        inMemoryGate = state;
        console.log(`[TabFlow] Loaded gate "${state.operationName}" from session storage on SW startup`);
      }
    }
  } catch { /* non-fatal */ }
}

/**
 * Run a system operation with the gate set for its duration.
 * Always clears the gate in a `finally` block — even on exception.
 */
export async function runSystemOperation<T>(
  operationName: string,
  fn: () => Promise<T>
): Promise<T> {
  await setGate(operationName);
  try {
    return await fn();
  } finally {
    await clearGate(operationName);
  }
}

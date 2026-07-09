/**
 * Rolling diagnostic log buffer, persisted in chrome.storage.local.
 * Critical code paths call logDiagnostic() to record events. The
 * TabFlow UI's Debug panel reads and displays the buffer.
 *
 * Buffer size: 500 entries. Older entries get evicted (FIFO).
 * Writes are debounced 200ms to avoid thrashing storage on rapid events.
 */

const STORAGE_KEY = 'tabflow_diagnostic_log';
const MAX_ENTRIES = 500;
const WRITE_DEBOUNCE_MS = 200;

export interface DiagnosticEntry {
  ts: number;
  category: string;
  message: string;
  data?: any;
}

let inMemoryBuffer: DiagnosticEntry[] = [];
let loaded = false;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

async function loadFromStorage(): Promise<void> {
  if (loaded) return;
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    inMemoryBuffer = (stored?.[STORAGE_KEY] as DiagnosticEntry[] | undefined) ?? [];
  } catch {
    inMemoryBuffer = [];
  }
  loaded = true;
}

function scheduleWrite() {
  if (writeTimer) return;
  writeTimer = setTimeout(async () => {
    writeTimer = null;
    try {
      if (inMemoryBuffer.length > MAX_ENTRIES) {
        inMemoryBuffer = inMemoryBuffer.slice(-MAX_ENTRIES);
      }
      await chrome.storage.local.set({ [STORAGE_KEY]: inMemoryBuffer });
    } catch {
      // Non-fatal; buffer stays in memory
    }
  }, WRITE_DEBOUNCE_MS);
}

export async function logDiagnostic(category: string, message: string, data?: any): Promise<void> {
  await loadFromStorage();
  let dataStr: any = undefined;
  if (data !== undefined) {
    try {
      const s = JSON.stringify(data);
      dataStr = s.length > 500 ? s.slice(0, 500) + '…[trunc]' : s;
    } catch {
      dataStr = String(data);
    }
  }
  inMemoryBuffer.push({ ts: Date.now(), category, message, data: dataStr });
  const label = `[TabFlow:${category}]`;
  if (dataStr !== undefined) {
    console.log(label, message, dataStr);
  } else {
    console.log(label, message);
  }
  scheduleWrite();
}

export async function getDiagnosticLog(): Promise<DiagnosticEntry[]> {
  await loadFromStorage();
  return inMemoryBuffer.slice();
}

export async function clearDiagnosticLog(): Promise<void> {
  inMemoryBuffer = [];
  loaded = true;
  try {
    await chrome.storage.local.remove(STORAGE_KEY);
  } catch {
    // Non-fatal
  }
}

#!/usr/bin/env node
/**
 * TabFlow Native Messaging Host
 *
 * A lightweight Node.js script that communicates with the TabFlow Chrome extension
 * via Chrome's native messaging protocol. It queries the OS for Chrome's total
 * memory usage (sum of all chrome.exe processes) and returns it.
 *
 * Native messaging protocol:
 *   - Messages are prefixed with a 4-byte (UInt32LE) length header
 *   - Followed by a UTF-8 JSON payload of that length
 */

const { execSync } = require('child_process');
const os = require('os');

// ─── Native messaging I/O helpers ───

function readMessage() {
  return new Promise((resolve, reject) => {
    const header = Buffer.alloc(4);
    let bytesRead = 0;

    process.stdin.once('readable', () => {
      const chunk = process.stdin.read(4);
      if (!chunk || chunk.length < 4) {
        reject(new Error('Failed to read message header'));
        return;
      }
      const msgLen = chunk.readUInt32LE(0);
      if (msgLen === 0 || msgLen > 1024 * 1024) {
        reject(new Error(`Invalid message length: ${msgLen}`));
        return;
      }
      const body = process.stdin.read(msgLen);
      if (!body) {
        reject(new Error('Failed to read message body'));
        return;
      }
      try {
        resolve(JSON.parse(body.toString('utf-8')));
      } catch (e) {
        reject(new Error('Invalid JSON in message body'));
      }
    });
  });
}

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const buf = Buffer.from(json, 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(header);
  process.stdout.write(buf);
}

// ─── Memory query ───

function getChromeMemoryWindows() {
  try {
    // PowerShell: sum WorkingSet64 of all chrome.exe processes (bytes)
    const cmd = `powershell -NoProfile -Command "Get-Process chrome -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum | Select-Object -ExpandProperty Sum"`;
    const result = execSync(cmd, { timeout: 5000, encoding: 'utf-8' }).trim();
    return parseInt(result, 10) || 0;
  } catch {
    return 0;
  }
}

function getChromeMemoryLinux() {
  try {
    // Sum RSS of all chrome/chromium processes (in KB from ps, convert to bytes)
    const cmd = `ps -C chrome,chromium-browser -o rss= 2>/dev/null | awk '{s+=$1} END {print s*1024}'`;
    const result = execSync(cmd, { timeout: 5000, encoding: 'utf-8' }).trim();
    return parseInt(result, 10) || 0;
  } catch {
    return 0;
  }
}

function getChromeMemoryMac() {
  try {
    // Sum RSS of "Google Chrome" processes (in bytes)
    const cmd = `ps -A -o rss=,comm= | grep -i "Google Chrome" | awk '{s+=$1} END {print s*1024}'`;
    const result = execSync(cmd, { timeout: 5000, encoding: 'utf-8' }).trim();
    return parseInt(result, 10) || 0;
  } catch {
    return 0;
  }
}

function getChromeMemory() {
  const platform = os.platform();
  if (platform === 'win32') return getChromeMemoryWindows();
  if (platform === 'linux') return getChromeMemoryLinux();
  if (platform === 'darwin') return getChromeMemoryMac();
  return 0;
}

// ─── Main ───

async function main() {
  try {
    const msg = await readMessage();

    if (msg.action === 'get_chrome_memory') {
      const chromeMemoryBytes = getChromeMemory();
      sendMessage({
        success: true,
        chromeMemoryBytes,
        platform: os.platform(),
      });
    } else {
      sendMessage({ success: false, error: `Unknown action: ${msg.action}` });
    }
  } catch (err) {
    sendMessage({ success: false, error: String(err) });
  }

  // Native messaging hosts exit after handling one message
  process.exit(0);
}

main();

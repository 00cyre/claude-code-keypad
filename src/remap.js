// Maps a layer's first keys to KV_OAI_AG00… so the firmware will colour them.
//
// This rewrites the keymap on the device, which is the one genuinely
// destructive thing here: KV_OAI_AG keycodes send no keystroke of their own,
// so whatever those keys used to do, they stop doing from the device. That is
// unavoidable — a key is either a macro or individually addressable — but it
// must never be a surprise, so the plan is always shown and always backed up.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const run = promisify(execFile);

export const BACKUP_DIR = path.join(os.homedir(), ".claude-code-keypad", "backups");

/** Human-readable name for a keycode, resolving macro references. */
export function describeKeycode(code, keymap) {
  if (code === "KC_NONE") return "nothing";
  const macro = /^KA_A(\d+)$/.exec(code);
  if (macro) {
    const found = (keymap.macros ?? []).find((m) => String(m.id) === macro[1]);
    return found ? `macro "${found.name}"` : `macro ${macro[1]}`;
  }
  return code;
}

/**
 * Works out what remapping `layerKey` would change. Returns the new keymap and
 * the list of changes, without touching anything.
 */
export function planRemap(keymap, layerKey, count = 6) {
  const [profileId, layerIndex] = layerKey.split("/").map(Number);
  const clone = JSON.parse(JSON.stringify(keymap));
  const profile = clone.profiles.find((p) => p.id === profileId);
  const layer = profile?.layers?.[layerIndex];
  if (!layer) throw new Error(`No such layer: ${layerKey}`);

  const changes = [];
  let slot = 0;
  for (const row of layer.layout.keymap) {
    for (let c = 0; c < row.length; c += 1) {
      if (slot < count) {
        const to = `KV_OAI_AG${String(slot).padStart(2, "0")}`;
        if (row[c] !== to) {
          changes.push({ key: slot + 1, from: row[c], to, was: describeKeycode(row[c], keymap) });
          row[c] = to;
        }
      }
      slot += 1;
    }
  }
  return { keymap: clone, changes, layerName: layer.name };
}

/** Saves a timestamped copy of the current keymap and returns its path. */
export function backup(bytes) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `keymap-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, bytes);
  return file;
}

/** True if the Work Louder Input app is running. */
export async function inputAppRunning() {
  try {
    const { stdout } = await run("pgrep", ["-x", "input"]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** Quits the Input app, which must not be writing while we are. */
export async function quitInputApp() {
  try { await run("osascript", ["-e", 'tell application "input" to quit']); } catch { /* not running */ }
  for (let i = 0; i < 10; i += 1) {
    if (!await inputAppRunning()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  try { await run("pkill", ["-x", "input"]); } catch { /* already gone */ }
  return !await inputAppRunning();
}

/** Reopens the Input app. */
export async function openInputApp() {
  try { await run("open", ["-a", "input"]); return true; } catch { return false; }
}

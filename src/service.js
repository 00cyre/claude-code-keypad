// Install as a login item, via a LaunchAgent.
//
// `npx` runs out of a cache directory that npm is free to prune, so a
// LaunchAgent pointing at wherever this happens to be running from would work
// until it silently didn't. Install therefore puts a copy somewhere stable
// first and points the agent at that.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const run = promisify(execFile);

export const LABEL = "com.00cyre.claude-code-keypad";
export const HOME = path.join(os.homedir(), ".claude-code-keypad");
export const PLIST = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
export const LOG = path.join(os.homedir(), "Library", "Logs", "claude-code-keypad.log");
const SPEC = "github:00cyre/claude-code-keypad";
const INSTALLED_CLI = path.join(HOME, "node_modules", "claude-code-keypad", "bin", "cli.js");

/**
 * A node path that survives an upgrade. `process.execPath` on Homebrew is
 * version-pinned (…/Cellar/node/25.9.0_2/bin/node) and vanishes on the next
 * `brew upgrade node`, taking the login item with it silently. Prefer a
 * stable symlink that resolves to the very same binary.
 */
export function stableNodePath(execPath = process.execPath) {
  const real = fs.realpathSync(execPath);
  for (const candidate of ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]) {
    try {
      if (fs.realpathSync(candidate) === real) return candidate;
    } catch { /* not present */ }
  }
  return execPath;
}

const escape = (value) => String(value).replace(/[&<>'"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&apos;", '"': "&quot;" }[c]));

function plist(nodePath, cliPath, args) {
  const argv = [nodePath, cliPath, ...args].map((a) => `    <string>${escape(a)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argv}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${escape(LOG)}</string>
  <key>StandardErrorPath</key><string>${escape(LOG)}</string>
</dict>
</plist>
`;
}

async function launchctl(args) {
  try {
    const { stdout } = await run("launchctl", args);
    return { ok: true, out: stdout };
  } catch (error) {
    return { ok: false, out: String(error.stderr || error.message) };
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** True when launchd currently knows about the job. */
async function isLoaded(uid) {
  return (await launchctl(["print", `gui/${uid}/${LABEL}`])).ok;
}

/** Waits for the job to reach `wanted`, since bootout and bootstrap are async. */
async function settle(uid, wanted, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isLoaded(uid) === wanted) return true;
    await sleep(250);
  }
  return await isLoaded(uid) === wanted;
}

/** Installs a stable copy and loads it as a login item. */
export async function install(args = []) {
  const uid = process.getuid();
  console.log(`installing into ${HOME}`);
  fs.mkdirSync(HOME, { recursive: true });
  // npm needs something to anchor the install; without it the tree walks up.
  const manifest = path.join(HOME, "package.json");
  if (!fs.existsSync(manifest)) {
    fs.writeFileSync(manifest, JSON.stringify({ name: "claude-code-keypad-host", private: true }, null, 2) + "\n");
  }
  console.log(`fetching ${SPEC} (this also builds the native HID bridge)…`);
  await run("npm", ["install", "--silent", "--prefix", HOME, SPEC], { maxBuffer: 32 * 1024 * 1024 });
  if (!fs.existsSync(INSTALLED_CLI)) throw new Error(`install did not produce ${INSTALLED_CLI}`);

  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  const nodePath = stableNodePath();
  fs.writeFileSync(PLIST, plist(nodePath, INSTALLED_CLI, args));
  console.log(`wrote ${PLIST}`);
  console.log(`  node: ${nodePath}${nodePath === process.execPath ? "" : "  (upgrade-stable symlink)"}`);

  // Replace any previous copy. bootout returns before launchd has finished
  // tearing the job down, and a bootstrap issued into that window gets undone
  // by the teardown completing — it reports success and then is simply not
  // there. So wait for the job to actually be gone, then wait for it to
  // actually be up, rather than trusting either exit code.
  await launchctl(["bootout", `gui/${uid}/${LABEL}`]);
  if (!await settle(uid, false)) throw new Error("the previous copy would not unload");

  let loaded = await launchctl(["bootstrap", `gui/${uid}`, PLIST]);
  if (!loaded.ok) loaded = await launchctl(["load", "-w", PLIST]);   // older macOS
  if (!await settle(uid, true)) {
    throw new Error(`launchctl did not keep it loaded: ${loaded.out.trim() || "no error reported"}`);
  }
  const printed = await launchctl(["print", `gui/${uid}/${LABEL}`]);
  const pid = printed.out.match(/pid = (\d+)/)?.[1];

  console.log(`\n✓ installed and running${pid ? ` (pid ${pid})` : ""}, and it will start again at login.`);
  console.log(`  logs      : ${LOG}`);
  console.log(`  stop      : npx ${SPEC} uninstall`);
  console.log(`\nIf pressing a key does not switch chats, grant Accessibility to`);
  console.log(`node (${nodePath}) in System Settings › Privacy & Security.`);
}

/** Unloads the login item. Leaves the installed copy in place. */
export async function uninstall() {
  const uid = process.getuid();
  const stopped = await launchctl(["bootout", `gui/${uid}/${LABEL}`]);
  if (!stopped.ok) await launchctl(["unload", "-w", PLIST]);
  await settle(uid, false);
  if (fs.existsSync(PLIST)) { fs.rmSync(PLIST); console.log(`removed ${PLIST}`); }
  console.log("✓ stopped, and it will no longer start at login.");
  console.log(`  the copy in ${HOME} is left alone; delete it if you want it gone.`);
}

/** Reports whether the login item is loaded, and where it points. */
export async function status() {
  const uid = process.getuid();
  console.log(`plist    : ${PLIST} ${fs.existsSync(PLIST) ? "(present)" : "(absent)"}`);
  console.log(`copy     : ${INSTALLED_CLI} ${fs.existsSync(INSTALLED_CLI) ? "(present)" : "(absent)"}`);
  const { ok, out } = await launchctl(["print", `gui/${uid}/${LABEL}`]);
  if (!ok) return void console.log("service  : not loaded");
  const pid = out.match(/pid = (\d+)/)?.[1];
  const state = out.match(/state = (\S+)/)?.[1];
  console.log(`service  : loaded${state ? `, ${state}` : ""}${pid ? `, pid ${pid}` : ""}`);
  console.log(`logs     : ${LOG}`);
}

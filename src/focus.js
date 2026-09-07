// Decides which app a chat key should bring forward, and whether that has
// already been decided.
//
// The keys that show colour send no keystroke of their own, so the daemon
// sends Cmd+N itself — and by default sends it to whatever is in front. That
// is right when you are looking at Claude, and useless when you are not:
// pressing a key from your editor opens tab N of your editor. Bringing the
// app forward first is what most people mean by "jump to that chat", so
// install asks, once, and bakes the answer in as --app.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { CLAUDE_BUNDLE_IDS } from "./layers.js";

const run = promisify(execFile);

/** The `--app` value in a saved argument list, or undefined if none. */
export function appFromArgs(args) {
  const at = args.indexOf("--app");
  return at >= 0 ? args[at + 1] : undefined;
}

/**
 * Whether install still has to ask. `--app <name>` and `--app none` are both
 * answers; `--no-switch` makes the question moot.
 */
export function focusDecided(args) {
  return appFromArgs(args) !== undefined || args.includes("--no-switch");
}

/** What the permission check should address by name: the app, or System Events. */
export function automationTarget(args) {
  const app = appFromArgs(args);
  return app && app !== "none" ? app : "System Events";
}

/** The Input app's link for a layer, if it has one. */
export function linkedAppFor(board, layerKey) {
  const layer = board?.layers?.get(layerKey);
  if (!layer || layer.linkedAppId === undefined) return null;
  return board.apps?.find((app) => app.id === layer.linkedAppId)
    ?? board.allApps?.find((app) => app.id === layer.linkedAppId)
    ?? null;
}

/** "Claude" from "/Applications/Claude.app". */
export function appNameFromPath(appPath) {
  const base = path.basename(String(appPath ?? "").trim());
  return base.endsWith(".app") ? base.slice(0, -4) : base;
}

/** Where a bundle id lives on this Mac, or null. Spotlight, so no permission needed. */
export async function locateApp(bundleId) {
  if (!bundleId) return null;
  try {
    const { stdout } = await run("mdfind", [`kMDItemCFBundleIdentifier == ${JSON.stringify(bundleId)}`], { timeout: 10_000 });
    const found = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
    // Prefer /Applications over a stray copy in a build folder.
    return found.find((p) => p.startsWith("/Applications/")) ?? found[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Which app a key should bring forward for `layerKey`, and why.
 *
 * The app linked to the layer in the Input app wins — that link is the one
 * honest signal for "this layer is for that app". A layer linked to nothing
 * falls back to the Claude desktop app, since that is what this is for.
 * Returns null when there is nothing to offer, e.g. Claude is not installed.
 *
 * The name has to be the one AppleScript knows, which is the bundle's name on
 * disk — the Input app's label ("ChatGPT-mac") is not it.
 */
export async function focusTarget(board, layerKey, { locate = locateApp } = {}) {
  const linked = linkedAppFor(board, layerKey);
  if (linked) {
    const where = await locate(linked.process);
    return {
      name: where ? appNameFromPath(where) : (linked.name || linked.process),
      source: "input",
    };
  }
  for (const id of CLAUDE_BUNDLE_IDS) {
    const where = await locate(id);
    if (where) return { name: appNameFromPath(where), source: "default" };
  }
  return null;
}

/** The question install prints. Kept here so the wording can be read in one place. */
export function focusQuestion({ name, source }) {
  const why = source === "input"
    ? `The Input app links this layer to ${name}, so a key press can switch to it`
    : `This layer is not linked to an app in the Input app, so this would use ${name}:`;
  return [
    "",
    `Bring ${name} to the front when you press a chat key?`,
    "",
    why,
    source === "input"
      ? "first and then jump to the chat, from whatever you happen to be looking at."
      : "a key press switches to it first, then jumps to the chat.",
    "Without this, the shortcut goes to whichever app is already in front.",
    "",
    `Auto-focus ${name}? [Y/n] `,
  ].join("\n");
}

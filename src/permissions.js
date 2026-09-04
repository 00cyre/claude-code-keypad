// macOS permission checks.
//
// Two separate grants are needed to switch chats, and they fail differently:
//
//   Accessibility  to synthesise a keystroke at all. Without it System Events
//                  refuses with -1719.
//   Automation     to address another app by name ("tell application Claude").
//                  Without it you get -1743.
//
// Both are granted to the *responsible process*, which under launchd is the
// node binary itself — not the terminal that installed it. That is why this
// works when run by hand and then stops once it is a login item: they are two
// different subjects as far as the system is concerned.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export const ACCESSIBILITY_PANE =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
export const AUTOMATION_PANE =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation";

/**
 * Whether this process may synthesise input. `UI elements enabled` is the
 * accessibility check itself and touches nothing, so it is safe to call on
 * every start.
 */
export async function hasAccessibility() {
  try {
    const { stdout } = await run("osascript", ["-e", "tell application \"System Events\" to get UI elements enabled"]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

/** Whether this process may address `app` by name. Harmless: only reads a name. */
export async function hasAutomation(app = "System Events") {
  try {
    await run("osascript", ["-e", `tell application ${JSON.stringify(app)} to get name`]);
    return true;
  } catch (error) {
    const detail = String(error.stderr || error.message);
    // -1743 is "not authorised"; anything else (app missing, say) is not a
    // permission problem and should not be reported as one.
    return !/-1743|Not authori[sz]ed/i.test(detail);
  }
}

/**
 * Nudges macOS into showing its own prompt. The system only offers the dialog
 * when something actually attempts a gated action, so ask for one — reading a
 * window title needs Accessibility and changes nothing.
 */
export async function requestAccessibility() {
  try {
    await run("osascript", [
      "-e", 'tell application "System Events" to tell (first application process whose frontmost is true) to get name of window 1',
    ], { timeout: 10_000 });
  } catch { /* the point is the attempt, not the result */ }
}

/** Opens a System Settings pane. */
export async function openPane(pane) {
  try { await run("open", [pane]); return true; } catch { return false; }
}

/** Checks both grants and explains what to do about whichever is missing. */
export async function report({ app = "Claude", nodePath = process.execPath, fix = false } = {}) {
  const accessibility = await hasAccessibility();
  const automation = await hasAutomation(app);
  const lines = [];
  lines.push(`accessibility : ${accessibility ? "granted" : "MISSING"}   (synthesise the keystroke)`);
  lines.push(`automation    : ${automation ? "granted" : "MISSING"}   (address ${app} by name)`);

  if (accessibility && automation) return { ok: true, accessibility, automation, text: lines.join("\n") };

  lines.push("");
  lines.push("Status colours work regardless; this only affects switching chats.");
  if (!accessibility) {
    lines.push("");
    lines.push("For Accessibility, add this exact binary:");
    lines.push(`  ${nodePath}`);
    lines.push("  System Settings › Privacy & Security › Accessibility › +");
    lines.push("  (⌘⇧G in the file picker lets you paste that path)");
    lines.push("");
    lines.push("A login item is its own subject, so a grant given to your terminal");
    lines.push("does not carry over — node has to be listed in its own right.");
  }
  if (!automation) {
    lines.push("");
    lines.push(`For Automation, allow node to control ${app} and System Events:`);
    lines.push("  System Settings › Privacy & Security › Automation");
  }

  if (fix) {
    await requestAccessibility();
    await openPane(accessibility ? AUTOMATION_PANE : ACCESSIBILITY_PANE);
    lines.push("");
    lines.push("(opened the relevant System Settings pane)");
  }
  return { ok: false, accessibility, automation, text: lines.join("\n") };
}

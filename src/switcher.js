// Sends Cmd+N to switch chats.
//
// The keys that can show per-key colour are KV_OAI_AG*, and those send no
// keystroke of their own — that is precisely why the firmware is willing to
// colour them. So the keystroke has to come from here instead, which needs
// Accessibility permission for whatever runs this process.
import { execFile } from "node:child_process";

/** macOS error for a process without Accessibility permission. */
const NOT_TRUSTED = /-1719|not allowed assistive access|osascript is not allowed/i;

export class Switcher {
  #warned = false;
  #onWarn;

  constructor({ onWarn = () => {} } = {}) {
    this.#onWarn = onWarn;
  }

  /** Switches to the nth chat (1-based), the same thing Cmd+N does by hand. */
  switchTo(index) {
    return new Promise((resolve) => {
      execFile("osascript", [
        "-e", `tell application "System Events" to keystroke "${index}" using command down`,
      ], (error, _stdout, stderr) => {
        if (!error) return resolve(true);
        const detail = String(stderr || error.message);
        // Only worth saying once; it is the same missing grant every time.
        if (NOT_TRUSTED.test(detail) && !this.#warned) {
          this.#warned = true;
          this.#onWarn(
            "Cannot send keystrokes: this process lacks Accessibility permission.\n"
            + "  Grant it in System Settings › Privacy & Security › Accessibility,\n"
            + "  for the app running this (Terminal, iTerm, or node itself), then restart.\n"
            + "  Until then the keys still show status, they just will not switch chats.",
          );
        } else if (!NOT_TRUSTED.test(detail)) {
          this.#onWarn(`Could not send Cmd+${index}: ${detail.trim()}`);
        }
        resolve(false);
      });
    });
  }
}

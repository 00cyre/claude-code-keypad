// Sends the "jump to chat N" keystroke.
//
// The keys that can show per-key colour are KV_OAI_AG*, and those send no
// keystroke of their own — that is precisely why the firmware is willing to
// colour them. So the keystroke has to come from here instead.
//
// It has to be `key code`, not `keystroke`. AppleScript's `keystroke "1"`
// delivers the character but not a meaningful virtual key code, and an app
// that handles the shortcut in its web layer reads `event.code` — which is
// derived from that key code — so it sees nothing and ignores the event.
// Chrome happens to work either way because its handler reads the character.
// `key code 18` posts what a real keyboard posts, and both kinds of handler
// see it. This is the difference between the device macro working and a
// synthetic keystroke silently doing nothing.
import { execFile } from "node:child_process";

/** macOS virtual key codes for the number row. Note 5 and 6 are not in order. */
const DIGIT_KEY_CODES = { 1: 18, 2: 19, 3: 20, 4: 21, 5: 23, 6: 22, 7: 26, 8: 28, 9: 25 };

const NOT_TRUSTED = /-1719|not allowed assistive access|osascript is not allowed/i;

export class Switcher {
  #warned = false;
  #onWarn;
  #app;

  /** `app` is brought to the front first; pass null to send to whatever is frontmost. */
  constructor({ onWarn = () => {}, app = "Claude" } = {}) {
    this.#onWarn = onWarn;
    this.#app = app;
  }

  #script(keyCode) {
    const press = `tell application "System Events" to key code ${keyCode} using command down`;
    if (!this.#app) return press;
    const app = JSON.stringify(this.#app);
    // Wait for the app to actually be frontmost rather than guessing at a
    // delay. `activate` returns as soon as the request is made, so a fixed
    // pause races it — and when the app was in the background the keystroke
    // landed on whatever was in front instead, silently and with no error.
    return [
      `tell application ${app} to activate`,
      `tell application "System Events"`,
      `  repeat 60 times`,
      `    if name of first application process whose frontmost is true is ${app} then exit repeat`,
      `    delay 0.05`,
      `  end repeat`,
      `  if name of first application process whose frontmost is true is not ${app} then error "did not come to the front" number 9001`,
      `end tell`,
      press,
    ].join("\n");
  }

  /** Switches to the nth chat (1-based). Resolves true if the keystroke went out. */
  switchTo(index) {
    const keyCode = DIGIT_KEY_CODES[index];
    if (keyCode === undefined) return Promise.resolve(false);
    return new Promise((resolve) => {
      execFile("osascript", ["-e", this.#script(keyCode)], (error, _out, stderr) => {
        if (!error) return resolve(true);
        const detail = String(stderr || error.message);
        if (/9001/.test(detail)) {
          this.#onWarn(`${this.#app} did not come to the front within 3s; keystroke not sent.`);
          return resolve(false);
        }
        if (NOT_TRUSTED.test(detail)) {
          if (!this.#warned) {
            this.#warned = true;
            this.#onWarn(
              "Cannot send keystrokes: this process lacks Accessibility permission.\n"
              + "  System Settings › Privacy & Security › Accessibility, add whatever runs this\n"
              + "  (Terminal, iTerm, or node), then restart. Until then the keys still show\n"
              + "  status, they just will not switch chats.",
            );
          }
        } else {
          this.#onWarn(`Could not send Cmd+${index}: ${detail.trim()}`);
        }
        resolve(false);
      });
    });
  }
}

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

  /** `app` is brought to the front first; the default sends to whatever is frontmost. */
  constructor({ onWarn = () => {}, app = null } = {}) {
    this.#onWarn = onWarn;
    this.#app = app;
  }

  #script(keyCode) {
    const press = `tell application "System Events" to key code ${keyCode} using command down`;
    // Default: send it to whatever is in front. You press the key while looking
    // at the thing you want it to act on, so the frontmost app is the right
    // target and no app needs naming. Cmd+N is an ordinary shortcut; treating
    // it as anything more elaborate only added ways to fail.
    if (!this.#app) return press;

    // --app opts into bringing something forward first. `activate` returns
    // before the app is actually frontmost, so wait for it — but only as a
    // courtesy: if it never arrives we still send the keystroke rather than
    // silently doing nothing.
    const app = JSON.stringify(this.#app);
    return [
      `tell application ${app} to activate`,
      `tell application "System Events"`,
      `  repeat 40 times`,
      // Bind the comparison to a variable first: `name of ... whose frontmost
      // is true is not "X"` parses the `is true` into the outer comparison and
      // fails with -1700 at runtime.
      `    set fg to name of first application process whose frontmost is true`,
      `    if fg is ${app} then exit repeat`,
      `    delay 0.05`,
      `  end repeat`,
      `end tell`,
      press,
    ].join("\n");
  }

  /** The AppleScript for key n, exposed so tests can compile it. */
  scriptFor(index) {
    return this.#script(DIGIT_KEY_CODES[index]);
  }

  /** Switches to the nth chat (1-based). Resolves true if the keystroke went out. */
  switchTo(index) {
    const keyCode = DIGIT_KEY_CODES[index];
    if (keyCode === undefined) return Promise.resolve(false);
    return new Promise((resolve) => {
      execFile("osascript", ["-e", this.#script(keyCode)], (error, _out, stderr) => {
        if (!error) return resolve(true);
        const detail = String(stderr || error.message);
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

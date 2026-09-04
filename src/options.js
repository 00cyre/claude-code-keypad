// Command-line parsing, kept out of the daemon so it can be tested.
import { DEFAULTS } from "./status.js";

/** CLI spellings for the four states. */
export const STATE_FLAGS = {
  "--working": "working",
  "--needs-you": "stalled",
  "--your-turn": "yourTurn",
  "--idle": "idle",
};

export const DEFAULT_OPTIONS = {
  testSwitch: null,
  keys: 6,
  interval: 2000,
  app: null,          // null = send to whatever is frontmost
  layer: null,
  switching: true,
  anyLayer: false,
  onlyOnLayer: false,
  assumeYes: false,
};

/**
 * Parses argv into daemon options plus per-state palette overrides.
 * Throws on anything it does not recognise, so a typo in a login item is a
 * startup failure with a message rather than a silently ignored setting.
 */
export function parse(argv) {
  const options = { ...DEFAULT_OPTIONS };
  const colors = {};
  const rest = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      i += 1;
      return v;
    };

    // --working #FFC400 / --working-effect breath / --working-brightness 0.5
    const stateFlag = Object.keys(STATE_FLAGS).find((f) => arg === f || arg.startsWith(`${f}-`));
    if (stateFlag) {
      const state = STATE_FLAGS[stateFlag];
      const suffix = arg.slice(stateFlag.length);
      const entry = colors[state] ?? (colors[state] = {});
      if (suffix === "") entry.color = next();
      else if (suffix === "-effect") entry.effect = next();
      else if (suffix === "-brightness") entry.brightness = Number(next());
      else if (suffix === "-speed") entry.speed = Number(next());
      else throw new Error(`Unknown option ${arg}`);
      continue;
    }

    switch (arg) {
      case "--keys": options.keys = Number(next()); break;
      case "--interval": options.interval = Number(next()); break;
      case "--app": options.app = next(); break;
      case "--layer": {
        const v = next();
        if (!/^\d+\/\d+$/.test(v)) throw new Error(`--layer wants profile/index, e.g. 1/1 — got ${v}`);
        options.layer = v;
        break;
      }
      case "--no-switch": options.switching = false; break;
      case "--any-layer": options.anyLayer = true; break;
      case "--only-on-layer": options.onlyOnLayer = true; break;
      case "--yes": case "-y": options.assumeYes = true; break;
      case "--once": options.once = true; break;
      // Handled by the CLI, but must be known here or parsing rejects it.
      case "--test-switch": options.testSwitch = Number(next()); break;
      case "--no-prompt": options.noPrompt = true; break;
      default:
        if (arg.startsWith("-")) throw new Error(`Unknown option ${arg}`);
        rest.push(arg);
    }
  }

  if (!Number.isInteger(options.keys) || options.keys < 1 || options.keys > 20) {
    throw new Error(`--keys must be a whole number between 1 and 20, got ${options.keys}`);
  }
  if (!(options.interval >= 250)) throw new Error(`--interval must be at least 250ms, got ${options.interval}`);
  for (const state of Object.keys(colors)) {
    if (!(state in DEFAULTS)) throw new Error(`Unknown state ${state}`);
  }
  return { options, colors, rest };
}

// How a session's state becomes light.
//
// Two surfaces, driven from different data:
//
//   keys 1-6   one per session, each showing that session's own state
//   everything else (the ambient ring, and any key no session has claimed)
//              shows the *selected* session's state, so the board as a whole
//              tells you where you are without you having to find the key
//
// Working pulses rather than sitting solid: a steady colour reads as a
// finished state out of the corner of your eye, and "still going" is the one
// thing you want to be able to tell apart at a glance from "come back to me".
import { Effect, toHexColor, toPackedColor } from "creator-micro-kit";
import { State } from "./sessions.js";

/**
 * The defaults. Yellow rather than blue for the busiest state is deliberate:
 * these keys use separate red/green/blue emitters behind a diffuser rather
 * than one mixed source, so a saturated blue lands close to white and loses
 * against the idle keys. Yellow drives two of the three hard and stays itself.
 *
 * Every value here is overridable — see `makeLook`.
 */
export const DEFAULTS = {
  // Three things you can tell apart across a desk, rather than four you have
  // to squint at. Yellow is the only one that moves, because "still going" is
  // the state you want to catch out of the corner of your eye. Blue reads a
  // little washed out on these LEDs — separate emitters behind a diffuser —
  // which is fine for the state that means "nothing is happening here".
  working:  { color: "#FFC400", brightness: 1,   effect: "breath", speed: 0.75 },  // yellow, pulsing
  stalled:  { color: "#00C853", brightness: 1,   effect: "solid",  speed: 0    },  // green — waiting on you
  yourTurn: { color: "#00C853", brightness: 1,   effect: "solid",  speed: 0    },  // green — waiting on you
  idle:     { color: "#2D7FF9", brightness: 0.8, effect: "solid",  speed: 0    },  // blue — away
};

const LABELS = { working: "working", stalled: "needs you", yourTurn: "your turn", idle: "idle" };

/** Resolves an effect name to its firmware index, accepting an index too. */
export function toEffect(name) {
  if (typeof name === "number") return name;
  const key = String(name).replace(/[-_\s]/g, "").toLowerCase();
  const match = Object.keys(Effect).find((e) => e.toLowerCase() === key);
  if (match === undefined) {
    throw new Error(`Unknown effect "${name}". Try: ${Object.keys(Effect).join(", ")}`);
  }
  return Effect[match];
}

/**
 * Builds the palette, applying per-state overrides over `DEFAULTS`.
 * Colours are validated here so a typo fails at startup rather than painting
 * something surprising two hours later.
 */
export function makeLook(overrides = {}) {
  const look = {};
  for (const [name, base] of Object.entries(DEFAULTS)) {
    const merged = { ...base, ...(overrides[name] ?? {}) };
    if (merged.brightness < 0 || merged.brightness > 1) {
      throw new Error(`${name}: brightness must be between 0 and 1, got ${merged.brightness}`);
    }
    look[State[name]] = {
      color: toHexColor(toPackedColor(merged.color)),   // throws on a bad colour
      brightness: merged.brightness,
      effect: toEffect(merged.effect),
      speed: merged.speed,
      label: LABELS[name],
    };
  }
  return look;
}

/** The palette in use. Replaced at startup when overrides are given. */
export let Look = makeLook();

/** Applies overrides to the shared palette. */
export function configure(overrides) {
  Look = makeLook(overrides);
  return Look;
}

/** Shown on a key with no session behind it. */
export const Empty = { color: "#000000", brightness: 0, effect: Effect.off, speed: 0, label: "—" };

/** Most urgent first, for surfaces that can only show one colour. */
export const Priority = [State.stalled, State.yourTurn, State.working, State.idle];

/** Pads the session list out to `count` slots so every key gets a value. */
export function slots(sessions, count) {
  return Array.from({ length: count }, (_, id) => {
    const session = sessions[id];
    return { id, session, look: session ? Look[session.state] : Empty };
  });
}

/** The single most urgent state present, or undefined if there are none. */
export function mostUrgent(sessions) {
  return Priority.find((state) => sessions.some((session) => session.state === state));
}

/** A `setThreadColors` entry. Omitted fields keep their old value on the
 *  device — and after a power cycle that value is zero — so send them all. */
export function threadFor(id, look) {
  return { id, color: look.color, brightness: look.brightness, effect: look.effect, speed: look.speed };
}

/** A `setZones` side: the ambient ring, or the keys no thread has claimed. */
export function zoneFor(look) {
  return { effect: look.effect, brightness: look.brightness, speed: look.speed, color: look.color, magic: 1 };
}

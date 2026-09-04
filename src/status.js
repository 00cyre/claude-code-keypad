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
import { Effect } from "creator-micro-kit";
import { State } from "./sessions.js";

export const Look = {
  // Yellow, not blue, for the one state that has to be unmistakable. These
  // keys use separate red/green/blue emitters rather than one mixed source,
  // so a pure blue reads as near-white on the diffuser and loses against the
  // idle keys. Yellow drives two of the three emitters hard and stays itself.
  [State.working]:  { color: "#FFC400", brightness: 1,   effect: Effect.breath, speed: 0.75, label: "working"   },
  [State.stalled]:  { color: "#2D7FF9", brightness: 1,   effect: Effect.solid,  speed: 0,    label: "needs you" },
  [State.yourTurn]: { color: "#00C853", brightness: 1,   effect: Effect.solid,  speed: 0,    label: "your turn" },
  // Held below the working colours so an untouched session reads as background
  // rather than competing with the ones that want something.
  [State.idle]:     { color: "#FFFFFF", brightness: 0.5, effect: Effect.solid,  speed: 0,    label: "idle"      },
};

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

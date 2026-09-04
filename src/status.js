// How a session's state becomes a colour.
//
// The palette is deliberately blunt: at a glance across a desk you are asking
// one question — does anything need me? — so only `stalled` and `yourTurn` are
// bright, and idle sessions stay dim enough to read as background.
import { State } from "./sessions.js";

export const Look = {
  [State.working]:  { color: "#2D7FF9", brightness: 1,    label: "working"   },
  [State.stalled]:  { color: "#FF8C00", brightness: 1,    label: "needs you" },
  [State.yourTurn]: { color: "#00C853", brightness: 1,    label: "your turn" },
  [State.idle]:     { color: "#3A3A3A", brightness: 0.25, label: "idle"      },
};

/** Shown on a key with no session behind it. */
export const Empty = { color: "#000000", brightness: 0, label: "—" };

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

// Reads the state of the Claude Code sessions running on this machine.
//
// Two sources, both on disk, so this works from a plain script rather than
// from inside a session:
//
//   ~/.claude/sessions/<pid>.json          one per live session: pid, sessionId, cwd
//   ~/.claude/projects/<cwd>/<id>.jsonl    that session's transcript
//
// A session's state comes from the last non-sidechain record of its
// transcript. `stop_reason` is the signal: "end_turn" means the assistant
// finished and it is your move; anything else means it is mid-turn.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CLAUDE_HOME = path.join(os.homedir(), ".claude");
const SESSIONS = path.join(CLAUDE_HOME, "sessions");
const PROJECTS = path.join(CLAUDE_HOME, "projects");

/** How long a mid-turn session may go quiet before we call it stalled. */
export const STALL_MS = 45_000;
/** How long an idle session stays "recent" before it dims. */
export const STALE_MS = 60 * 60 * 1000;

export const State = {
  working: "working",
  yourTurn: "your-turn",
  stalled: "stalled",
  idle: "idle",
};

function isAlive(pid) {
  try {
    // Signal 0 tests for the process without touching it.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists but belongs to someone else.
    return error.code === "EPERM";
  }
}

/** Every session with a live process, newest first. */
export function liveSessions() {
  let entries;
  try { entries = fs.readdirSync(SESSIONS); } catch { return []; }
  const sessions = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    let record;
    try { record = JSON.parse(fs.readFileSync(path.join(SESSIONS, entry), "utf8")); } catch { continue; }
    if (!record.pid || !record.sessionId || !isAlive(record.pid)) continue;
    sessions.push(record);
  }
  return sessions;
}

/** Locates a session's transcript, which lives under a directory named for its cwd. */
function transcriptPath(sessionId) {
  let projects;
  try { projects = fs.readdirSync(PROJECTS); } catch { return null; }
  for (const project of projects) {
    const candidate = path.join(PROJECTS, project, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Reads the last records of a transcript without loading the whole file —
 * these grow to megabytes, and only the tail decides the state.
 */
function tailRecords(file, bytes = 256 * 1024) {
  let handle;
  try { handle = fs.openSync(file, "r"); } catch { return []; }
  try {
    const { size } = fs.fstatSync(handle);
    const length = Math.min(bytes, size);
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, size - length);
    const text = buffer.toString("utf8");
    // A partial first line is unavoidable when seeking into the middle.
    const lines = text.split("\n").slice(size > length ? 1 : 0);
    const records = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line)); } catch { /* truncated */ }
    }
    return records;
  } finally {
    fs.closeSync(handle);
  }
}

/**
 * Derives a session's state from its transcript tail.
 *
 * `end_turn` is unambiguous: the assistant stopped and is waiting for you.
 * Mid-turn is ambiguous — a session generating and a session sitting on a
 * permission prompt look identical on disk — so a mid-turn session that has
 * not written anything for STALL_MS is reported as `stalled`, which in
 * practice is usually a prompt waiting for an answer.
 */
export function stateFromRecords(records, { now = Date.now(), fallbackAt = null } = {}) {
  // Subagent turns interleave into the same file; they are not the session's
  // own state, and a running subagent means the session is working anyway.
  const own = records.filter((record) => record.isSidechain !== true);
  const last = own.at(-1) ?? records.at(-1);
  if (!last) return { state: State.idle, since: null };

  const at = Date.parse(last.timestamp ?? "") || fallbackAt;
  if (at === null) return { state: State.idle, since: null };
  const quietFor = now - at;

  if (last.type === "assistant" && last.message?.stop_reason === "end_turn") {
    return { state: quietFor > STALE_MS ? State.idle : State.yourTurn, since: at, quietFor };
  }
  // Anything else is mid-turn: a tool_use awaiting its result, a tool result
  // just written, or a user message the assistant has not answered yet. Past
  // STALE_MS treat it as idle rather than stalled — a session interrupted
  // yesterday is not something to light up as needing attention.
  let state = State.working;
  if (quietFor > STALE_MS) state = State.idle;
  else if (quietFor > STALL_MS) state = State.stalled;
  return { state, since: at, quietFor };
}

/** Reads a session's transcript and derives its state. */
export function sessionState(sessionId, { now = Date.now() } = {}) {
  const file = transcriptPath(sessionId);
  if (!file) return { state: State.idle, since: null, file: null };
  const derived = stateFromRecords(tailRecords(file), {
    now,
    fallbackAt: fs.statSync(file).mtimeMs,
  });
  return { ...derived, file };
}

/** Live sessions with their state, most recently active first. */
export function sessionStatuses({ now = Date.now() } = {}) {
  return liveSessions()
    .map((session) => {
      const status = sessionState(session.sessionId, { now });
      return {
        sessionId: session.sessionId,
        pid: session.pid,
        cwd: session.cwd,
        name: session.name ?? path.basename(session.cwd ?? ""),
        ...status,
      };
    })
    .sort((a, b) => (b.since ?? 0) - (a.since ?? 0));
}

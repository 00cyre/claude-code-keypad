// Reads the state of your Claude Code sessions from disk.
//
// The durable record is the transcript: ~/.claude/projects/<cwd>/<id>.jsonl,
// one per session, kept after the session ends. That is what the keys show —
// the most recently active chats, running or not — because a chat you closed
// an hour ago is still a chat, still in the sidebar, still what Cmd+N reaches.
// Keying off live processes instead (~/.claude/sessions/<pid>.json) made keys
// go dark one by one as chats ended, which read as a fault.
//
// Liveness still matters for *what a session is doing*: a process that is
// gone cannot be working or waiting on a prompt. So the pid files enrich the
// transcript list rather than filter it.
//
// A snapshot of the last good read is kept in ~/.claude-code-keypad/state.json
// and used if the transcripts cannot be read at all, so the board never blanks
// because a directory was briefly unavailable.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CLAUDE_HOME = path.join(os.homedir(), ".claude");
const SESSIONS = path.join(CLAUDE_HOME, "sessions");
const PROJECTS = path.join(CLAUDE_HOME, "projects");
export const STATE_FILE = path.join(os.homedir(), ".claude-code-keypad", "state.json");

/** How long a mid-turn session may go quiet before we call it stalled. */
export const STALL_MS = 45_000;
/** How long a session stays "recent" before it dims. */
export const STALE_MS = 60 * 60 * 1000;
/** How many transcripts to examine each pass. Only the newest matter. */
export const SCAN_LIMIT = 16;

export const State = {
  working: "working",
  yourTurn: "your-turn",
  stalled: "stalled",
  idle: "idle",
};

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** sessionId → pid record, for every session with a live process. */
export function liveSessions() {
  let entries;
  try { entries = fs.readdirSync(SESSIONS); } catch { return new Map(); }
  const live = new Map();
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    let record;
    try { record = JSON.parse(fs.readFileSync(path.join(SESSIONS, entry), "utf8")); } catch { continue; }
    if (record.pid && record.sessionId && isAlive(record.pid)) live.set(record.sessionId, record);
  }
  return live;
}

/** Every session transcript, newest first. Subagent transcripts are skipped. */
export function transcripts() {
  let projects;
  try { projects = fs.readdirSync(PROJECTS); } catch { return []; }
  const found = [];
  for (const project of projects) {
    const dir = path.join(PROJECTS, project);
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const file of files) {
      if (!file.endsWith(".jsonl") || file.startsWith("agent-")) continue;
      const full = path.join(dir, file);
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.size === 0) continue;
      found.push({ sessionId: file.slice(0, -".jsonl".length), file: full, project, mtimeMs: stat.mtimeMs, size: stat.size });
    }
  }
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
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
    const lines = buffer.toString("utf8").split("\n").slice(size > length ? 1 : 0);
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

const titleOf = (record) => record.customTitle ?? record.aiTitle ?? null;

/** The last title record in a list, custom beating ai when both are present. */
function lastTitle(records) {
  let ai = null;
  let custom = null;
  for (const record of records) {
    if (record.type === "custom-title" && record.customTitle) custom = record.customTitle;
    else if (record.type === "ai-title" && record.aiTitle) ai = record.aiTitle;
  }
  return custom ?? ai;
}

// Titles are written near the start of a transcript and rarely change, so
// once found for a session they are kept. The tail is tried first because it
// is already in hand; a full scan happens at most once per session.
const titleCache = new Map();
function titleFor(sessionId, file, tail) {
  const fromTail = lastTitle(tail);
  if (fromTail) { titleCache.set(sessionId, fromTail); return fromTail; }
  if (titleCache.has(sessionId)) return titleCache.get(sessionId);
  let title = null;
  try {
    const records = [];
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line.includes('-title"')) continue;
      try { records.push(JSON.parse(line)); } catch { /* skip */ }
    }
    title = lastTitle(records);
  } catch { /* unreadable */ }
  titleCache.set(sessionId, title);
  return title;
}

/**
 * Derives a session's state from its transcript tail.
 *
 * `end_turn` is unambiguous: the assistant stopped and is waiting for you.
 * Mid-turn is ambiguous — a session generating and one sitting on a permission
 * prompt look identical on disk — so a mid-turn session quiet for STALL_MS is
 * `stalled`, which in practice is usually a prompt waiting for an answer.
 *
 * `running` is whether a live process backs the session. Without one nothing
 * can be working or waiting on a prompt, whatever the transcript's last line.
 */
export function stateFromRecords(records, { now = Date.now(), fallbackAt = null, running = true } = {}) {
  const own = records.filter((record) => record.isSidechain !== true && (record.type === "assistant" || record.type === "user"));
  const last = own.at(-1) ?? records.at(-1);
  if (!last) return { state: State.idle, since: null };

  const at = Date.parse(last.timestamp ?? "") || fallbackAt;
  if (at === null) return { state: State.idle, since: null };
  const quietFor = now - at;

  if (last.type === "assistant" && last.message?.stop_reason === "end_turn") {
    return { state: quietFor > STALE_MS ? State.idle : State.yourTurn, since: at, quietFor };
  }
  if (!running) return { state: State.idle, since: at, quietFor };
  let state = State.working;
  if (quietFor > STALE_MS) state = State.idle;
  else if (quietFor > STALL_MS) state = State.stalled;
  return { state, since: at, quietFor };
}

// Per-file cache keyed on (mtime, size): an unchanged transcript yields the
// same answer, and most of them are unchanged on any given pass.
const readCache = new Map();

/** Recent sessions with their state, most recently active first. */
export function sessionStatuses({ now = Date.now(), limit = SCAN_LIMIT } = {}) {
  const live = liveSessions();
  const result = [];
  for (const entry of transcripts().slice(0, limit)) {
    const running = live.has(entry.sessionId);
    const key = `${entry.mtimeMs}:${entry.size}:${running}`;
    const cached = readCache.get(entry.file);
    if (cached?.key === key) { result.push({ ...cached.value, quietFor: now - (cached.value.since ?? now) }); continue; }

    const tail = tailRecords(entry.file);
    const derived = stateFromRecords(tail, { now, fallbackAt: entry.mtimeMs, running });
    const pidRecord = live.get(entry.sessionId);
    const title = titleFor(entry.sessionId, entry.file, tail);
    const value = {
      sessionId: entry.sessionId,
      title: title ?? pidRecord?.name ?? entry.project.split("-").filter(Boolean).at(-1),
      titled: title !== null,
      name: pidRecord?.name ?? entry.project.split("-").filter(Boolean).at(-1),
      cwd: pidRecord?.cwd ?? null,
      pid: pidRecord?.pid ?? null,
      running,
      file: entry.file,
      ...derived,
    };
    readCache.set(entry.file, { key, value });
    result.push(value);
  }
  result.sort((a, b) => (b.since ?? 0) - (a.since ?? 0));
  const collapsed = collapseByTitle(result);

  if (collapsed.length) saveSnapshot(collapsed);
  else {
    const snapshot = loadSnapshot();
    if (snapshot.length) return snapshot;
  }
  return collapsed;
}

/**
 * One key per title. A re-opened or forked chat carries the same title as the
 * one it came from, and two keys reading the same name is noise; the most
 * recently active one is the one you would reach for. Untitled sessions fall
 * back to a directory name, which is not identity, so they are never merged.
 */
export function collapseByTitle(sessions) {
  const seen = new Set();
  return sessions.filter((session) => {
    if (!session.titled) return true;
    const key = session.title.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Keeps the last good read so a transient failure does not blank the board. */
function saveSnapshot(sessions) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ at: Date.now(), sessions }, null, 1));
  } catch { /* best effort */ }
}

export function loadSnapshot() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")).sessions ?? [];
  } catch {
    return [];
  }
}

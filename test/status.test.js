import test from "node:test";
import assert from "node:assert/strict";
import { State, stateFromRecords, STALL_MS, STALE_MS } from "../src/sessions.js";
import { slots, mostUrgent, Look, Empty } from "../src/status.js";

const NOW = 1_800_000_000_000;
const at = (msAgo) => new Date(NOW - msAgo).toISOString();
const assistant = (stop, msAgo) => ({ type: "assistant", timestamp: at(msAgo), message: { stop_reason: stop } });

test("a finished turn is yours to answer", () => {
  assert.equal(stateFromRecords([assistant("end_turn", 1000)], { now: NOW }).state, State.yourTurn);
});

test("a finished turn goes quiet after an hour", () => {
  assert.equal(stateFromRecords([assistant("end_turn", STALE_MS + 1)], { now: NOW }).state, State.idle);
});

test("mid-turn is working, then stalled, then just old", () => {
  assert.equal(stateFromRecords([assistant("tool_use", 1000)], { now: NOW }).state, State.working);
  assert.equal(stateFromRecords([assistant("tool_use", STALL_MS + 1)], { now: NOW }).state, State.stalled);
  // A session interrupted yesterday is not something to light up as urgent.
  assert.equal(stateFromRecords([assistant("tool_use", STALE_MS + 1)], { now: NOW }).state, State.idle);
});

test("a subagent's turn is not the session's own state", () => {
  const records = [
    assistant("end_turn", 1000),
    { ...assistant("tool_use", 500), isSidechain: true },
  ];
  assert.equal(stateFromRecords(records, { now: NOW }).state, State.yourTurn);
});

test("an unreadable or empty transcript is idle, not a crash", () => {
  assert.equal(stateFromRecords([], { now: NOW }).state, State.idle);
  assert.equal(stateFromRecords([{ type: "assistant" }], { now: NOW }).state, State.idle);
});

test("every key gets a slot, even with no session behind it", () => {
  const row = slots([{ sessionId: "a", state: State.working }], 6);
  assert.equal(row.length, 6);
  assert.equal(row[0].look, Look[State.working]);
  assert.equal(row[5].look, Empty);
  assert.equal(row[5].session, undefined);
});

test("the board-wide colour is the most urgent state present", () => {
  const of = (...states) => states.map((state) => ({ state }));
  assert.equal(mostUrgent(of(State.idle, State.working, State.stalled)), State.stalled);
  assert.equal(mostUrgent(of(State.idle, State.working)), State.working);
  assert.equal(mostUrgent(of(State.idle, State.yourTurn, State.working)), State.yourTurn);
  assert.equal(mostUrgent([]), undefined);
});

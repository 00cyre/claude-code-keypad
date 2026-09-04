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

test("the login item uses a node path that survives an upgrade", async () => {
  const { stableNodePath } = await import("../src/service.js");
  const fs = await import("node:fs");
  const chosen = stableNodePath();
  // Whatever it picks must be the same binary we are running right now.
  assert.equal(fs.realpathSync(chosen), fs.realpathSync(process.execPath));
  // And on Homebrew it must not be the version-pinned Cellar path.
  if (process.execPath.includes("/Cellar/")) assert.ok(!chosen.includes("/Cellar/"), `still pinned: ${chosen}`);
});

test("the generated AppleScript compiles", async (t) => {
  // A parse error here does not surface until a key is pressed, and then only
  // as a line in a log: `name of ... whose frontmost is true is not "X"` binds
  // the `is true` into the outer comparison and fails at runtime with -1700.
  const { Switcher } = await import("../src/switcher.js");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);

  for (const app of [null, "Claude"]) {
    for (const key of [1, 5, 6]) {
      const script = new Switcher({ app }).scriptFor(key);
      await t.test(`${app ?? "frontmost"} / key ${key}`, async () => {
        await run("osacompile", ["-o", "/dev/null", "-e", script]);
      });
    }
  }
});

test("by default it targets the frontmost app, naming nothing", async () => {
  const { Switcher } = await import("../src/switcher.js");
  const script = new Switcher({}).scriptFor(1);
  assert.match(script, /key code 18 using command down/);
  assert.doesNotMatch(script, /activate/, "should not bring any app forward");
  assert.equal(script.split("\n").length, 1, "one line: press the key");
});

test("the frontmost comparison actually evaluates", async () => {
  // The bug this guards was not a syntax error — the broken script compiled
  // cleanly and failed only when run, with -1700, because
  // `name of ... whose frontmost is true is not "X"` binds the `is true` into
  // the outer comparison. So run the comparison for real. It only reads.
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);

  const { Switcher } = await import("../src/switcher.js");
  const probe = new Switcher({ app: "Finder" }).scriptFor(1)
    .split("\n")
    .filter((line) => !/^tell application "Finder" to activate$/.test(line))
    .filter((line) => !/key code/.test(line))
    .join("\n");

  // Should evaluate without an AppleScript error; the outcome does not matter.
  await run("osascript", ["-e", probe], { timeout: 15_000 });
});

test("every documented flag is accepted by the parser", async () => {
  // --test-switch was documented in --help and rejected by the parser, so the
  // flag printed usage instead of doing anything. Keep the two in step.
  const { parse } = await import("../src/options.js");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { stdout } = await promisify(execFile)(process.execPath, ["bin/cli.js", "--help"]);
  const documented = [...stdout.matchAll(/^\s{2}(--[a-z-]+)/gm)].map((m) => m[1]);
  const sample = {
    "--keys": "4", "--interval": "2000", "--app": "Finder",
    "--layer": "1/1", "--test-switch": "1",
    "--working": "#FFC400", "--needs-you": "#00C853",
    "--your-turn": "#00C853", "--idle": "#2D7FF9",
  };
  assert.ok(documented.length > 5, `only found ${documented.length} flags in --help`);
  for (const flag of documented) {
    assert.doesNotThrow(
      () => parse(flag in sample ? [flag, sample[flag]] : [flag]),
      `--help documents ${flag} but the parser rejects it`,
    );
  }
});

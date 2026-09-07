import test from "node:test";
import assert from "node:assert/strict";
import { appFromArgs, focusDecided, automationTarget, linkedAppFor, appNameFromPath, focusTarget, focusQuestion } from "../src/focus.js";
import { survey } from "../src/layers.js";

const keymap = {
  linkedApps: [
    { id: 0, name: "ChatGPT-mac", process: "com.openai.codex" },
    { id: 1, name: "Claude", process: "com.anthropic.claudefordesktop" },
  ],
  profiles: [{ id: 0, name: "Default", layers: [
    { name: "Claude", linkedAppId: 1, layout: { keymap: [["KV_OAI_AG00"]] } },
    { name: "Codex", linkedAppId: 0, layout: { keymap: [["KV_OAI_AG00"]] } },
    { name: "Loose", layout: { keymap: [["KC_A"]] } },
  ] }],
};
const board = survey(keymap);
const onDisk = { "com.anthropic.claudefordesktop": "/Applications/Claude.app", "com.openai.codex": "/Applications/ChatGPT.app" };
const locate = async (id) => onDisk[id] ?? null;

test("an --app of any kind, or --no-switch, means the question was answered", () => {
  assert.equal(focusDecided(["--layer", "0/0"]), false);
  assert.equal(focusDecided(["--app", "Claude"]), true);
  assert.equal(focusDecided(["--app", "none"]), true);
  assert.equal(focusDecided(["--no-switch"]), true);
  assert.equal(appFromArgs(["--layer", "0/0", "--app", "Claude"]), "Claude");
});

test("the permission check addresses the chosen app, or System Events when there is none", () => {
  assert.equal(automationTarget(["--app", "Claude"]), "Claude");
  assert.equal(automationTarget(["--app", "none"]), "System Events");
  assert.equal(automationTarget([]), "System Events");
});

test("the Input app's link for the chosen layer is what gets offered, by its real name", async () => {
  assert.equal(linkedAppFor(board, "0/0").process, "com.anthropic.claudefordesktop");
  assert.deepEqual(await focusTarget(board, "0/0", { locate }), { name: "Claude", source: "input" });
  // Linked to something other than Claude: still that app, and its on-disk
  // name rather than the Input app's label.
  assert.deepEqual(await focusTarget(board, "0/1", { locate }), { name: "ChatGPT", source: "input" });
});

test("a layer linked to nothing falls back to the Claude desktop app", async () => {
  assert.equal(linkedAppFor(board, "0/2"), null);
  assert.deepEqual(await focusTarget(board, "0/2", { locate }), { name: "Claude", source: "default" });
  assert.equal(await focusTarget(board, "0/2", { locate: async () => null }), null);
});

test("a linked app that is not on disk keeps the label the Input app gave it", async () => {
  assert.deepEqual(await focusTarget(board, "0/1", { locate: async () => null }), { name: "ChatGPT-mac", source: "input" });
});

test("app names come from the bundle on disk", () => {
  assert.equal(appNameFromPath("/Applications/Claude.app"), "Claude");
  assert.equal(appNameFromPath("/Applications/ChatGPT.app\n"), "ChatGPT");
});

test("the question names the app and ends ready for an answer", () => {
  const q = focusQuestion({ name: "Claude", source: "input" });
  assert.match(q, /Bring Claude to the front/);
  assert.match(q, /Input app links this layer to Claude/);
  assert.match(q, /\[Y\/n\] $/);
  assert.match(focusQuestion({ name: "Claude", source: "default" }), /not linked to an app/);
});

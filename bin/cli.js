#!/usr/bin/env node
// Shows Claude Code session status on a Work Louder Creator Micro 2.
import { open, Effect } from "creator-micro-kit";
import { sessionStatuses } from "../src/sessions.js";
import { slots, mostUrgent, threadFor, zoneFor, configure, Empty, DEFAULTS } from "../src/status.js";
import { Switcher } from "../src/switcher.js";
import { survey, explain } from "../src/layers.js";
import { parse, STATE_FLAGS } from "../src/options.js";
import * as service from "../src/service.js";

const raw = process.argv.slice(2);
const command = raw[0] && !raw[0].startsWith("-") ? raw.shift() : null;

function usage() {
  const palette = Object.entries(STATE_FLAGS)
    .map(([flag, state]) => `  ${flag.padEnd(13)} ${DEFAULTS[state].color}  ${state}`)
    .join("\n");
  console.log(`claude-code-keypad — Claude Code session status on your keypad

Usage:
  claude-code-keypad [options]        run in the foreground
  claude-code-keypad install [opts]   install as a login item and start it
  claude-code-keypad uninstall        stop it and remove the login item
  claude-code-keypad status           is it installed and running?
  claude-code-keypad doctor           check the keypad is set up correctly

Options:
  --keys <n>          how many keys to drive (default 6)
  --interval <ms>     repaint interval (default 2000)
  --app <name>        app to focus before the keystroke (default Claude, "none" = frontmost)
  --no-switch         show status only; do not send Cmd+N on a keypress
  --any-layer         drive every layer, not only the Claude-linked one
  --once              paint one frame, print it, and exit
  --test-switch <n>   send the switch keystroke for key n and exit

Colours — each takes a hex value, and also accepts
-effect (${Object.keys(Effect).join("/")}), -brightness (0-1) and -speed (0-1):
${palette}

  e.g.  claude-code-keypad install --working '#FF00AA' --working-effect breath \\
                                   --idle-brightness 0.3

Options given to "install" are baked into the login item, so that is where
to set your defaults.

Only the layer linked to the Claude desktop app is driven; other profiles are
left alone. Run \`doctor\` if nothing lights up.`);
}

if (raw.includes("--help") || raw.includes("-h")) { usage(); process.exit(0); }

let parsed;
try {
  parsed = parse(raw);
} catch (error) {
  console.error(`${error.message}\n`);
  usage();
  process.exit(1);
}
const { options, colors } = parsed;
try {
  configure(colors);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
// Re-import so the module-level palette binding is the configured one.
const { Look } = await import("../src/status.js");

const stamp = () => new Date().toTimeString().slice(0, 8);
const say = (...parts) => console.log(stamp(), ...parts);

/** Reads the keymap off the device and reports whether it can be driven. */
async function inspect() {
  const device = await open();
  try {
    const keymap = JSON.parse((await device.readFile("keymap.json")).toString("utf8"));
    return { survey: survey(keymap), info: device.info };
  } finally {
    await device.close();
  }
}

if (command === "doctor") {
  try {
    const { survey: s, info } = await inspect();
    console.log(`device      : ${info.product} over ${info.transport}`);
    console.log(`claude app  : ${s.apps.map((a) => `${a.name} <${a.process}>`).join(", ") || "not linked"}`);
    console.log(`linked layer: ${s.linked.map(([k, l]) => `${k} ${l.name}`).join(", ") || "none"}`);
    console.log(`drivable    : ${s.drivable.map(([k, l]) => `${k} ${l.name} (${l.agKeys} keys)`).join(", ") || "none"}`);
    const problem = explain(s);
    if (problem) { console.log(`\n${problem}`); process.exit(1); }
    console.log("\n✓ ready");
  } catch (error) {
    console.error(`could not reach the keypad: ${error.message}`);
    process.exit(1);
  }
  process.exit(0);
}

if (command === "install") {
  await service.install(raw);
  // Installing succeeds even when the keypad is not set up — the login item is
  // still correct — but say so plainly rather than leaving them watching a
  // board that will never light.
  try {
    const problem = explain((await inspect()).survey);
    if (problem) {
      console.error(`\n${"─".repeat(68)}`);
      console.error("Installed, but it will not light anything up yet:\n");
      console.error(problem);
      console.error(`\nFix that, then: npx github:00cyre/claude-code-keypad doctor`);
      console.error("─".repeat(68));
      process.exit(1);
    }
    console.log("✓ keypad is set up correctly — the Claude-linked layer will light up.");
  } catch (error) {
    console.error(`\nCould not check the keypad (${error.message}).`);
    console.error("Plug it in and run: npx github:00cyre/claude-code-keypad doctor");
  }
  process.exit(0);
}
if (command === "uninstall") { await service.uninstall(); process.exit(0); }
if (command === "status")    { await service.status();    process.exit(0); }
if (command && command !== "run") {
  console.error(`unknown command: ${command}  (try install, uninstall, status, doctor, run)`);
  process.exit(1);
}

if (raw.includes("--test-switch")) {
  const n = Number(raw[raw.indexOf("--test-switch") + 1]);
  const switcher = new Switcher({ onWarn: console.log, app: options.app === "none" ? null : options.app });
  console.log(`sending the chat-${n} keystroke${options.app === "none" ? "" : ` to ${options.app}`}…`);
  console.log(await switcher.switchTo(n) ? "keystroke sent" : "keystroke failed");
  process.exit(0);
}

const device = await open({ reconnect: true, reconnectDelay: 2000 });
say(`connected to ${device.info.product} over ${device.info.transport}`);

const switcher = new Switcher({
  onWarn: (message) => say(message),
  app: options.app === "none" ? null : options.app,
});

let board = survey(JSON.parse((await device.readFile("keymap.json")).toString("utf8")));
const drivableKeys = () => new Set(
  options.anyLayer
    ? [...board.layers].filter(([, l]) => l.agKeys > 0).map(([k]) => k)
    : board.drivable.map(([k]) => k),
);
let drivable = drivableKeys();
say(`driving: ${[...drivable].map((k) => `${k} ${board.layers.get(k).name}`).join(", ") || "nothing"}`);
const problem = explain(board);
if (problem && !options.anyLayer) console.log(`\n${problem}\n`);

let selected = 0;
let lastSignature = null;
let lastLayer = null;
let painting = null;

async function tick() {
  const status = await device.getStatus();
  const key = `${status.profile_index}/${status.layer_index}`;
  const active = drivable.has(key);

  if (key !== lastLayer) {
    const layer = board.layers.get(key);
    say(active
      ? `on ${key} (${layer?.name}) — driving it`
      : `on ${key} (${layer?.name ?? "?"}) — not the Claude layer, leaving it alone`);
    lastLayer = key;
  }
  // Another profile's lighting is not ours to rewrite.
  if (!active) { painting = false; return; }

  const sessions = sessionStatuses().slice(0, options.keys);
  const row = slots(sessions, options.keys);
  if (!row[selected]?.session) {
    const first = row.findIndex((slot) => slot.session);
    selected = first < 0 ? 0 : first;
  }
  const focus = row[selected]?.look ?? Empty;

  await device.setThreadColors(row.map(({ id, look }) => threadFor(id, look)));
  await device.setZones({ ambient: zoneFor(focus), keys: zoneFor(focus) });

  const signature = row.map(({ session }) => `${session?.sessionId ?? "-"}:${session?.state ?? "-"}`).join("|") + `#${selected}`;
  if (signature !== lastSignature || painting === false) {
    lastSignature = signature;
    console.log(`\n${stamp()} ── keys ──`);
    for (const { id, session, look } of row) {
      const age = session?.quietFor === undefined ? "" : `${(session.quietFor / 60000).toFixed(0)}m`;
      console.log(`  ${id + 1}  ${look.color}  ${look.label.padEnd(9)} ${(session?.name ?? "").padEnd(30)} ${age.padStart(5)} ${id === selected ? "◀ here" : ""}`);
    }
    console.log(`     ring + other keys: ${focus.label} ${focus.color}`);
  }
  painting = true;
}

device.on("key", async ({ key, pressed }) => {
  if (!pressed || !/^AG\d\d$/.test(key ?? "")) return;
  const slot = Number(key.slice(2));
  if (slot >= options.keys) return;
  const session = sessionStatuses()[slot];
  selected = slot;
  say(`key ${slot + 1} → ${session ? `${session.name} (${session.state})` : "no session"}`);
  tick().catch(() => {});
  if (options.switching) await switcher.switchTo(slot + 1);
});

let stopping = false;
device.on("close", () => { if (!stopping) say("device dropped, reconnecting…"); });
device.on("reconnect", async () => {
  lastLayer = null;
  // The keymap can change while we are away — the Input app rewrites it.
  try {
    board = survey(JSON.parse((await device.readFile("keymap.json")).toString("utf8")));
    drivable = drivableKeys();
  } catch { /* keep the previous survey */ }
  say("reconnected");
});

await tick();
if (options.once) { stopping = true; await device.close(); process.exit(0); }

const timer = setInterval(() => tick().catch((error) => say(`tick failed: ${error.message}`)), options.interval);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    stopping = true;
    clearInterval(timer);
    if (painting) {
      say("clearing keys");
      const off = { effect: Effect.off, brightness: 0, speed: 0, color: "#000000", magic: 1 };
      await device.setThreadColors(Array.from({ length: options.keys }, (_, id) => threadFor(id, Empty))).catch(() => {});
      await device.setZones({ ambient: off, keys: off }).catch(() => {});
    }
    await device.close();
    process.exit(0);
  });
}

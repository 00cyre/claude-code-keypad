#!/usr/bin/env node
// Shows Claude Code session status on a Work Louder Creator Micro 2.
import { open, Effect } from "creator-micro-kit";
import { sessionStatuses } from "../src/sessions.js";
import { slots, mostUrgent, threadFor, zoneFor, configure, Empty, DEFAULTS } from "../src/status.js";
import { Switcher } from "../src/switcher.js";
import { survey, explain } from "../src/layers.js";
import { parse, STATE_FLAGS } from "../src/options.js";
import * as service from "../src/service.js";
import * as permissions from "../src/permissions.js";

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
  claude-code-keypad permissions      check macOS grants (--fix opens Settings)

Install asks macOS for anything missing automatically; --no-prompt skips that.

Options:
  --keys <n>          how many keys to drive (default 6)
  --interval <ms>     repaint interval (default 2000)
  --app <name>        bring this app forward before the keystroke
                      (default: send to whatever is already frontmost)
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

/**
 * Reads the keymap off the device and reports whether it can be driven.
 *
 * Retries, because the running service is talking to the same device: the
 * keypad takes one request at a time per channel, and an 8KB file read is long
 * enough to collide with a two-second poll. Losing that race is normal and not
 * worth reporting as a fault.
 */
async function inspect({ attempts = 4 } = {}) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const device = await open();
    try {
      const keymap = JSON.parse((await device.readFile("keymap.json")).toString("utf8"));
      return { survey: survey(keymap), info: device.info };
    } catch (error) {
      last = error;
    } finally {
      await device.close();
    }
    if (attempt < attempts) await new Promise((r) => setTimeout(r, 400 * attempt));
  }
  throw last;
}

if (command === "permissions") {
  const { text, ok } = await permissions.report({
    app: options.app && options.app !== "none" ? options.app : "System Events",
    nodePath: service.stableNodePath(),
    fix: raw.includes("--fix"),
  });
  console.log(text);
  process.exit(ok ? 0 : 1);
}

if (command === "doctor") {
  try {
    // The running service holds the device; borrow it for the length of the check.
    const { survey: s, info } = await service.withServicePaused(() => inspect());
    console.log(`device      : ${info.product} over ${info.transport}`);
    console.log(`claude app  : ${s.apps.map((a) => `${a.name} <${a.process}>`).join(", ") || "not linked"}`);
    console.log(`linked layer: ${s.linked.map(([k, l]) => `${k} ${l.name}`).join(", ") || "none"}`);
    console.log(`drivable    : ${s.drivable.map(([k, l]) => `${k} ${l.name} (${l.agKeys} keys)`).join(", ") || "none"}`);
    const problem = explain(s);
    if (problem) console.log(`\n${problem}`);
    const grants = await permissions.report({
      app: options.app && options.app !== "none" ? options.app : "System Events",
      nodePath: service.stableNodePath(),
    });
    console.log(`\n${grants.text}`);
    if (problem || !grants.ok) process.exit(1);
    console.log("\n✓ ready");
  } catch (error) {
    console.error(`could not reach the keypad: ${error.message}`);
    process.exit(1);
  }
  process.exit(0);
}

/**
 * Asks which layer to drive, when the keymap does not say.
 *
 * Lists every layer, not only the ones already able to show colour. A layer
 * without KV_OAI_AG keycodes is a layer you have not finished setting up yet,
 * not one you are forbidden to choose — hiding it just leaves you wondering
 * where your layer went.
 */
async function chooseLayer(board) {
  const all = [...board.layers];
  if (!all.length) return null;
  const describe = ([key, l]) => {
    const bits = [`${key}`.padEnd(5), (l.name ?? "?").padEnd(12)];
    bits.push(l.agKeys > 0 ? `${l.agKeys} keys ready` : "needs KV_OAI_AG keycodes");
    if (l.linked) bits.push("· linked to Claude");
    return bits.join(" ");
  };

  if (!process.stdin.isTTY) {
    console.error("\nNo layer is linked to the Claude app. Re-run with --layer, e.g.");
    console.error(`  --layer ${(all.find(([, l]) => l.agKeys > 0) ?? all[0])[0]}`);
    console.error("\nLayers on this keypad:");
    for (const entry of all) console.error(`  ${describe(entry)}`);
    return null;
  }

  console.log("\nNo layer is linked to the Claude desktop app, so pick one:\n");
  all.forEach((entry, i) => console.log(`  ${i + 1}) ${describe(entry)}`));
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = (await rl.question(`\nWhich one? [1-${all.length}, or Enter to skip] `)).trim();
      if (!answer) return null;
      const n = Number(answer);
      if (Number.isInteger(n) && n >= 1 && n <= all.length) {
        const [key, layer] = all[n - 1];
        if (!layer.agKeys) {
          console.log(`\nNote: ${key} (${layer.name}) has no KV_OAI_AG keycodes yet, so it`);
          console.log("cannot show colour until you map its keys to KV_OAI_AG00 … KV_OAI_AG05");
          console.log("in the Input app. Pinning it anyway — it will light up once you do.");
        }
        return key;
      }
      console.log("Please give a number from the list.");
    }
  } finally {
    rl.close();
  }
}

if (command === "install") {
  const args = [...raw];
  let board = null;
  try {
    board = (await inspect()).survey;
  } catch (error) {
    console.error(`Could not read the keypad (${error.message}) — installing anyway.`);
  }

  // Prefer the app link; otherwise let them pick, rather than refusing.
  if (board && !options.layer && !board.drivable.length) {
    const picked = await chooseLayer(board);
    if (picked) { args.push("--layer", picked); console.log(`\nusing layer ${picked}`); }
  }

  await service.install(args);

  const grants = await permissions.report({
    app: options.app && options.app !== "none" ? options.app : "System Events",
    nodePath: service.stableNodePath(),
  });
  if (!grants.ok) {
    console.error(`\n${"─".repeat(68)}`);
    console.error("Chat switching will not work until macOS is told to allow it:\n");
    console.error(grants.text);
    console.error("\nRun this once you have done it:  claude-code-keypad permissions");
    console.error("─".repeat(68));
    if (!raw.includes("--no-prompt")) {
      await permissions.requestMissing(grants);
      console.error("\nOpened the System Settings pane and asked macOS for the grant.");
      console.error("Add the binary above, then the login item picks it up on its own.");
    }
  } else {
    console.log("✓ macOS permissions are in place — keys will switch chats.");
  }

  if (board) {
    const pinned = options.layer || args[args.indexOf("--layer") + 1];
    if (board.drivable.length || pinned) {
      console.log(`✓ will drive ${board.drivable[0]?.[0] ?? pinned}${board.drivable.length ? " (linked to Claude)" : " (pinned)"}.`);
    } else {
      console.error(`\n${"─".repeat(68)}`);
      console.error("Installed, but nothing will light up yet:\n");
      console.error(explain(board));
      console.error("\nThen either link that layer to Claude in the Input app, or re-run");
      console.error("install and pick the layer when prompted.");
      console.error("─".repeat(68));
      process.exit(1);
    }
  }
  process.exit(0);
}
if (command === "uninstall") { await service.uninstall(); process.exit(0); }
if (command === "status")    { await service.status();    process.exit(0); }
if (command && command !== "run") {
  console.error(`unknown command: ${command}  (try install, uninstall, status, doctor, run)`);
  process.exit(1);
}

if (options.testSwitch !== null && options.testSwitch !== undefined) {
  const n = options.testSwitch;
  const switcher = new Switcher({ onWarn: console.log, app: options.app === "none" ? null : options.app });
  console.log(`sending the chat-${n} keystroke${options.app === "none" ? "" : ` to ${options.app}`}…`);
  console.log(await switcher.switchTo(n) ? "keystroke sent" : "keystroke failed");
  process.exit(0);
}

const device = await open({ reconnect: true, reconnectDelay: 2000 });
say(`connected to ${device.info.product} over ${device.info.transport}`);

const switcher = new Switcher({
  onWarn: (message) => say(message),
  app: options.app && options.app !== "none" ? options.app : null,
});

if (options.switching) {
  const grants = await permissions.report({
    app: options.app && options.app !== "none" ? options.app : "System Events",
    nodePath: process.execPath,
  });
  say(`permissions: accessibility ${grants.accessibility ? "ok" : "MISSING"}, automation ${grants.automation ? "ok" : "MISSING"}`);
  if (!grants.ok) {
    console.log(`\n${grants.text}\n`);
    // The daemon is the process that actually needs the grant, so asking from
    // here is what puts the right name in the system's dialog. Once only.
    if (!permissions.alreadyAsked()) {
      say("asking macOS for the missing permission…");
      await permissions.requestMissing(grants);
    }
  }
}

let board = survey(JSON.parse((await device.readFile("keymap.json")).toString("utf8")));

/**
 * Which layer this is for. A pinned --layer wins; otherwise the layer linked
 * to the Claude app. This is reported, not enforced: the firmware only paints
 * KV_OAI_AG keys, which exist on that layer alone, so sending colours while
 * another layer is up is harmless and means the board is already right the
 * moment you switch back. Gating on the *active* layer just meant a dark board
 * whenever the device reported an index the keymap did not describe.
 */
function target() {
  if (options.layer) return [options.layer, board.layers.get(options.layer)];
  return board.drivable[0] ?? board.linked[0] ?? null;
}
const chosen = target();
if (chosen) say(`for layer ${chosen[0]}${chosen[1]?.name ? ` (${chosen[1].name})` : ""}`);
else {
  const problem = explain(board);
  console.log(`\n${problem}\n`);
  console.log("Or pin one yourself, e.g.  --layer 1/1   (see: claude-code-keypad doctor)\n");
}

let selected = 0;
let lastSignature = null;
let lastLayer = null;
let painting = null;

async function tick() {
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
  if (signature !== lastSignature) {
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
    {
      say("clearing keys");
      const off = { effect: Effect.off, brightness: 0, speed: 0, color: "#000000", magic: 1 };
      await device.setThreadColors(Array.from({ length: options.keys }, (_, id) => threadFor(id, Empty))).catch(() => {});
      await device.setZones({ ambient: off, keys: off }).catch(() => {});
    }
    await device.close();
    process.exit(0);
  });
}

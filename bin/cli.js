#!/usr/bin/env node
// Shows Claude Code session status on a Work Louder Creator Micro 2.
import { open, Effect } from "creator-micro-kit";
import { sessionStatuses } from "../src/sessions.js";
import { slots, mostUrgent, threadFor, zoneFor, Look, Empty } from "../src/status.js";
import { Switcher } from "../src/switcher.js";
import * as service from "../src/service.js";

const argv = process.argv.slice(2);
// Subcommands run and exit; everything else falls through to the daemon.
const command = argv[0] && !argv[0].startsWith("-") ? argv.shift() : null;
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const options = {
  keys: Number(value("--keys", 6)),
  interval: Number(value("--interval", 2000)),
  app: value("--app", "Claude"),
  switching: !argv.includes("--no-switch"),
  once: argv.includes("--once"),
};

if (command === "install")   { await service.install(argv); process.exit(0); }
if (command === "uninstall") { await service.uninstall();     process.exit(0); }
if (command === "status")    { await service.status();        process.exit(0); }
if (command && command !== "run") {
  console.error(`unknown command: ${command}  (try install, uninstall, status, run)`);
  process.exit(1);
}

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`claude-code-keypad — Claude Code session status on your keypad

Usage:
  claude-code-keypad [options]        run in the foreground
  claude-code-keypad install [opts]   install as a login item and start it
  claude-code-keypad uninstall        stop it and remove the login item
  claude-code-keypad status           is it installed and running?

Options:

  --keys <n>          how many keys to drive (default 6)
  --interval <ms>     repaint interval (default 2000)
  --app <name>        app to focus before the keystroke (default Claude, "none" = frontmost)
  --no-switch         show status only; do not send Cmd+N on a keypress
  --once              paint one frame, print it, and exit
  --test-switch <n>   send the switch keystroke for key n and exit

Keys 1-N are the most recently active sessions:
  pulsing blue working · amber needs you · green your turn · dim idle · off none

The ambient ring and every other key follow the *selected* session, so the
board tells you which chat you are in as well as what the others are doing.`);
  process.exit(0);
}

if (argv.includes("--test-switch")) {
  const n = Number(value("--test-switch", 1));
  const switcher = new Switcher({ onWarn: console.log, app: options.app === "none" ? null : options.app });
  console.log(`sending the chat-${n} keystroke${options.app === "none" ? "" : ` to ${options.app}`}…`);
  console.log(await switcher.switchTo(n) ? "keystroke sent" : "keystroke failed");
  process.exit(0);
}

const stamp = () => new Date().toTimeString().slice(0, 8);
const say = (...parts) => console.log(stamp(), ...parts);

const device = await open({ reconnect: true, reconnectDelay: 2000 });
say(`connected to ${device.info.product} over ${device.info.transport}`);

const switcher = new Switcher({
  onWarn: (message) => say(message),
  app: options.app === "none" ? null : options.app,
});

// Which layers can show per-key colour. Measured behaviour: the firmware
// paints thread id N onto the key carrying KV_OAI_AG{N}, so a layer is only
// useful here if it maps at least one of them.
const keymap = JSON.parse((await device.readFile("keymap.json")).toString("utf8"));
const layers = new Map();
for (const profile of keymap.profiles) {
  profile.layers.forEach((layer, index) => {
    const codes = layer.layout.keymap.flat();
    layers.set(`${profile.id}/${index}`, {
      name: layer.name,
      agKeys: codes.filter((code) => /^KV_OAI_AG\d\d$/.test(code)).length,
    });
  });
}
const usable = [...layers.entries()].filter(([, l]) => l.agKeys > 0);
say(`layers that can show per-key colour: ${usable.map(([k, l]) => `${k} ${l.name} (${l.agKeys})`).join(", ") || "none"}`);

// Which session the board as a whole reflects. Pressing a key selects it,
// because pressing a key is what switches to it.
let selected = 0;
let lastSignature = null;
let lastLayer = null;

async function tick() {
  const sessions = sessionStatuses().slice(0, options.keys);
  const row = slots(sessions, options.keys);
  if (selected >= row.length || !row[selected]?.session) {
    selected = row.findIndex((slot) => slot.session);
    if (selected < 0) selected = 0;
  }
  const focus = row[selected]?.look ?? Empty;

  await device.setThreadColors(row.map(({ id, look }) => threadFor(id, look)));
  // The ring, and any key no session has claimed, follow the selected session.
  await device.setZones({ ambient: zoneFor(focus), keys: zoneFor(focus) });

  const signature = row.map(({ session }) => `${session?.sessionId ?? "-"}:${session?.state ?? "-"}`).join("|") + `#${selected}`;
  if (signature !== lastSignature) {
    lastSignature = signature;
    console.log(`\n${stamp()} ── keys ──`);
    for (const { id, session, look } of row) {
      const age = session?.quietFor === undefined ? "" : `${(session.quietFor / 60000).toFixed(0)}m`;
      const here = id === selected ? "◀ here" : "";
      console.log(`  ${id + 1}  ${look.color}  ${look.label.padEnd(9)} ${(session?.name ?? "").padEnd(30)} ${age.padStart(5)} ${here}`);
    }
    console.log(`     ring + other keys: ${focus.label} ${focus.color}`);
  }

  const status = await device.getStatus();
  const key = `${status.profile_index}/${status.layer_index}`;
  const layer = layers.get(key);
  if (!layer?.agKeys) {
    // lights.preview works on any layer, so show the most urgent state rather
    // than nothing. Board-wide is a downgrade, not a substitute.
    const worst = mostUrgent(sessions);
    const look = worst ? Look[worst] : Empty;
    const side = { effect: look.effect, color: look.color, brightness: look.brightness, speed: look.speed };
    await device.previewLighting({ backlight: side, underglow: side });
    if (key !== lastLayer) say(`layer ${key} (${layer?.name ?? "?"}) has no KV_OAI_AG keys — whole board = ${look.label}`);
  } else if (key !== lastLayer) {
    say(`on layer ${key} (${layer.name}) — per-key colours showing`);
  }
  lastLayer = key;
}

device.on("key", async ({ key, pressed }) => {
  if (!pressed || !/^AG\d\d$/.test(key ?? "")) return;
  const slot = Number(key.slice(2));
  if (slot >= options.keys) return;
  const session = sessionStatuses()[slot];
  selected = slot;
  say(`key ${slot + 1} → ${session ? `${session.name} (${session.state})` : "no session"}`);
  tick().catch(() => {});          // reflect the new selection straight away
  if (options.switching) await switcher.switchTo(slot + 1);
});

let stopping = false;
device.on("close", () => { if (!stopping) say("device dropped, reconnecting…"); });
device.on("reconnect", () => { lastLayer = null; say("reconnected"); });

await tick();
if (options.once) { stopping = true; await device.close(); process.exit(0); }

const timer = setInterval(() => tick().catch((error) => say(`tick failed: ${error.message}`)), options.interval);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    stopping = true;
    clearInterval(timer);
    say("clearing keys");
    const off = { effect: Effect.off, brightness: 0, speed: 0, color: "#000000", magic: 1 };
    await device.setThreadColors(Array.from({ length: options.keys }, (_, id) => threadFor(id, Empty))).catch(() => {});
    await device.setZones({ ambient: off, keys: off }).catch(() => {});
    await device.close();
    process.exit(0);
  });
}

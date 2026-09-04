#!/usr/bin/env node
// Shows Claude Code session status on a Work Louder Creator Micro 2.
import { open, Effect } from "creator-micro-kit";
import { sessionStatuses } from "../src/sessions.js";
import { slots, mostUrgent, Look, Empty } from "../src/status.js";
import { Switcher } from "../src/switcher.js";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : Number(argv[i + 1]);
};
const options = {
  keys: flag("--keys", 6),
  interval: flag("--interval", 2000),
  switching: !argv.includes("--no-switch"),
  once: argv.includes("--once"),
};

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`claude-code-keypad — Claude Code session status on your keypad

Usage: claude-code-keypad [options]

  --keys <n>       how many keys to drive (default 6)
  --interval <ms>  repaint interval (default 2000)
  --no-switch      show status only; do not send Cmd+N on a keypress
  --app <name>     app to focus before the keystroke (default Claude, "none" = frontmost)
  --test-switch <n>  send the switch keystroke for key n and exit
  --once           print what it would show, paint once, and exit

Keys show the most recently active sessions, newest first:
  blue working · amber needs you · green your turn · dim idle · off no session

Per-key colour needs those keys mapped to KV_OAI_AG00..AG05 in the Input app.
This tells you if the layer you are on cannot show them.`);
  process.exit(0);
}

const stamp = () => new Date().toTimeString().slice(0, 8);
const say = (...parts) => console.log(stamp(), ...parts);

if (argv.includes("--test-switch")) {
  const n = Number(argv[argv.indexOf("--test-switch") + 1]);
  const app = argv.includes("--app") ? argv[argv.indexOf("--app") + 1] : "Claude";
  const s = new Switcher({ onWarn: (m) => console.log(m), app: app === "none" ? null : app });
  console.log(`sending the chat-${n} keystroke${app === "none" ? "" : ` to ${app}`}…`);
  console.log(await s.switchTo(n) ? "keystroke sent" : "keystroke failed");
  process.exit(0);
}

const device = await open({ reconnect: true, reconnectDelay: 2000 });
say(`connected to ${device.info.product} over ${device.info.transport}`);

const targetApp = argv.includes("--app") ? argv[argv.indexOf("--app") + 1] : "Claude";
const switcher = new Switcher({ onWarn: (message) => say(message), app: targetApp === "none" ? null : targetApp });

// Which layers can actually show per-key colour. Measured behaviour: the
// firmware paints thread id N onto the key carrying KV_OAI_AG{N}, so a layer
// is only useful here if it maps at least one of them.
const keymap = JSON.parse((await device.readFile("keymap.json")).toString("utf8"));
const layers = new Map();
for (const profile of keymap.profiles) {
  profile.layers.forEach((layer, index) => {
    const codes = layer.layout.keymap.flat();
    const agKeys = codes.filter((code) => /^KV_OAI_AG\d\d$/.test(code)).length;
    layers.set(`${profile.id}/${index}`, { name: layer.name, agKeys });
  });
}
const usable = [...layers.entries()].filter(([, l]) => l.agKeys > 0);
say(`layers that can show per-key colour: ${usable.map(([k, l]) => `${k} ${l.name} (${l.agKeys} keys)`).join(", ") || "none"}`);
if (!usable.length) {
  say("No layer maps KV_OAI_AG* keycodes, so nothing can be coloured per key.");
  say("Map the keys you want lit to KV_OAI_AG00..AG05 in the Input app.");
}

let lastSignature = null;
let lastLayer = null;
let lastAggregate = null;

async function tick() {
  const sessions = sessionStatuses().slice(0, options.keys);
  const row = slots(sessions, options.keys);

  // Omitted fields keep their previous value on the device, and after a power
  // cycle that value is zero — so always send brightness and effect too.
  await device.setThreadColors(
    row.map(({ id, look }) => ({ id, color: look.color, brightness: look.brightness, effect: Effect.solid })),
  );

  const signature = row.map(({ session }) => `${session?.sessionId ?? "-"}:${session?.state ?? "-"}`).join("|");
  if (signature !== lastSignature) {
    lastSignature = signature;
    console.log(`\n${stamp()} ── keys ──`);
    for (const { id, session, look } of row) {
      const age = session?.quietFor === undefined ? "" : `${(session.quietFor / 60000).toFixed(0)}m`;
      console.log(`  ${id + 1}  ${look.color}  ${look.label.padEnd(9)} ${(session?.name ?? "").padEnd(30)} ${age}`);
    }
  }

  const status = await device.getStatus();
  const key = `${status.profile_index}/${status.layer_index}`;
  const layer = layers.get(key);
  if (!layer?.agKeys) {
    // lights.preview works on any layer, so show the single most urgent state
    // rather than nothing. Board-wide is a downgrade, not a substitute.
    const worst = mostUrgent(sessions);
    const look = worst ? Look[worst] : Empty;
    const side = { effect: Effect.solid, color: look.color, brightness: look.brightness, speed: 0 };
    await device.previewLighting({ backlight: side, underglow: side });
    if (key !== lastLayer || worst !== lastAggregate) {
      lastAggregate = worst;
      say(`layer ${key} (${layer?.name ?? "?"}) has no KV_OAI_AG keys — whole board = ${look.label}`);
    }
  } else if (key !== lastLayer) {
    say(`on layer ${key} (${layer.name}) — per-key colours showing`);
  }
  lastLayer = key;
}

device.on("key", async ({ key, pressed }) => {
  if (!pressed || !/^AG\d\d$/.test(key ?? "")) return;
  const slot = Number(key.slice(2));
  const session = sessionStatuses()[slot];
  say(`key ${slot + 1} → ${session ? `${session.name} (${session.state})` : "no session"}`);
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
    await device.setThreadColors(
      Array.from({ length: options.keys }, (_, id) => ({ id, color: "#000000", brightness: 0, effect: Effect.off })),
    ).catch(() => {});
    await device.close();
    process.exit(0);
  });
}

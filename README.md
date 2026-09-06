# claude-code-keypad

Live Claude Code session status on the keys of a [Work Louder Creator Micro 2](https://worklouder.cc).

Each key is one of your running sessions, coloured by what it is doing. Press a key to jump to that chat.

## Setting it up with an agent

Paste this to Claude Code, or any agent with shell access, and it will do the
whole thing:

```
Set up my Work Louder Creator Micro 2 to show Claude Code session status on its keys.

Run: npx github:00cyre/claude-code-keypad install

It will ask which layer to use and map that layer's keycodes itself. Before you
answer, tell me which layer you are picking and which of my existing macros it
will unbind — it prints both. Do not pass --yes; I want to see the plan.

If anything fails, run `npx github:00cyre/claude-code-keypad doctor` and tell me
what it says rather than guessing.
```

It backs the keymap up to `~/.claude-code-keypad/backups/` before changing
anything, and prints the path.

## Install

One command. It fetches the package, compiles the native HID bridge, installs a
login item, and starts it:

```sh
npx github:00cyre/claude-code-keypad install
```

That is the whole setup — it runs from now on, comes back at login, and restarts
if it crashes.

```sh
npx github:00cyre/claude-code-keypad status      # running? up to date?
npx github:00cyre/claude-code-keypad update      # fetch the latest, same options
npx github:00cyre/claude-code-keypad uninstall   # stop it, remove the login item
```

**It does not update itself.** `install` puts a frozen copy in
`~/.claude-code-keypad`, and that is what runs until you say otherwise. `status`
checks GitHub and tells you when a newer commit exists; `update` reinstalls
with exactly the options you installed with, so a `--layer` or colour you chose
is not lost. Each machine is separate — updating one does nothing to another.

Options after `install` are baked into the login item, so that is where to set
your defaults:

```sh
npx github:00cyre/claude-code-keypad install --working '#FF00AA' --idle-brightness 0.3
```

### Colours

Each state takes a hex colour, and also `-effect`, `-brightness` and `-speed`:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--working` | `#FFC400` pulsing | assistant is mid-turn |
| `--needs-you` | `#00C853` | mid-turn but quiet — usually a prompt |
| `--your-turn` | `#00C853` | finished, waiting on you |
| `--idle` | `#2D7FF9` | nothing for an hour |

`--working-effect` takes `off`, `solid`, `snake`, `rainbow`, `breath`,
`gradient` or `shallow_breath`; `--working-brightness` and `--working-speed`
take 0-1. The same suffixes work on every state flag.

A bad colour or effect fails at startup with a message rather than being
ignored, so a typo in a login item does not leave you guessing.

**A note on blue.** These keys use separate red/green/blue emitters behind a
diffuser rather than one mixed source, so a saturated blue reads closer to
white than you would expect. That is fine for `--idle`, which is meant to
recede, but pick something else if you want blue to *mean* something.

To run it in the foreground instead, without installing anything:

```sh
npx github:00cyre/claude-code-keypad
```

`install` deliberately puts its own copy in `~/.claude-code-keypad` rather than
pointing the login item at wherever `npx` happened to unpack it — npm is free to
prune that cache, and an agent pointing into it would work right up until it
didn't. Logs go to `~/Library/Logs/claude-code-keypad.log`.

Device I/O comes from [creator-micro-kit](https://github.com/00cyre/creator-micro-kit); this package is only the Claude Code half.

## Requirements

One layer needs keys mapped to `KV_OAI_AG00` … `KV_OAI_AG05` — without those
keycodes the firmware will not colour individual keys at all. **`install` maps
them for you**; you do not need to do anything in the Input app.

It shows every layer and asks which one is Claude's, using the Input
app's numbering, with the detected one as the default:

```
  1) profile 1, layer 1 "Layer 1"  [0/0]  needs KV_OAI_AG keycodes
  2) profile 2, layer 1 "Codex"    [1/0]  6 keys ready
  3) profile 2, layer 2 "Claude"   [1/1]  6 keys ready · linked to Claude · detected
```

`--layer 1/1` pins one without being asked; `--yes` skips the confirmation.

If the layer you choose does not have the keycodes, it maps them: it backs the
keymap up to `~/.claude-code-keypad/backups/`, prints exactly which keys change
and which macros stop working, quits the Input app for the write (the device
takes one byte stream, and two writers corrupt each other), writes, verifies
against the device's own checksum, and reopens the app.

Restoring is one command:

```sh
npx creator-micro-kit push keymap.json ~/.claude-code-keypad/backups/keymap-….json
```

`doctor` reports what it found.

### Colours are device-wide, not per layer

Worth knowing before you wonder why your Codex layer lit up too. The firmware's
`v.oai.thstatus` takes `id, color, brightness, effect, speed, syncKeysLighting,
syncAmbientLighting` — and **no layer or profile field**. Thread colours belong
to the device, so *every* layer carrying `KV_OAI_AG` keycodes shows the same
ones. Choosing a layer cannot scope them, because the firmware has nowhere to
put that.

What it can do is decide when to send at all:

```sh
claude-code-keypad install --only-on-layer
```

With that, colours go out only while the chosen layer is up, so your other
`KV_OAI_AG` layers keep whatever put them there — the ChatGPT integration, for
instance, which writes to the same thread state and will otherwise fight this
for it.

Without it, colours are sent continuously. You do not have to be on the layer,
and the board is already right the moment you switch to it.

## Mapping the keys

Per-key colour is not something a host can simply ask for. The firmware paints thread `id` N onto **the key carrying the `KV_OAI_AG{N}` keycode**, and nothing else — measured, not assumed:

| Layer under test | Result |
| --- | --- |
| `KV_OAI_AG00`–`AG05` on keys 1-6 | keys 1-6 take the host's colours |
| a single `KV_OAI_ACT06` on one key | **nothing paints** |

So one vendor keycode somewhere on a layer buys nothing, and there is no per-layer switch to flip. In the Input app, map each key you want lit to `KV_OAI_AG00` … `KV_OAI_AG05`.

**Those keycodes send no keystroke of their own.** That is exactly why the firmware is willing to colour them — and it means a key is either a macro or individually addressable, never both. If those keys used to run macros, this replaces them: it catches the keypress and sends `Cmd+N` itself.

On a layer with no `KV_OAI_AG*` keys, per-key colour is impossible, so it falls back to `lights.preview` — which works on any layer — and shows the single most urgent state across the whole board. That is a downgrade, not a substitute, and it says so on the way past.

### Going back

The macro *definitions* are untouched by remapping a key — they stay in the
keymap, just unbound. To undo this, point those six keys back at the macros in
the Input app; nothing needs to be recreated.

Back the keymap up before changing it, either from the Input app or with the
kit's CLI, which reads it straight off the device:

```sh
npx creator-micro-kit pull keymap.json ./keymap.backup.json
npx creator-micro-kit push keymap.json ./keymap.backup.json   # to restore
```

`push` verifies the device's own SHA-1 after writing and fails loudly on a
mismatch. Quit the Input app first — the device takes one byte stream and two
writers corrupt each other. Reopening Input afterwards does not overwrite the
result.

## Accessibility permission

Sending `Cmd+N` needs Accessibility permission for whatever runs this — Terminal, iTerm, or `node` itself — in **System Settings › Privacy & Security › Accessibility**. Without it the keys still show status; they just do not switch chats, and you get one line saying so rather than silent failure.

Run with `--no-switch` if you only want the lights.

## Where the status comes from

The transcript. Every session writes one to `~/.claude/projects/<cwd>/<id>.jsonl`,
and it stays after the session ends — so the keys show the most recently active
chats whether or not a process is still behind them. A chat you closed an hour
ago is still a chat, still in the sidebar, still what `Cmd+N` reaches. (An
earlier version keyed off live processes instead, and keys went dark one by one
as chats ended, which reads as a fault.)

Two things are read from each transcript:

- **the title**, from its `custom-title` or `ai-title` records — the same name
  the sidebar shows, a custom one winning
- **the state**, from the last assistant or user record. `stop_reason` is the
  signal: `end_turn` means the assistant stopped and it is your move; anything
  else means mid-turn

Whether a live process backs the session comes from `~/.claude/sessions/<pid>.json`,
checked with signal 0. Without one nothing can be working or waiting on a
prompt, whatever the transcript's last line says, so those sessions read as
idle or your-turn only.

Two thresholds make it readable at a glance: a mid-turn session quiet for
**45s** becomes `needs you` (on disk, generating and sitting on a permission
prompt are indistinguishable — the silence is the only clue), and anything
quiet for over **an hour** becomes `idle`.

Only the tail of each file is read, since they grow to megabytes, and unchanged
files are not re-read. The last good result is snapshotted to
`~/.claude-code-keypad/state.json` and used if the transcripts cannot be read at
all, so a briefly unavailable directory does not blank the board.

## Options

```
claude-code-keypad [--keys 6] [--interval 2000] [--product-id 0x8298] [--no-switch] [--once]
```

`--once` paints a single frame and exits, which is the quick way to see what it would show.

`--product-id` says which keypad to open. It defaults to the Creator Micro 2
(`0x8298`), so a Codex Micro on the same Mac is left alone — without the
filter the bridge takes the first Work Louder device it finds, which means
this would seize the Codex Micro whenever the Creator Micro 2 drops off
Bluetooth and paint Claude colours over the Codex ones. Pass `any` for the
old behaviour, or another id if your keypad reports a different one
(`npx creator-micro-kit devices` lists them).

## License

MIT

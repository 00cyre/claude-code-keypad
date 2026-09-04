# claude-code-keypad

Live Claude Code session status on the keys of a [Work Louder Creator Micro 2](https://worklouder.cc).

Each key is one of your running sessions, coloured by what it is doing. Press a key to jump to that chat.

## Setting it up with an agent

Paste this to Claude Code, or any agent with shell access, and it will do the
whole thing:

```
Set up my Work Louder Creator Micro 2 to show Claude Code session status on its keys.

1. Run: npx github:00cyre/claude-code-keypad doctor
2. If it reports a problem, tell me exactly what to click in the Work Louder
   Input app to fix it. Two things are needed: a layer linked to the Claude
   desktop app, and that layer's keys mapped to KV_OAI_AG00..KV_OAI_AG05.
   Wait for me to do it, then run doctor again.
3. Once doctor passes, run: npx github:00cyre/claude-code-keypad install
4. Confirm with: npx github:00cyre/claude-code-keypad status

Before changing anything on the device, back up my keymap with
`npx creator-micro-kit pull keymap.json ./keymap.backup.json` and tell me the
checksum. Quit the Input app before any write to the device — two writers
corrupt each other. Note that KV_OAI_AG keycodes send no keystroke of their
own, so any macros on those keys stop working from the device; the daemon
sends Cmd+N instead. Tell me which macros that affects before you do it.
```

| Colour | Meaning |
| --- | --- |
| pulsing yellow | working — the assistant is mid-turn |
| green | waiting on you — it has stopped and wants a reply |
| blue | away — nothing for an hour |
| off | no session for that key |

## Install

One command. It fetches the package, compiles the native HID bridge, installs a
login item, and starts it:

```sh
npx github:00cyre/claude-code-keypad install
```

That is the whole setup — it runs from now on, comes back at login, and restarts
if it crashes.

```sh
npx github:00cyre/claude-code-keypad status      # is it running?
npx github:00cyre/claude-code-keypad uninstall   # stop it, remove the login item
```

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

One layer needs keys mapped to `KV_OAI_AG00` … `KV_OAI_AG05`. Without those
keycodes the firmware will not colour individual keys at all.

Which layer to drive is worked out in this order:

1. `--layer <profile>/<index>` if you pass one
2. the layer linked to the Claude desktop app in the Input app
3. otherwise `install` lists every layer and asks you to pick — including ones
   that do not have the keycodes yet, since a layer you have not finished
   setting up is still the layer you meant

You do **not** have to be sitting on that layer. Colours are sent continuously,
and the firmware only renders them on a layer carrying those keycodes — so the
board is already correct the moment you switch to it, and other profiles are
unaffected because they have no `KV_OAI_AG` keys to paint.

```sh
npx github:00cyre/claude-code-keypad doctor
```

reports what it found and what is missing.

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

Two files on disk, so this works as a plain script rather than from inside a session:

- `~/.claude/sessions/<pid>.json` — one per live session; the process is checked with signal 0
- `~/.claude/projects/<cwd>/<id>.jsonl` — that session's transcript

State comes from the last non-sidechain record of the transcript. `stop_reason` is the signal: `end_turn` means the assistant stopped and it is your move; anything else means mid-turn. Only the tail is read, since these grow to megabytes.

Two thresholds turn that into something readable at a glance:

- a mid-turn session quiet for **45s** becomes `needs you` — on disk, a session generating and a session sitting on a permission prompt are identical, and the silence is the only clue
- anything quiet for over **an hour** becomes `idle`, so a session you interrupted yesterday is not still demanding attention

Subagent records are skipped: they interleave into the same transcript, and a running subagent already means the session is working.

## Options

```
claude-code-keypad [--keys 6] [--interval 2000] [--no-switch] [--once]
```

`--once` paints a single frame and exits, which is the quick way to see what it would show.

## License

MIT

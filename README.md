# claude-code-keypad

Live Claude Code session status on the keys of a [Work Louder Creator Micro 2](https://worklouder.cc).

Each key is one of your running sessions, coloured by what it is doing. Press a key to jump to that chat.

| Colour | Meaning |
| --- | --- |
| blue | working — the assistant is mid-turn |
| amber | **needs you** — mid-turn but gone quiet, usually a prompt waiting on an answer |
| green | your turn — the assistant finished and is waiting for a reply |
| dim | idle — nothing recent |
| off | no session for that key |

```sh
npm install
npm start
```

Device I/O comes from [creator-micro-kit](https://github.com/00cyre/creator-micro-kit); this package is only the Claude Code half.

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

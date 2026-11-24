# Claude Code's terminal title

Claude Code writes its state to the terminal title (OSC 0). edi reads this title to tell that a
Claude tab in the background is waiting for you. The recording below was taken on 24 November
2026 with Claude Code 2.1.331, in a session opened through node-pty (`TERM_PROGRAM=edi`,
`TERM=xterm-256color`).

## Recording

Seconds, followed by the sequence that arrived. Repeats of the same title are left out.

A short answer:

```
  0.9  OSC 0 "✳ Claude Code"            startup, idle
  7.0  --- prompt sent
  7.4  OSC 0 "◐ Claude Code"            working
  8.3  OSC 0 "◑ Claude Code"
  8.4  OSC 0 "◑ Basit yanıt isteği"     took the session name
  9.3  OSC 0 "◐ Basit yanıt isteği"
  9.6  OSC 0 "✳ Basit yanıt isteği"     answer done, idle
```

A permission prompt (`--permission-mode default`, a request to write a file):

```
  0.7  OSC 0 "✳ Claude Code"
  7.0  --- prompt sent
  7.4  OSC 0 "◐ Claude Code"
  8.5  OSC 0 "◑ Perm-test2.txt dosya yazma"
  9.3  OSC 0 "◐ Perm-test2.txt dosya yazma"
 10.1  OSC 0 "✳ Perm-test2.txt dosya yazma"   "Do you want to create …?" prompt on screen
 34.0  --- Escape (declined); the title did not change
 40.3  OSC 0 ""                               process exited
```

## The rule

| First character of the title | State |
|---|---|
| `◐` or `◑` (alternates about once a second) | working |
| `✳` | waiting for you: the answer is done, or it asks for permission |
| anything else (empty title, the shell's own title) | not Claude Code's title |

- "Answer done" and "asking for permission" cannot be told apart from the title; both are `✳`. The bell is the same for both.
- The text after the first character is the session name and depends on the language; the rule ignores it.
- No BEL (`\a`) ever arrived in these sessions; the bell does not rely on it.
- Other sequences were seen too and are ignored: `OSC 7501 "?"` (at startup) and `OSC 8` for file links.

The title format is not a documented contract of Claude Code; if a release changes it, the
bell stops ringing (it does not ring wrongly). In that case this recording is taken again and
`src/shared/claudeTitle.ts` is updated.

# bead-pane

A Claude Code mod for [beads](https://github.com/steveyegge/beads). Claude's replies turn each
bead ID they mention, such as `fp-g5h6.4`, into a link. Clicking one opens the bead in a side pane:
its title, status, priority, type, assignee and dates, the beads above it as a breadcrumb, its
blockers, description, notes, design, acceptance criteria and close reason, and its children with
their status. Bead IDs inside the pane are links too, so you can walk the tree from there.

The mod reads beads with `bd show <id> --json` and `bd children <id> --json` and changes nothing.
It looks a bead up once, after the message has drawn, and caches the answer for the session, so
neither the reply nor the model waits on `bd` or spends tokens on it.

## Requirements

- Claude Code v2.1.317 or later, in the terminal or the desktop app.
- `bd` at `/opt/homebrew/bin/bd`, with its database reachable from the shell Claude Code runs in.
- Bead IDs with the `fp-` prefix. The prefix and the `bd` path are constants at the top of
  `hooks/register.tsx` (`ID` and `BD`).

## Install

At the prompt of a terminal session:

```
/plugin install bead-pane --marketplace adrian-baker/bead-pane
```

From a shell:

```bash
claude plugin install bead-pane --marketplace adrian-baker/bead-pane
```

In the desktop app, where `/plugin` doesn't run: click + next to the prompt box, then Plugins,
Add marketplace with `adrian-baker/bead-pane`, then Add plugin.

The repository is private, so the install needs read access to it on GitHub and a git credential
for github.com on the machine (an SSH key, or `gh auth login` then `gh auth setup-git`).

## Developing

Run it from this folder in a session of its own, which reloads it on each save:

```bash
claude --plugin-dir ~/mods/bead-pane
```

Check and test it:

```bash
claude plugin validate ~/mods/bead-pane
```

```bash
claude plugin test ~/mods/bead-pane
```

## Known limitation

Text in the pane can't be selected in the desktop app. Claude Code's desktop app turns off text
selection for everything a mod draws in a pane
([anthropics/claude-code#105492](https://github.com/anthropics/claude-code/issues/105492)), and no
element has a prop to turn it back on. Copy from the conversation, or from `bd show`.

# bead-pane

A Claude Code mod for [beads](https://github.com/steveyegge/beads). It turns each bead ID in
Claude's replies, such as `fp-g5h6.4`, into a link. Clicking the link opens the bead in a side
pane. The pane shows:

- the title, status, priority, type, assignee and dates
- the beads above it, as a breadcrumb
- its open blockers
- the description, notes, design, acceptance criteria and close reason
- its children with their status, summarised past 12

Bead IDs in the pane are links too, so you can move through the tree from there.

The pane's home, `/beads` or "Session" in the breadcrumb, lists the beads this session has
touched, most recent first, with what it last did to each. The mod adds a bead when a `bd`
command in the session claims, creates, updates, comments on, links, closes or reopens it,
including a subagent's command. It also adds the beads assigned to the session's `BEADS_ACTOR`,
which covers a claim made before the mod loaded.

The mod reads beads with `bd show <id> --json` and `bd children <id> --json`. It doesn't change
them. It looks up each bead once, after the message has drawn, and keeps the answer for the
session. Neither the reply nor the model waits on `bd`, and the lookup uses no tokens.

## Requirements

- Claude Code with mods, in the terminal or the desktop app. It was built and tested on v2.1.317.
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

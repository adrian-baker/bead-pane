# bead-pane

A Claude Code mod for [beads](https://github.com/steveyegge/beads). Under each of Claude's
replies that names a bead, such as `demo-g5h6.4`, it adds a row of links to those beads. Clicking
one opens the bead in a side pane. The pane shows:

- the title, status, priority, type, assignee and dates
- the beads above it, as a breadcrumb
- its blockers, and the beads that wait on it
- the description, notes, design, acceptance criteria, spec and close reason
- its comments, its labels and where else it's tracked, such as `gh-2510`
- its children, with a bar coloured by status. Past 12, it shows the ones still open, a count of
  each status that filters the list to it, and a link to all

Bead IDs in the pane are links too, so you can move through the tree from there. An ID inside
code, such as `` `bd show demo-g5h6` ``, isn't counted as a mention, but code that holds an ID and
nothing else, such as `` `demo-g5h6` ``, is. In a git checkout with a GitHub
`origin`, `PR 4503`, `#4501` and a pull request's or issue's URL link to that repository, and a
link to a file that is only on a pushed branch goes to its copy on GitHub.

`/beads`, or ▤ at the start of the breadcrumb, lists the beads this session has touched, most
recent first. Beads it worked on come first, each with what it last did, then beads a reply only
linked. The mod adds a bead when:

- a `bd` command in the session claims, creates, updates, comments on, links, closes or reopens
  it, a subagent's command included
- a reply links it
- the session's title names it as the session starts or resumes
- it's open and assigned to the session's `BEADS_ACTOR`, which covers a claim made before the
  mod loaded. Without `BEADS_ACTOR` the mod skips this.

The mod reads beads with `bd show --json` and `bd dep list --direction=up --json` and doesn't
change them. It looks beads up after a message has drawn, all the IDs a draw needs in one
`bd show`, and keeps the answers for the session. Neither the reply nor the model waits on `bd`, and the lookups use
no tokens. It remembers each folder's prefix and the IDs it found in its own store, so a resumed
session's replies draw with their links the first time.

The pane keeps up with changes made anywhere, such as another session or a person:

- A `bd` command in this session that changes a bead looks it up again at once.
- Where the project's Dolt data is on this machine, the mod follows Dolt's journal file with
  `tail -F`. Each write elsewhere refreshes what the pane shows within about a second, and
  nothing runs between writes.
- Otherwise, such as with a Dolt server on another machine, it asks `bd` every 5 seconds while
  the pane is open.
- A closed pane doesn't refresh.

The mod asks `bd config get issue_prefix` for the project's prefix, so it links only that
project's IDs. If `bd` can't run, or finds no database from the session's folder, the pane says
so.

## Requirements

- Claude Code with [mods](https://code.claude.com/docs/en/plugins/mods/overview), in the
  terminal or the desktop app. It was built and tested on v2.1.317. Earlier versions are
  untested, and some lack `--marketplace` on `claude plugin install`.
- [`bd`](https://github.com/steveyegge/beads), with a beads database that `bd` finds from the
  session's folder, through a `.beads` folder above it or `BEADS_DIR`.

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

## Configure

The mod runs `bd` from the PATH Claude Code starts with. The desktop app, started from the Dock,
may not have Homebrew's folder on that PATH. If the pane says it couldn't run `bd`, give the full
path, from `which bd`, at a session's prompt:

```
/plugin configure bead-pane@bead-pane
```

Or set it when installing from a shell:

```bash
claude plugin install bead-pane --marketplace adrian-baker/bead-pane --config bd_path=/opt/homebrew/bin/bd
```

The same command sets where a reply's bead links go, as `reply_links`. `below`, the default,
adds the row under the reply. `inline` makes the IDs in the reply's text the links instead. In
the desktop app an inline reply is drawn at a slightly smaller size than the replies around it
([anthropics/claude-code#107850](https://github.com/anthropics/claude-code/issues/107850)).

After creating a beads database for a session that had none, run `/beads` to look again.

## Developing

From a clone, run Claude Code with the mod loaded from it. It reloads the mod on each save, and
on its first load it writes the API's types to `.claude-plugin/types/`, which `tsconfig.json`
extends:

```bash
claude --plugin-dir .
```

Check, test and type-check it:

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

```bash
npx tsc -p .
```

## Known limitation

Text in the pane can't be selected in the desktop app. Claude Code's desktop app turns off text
selection for everything a mod draws in a pane
([anthropics/claude-code#105492](https://github.com/anthropics/claude-code/issues/105492)), and no
element has a prop to turn it back on. Copy from the conversation, or from `bd show`.

## License

[MIT](LICENSE)

// `priority` where bd gave one, as it does for children and blockers.
export type Ref = { id: string; title: string; status: string; priority?: number; type?: string }

export type Comment = { author: string; text: string; createdMs: number | null }

export type Bead = {
  status: string
  title: string
  description: string
  priority: number | null
  type: string
  assignee: string
  // null when bd gave no date it could parse.
  createdMs: number | null
  updatedMs: number | null
  closedMs: number | null
  labels: string[]
  // Where the bead is tracked elsewhere, such as `gh-2510`; empty when nowhere.
  externalRef: string
  // The specification it builds, as `bd create --spec-id` gave it; empty when none.
  specId: string
  commentCount: number
  // Fetched only for the bead the pane shows: null until then.
  comments: Comment[] | null
  // Notes, design and acceptance criteria, each only when the bead has one.
  extras: { label: string; text: string }[]
  blockedBy: Ref[]
  // The bead this one sits under, and the beads under it.
  parent: Ref | null
  children: Ref[]
  // Why it was closed, as `bd close --reason` gave it; empty while open.
  closeReason: string
}

// What looking a bead up found. A failure isn't a missing bead: bd may have
// timed out or found its database locked, and pressing the bead asks again.
export type Lookup =
  { kind: 'found'; bead: Bead } | { kind: 'missing' } | { kind: 'failed'; detail: string }

// What the session last did to a bead. `assigned` is a bead the session's
// BEADS_ACTOR holds, `in title` one the session's title names, and `mentioned`
// one a reply linked, that no command in this load touched.
export type How =
  | 'created'
  | 'closed'
  | 'reopened'
  | 'unclaimed'
  | 'commented'
  | 'linked'
  | 'updated'
  | 'claimed'
  | 'assigned'
  | 'in title'
  | 'mentioned'

// What asking bd for the project's ID prefix found.
export type Setup =
  // `repo` is the GitHub `owner/name` from the session's git remote, if any.
  | { kind: 'ready'; prefix: string; repo: string | null }
  // bd didn't start, or didn't answer in time.
  | { kind: 'no-bd'; bd: string; detail: string }
  // bd ran but found no beads database from the session's folder.
  | { kind: 'no-database'; detail: string }

declare module 'claude-code' {
  interface PluginState {
    'bead-pane': {
      setup: Shaped<Setup | null>
      beads: Shaped<Record<string, Lookup>>
      selected: Shaped<string | null>
      expanded: Shaped<string | null>
      // The one status a bead's long list of children is narrowed to, if any.
      only: Shaped<{ id: string; status: string } | null>
      touched: Shaped<Record<string, { how: How; atMs: number }>>
      // Counts the mod's refreshes. The pane reads it, so a refresh redraws an
      // open pane even when nothing changed, and a closed pane doesn't draw.
      pulse: Shaped<number>
    }
  }
}

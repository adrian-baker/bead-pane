export type Ref = { id: string; title: string; status: string }

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
// BEADS_ACTOR holds, and `in title` one the session's title names, that no
// command in this load touched.
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

// What asking bd for the project's ID prefix found.
export type Setup =
  | { kind: 'ready'; prefix: string }
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
      touched: Shaped<Record<string, { how: How; atMs: number }>>
    }
  }
}

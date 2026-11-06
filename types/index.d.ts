export type Ref = { id: string; title: string; status: string }

export type Bead = {
  status: string
  title: string
  description: string
  priority: number | null
  type: string
  assignee: string
  created: string
  updated: string
  // Notes, design and acceptance criteria, each only when the bead has one.
  extras: { label: string; text: string }[]
  blockedBy: Ref[]
  // The bead this one sits under, and the beads under it.
  parent: Ref | null
  children: Ref[]
  // Why it was closed, as `bd close --reason` gave it; empty while open.
  closeReason: string
}

declare module 'claude-code' {
  interface PluginState {
    'bead-pane': {
      beads: Shaped<Record<string, Bead | null>>
      selected: Shaped<string | null>
      expanded: Shaped<string | null>
      touched: Shaped<Record<string, { how: string; at: number }>>
    }
  }
}

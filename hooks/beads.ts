// What bd prints, parsed into the mod's own types, and the other pure parts:
// nothing here runs a command or touches state.

import type { Bead, How, Lookup, Ref } from '../types'

const patterns = new Map<string, RegExp>()

// A bead ID is the project's prefix, a hyphen and three to eight base-36
// characters, plus `.n` for each level of child (`demo-g5h6.4`). An ID inside
// a link or a path is left alone, and `outsideCode` skips code.
export const idPattern = (prefix: string): RegExp => {
  const known = patterns.get(prefix)
  if (known) return known
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
  const made = new RegExp(`(?<![\\w[/.-])${escaped}-[a-z0-9]{3,8}(?:\\.\\d+)*(?![\\w\\]/-])`, 'g')
  patterns.set(prefix, made)
  return made
}

// `bd info --json`: the folder that holds the project's Dolt data.
export const parseDatabasePath = (stdout: string): string | null => {
  const info = json(stdout)
  return isRow(info) && typeof info.database_path === 'string' && info.database_path !== ''
    ? info.database_path
    : null
}

// Dolt appends every write to a database to this file, its chunk journal, in
// `<database>/.dolt/noms/`. The name is a constant of Dolt's storage format.
export const JOURNAL = 'v'.repeat(32)

// bd allows letters, digits, `_` and `-` in a prefix.
export const parsePrefix = (stdout: string): string | null => {
  const prefix = stdout.trim()
  return /^[A-Za-z0-9_-]+$/.test(prefix) ? prefix : null
}

// A fenced block, or an inline code span of any number of backticks. An
// unclosed fence runs to the end, as Markdown draws it.
const CODE = /(```|~~~)[\s\S]*?(?:\1|$(?![\s\S]))|(`+)[\s\S]*?\2(?!`)/g

// Applies `fn` to the text outside code, which Markdown draws literally.
export const outsideCode = (text: string, fn: (prose: string) => string): string => {
  let out = ''
  let at = 0
  for (const m of text.matchAll(CODE)) {
    out += fn(text.slice(at, m.index)) + m[0]
    at = m.index + m[0].length
  }
  return out + fn(text.slice(at))
}

// The distinct bead IDs in the text outside code.
export const idsIn = (text: string, prefix: string): string[] => {
  const found = new Set<string>()
  outsideCode(text, prose => {
    for (const m of prose.matchAll(idPattern(prefix))) found.add(m[0])
    return prose
  })
  return [...found]
}

// Rewrites each ID outside code that `link` answers for.
export const linkIds = (
  text: string,
  prefix: string,
  link: (id: string) => string | null,
): string => outsideCode(text, prose => prose.replace(idPattern(prefix), id => link(id) ?? id))

type Row = Record<string, unknown>

const isRow = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.filter(isRow) : [])
const json = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
const ms = (v: unknown): number | null => {
  const at = Date.parse(str(v))
  return Number.isNaN(at) ? null : at
}

const refOf = (r: Row): Ref | null =>
  typeof r.id === 'string' ? { id: r.id, title: str(r.title), status: str(r.status) } : null
const refs = (v: unknown): Ref[] => rows(v).flatMap(r => refOf(r) ?? [])

// `demo-g5h6.10` after `demo-g5h6.9`: the numeric parts compare as numbers.
export const byId = (a: Ref, b: Ref): number => {
  const pa = a.id.split('.')
  const pb = b.id.split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? ''
    const y = pb[i] ?? ''
    const n = Number(x) - Number(y)
    if (x !== y) return Number.isNaN(n) || n === 0 ? x.localeCompare(y) : n
  }
  return 0
}

const beadOf = (row: Row): Bead => {
  const deps = rows(row.dependencies)
  const ofType = (type: string) => refs(deps.filter(d => d.dependency_type === type))
  const extras = (
    [
      ['Notes', row.notes],
      ['Design', row.design],
      ['Acceptance criteria', row.acceptance_criteria],
    ] as const
  ).flatMap(([label, text]) =>
    typeof text === 'string' && text.trim() !== '' ? [{ label, text }] : [],
  )
  return {
    status: str(row.status) || '?',
    title: str(row.title),
    description: str(row.description),
    priority: typeof row.priority === 'number' ? row.priority : null,
    type: str(row.issue_type),
    assignee: str(row.assignee),
    createdMs: ms(row.created_at),
    updatedMs: ms(row.updated_at),
    extras,
    blockedBy: ofType('blocks'),
    parent: ofType('parent-child')[0] ?? refs(deps.filter(d => d.id === row.parent))[0] ?? null,
    children: [],
    closeReason: str(row.close_reason),
  }
}

// `bd show <id>... --json`: the rows it found, exit 0. When it finds none it
// exits 1 with `{ "error": "no issues found …" }`. Anything else is a failure
// for every ID asked. Children come from a second command, so they start
// empty; `withChildren` names the beads that can have some.
export const parseShown = (
  ids: readonly string[],
  ran: { exitCode: number; stdout: string; stderr: string },
): { lookups: Record<string, Lookup>; withChildren: string[] } => {
  const parsed = json(ran.stdout)
  const isNoneFound =
    ran.exitCode !== 0 && isRow(parsed) && /no issues found/.test(str(parsed.error))
  if (ran.exitCode !== 0 && !isNoneFound) {
    const detail = (ran.stderr || ran.stdout).trim() || `bd exited with ${ran.exitCode}`
    return {
      lookups: Object.fromEntries(ids.map(id => [id, { kind: 'failed', detail }])),
      withChildren: [],
    }
  }
  const found = new Map(
    rows(parsed).flatMap(r => (typeof r.id === 'string' ? [[r.id, r] as const] : [])),
  )
  return {
    lookups: Object.fromEntries(
      ids.map((id): [string, Lookup] => {
        const row = found.get(id)
        return [id, row ? { kind: 'found', bead: beadOf(row) } : { kind: 'missing' }]
      }),
    ),
    // Only a bead something depends on can have children.
    withChildren: ids.filter(id => {
      const count = found.get(id)?.dependent_count
      return typeof count === 'number' && count > 0
    }),
  }
}

// `bd children <id> --json`, in ID order.
export const parseChildren = (stdout: string): Ref[] => refs(json(stdout)).sort(byId)

// `bd list --json`: each bead's ID and when it last changed.
export const parseAssigned = (stdout: string): { id: string; atMs: number }[] =>
  rows(json(stdout)).flatMap(r =>
    typeof r.id === 'string' ? [{ id: r.id, atMs: ms(r.updated_at) ?? 0 }] : [],
  )

// Whether the session worked on a bead, or only looked at it or named it.
export const isWork = (how: How): boolean => how !== 'viewed' && how !== 'mentioned'

// What a `bd` subcommand did; `null` for the ones that change nothing.
const VERB = new Map<string, How | null>([
  ['create', 'created'],
  ['close', 'closed'],
  ['reopen', 'reopened'],
  ['unclaim', 'unclaimed'],
  ['comment', 'commented'],
  ['comments', 'commented'],
  ['dep', 'linked'],
  ['update', 'updated'],
  ...[
    'show',
    'list',
    'ready',
    'children',
    'search',
    'config',
    'info',
    'blocked',
    'history',
    'stats',
  ].map((sub): [string, null] => [sub, null]),
])

const QUOTED = /"(?:\\.|[^"\\])*"|'[^']*'/g

// The beads one shell command changed, and how. The subcommand is the first
// word bd knows after `bd`, past any global flags (`bd -q close`). Quoted text,
// such as a description, isn't searched for IDs. `bd update <id> --claim` is
// a claim; `bd create` names its new bead only in what it prints.
export const changedBy = (
  command: string,
  stdout: string,
  prefix: string,
): { id: string; how: How }[] =>
  command
    .replace(QUOTED, '""')
    .split(/&&|\|\||;|\n|\|/)
    .flatMap(part => {
      const m = part.match(/(?:^|[\s/])bd(\s.*)$/)
      const words = m?.[1]?.trim().split(/\s+/) ?? []
      const at = words.findIndex(w => VERB.has(w))
      const sub = words[at] ?? ''
      const verb = VERB.get(sub)
      if (!verb) return []
      const args = words.slice(at + 1)
      if (sub === 'comments' && args[0] !== 'add') return []
      const how: How = sub === 'update' && args.includes('--claim') ? 'claimed' : verb
      const ids =
        sub === 'create' ? idsIn(stdout, prefix).slice(0, 1) : idsIn(args.join(' '), prefix)
      return ids.map(id => ({ id, how }))
    })

// The breadcrumb's labels: each ID below the first by its own `.n` where it
// nests in the one before (`demo-g5h6 › .5 › .1`).
export const trailLabels = (ids: readonly string[]): string[] =>
  ids.map((id, i) => {
    const prev = ids[i - 1]
    return prev && id.startsWith(`${prev}.`) ? id.slice(prev.length) : id
  })

// The order statuses take in the progress bar and the counts: done first,
// then work under way, then work waiting. A status bd adds later goes last.
const ORDER = ['closed', 'in_progress', 'blocked', 'open', 'deferred']
const rank = (status: string) => {
  const at = ORDER.indexOf(status)
  return at === -1 ? ORDER.length : at
}

// How many of the refs are in each status, in bar order.
export const countByStatus = (list: readonly Ref[]): [string, number][] =>
  [
    ...list.reduce(
      (n, r) => n.set(r.status, (n.get(r.status) ?? 0) + 1),
      new Map<string, number>(),
    ),
  ].sort(([a], [b]) => rank(a) - rank(b))

// A progress bar `width` cells wide, one run of cells per status in bar
// order. Each status with any beads gets at least one cell, and rounding
// gives the spare cells to the largest remainders.
export const barRuns = (list: readonly Ref[], width: number): [string, number][] => {
  const counts = countByStatus(list)
  if (list.length === 0) return []
  const exact = counts.map(([status, n]) => [status, (n / list.length) * width] as const)
  const runs = exact.map(([status, x]): [string, number] => [status, Math.max(1, Math.floor(x))])
  const spare = width - runs.reduce((sum, [, n]) => sum + n, 0)
  const byRemainder = exact
    .map(([, x], i) => [i, x - Math.floor(x)] as const)
    .sort(([, a], [, b]) => b - a)
  for (const [i] of byRemainder.slice(0, Math.max(0, spare))) {
    const run = runs[i]
    if (run) run[1] += 1
  }
  return runs
}

// The children a summarised list shows: the work left, in ID order, up to
// `first` of them. When every child is closed, the first `first`.
export const summarised = (kids: readonly Ref[], first: number): Ref[] => {
  const left = kids.filter(k => k.status !== 'closed')
  return (left.length > 0 ? left : kids).slice(0, first)
}

export const ago = (atMs: number | null, nowMs: number): string => {
  if (atMs === null) return '-'
  const mins = Math.max(0, Math.round((nowMs - atMs) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 2880) return `${Math.round(mins / 60)}h ago`
  if (mins < 86400) return `${Math.round(mins / 1440)}d ago`
  return new Date(atMs).toLocaleDateString()
}

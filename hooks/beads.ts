// What bd prints, parsed into the mod's own types, and the other pure parts:
// nothing here runs a command or touches state.

import type { Bead, Comment, How, Lookup, Ref } from '../types'

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

// Applies `fn` to the text outside code, which Markdown draws literally, and
// `code` to each code block and span, which it keeps by default.
export const outsideCode = (
  text: string,
  fn: (prose: string) => string,
  code: (span: string) => string = span => span,
): string => {
  let out = ''
  let at = 0
  for (const m of text.matchAll(CODE)) {
    out += fn(text.slice(at, m.index)) + code(m[0])
    at = m.index + m[0].length
  }
  return out + fn(text.slice(at))
}

// The ID in an inline code span that holds one and nothing else, as a reply
// writes `demo-g5h6`; null for any other code, such as `bd show demo-g5h6`.
const soleId = (span: string, prefix: string): string | null => {
  // On one line, so a fenced block never counts.
  const inner = span.match(/^(`+) *([^`\n]*?) *\1$/)?.[2] ?? ''
  const ids = inner.match(idPattern(prefix))
  return ids?.length === 1 && ids[0] === inner ? inner : null
}

// The distinct bead IDs in the text outside code, and in code that holds an
// ID alone.
export const idsIn = (text: string, prefix: string): string[] => {
  const found = new Set<string>()
  outsideCode(
    text,
    prose => {
      for (const m of prose.matchAll(idPattern(prefix))) found.add(m[0])
      return prose
    },
    span => {
      const id = soleId(span, prefix)
      if (id) found.add(id)
      return span
    },
  )
  return [...found]
}

// Rewrites each ID that `link` answers for, outside code and as the whole of
// a code span. A span's link drops the backticks: a desktop draws code in a
// link as plain text, so it reads as the other IDs do.
export const linkIds = (
  text: string,
  prefix: string,
  link: (id: string) => string | null,
): string =>
  outsideCode(
    text,
    prose => prose.replace(idPattern(prefix), id => link(id) ?? id),
    span => {
      const id = soleId(span, prefix)
      return (id && link(id)) ?? span
    },
  )

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
  typeof r.id === 'string'
    ? {
        id: r.id,
        title: str(r.title),
        status: str(r.status),
        ...(typeof r.priority === 'number' ? { priority: r.priority } : {}),
        ...(typeof r.issue_type === 'string' && r.issue_type !== '' ? { type: r.issue_type } : {}),
      }
    : null
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
    closedMs: ms(row.closed_at),
    deferUntilMs: ms(row.defer_until),
    labels: Array.isArray(row.labels) ? row.labels.filter(l => typeof l === 'string') : [],
    externalRef: str(row.external_ref),
    specId: str(row.spec_id),
    commentCount: typeof row.comment_count === 'number' ? row.comment_count : 0,
    comments: null,
    extras,
    blockedBy: ofType('blocks'),
    parent: ofType('parent-child')[0] ?? refs(deps.filter(d => d.id === row.parent))[0] ?? null,
    children: [],
    blocks: [],
    closeReason: str(row.close_reason),
  }
}

// `bd show <id>... --json`: the rows it found, exit 0. When it finds none it
// exits 1 with `{ "error": "no issues found …" }`. Anything else is a failure
// for every ID asked. Children and the beads it blocks come from a second
// command, so they start empty; `withDependents` names the beads that can
// have some.
export const parseShown = (
  ids: readonly string[],
  ran: { exitCode: number; stdout: string; stderr: string },
): { lookups: Record<string, Lookup>; withDependents: string[] } => {
  const parsed = json(ran.stdout)
  const isNoneFound =
    ran.exitCode !== 0 && isRow(parsed) && /no issues found/.test(str(parsed.error))
  if (ran.exitCode !== 0 && !isNoneFound) {
    const detail = (ran.stderr || ran.stdout).trim() || `bd exited with ${ran.exitCode}`
    return {
      lookups: Object.fromEntries(ids.map(id => [id, { kind: 'failed', detail }])),
      withDependents: [],
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
    // Only a bead something depends on has children or blocks anything.
    withDependents: ids.filter(id => {
      const count = found.get(id)?.dependent_count
      return typeof count === 'number' && count > 0
    }),
  }
}

// `bd comments <id> --json`, oldest first.
export const parseComments = (stdout: string): Comment[] =>
  rows(json(stdout))
    .map(r => ({ author: str(r.author), text: str(r.text), createdMs: ms(r.created_at) }))
    .sort((a, b) => (a.createdMs ?? 0) - (b.createdMs ?? 0))

// `bd dep list <id> --direction=up --json`: the beads under it and the beads
// it blocks, each in ID order. Other kinds of link, such as `tracks`, are left
// out.
export const parseDependents = (stdout: string): { children: Ref[]; blocks: Ref[] } => {
  const all = rows(json(stdout))
  const ofType = (type: string) => refs(all.filter(r => r.dependency_type === type)).sort(byId)
  return { children: ofType('parent-child'), blocks: ofType('blocks') }
}

// `bd list --json`: each bead's ID and when it last changed.
export const parseAssigned = (stdout: string): { id: string; atMs: number }[] =>
  rows(json(stdout)).flatMap(r =>
    typeof r.id === 'string' ? [{ id: r.id, atMs: ms(r.updated_at) ?? 0 }] : [],
  )

const WORK: ReadonlySet<string> = new Set<How>([
  'created',
  'closed',
  'reopened',
  'unclaimed',
  'commented',
  'linked',
  'updated',
  'claimed',
  'assigned',
  'in title',
])

// Whether the session worked on a bead, or a reply only linked it. A value an
// earlier version stored, such as `viewed`, counts as a link.
export const isWork = (how: string): boolean => WORK.has(how)

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
      // `bd dep list`, `tree` and `cycles` only read.
      if (sub === 'dep' && ['list', 'tree', 'cycles'].includes(args[0] ?? '')) return []
      const how: How = sub === 'update' && args.includes('--claim') ? 'claimed' : verb
      const ids =
        sub === 'create' ? idsIn(stdout, prefix).slice(0, 1) : idsIn(args.join(' '), prefix)
      return ids.map(id => ({ id, how }))
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

// The `owner/name` of a GitHub repository from a git remote's URL, in its
// https or ssh form; null for a remote that isn't on github.com.
export const parseGitHubRepo = (remote: string): string | null => {
  const m = remote.trim().match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/)
  return m?.[1] ?? null
}

// What a link to GitHub reads as: `PR 4610` for a pull request, `#2510` for
// an issue, or the text as given for anything else.
export const refLabel = (ref: string): string => {
  const pull = ref.match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/)
  if (pull) return `PR ${pull[1]}`
  const issue = ref.match(/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/) ?? ref.match(/^gh-(\d+)$/)
  return issue ? `#${issue[1]}` : ref
}

// Where an external ref points: the URL itself, or `gh-2510` as an issue in
// the repository. Null when it's neither.
export const refUrl = (ref: string, repo: string | null): string | null => {
  if (/^https?:\/\//.test(ref)) return ref
  const gh = ref.match(/^gh-(\d+)$/)
  return gh && repo ? `https://github.com/${repo}/issues/${gh[1]}` : null
}

// A Markdown link written out: `[label](url)`.
const LINK = /\[[^\]]*\]\([^)]*\)/g
const LINK_PARTS = /\[([^\]]*)\]\(([^)\s]*)\)/g

// The links in the text that name a file rather than a web address, such as
// `[the approach](openspec/changes/x/approach.md)`, outside code.
export const fileLinks = (text: string): string[] => {
  const found = new Set<string>()
  outsideCode(text, prose => {
    for (const m of prose.matchAll(LINK_PARTS)) {
      const href = m[2] ?? ''
      if (href !== '' && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#')) {
        found.add(href.replace(/#.*$/, ''))
      }
    }
    return prose
  })
  return [...found]
}

// Rewrites each link to a file by `target`: a new address to point it at,
// null to draw its label alone, or undefined to leave it as it is.
export const relinkFiles = (
  text: string,
  target: (path: string) => string | null | undefined,
): string =>
  outsideCode(text, prose =>
    prose.replace(LINK_PARTS, (whole, label: string, href: string) => {
      const to = target(href.replace(/#.*$/, ''))
      return to === undefined ? whole : to === null ? label : `[${label}](${to})`
    }),
  )

const GITHUB_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(pull|issues)\/(\d+)[^\s)\]]*/g

// Links `PR 4503` to the pull request and `#4501` or `gh-4501` to the issue,
// outside code and outside links already written. GitHub sends an issue's
// address on to a pull request with that number.
export const linkGitHub = (text: string, repo: string): string =>
  outsideCode(text, prose => {
    let out = ''
    let at = 0
    const shorthand = (part: string) =>
      part
        .replace(/\bPR ?#?(\d{1,6})\b/g, (m, n) => `[${m}](https://github.com/${repo}/pull/${n})`)
        .replace(
          /(?<![\w/&#[])(?:#|\bgh-)(\d{1,6})\b/g,
          (m, n) => `[${m}](https://github.com/${repo}/issues/${n})`,
        )
    // A bare pull request or issue URL reads as its shorthand, `PR 2769` or
    // `#2769`, with the repository's name when it's another's. A full stop or
    // comma after it stays outside the link.
    const plain = (part: string) => {
      let text = ''
      let from = 0
      for (const m of part.matchAll(GITHUB_URL)) {
        const [whole, owner = '', kind, n] = m
        const url = whole.replace(/[.,;:!?]+$/, '')
        const before = part.slice(from, m.index)
        // After the words "PR", as in "Draft PR <url>", the number alone.
        const label = kind === 'pull' && !/\bPR\s*$/.test(before) ? `PR ${n}` : `#${n}`
        text += shorthand(before) + `[${owner === repo ? label : `${owner}#${n}`}](${url})`
        from = m.index + url.length
      }
      return text + shorthand(part.slice(from))
    }
    for (const m of prose.matchAll(LINK)) {
      out += plain(prose.slice(at, m.index)) + m[0]
      at = m.index + m[0].length
    }
    return out + plain(prose.slice(at))
  })

// Each line break the writer typed stays a line break: Markdown would join
// lines a single newline separates into one paragraph.
export const keepLineBreaks = (text: string): string => text.replace(/([^\n])\n(?!\n)/g, '$1  \n')

// Notes written as dated entries, one per line (`2026-11-06: …`), as an agent
// appending to them does. Null when the notes aren't all entries like that.
const DATED = /^(\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?Z?)?):\s*(.*)$/
export const datedEntries = (text: string): { when: string; text: string }[] | null => {
  const lines = text.split('\n').filter(line => line.trim() !== '')
  const entries = lines.map(line => line.match(DATED))
  return entries.length > 1 && entries.every(m => m !== null)
    ? entries.map(m => ({ when: m?.[1] ?? '', text: m?.[2] ?? '' }))
    : null
}

// A dated note's date as the pane shows other times: `5h ago` for one with a
// time, read as UTC as bd writes it; `6 Nov` for a date alone, which has no
// time to count from.
export const noteWhen = (when: string, nowMs: number): string => {
  const [date = '', time] = when.split(/[ T]/)
  if (time) {
    const at = Date.parse(`${date}T${time.replace(/Z$/, '')}Z`)
    return Number.isNaN(at) ? when : ago(at, nowMs)
  }
  const [y, m, d] = date.split('-').map(Number)
  return y && m && d
    ? new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : when
}

// Small outline icons for the pane's section headings, 16 units square, in a
// grey that reads on a light or a dark pane: an SVG draws as an image, so it
// can't take the theme's colours.
const ICON_PATHS = {
  notes: 'M3.5 2.5h9v11h-9zM6 6h4M6 9h4',
  design: 'M3 13l.8-3L10.5 3.3l2.2 2.2L6 12.2zM9.3 4.5l2.2 2.2',
  acceptance: 'M2.5 4.5l1.2 1.2 2-2.2M7.5 4.8h6M2.5 10.5l1.2 1.2 2-2.2M7.5 10.8h6',
  spec: 'M4 2.5h5.5L12 5v8.5H4zM9.5 2.5V5H12',
  resolution: 'M8 2.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11zM5.6 8.1l1.7 1.7 3.2-3.4',
} as const
export type IconName = keyof typeof ICON_PATHS

// Each icon's leftmost x, in its 16 units.
const ICON_LEFT: Record<IconName, number> = {
  notes: 3.5,
  design: 3,
  acceptance: 2.5,
  spec: 4,
  resolution: 2.5,
}

// A section's icon, `size` pixels to its 16 units, starting at the glyph's
// left edge so it lines up with the text under the heading.
export const iconSvg = (
  name: IconName,
  size: number,
): { source: string; width: number; height: number } => {
  // Half the stroke's width beyond the path.
  const x0 = ICON_LEFT[name] - 0.7
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} 0 ${16 - x0} 16" fill="none" stroke="#8b8b8b" ` +
    `stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${ICON_PATHS[name]}"/></svg>`
  return { source, width: (size * (16 - x0)) / 16, height: size }
}

// The rows grouped under their parents, in the order each group first
// appears. Rows with no parent next to each other share a group without one,
// so the list keeps its order where nothing nests.
export const underParents = (
  rows: readonly Ref[],
  parentOf: (id: string) => Ref | null,
): { parent: Ref | null; rows: Ref[] }[] =>
  rows.reduce<{ parent: Ref | null; rows: Ref[] }[]>((groups, row) => {
    const parent = parentOf(row.id)
    const last = groups[groups.length - 1]
    const group = parent
      ? groups.find(g => g.parent?.id === parent.id)
      : last?.parent === null
        ? last
        : undefined
    return group
      ? groups.map(g => (g === group ? { ...g, rows: [...g.rows, row] } : g))
      : [...groups, { parent, rows: [row] }]
  }, [])

// An icon for each of bd's issue types, drawn beside a bead's title in the
// type's colour: fixed colours, since an SVG draws as an image without the
// theme, each one that reads on a light or a dark pane.
// `left` is the path's leftmost x, in its 16 units.
const TYPE_ICONS: Record<string, { path: string; colour: string; left: number }> = {
  epic: { path: 'M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z', colour: '#a371f7', left: 3.5 },
  task: { path: 'M3 3h10v10H3zM5.5 8.2l1.8 1.8 3.4-3.8', colour: '#6f9cef', left: 3 },
  bug: {
    path: 'M5.5 6h5v4.5a2.5 2.5 0 0 1-5 0zM8 6v7M5.5 8.5H3M10.5 8.5H13M5.5 11H3.5M10.5 11h2M6 6L5 3.5M10 6l1-2.5',
    colour: '#e07070',
    left: 3,
  },
  feature: {
    path: 'M8 2l1.8 3.8 4.2.5-3.1 2.8.9 4.1L8 11.1 4.2 13.2l.9-4.1L2 6.3l4.2-.5z',
    colour: '#5e9b4f',
    left: 2,
  },
  decision: {
    path: 'M8 14V2M8 3h4.5L14 4.5 12.5 6H8M8 7.5H3.5L2 9l1.5 1.5H8',
    colour: '#d29b3a',
    left: 2,
  },
  spike: { path: 'M6 2h4M6.5 2v4L3 13h10L9.5 6V2', colour: '#3fb5b5', left: 3 },
  chore: {
    path: 'M10.5 2.5a3 3 0 0 0-3 4L3 11l2 2 4.5-4.5a3 3 0 0 0 4-3l-1.8 1.8-1.7-1.7 1.8-1.8a3 3 0 0 0-1.3-.3z',
    colour: '#8b8b8b',
    left: 3,
  },
}

// The type's icon, an SVG `size` pixels to its 16 units whose title names the
// type for a tooltip; null for a type bd added after this list. `lowerPx`
// moves the glyph down within a box that centres it: the drawing grows by
// twice that at the top, so its centre falls below the glyph's. `opacity`
// mutes it. `isFlush` starts the drawing at the glyph's left edge, so it lines
// up with the text beside it.
export const typeIcon = (
  type: string,
  size: number,
  lowerPx = 0,
  opacity = 1,
  isFlush = false,
): { source: string; width: number; height: number } | null => {
  const icon = TYPE_ICONS[type]
  if (!icon) return null
  const extra = (2 * lowerPx * 16) / size
  // Half the stroke's width beyond the path.
  const x0 = isFlush ? icon.left - 0.7 : 0
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${-extra} ${16 - x0} ${16 + extra}" fill="none" ` +
    `stroke="${icon.colour}" stroke-opacity="${opacity}" stroke-width="1.4" ` +
    `stroke-linecap="round" stroke-linejoin="round">` +
    `<title>${type.replace(/^./, c => c.toUpperCase())}</title><path d="${icon.path}"/></svg>`
  return { source, width: (size * (16 - x0)) / 16, height: size + 2 * lowerPx }
}

// A speech bubble with the count in it, as an SVG: a filled rounded box with
// a tail, the number in bold white, wider for each digit. The colours are
// fixed, since an SVG draws as an image without the theme; this blue reads on
// a dark or a light pane.
export const countBubble = (count: number): { source: string; width: number; height: number } => {
  const label = String(count)
  const width = 10 + 6 * label.length
  const height = 17
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">` +
    `<rect x="0.5" y="0.5" width="${width - 1}" height="12.5" rx="4" fill="#4f7cf7"/>` +
    `<path d="M4 12.5 L4 16.5 L8.5 12.5 Z" fill="#4f7cf7"/>` +
    `<text x="${width / 2}" y="10" text-anchor="middle" fill="#ffffff" font-size="9.5" ` +
    `font-weight="700" font-family="-apple-system, system-ui, sans-serif">${label}</text></svg>`
  return { source, width, height }
}

// The progress bar as an SVG a few pixels tall and as wide as its slot: a
// desktop draws an SVG given no width at its own, 1000px, up to the slot's,
// and this one stretches to it. Each run of `barRuns` is a segment in its
// status's colour. Fixed colours, as for the bubble, matched to the theme's
// status colours; closed is faint, so the work left stands out.
const BAR_COLOURS: Record<string, string> = {
  open: '#7ea6f0',
  in_progress: '#d29b3a',
  blocked: '#e07070',
  closed: '#5e9b4f',
}
export const progressBar = (
  runs: readonly [string, number][],
  height = 4,
): { source: string; height: number } => {
  const width = 1000
  const cells = runs.reduce((sum, [, n]) => sum + n, 0)
  let x = 0
  const segments = runs.map(([status, n]) => {
    const opacity = status === 'closed' ? 0.55 : 1
    const w = (n / cells) * width
    const rect =
      `<rect x="${x}" y="0" width="${w}" height="${height}" ` +
      `fill="${BAR_COLOURS[status] ?? '#8b8b8b'}" fill-opacity="${opacity}"/>`
    x += w
    return rect
  })
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${segments.join('')}</svg>`
  return { source, height }
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

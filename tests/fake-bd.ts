// A stand-in for bd, answering the commands the mod runs as bd 1.3.2 does.

type Answer = {
  value: {
    exitCode: number
    stdout: string
    stderr: string
    isStdoutTruncated: false
    isStderrTruncated: false
  }
}

const answer = (exitCode: number, out: unknown, stderr = ''): Answer => ({
  value: {
    exitCode,
    stdout: typeof out === 'string' ? out : JSON.stringify(out),
    stderr,
    isStdoutTruncated: false,
    isStderrTruncated: false,
  },
})

// One `bd show --json` row with every field bd 1.3.2 prints, the values made up.
export const row = (id: string, fields: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  title: `Title of ${id}`,
  description: '',
  status: 'open',
  priority: 2,
  issue_type: 'task',
  assignee: '',
  owner: 'someone@example.com',
  created_at: '2026-10-30T18:15:16Z',
  created_by: 'Someone',
  updated_at: '2026-11-05T23:24:07Z',
  started_at: '2026-11-01T09:00:00Z',
  closed_at: '',
  close_reason: '',
  dependencies: [],
  dependent_count: 0,
  dependency_count: 0,
  comment_count: 0,
  revision: '1',
  ...fields,
})

export type FakeBd = {
  prefix?: string
  beads?: Record<string, Record<string, unknown>>
  children?: Record<string, Record<string, unknown>[]>
  assigned?: Record<string, unknown>[]
  // The Dolt folder `bd info` reports; none when absent.
  databasePath?: string
  // Every argument vector the mod ran, in order.
  ran?: (readonly string[])[]
}

export const fakeBd =
  ({ prefix = 'demo', beads = {}, children = {}, assigned = [], databasePath, ran = [] }: FakeBd) =>
  (_: unknown, e: { argv: readonly string[] }): Answer => {
    ran.push(e.argv)
    const [, verb = '', ...rest] = e.argv
    if (verb === 'config') return answer(0, `${prefix}\n`)
    if (verb === 'children') return answer(0, children[rest[0] ?? ''] ?? [])
    if (verb === 'list') return answer(0, assigned)
    if (verb === 'info') {
      return databasePath
        ? answer(0, { database_path: databasePath, mode: 'direct' })
        : answer(1, '', 'no database')
    }
    const found = rest.flatMap(id => beads[id] ?? [])
    return found.length > 0
      ? answer(0, found)
      : answer(
          1,
          { error: 'no issues found matching the provided IDs', schema_version: 1 },
          'Issue not found',
        )
  }

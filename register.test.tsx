import { expect, test } from 'claude-code/testing'

const MSG = {
  plugin: 'bead-pane',
  component: 'AssistantMessage',
  requestId: 'm1',
  props: {
    text: 'See fp-a1b2c and fp-g5h6.4, and `fp-aaaaa` stays, as does fp-nope.',
    isFirstOfReply: true,
  },
} as const

test('a bead line opens its details in a pane', async ($, on) => {
  on('process.run', (_, e) => {
    const [, verb, ref] = e.argv
    const bead = {
      id: 'fp-a1b2c', status: 'open', close_reason: 'Not shown while open.', title: 'Tidy the importer', description: 'Follow-up to fp-d3e4f.',
      notes: 'Check the fixtures first.', priority: 3, issue_type: 'task', assignee: 'me',
      created_at: '2026-10-30T18:15:16Z', updated_at: '2026-11-05T23:24:07Z',
      parent: 'fp-p0000', dependent_count: 1,
      dependencies: [
        { id: 'fp-d3e4f', title: 'Draft the plan', status: 'closed', dependency_type: 'blocks' },
        { id: 'fp-p0000', title: 'The epic', status: 'open', dependency_type: 'parent-child' },
      ],
    }
    const out =
      verb === 'children'
        ? [
            { id: 'fp-a1b2c.10', title: 'Tenth', status: 'open' },
            { id: 'fp-a1b2c.9', title: 'Ninth', status: 'closed' },
          ]
        : [{ ...bead, id: ref }]
    const ok = e.argv[0] === '/opt/homebrew/bin/bd' && (verb === 'children' || ref === 'fp-a1b2c' || ref === 'fp-g5h6.4' || ref === 'fp-d3e4f')
    return { value: { exitCode: ok ? 0 : 1, stdout: JSON.stringify(out), stderr: '' } }
  })
  on('clock.now', () => ({ value: Date.parse('2026-11-06T00:00:00Z') }))
  on('clock.after', () => ({ value: undefined }))
  // The engine's own drawing, here the markdown the hook handed down.
  on('ui.render', ($, e) => {
    const { Markdown } = $.ui.resolve(e)

    return <Markdown text={e.props.text} />
  })

  on('ui.open', () => ({ value: { isPlaced: true } }))

  for (const surface of ['terminal', 'desktop'] as const) {
    let ui = await $.ui.mount({ ...MSG, surface })
    await ui.unmount()
    await new Promise(r => setTimeout(r, 50))
    ui = await $.ui.mount({ ...MSG, surface })
    const md = await ui.find({ type: 'Markdown' })
    expect(md?.props?.text).toContain('[fp-a1b2c](https://beads.invalid/fp-a1b2c)')
    expect(md?.props?.text).toContain('[fp-g5h6.4](https://beads.invalid/fp-g5h6.4)')
    expect(md?.props?.text).toContain('`fp-aaaaa`')
    expect(md?.props?.text).not.toContain('[fp-nope')
    await ui.press({ key: `msg-${MSG.requestId}`, link: { href: 'https://beads.invalid/fp-a1b2c' } })
    await ui.unmount()

    const pane = await $.ui.mount({
      plugin: 'bead-pane',
      component: 'Pane',
      requestId: 'bead',
      surface,
      props: { title: 'Bead', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
    })
    const text = async (key: string) => (await pane.find({ key }))?.props?.text as string | undefined
    expect(await text('desc')).toBe('Follow-up to [fp\u2011d3e4f](https://beads.invalid/fp-d3e4f).')
    expect(await text('text-Notes')).toBe('Check the fixtures first.')
    expect(await text('trail')).toBe('[fp-p0000](https://beads.invalid/fp-p0000) › fp-a1b2c')
    expect(await pane.find({ type: 'Text', text: /^CHILDREN$/ })).toBeTruthy()
    // In ID order whatever their status, `.9` before `.10`, each by its own `.n`.
    const kidRows = (await pane.find({ key: 'kids' }))?.children ?? []
    expect(kidRows.map((r: { key?: string; props?: { key?: string } }) => r.key ?? r.props?.key)).toEqual(['kids-fp-a1b2c.9', 'kids-fp-a1b2c.10'])
    expect(await text('kids-fp-a1b2c.9-title')).toBe('[Ninth](https://beads.invalid/fp-a1b2c.9)')
    expect((await pane.find({ key: 'kids-fp-a1b2c.9-title' }))?.props?.dimColor).toBeFalsy()
    expect(await pane.find({ type: 'Text', text: /^\.10$/ })).toBeTruthy()
    expect(await pane.find({ key: 'text-resolution' })).toBeFalsy()
    expect((await pane.find({ key: 'trail' }))?.props?.dimColor).toBeFalsy()
    expect(await pane.find({ type: 'Text', text: /P3/ })).toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /Open/ })).toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /in_progress/ })).toBeFalsy()
    expect(await pane.find({ type: 'Text', text: /Its blocker is closed/ })).toBeTruthy()

    // A link in the description moves the pane, and the breadcrumb leads back up.
    await pane.press({ key: 'desc', link: { href: 'https://beads.invalid/fp-d3e4f' } })
    expect(await text('trail')).toBe('[fp-p0000](https://beads.invalid/fp-p0000) › fp-d3e4f')
    await pane.press({ key: 'trail', link: { href: 'https://beads.invalid/fp-p0000' } })
    expect(await pane.find({ type: 'Text', text: /fp-p0000 is not a bead/ })).toBeTruthy()
    await pane.unmount()
  }
})

test('a long list of children is summarised until opened', async ($, on) => {
  const kids = Array.from({ length: 20 }, (_, i) => ({
    id: `fp-epic1.${i + 1}`,
    title: `Child ${i + 1}`,
    status: i < 15 ? 'closed' : 'open',
  }))
  on('process.run', (_, e) => {
    const [, verb, ref] = e.argv
    const out =
      verb === 'children'
        ? kids
        : [{ id: ref, title: 'Big epic', status: 'open', issue_type: 'epic', dependent_count: 20, dependencies: [] }]
    return { value: { exitCode: ref === 'fp-epic1' || verb === 'children' ? 0 : 1, stdout: JSON.stringify(out), stderr: '' } }
  })
  on('clock.after', () => ({ value: undefined }))
  on('clock.now', () => ({ value: Date.parse('2026-11-06T00:00:00Z') }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={e.props.text} />
  })

  const msg = { ...MSG, props: { ...MSG.props, text: 'See fp-epic1.' } }
  let ui = await $.ui.mount({ ...msg, surface: 'desktop' })
  await ui.unmount()
  ui = await $.ui.mount({ ...msg, surface: 'desktop' })
  await ui.press({ key: `msg-${MSG.requestId}`, link: { href: 'https://beads.invalid/fp-epic1' } })
  await ui.unmount()

  const pane = await $.ui.mount({
    plugin: 'bead-pane',
    component: 'Pane',
    requestId: 'bead',
    surface: 'desktop',
    props: { title: 'Bead', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  const rows = async () => ((await pane.find({ key: 'kids' }))?.children ?? []).length
  expect(await rows()).toBe(8)
  expect(await pane.find({ type: 'Text', text: /15 closed/ })).toBeFalsy()
  expect(await pane.find({ type: 'Text', text: /^15\/20$/ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /5 open/ })).toBeTruthy()
  expect((await pane.find({ key: 'all' }))?.props?.text).toContain('Show all 20')
  await pane.press({ key: 'all', link: { href: 'https://beads.invalid/~all' } })
  expect(await rows()).toBe(20)
  expect((await pane.find({ key: 'all' }))?.props?.text).toContain('Show fewer')
  await pane.unmount()
})

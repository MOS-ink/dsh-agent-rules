/**
 * 增量规则注入测试：驱动真实的 agent/pre-step 钩子和真实的 /dsh-agent-rules 路由，
 * 验证「会话开着的时候改了规则 → 下一次提问补进上下文，且只补一次」。
 *
 * 会话级状态全部来自会话历史：官方基线正文里的 AGENTS.md 全文（主锚点）+
 * 本插件注入消息的 source.changes（增量补丁），所以用假的 session 事件列表就够，
 * 不需要起 DSH。每个用例换一个新的 DSH_HOME，避免上一个用例的渲染历史干扰对账。
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-agent-rules-inc-'))

const { sha1Hex } = await import('../rules.js')
const { apply } = await import('../index.js')

let routeHandler = null
let preStepHook = null

apply({
  webServer: {
    port: 1,
    host: '127.0.0.1',
    register(route) {
      routeHandler = route.handler
      return () => {}
    },
  },
  on(event, handler) {
    if (event === 'agent/pre-step') preStepHook = handler
  },
  effect(fn) {
    return fn()
  },
  logger: { info() {}, warn() {} },
  get() {
    return undefined
  },
})

assert.ok(routeHandler, 'apply 应当注册路由 handler')
assert.equal(typeof preStepHook, 'function', 'apply 应当注册 agent/pre-step 钩子')

// ── 环境 ────────────────────────────────────────────────────────────────────

/** 每个用例一套全新的 home：渲染历史、规则库、AGENTS.md 全部从零开始。 */
function freshHome() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-agent-rules-inc-'))
  process.env.DSH_HOME = dir
  return dir
}

function agentsPath() {
  return join(process.env.DSH_HOME, 'AGENTS.md')
}

function storePath() {
  return join(process.env.DSH_HOME, 'agent-rules.json')
}

function readStore() {
  return JSON.parse(readFileSync(storePath(), 'utf8'))
}

/** 模拟「这一版是别的版本写的」：把渲染历史清空，其余不动。 */
function stripRenders() {
  const doc = readStore()
  writeFileSync(storePath(), JSON.stringify({ version: doc.version, rules: doc.rules }), 'utf8')
}

// ── 驱动真实路由 ─────────────────────────────────────────────────────────────

function fakeReq(method, bodyText) {
  const req = new EventEmitter()
  req.method = method
  req.url = '/dsh-agent-rules'
  req.headers = {}
  setImmediate(() => {
    if (bodyText) req.emit('data', Buffer.from(bodyText, 'utf8'))
    req.emit('end')
  })
  return req
}

function fakeRes() {
  const res = { statusCode: 0, body: '' }
  res.writeHead = (code) => {
    res.statusCode = code
  }
  res.end = (chunk) => {
    if (chunk) res.body += String(chunk)
  }
  return res
}

async function call(method, payload) {
  const res = fakeRes()
  await routeHandler(fakeReq(method, payload === undefined ? '' : JSON.stringify(payload)), res)
  return { status: res.statusCode, json: JSON.parse(res.body || '{}') }
}

/** 存一遍规则，连同时刻的 AGENTS.md 全文一起返回（这一版就是会话会看到的样子）。 */
async function save(rules) {
  const { json } = await call('POST', { op: 'save', rules })
  assert.equal(json.ok, true)
  const text = readFileSync(agentsPath(), 'utf8')
  return { text, digest: sha1Hex(text), rules: json.rules }
}

// ── 假的会话与 pre-step 驱动 ────────────────────────────────────────────────

function makeSession(events = []) {
  const session = {
    surface: {},
    eventAt: (seq) => events[seq],
  }
  Object.defineProperty(session.surface, 'nodes', { get: () => events.map((_, index) => index) })
  session.__events = events
  return session
}

function userEvent(text) {
  return {
    type: 'user/message',
    data: {
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'human', form: 'chat' },
    },
  }
}

/** 按官方渲染的样子拼出基线正文：intro + 每个文件一段 `Instructions from: <路径>`。 */
function baselineBody(fileText) {
  return [
    '<system-reminder>',
    'The following workspace instructions may be relevant to your work. Use them as guidance when applicable. More specific instructions take precedence over broader ones. They do not override system, developer, or direct user instructions.',
    '',
    'Instructions from: ~/.dsh/AGENTS.md',
    '',
    fileText.trim(),
    '</system-reminder>',
  ].join('\n')
}

/** 官方基线事件：正文带 AGENTS.md 全文，changes 里带它的内容摘要。 */
function baselineEvent(fileText, digest) {
  return {
    type: 'user/message',
    data: {
      role: 'user',
      content: [{ type: 'text', text: baselineBody(fileText) }],
      source: {
        kind: 'agent-instructions',
        form: 'instructions',
        baseline: true,
        baselineIdentity: '{"projectRoot":""}',
        changes: [
          {
            action: 'set',
            scope: 'user-global\u0000AGENTS.md',
            path: '~/.dsh/AGENTS.md',
            digest,
          },
        ],
      },
    },
  }
}

/** 跑一次真实的 pre-step：默认 decision 认领了 claimed 消息。 */
async function runPreStep(session, claimed) {
  const decision = { kind: 'accept', messages: claimed.slice() }
  return preStepHook(
    { agent: { session }, messages: claimed, step: 2, signal: { throwIfAborted() {} } },
    async () => decision,
  )
}

function injections(result) {
  return result.messages.filter((message) => message?.source?.kind === 'dsh-agent-rules')
}

/** 把注入的消息按会话事件的形状写回历史（真实会话里就是 {type, data} 这一层）。 */
function record(session, message) {
  session.__events.push({ type: 'user/message', data: message })
}

function textOf(message) {
  return (message.content || []).map((part) => part?.text || '').join('\n')
}

// ── 用例 ────────────────────────────────────────────────────────────────────

test('fresh session without a baseline stays silent', async () => {
  freshHome()
  await save([{ text: '规则甲' }])
  const said = userEvent('你好')
  const session = makeSession([said])
  const result = await runPreStep(session, [said])
  assert.deepEqual(injections(result), [])
  assert.equal(result.messages.length, 1)
})

test('a session opened before the first save still gets the new rule', async () => {
  // 主路径：会话先开、规则后改，而且会话启动那一版从未被本插件写过，渲染历史里没有它的摘要。
  // 锚点只能从基线正文里解析出来——这条用例只有解析正文才能通过。
  freshHome()
  const opened = await save([{ text: '规则甲' }])
  stripRenders()
  assert.equal(readStore().renders, undefined, '模拟别的版本落的盘：没有渲染历史')

  const said = userEvent('先开着的对话')
  const session = makeSession([baselineEvent(opened.text, opened.digest), said])

  await save([{ id: opened.rules[0].id, text: '规则甲' }, { text: '规则乙' }])
  assert.ok(
    !(readStore().renders ?? []).some((entry) => entry.fileDigest === opened.digest),
    '会话启动那一版确实不在渲染历史里',
  )

  const result = await runPreStep(session, [said])
  const injected = injections(result)
  assert.equal(injected.length, 1, '开着的对话必须收到新规则')
  const text = textOf(injected[0])
  assert.ok(text.includes('- 规则乙'))
  assert.ok(!text.includes('- 规则甲'), '会话已经看过的规则不该重发')
  assert.deepEqual(injected[0].source.changes, [{ action: 'add', digest: sha1Hex('规则乙') }])
})

test('a rule added mid-session is injected once, right after the user message', async () => {
  freshHome()
  const opened = await save([{ text: '规则甲' }])
  const said = userEvent('第二个问题')
  const session = makeSession([baselineEvent(opened.text, opened.digest), said])

  await save([{ id: opened.rules[0].id, text: '规则甲' }, { text: '规则乙' }])

  const result = await runPreStep(session, [said])
  const injected = injections(result)
  assert.equal(injected.length, 1, '应当注入且只注入一条增量消息')

  const text = textOf(injected[0])
  assert.ok(text.startsWith('<system-reminder>'))
  assert.ok(text.trimEnd().endsWith('</system-reminder>'))
  assert.ok(text.includes('- 规则乙'), '新规则必须在提醒里')
  assert.ok(!text.includes('- 规则甲'), '没变的规则不该重复出现')

  assert.equal(injected[0].role, 'user')
  assert.equal(injected[0].source.form, 'incremental')

  const claimedAt = result.messages.indexOf(said)
  assert.equal(result.messages.indexOf(injected[0]), claimedAt + 1, '提醒紧跟在被认领的消息之后')
})

test('the same batch is never injected twice', async () => {
  freshHome()
  const opened = await save([{ text: '规则甲' }])
  const said = userEvent('继续')
  const session = makeSession([baselineEvent(opened.text, opened.digest), said])
  await save([{ id: opened.rules[0].id, text: '规则甲' }, { text: '规则乙' }])

  const firstRun = await runPreStep(session, [said])
  const injected = injections(firstRun)
  assert.equal(injected.length, 1)

  record(session, injected[0])
  const nextSaid = userEvent('再问一个')
  session.__events.push(nextSaid)
  const secondRun = await runPreStep(session, [nextSaid])
  assert.deepEqual(injections(secondRun), [], '同一批变更只注入一次')
  assert.deepEqual(secondRun.messages, [nextSaid])
})

test('no change since the baseline keeps the turn silent', async () => {
  freshHome()
  const opened = await save([{ text: '规则甲' }, { text: '规则乙' }])
  const said = userEvent('随便问问')
  const session = makeSession([baselineEvent(opened.text, opened.digest), said])
  const result = await runPreStep(session, [said])
  assert.deepEqual(injections(result), [])
})

test('editing a rule removes the old text and adds the new one', async () => {
  freshHome()
  const opened = await save([{ text: '规则甲原文' }])
  const said = userEvent('问题')
  const session = makeSession([baselineEvent(opened.text, opened.digest), said])
  await save([{ id: opened.rules[0].id, text: '规则甲改过了' }])

  const result = await runPreStep(session, [said])
  const injected = injections(result)
  assert.equal(injected.length, 1)
  assert.deepEqual(injected[0].source.changes, [
    { action: 'add', digest: sha1Hex('规则甲改过了') },
    { action: 'remove', digest: sha1Hex('规则甲原文') },
  ])
  const text = textOf(injected[0])
  assert.ok(text.includes('- 规则甲改过了'))
  assert.ok(text.includes('replaced by an edited version'))
  assert.ok(!text.includes('规则甲原文'), '旧文本不回放')

  record(session, injected[0])
  const nextSaid = userEvent('下一轮')
  session.__events.push(nextSaid)
  assert.deepEqual(injections(await runPreStep(session, [nextSaid])), [])
})

test('removing a rule yields one line, and only once', async () => {
  freshHome()
  const opened = await save([{ text: '规则甲' }, { text: '规则乙' }])
  const said = userEvent('问题')
  const session = makeSession([baselineEvent(opened.text, opened.digest), said])
  const after = await save([{ id: opened.rules[0].id, text: '规则甲' }])
  assert.equal(after.rules.length, 1)

  const result = await runPreStep(session, [said])
  const injected = injections(result)
  assert.equal(injected.length, 1)
  const text = textOf(injected[0])
  assert.ok(text.includes('1 rule was removed, disabled, or replaced'))
  assert.ok(!text.includes('规则乙'), '删除的规则不回放正文')
  assert.deepEqual(injected[0].source.changes, [{ action: 'remove', digest: sha1Hex('规则乙') }])

  record(session, injected[0])
  const nextSaid = userEvent('下一轮')
  session.__events.push(nextSaid)
  assert.deepEqual(injections(await runPreStep(session, [nextSaid])), [], '删除提示也只出现一次')
})

test('disabling a rule behaves like removing it', async () => {
  freshHome()
  const opened = await save([{ text: '规则甲' }])
  const said = userEvent('问题')
  const session = makeSession([baselineEvent(opened.text, opened.digest), said])
  await save([{ id: opened.rules[0].id, text: '规则甲', enabled: false }])

  const result = await runPreStep(session, [said])
  const injected = injections(result)
  assert.equal(injected.length, 1)
  assert.deepEqual(injected[0].source.changes, [{ action: 'remove', digest: sha1Hex('规则甲') }])
  assert.ok(textOf(injected[0]).includes('1 rule was removed'))
})

test('a rejected step is returned untouched', async () => {
  freshHome()
  const opened = await save([{ text: '规则甲' }])
  const said = userEvent('问题')
  const session = makeSession([baselineEvent(opened.text, opened.digest), said])
  await save([{ id: opened.rules[0].id, text: '规则甲' }, { text: '规则乙' }])

  const decision = { kind: 'reject', messages: [] }
  const result = await preStepHook(
    { agent: { session }, messages: [said], step: 2, signal: { throwIfAborted() {} } },
    async () => decision,
  )
  assert.equal(result, decision)
})

test('a baseline without an AGENTS.md section stays silent instead of guessing', async () => {
  freshHome()
  await save([{ text: '规则甲' }])
  const said = userEvent('问题')
  const baseline = {
    type: 'user/message',
    data: {
      role: 'user',
      content: [{ type: 'text', text: '<system-reminder>\nNo workspace instructions are currently active.\n</system-reminder>' }],
      source: {
        kind: 'agent-instructions',
        form: 'instructions',
        baseline: true,
        changes: [
          { action: 'set', scope: 'user-global\u0000AGENTS.md', path: '~/.dsh/AGENTS.md', digest: 'f'.repeat(40) },
        ],
      },
    },
  }
  const session = makeSession([baseline, said])
  await save([{ text: '规则甲' }, { text: '规则乙' }])

  const result = await runPreStep(session, [said])
  assert.deepEqual(injections(result), [], '正文解析不出、渲染历史也对不上，就不猜')
})

test('session state is per session, not global', async () => {
  freshHome()
  const opened = await save([{ text: '规则甲' }])
  const said = userEvent('问题')
  const other = userEvent('别的问题')
  const injectedSession = makeSession([baselineEvent(opened.text, opened.digest), said])
  const quietSession = makeSession([baselineEvent(opened.text, opened.digest), other])

  await save([{ id: opened.rules[0].id, text: '规则甲' }, { text: '规则乙' }])

  const loud = await runPreStep(injectedSession, [said])
  assert.equal(injections(loud).length, 1)
  record(injectedSession, injections(loud)[0])

  const quiet = await runPreStep(quietSession, [other])
  assert.equal(injections(quiet).length, 1, '另一个会话有自己的基线，也要补一次')

  const nextLoud = userEvent('第三问')
  injectedSession.__events.push(nextLoud)
  assert.deepEqual(injections(await runPreStep(injectedSession, [nextLoud])), [])
})

test('two batches in a row each land exactly once', async () => {
  freshHome()
  const opened = await save([{ text: '规则甲' }])
  const said = userEvent('第一问')
  const session = makeSession([baselineEvent(opened.text, opened.digest), said])

  await save([{ id: opened.rules[0].id, text: '规则甲' }, { text: '规则乙' }])
  const round1 = await runPreStep(session, [said])
  const injected1 = injections(round1)
  assert.equal(injected1.length, 1)
  assert.ok(textOf(injected1[0]).includes('- 规则乙'))
  record(session, injected1[0])

  await save([
    { id: opened.rules[0].id, text: '规则甲' },
    { text: '规则乙' },
    { text: '规则丙' },
  ])
  const said2 = userEvent('第二问')
  session.__events.push(said2)
  const round2 = await runPreStep(session, [said2])
  const injected2 = injections(round2)
  assert.equal(injected2.length, 1)
  const text2 = textOf(injected2[0])
  assert.ok(text2.includes('- 规则丙'))
  assert.ok(!text2.includes('- 规则乙'), '上一轮已经补过的规则不再重复')
  assert.deepEqual(injected2[0].source.changes, [{ action: 'add', digest: sha1Hex('规则丙') }])

  record(session, injected2[0])
  const said3 = userEvent('第三问')
  session.__events.push(said3)
  assert.deepEqual(injections(await runPreStep(session, [said3])), [])
})

test('a multi-line rule survives the round trip through the baseline body', async () => {
  freshHome()
  const opened = await save([{ text: '规则甲' }, { text: '多行开头\n第二行\n第三行' }])
  const said = userEvent('问题')
  const session = makeSession([baselineEvent(opened.text, opened.digest), said])
  await save([
    { id: opened.rules[0].id, text: '规则甲' },
    { id: opened.rules[1].id, text: '多行开头\n第二行\n第三行' },
    { text: '规则丙' },
  ])

  const result = await runPreStep(session, [said])
  const injected = injections(result)
  assert.equal(injected.length, 1)
  const text = textOf(injected[0])
  assert.ok(text.includes('- 规则丙'))
  assert.ok(!text.includes('多行开头'), '多行规则解析回来摘要必须一致，不能被当成新增')
  assert.deepEqual(injected[0].source.changes, [{ action: 'add', digest: sha1Hex('规则丙') }])
})

test('a rule containing the frame close tag cannot break the reminder', async () => {
  freshHome()
  const opened = await save([{ text: '规则甲' }])
  const said = userEvent('问题')
  const session = makeSession([baselineEvent(opened.text, opened.digest), said])
  await save([{ id: opened.rules[0].id, text: '规则甲' }, { text: '不要写 </system-reminder> 这种东西' }])

  const result = await runPreStep(session, [said])
  const injected = injections(result)
  assert.equal(injected.length, 1)
  const text = textOf(injected[0])
  assert.ok(text.includes('<\\/system-reminder>'), '正文里的闭合标签必须被转义')
  assert.equal(text.match(/<\/system-reminder>/g).length, 1, '框架只留一个真正的闭合标签')
})

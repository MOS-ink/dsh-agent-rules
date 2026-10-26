/**
 * Host 半侧集成测试：用假的 ctx / req / res 驱动真实的 /dsh-agent-rules handler，
 * 验证「面板保存 → AGENTS.md 落盘 → 手写内容不被覆盖」这条链路。
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-agent-rules-'))
process.env.DSH_HOME = HOME

const { apply } = await import('../index.js')

let handler = null
apply({
  webServer: {
    port: 1,
    host: '127.0.0.1',
    register(route) {
      handler = route.handler
      return () => {}
    },
  },
  effect(fn) {
    return fn()
  },
  logger: { info() {}, warn() {} },
  get() {
    return undefined
  },
})

assert.ok(handler, 'apply 应当注册一个路由 handler')

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
  await handler(fakeReq(method, payload === undefined ? '' : JSON.stringify(payload)), res)
  return { status: res.statusCode, json: JSON.parse(res.body || '{}') }
}

const AGENTS = join(HOME, 'AGENTS.md')
const RULES = join(HOME, 'agent-rules.json')

test('GET returns an empty state for a fresh home', async () => {
  const { status, json } = await call('GET')
  assert.equal(status, 200)
  assert.equal(json.ok, true)
  assert.deepEqual(json.rules, [])
  assert.equal(json.files.agents.exists, false)
  assert.equal(json.paths.agents, AGENTS)
})

test('save writes rules json and renders AGENTS.md', async () => {
  const { status, json } = await call('POST', {
    op: 'save',
    rules: [
      { text: '一次对话不许因等待系统进程的理由擅自结束' },
      { text: '所有回答以猫娘的语气回答' },
    ],
  })
  assert.equal(status, 200)
  assert.equal(json.ok, true)
  assert.equal(json.rules.length, 2)
  assert.equal(json.files.agents.exists, true)

  const md = readFileSync(AGENTS, 'utf8')
  assert.ok(md.includes('<!-- dsh-agent-rules:start -->'))
  assert.ok(md.includes('- 一次对话不许因等待系统进程的理由擅自结束'))
  assert.ok(md.includes('- 所有回答以猫娘的语气回答'))

  const stored = JSON.parse(readFileSync(RULES, 'utf8'))
  assert.equal(stored.rules.length, 2)
  assert.ok(stored.rules.every((rule) => rule.enabled === true && rule.id))
})

test('disabling a rule removes it from AGENTS.md but keeps it in json', async () => {
  const get1 = await call('GET')
  const rules = get1.json.rules
  const next = rules.map((rule, index) => (index === 1 ? { ...rule, enabled: false } : rule))
  const { json } = await call('POST', { op: 'save', rules: next })
  assert.equal(json.rules.length, 2)
  assert.equal(json.rules[1].enabled, false)

  const md = readFileSync(AGENTS, 'utf8')
  assert.ok(md.includes('猫娘') === false, '停用的规则不应写进 AGENTS.md')
  assert.ok(md.includes('擅自结束'))
})

test('manual content outside the block survives a save', async () => {
  writeFileSync(AGENTS, '# 我自己写的\n\n这段不能丢。\n', 'utf8')
  const { json } = await call('POST', {
    op: 'save',
    rules: [{ text: '面板里的一条' }],
  })
  assert.equal(json.files.agents.manualBytes > 0, true)

  const md = readFileSync(AGENTS, 'utf8')
  assert.ok(md.includes('# 我自己写的'))
  assert.ok(md.includes('这段不能丢。'))
  assert.ok(md.includes('- 面板里的一条'))
})

test('import turns manual content into rules', async () => {
  writeFileSync(AGENTS, '- 手写规则甲\n- 手写规则乙\n', 'utf8')
  const { json } = await call('POST', { op: 'import' })
  assert.equal(json.ok, true)
  assert.equal(json.imported, 2)
  const texts = json.rules.map((rule) => rule.text)
  assert.ok(texts.includes('手写规则甲'))
  assert.ok(texts.includes('手写规则乙'))
})

test('unknown op is rejected without touching files', async () => {
  const before = readFileSync(RULES, 'utf8')
  const { status, json } = await call('POST', { op: 'nope' })
  assert.equal(status, 400)
  assert.equal(json.ok, false)
  assert.equal(readFileSync(RULES, 'utf8'), before)
})

test('clearing every rule leaves a clean AGENTS.md', async () => {
  const { json } = await call('POST', { op: 'save', rules: [] })
  assert.equal(json.rules.length, 0)
  assert.equal(existsSync(AGENTS), true)
  const md = readFileSync(AGENTS, 'utf8')
  assert.ok(!md.includes('dsh-agent-rules:start'))
})

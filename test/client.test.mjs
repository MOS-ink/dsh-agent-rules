/**
 * Client 半侧结构测试：不启动浏览器，验证
 *   1. bundle 以 dsh-agent-rules 的 id 注册进 ModuleLoader
 *   2. apply 把「规则与记忆」注册进 settings.section
 *   3. 面板在没有数据（加载态）、有两条规则时都能渲染出关键文案
 *
 * React 用一个最小 stub 顶替：createElement 返回普通对象树，useState 按预置序列返回，
 * useEffect 不执行（避免真的 fetch）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

globalThis.window = {}

let captured = null
globalThis.window.__ModuleLoader__ = {
  load(spec) {
    captured = spec
  },
}

const ReactStub = {
  __seed: [],
  __i: 0,
  __reset(seed) {
    ReactStub.__seed = seed || []
    ReactStub.__i = 0
  },
  createElement(type, props, ...children) {
    return { type, props: props || {}, children }
  },
  useState(init) {
    const index = ReactStub.__i++
    const value = index < ReactStub.__seed.length ? ReactStub.__seed[index] : typeof init === 'function' ? init() : init
    return [value, () => {}]
  },
  useEffect() {},
}

await import('../client.js')

assert.ok(captured, 'client.js 应当调用 window.__ModuleLoader__.load')
assert.equal(captured.id, 'dsh-agent-rules')
assert.equal(typeof captured.factory, 'function')

const mod = captured.factory((id) => {
  if (id === 'react') return ReactStub
  throw new Error('unexpected require: ' + id)
})

test('factory exports apply/inject and the section id', () => {
  assert.equal(typeof mod.apply, 'function')
  assert.deepEqual(mod.inject, ['slots'])
  assert.equal(mod.SECTION_ID, 'agent-rules')
})

test('apply registers a settings.section entry labelled 规则与记忆', () => {
  const registered = []
  const slots = {
    inject(name, factory) {
      assert.equal(name, 'settings.section')
      return factory()
    },
    register(options, component) {
      registered.push({ options, component })
      return () => {}
    },
  }
  mod.apply({ slots, get: () => undefined })
  assert.equal(registered.length, 1)
  const { options } = registered[0]
  assert.equal(options.name, 'settings.section')
  assert.equal(options.id, 'agent-rules')
  assert.equal(options.label, '规则与记忆')
  assert.equal(options.order, 24)
  assert.equal(typeof registered[0].component, 'function')
  mod.__registered = registered[0]
})

function collectText(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out)
    return out
  }
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (node && typeof node === 'object') {
    if (node.children) collectText(node.children, out)
    if (node.props && node.props.children) collectText(node.props.children, out)
  }
  return out
}

function renderPanel(seed) {
  ReactStub.__reset(seed)
  const element = mod.__registered.component()
  const Component = element.type
  return collectText(Component()).join('\n')
}

test('panel renders the empty state with both sections', () => {
  const text = renderPanel([])
  assert.ok(text.includes('规则与记忆'))
  assert.ok(text.includes('上下文来源'))
  assert.ok(text.includes('~/.dsh/AGENTS.md'))
  assert.ok(text.includes('~/.agents/AGENTS.md'))
  assert.ok(text.includes('CLAUDE.md（项目目录）'))
  assert.ok(text.includes('还没有规则'))
  assert.ok(text.includes('添加规则'))
})

test('panel renders rule rows and the save hint when data is present', () => {
  const snap = {
    ok: true,
    version: 1,
    dshHome: 'C:\\Users\\x\\.dsh',
    paths: { agents: 'C:\\Users\\x\\.dsh\\AGENTS.md', rules: 'a', shared: 'b', claude: 'c' },
    rules: [],
    files: {
      agents: { exists: true, size: 2048, hasBlock: true, manualBytes: 120 },
      shared: { exists: false, size: 0 },
      claude: { exists: false, size: 0 },
    },
    limits: { maxRules: 200, maxRuleChars: 2000 },
  }
  const draft = [
    { id: 'r1', text: '一次对话不许因等待系统进程的理由擅自结束', enabled: true },
    { id: 'r2', text: '所有回答以猫娘的语气回答', enabled: true },
  ]
  const text = renderPanel([snap, draft])
  assert.ok(text.includes('全局规则 2 条'))
  assert.ok(text.includes('一次对话不许因等待系统进程的理由擅自结束'))
  assert.ok(text.includes('所有回答以猫娘的语气回答'))
  assert.ok(text.includes('2.0 KB'))
  assert.ok(text.includes('导入成规则'), '检测到手写内容时应给出导入入口')
  assert.ok(!text.includes('还没有规则'))
})

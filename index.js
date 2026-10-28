/**
 * dsh-agent-rules — Host 半侧。
 *
 * 在设置页里维护一份「全局规则」列表，渲染进 ~/.dsh/AGENTS.md 的托管块。
 * DSH 内置的 @deepseek-ai/dsh-agent-instructions（dsh-base 已挂载，预算 64 KB）
 * 会在每个会话的首次请求把这份文件作为工作区指令注入，所以规则天然全局生效。
 *
 * 三件事：一个 JSON 存储、一份 markdown 落地、一个 agent/pre-step 增量注入钩子。
 * 不碰 prompt assemble，不和别的插件抢 system 段。
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  MAX_RULES,
  MAX_RULE_CHARS,
  SCHEMA_VERSION,
  agentsSectionFromBaseline,
  digestRules,
  digestsOfTexts,
  diffRules,
  hasDiff,
  incrementalChanges,
  manualBytes,
  mergeAgentsMd,
  normalizeRules,
  parseBlockRules,
  parseRulesFromMd,
  renderBlock,
  renderIncrementalReminder,
  sha1Hex,
  splitAgentsMd,
} from './rules.js'

const NS = 'dsh-agent-rules'
const ROUTE = '/dsh-agent-rules'
const JSON_FILE = 'agent-rules.json'
const AGENTS_FILE = 'AGENTS.md'
const CLAUDE_FILE = 'CLAUDE.md'
/** 注入消息的 source.kind。和官方的 agent-instructions 分开，两边的 changes 互不干扰。 */
const RULE_SOURCE_KIND = 'dsh-agent-rules'
/** 渲染历史保留多少版。锚点要能认出「会话启动时是哪一版」，20 版够覆盖一天的调整。 */
const RENDERS_LIMIT = 20


// connection 不写进 inject：拿不到就靠 ctx.get 探测、探测失败即放行，
// 绝不因为一个可选服务缺失让整个面板加载不起来（代价是重启一轮却看不到入口）。
export const inject = ['webServer']

/** 宿主 home：优先 DSH_HOME，其余按进程 home 的 .dsh。 */
function dshHome() {
  const env = String(process.env.DSH_HOME || '').trim()
  return env || join(homedir(), '.dsh')
}

/** 共享 agents 根：$DSH_AGENTS_HOME 或 ~/.agents。 */
function agentsHome() {
  const env = String(process.env.DSH_AGENTS_HOME || '').trim()
  return env || join(homedir(), '.agents')
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function fileMeta(file) {
  try {
    const info = statSync(file)
    return { exists: info.isFile(), size: info.isFile() ? info.size : 0 }
  } catch {
    return { exists: false, size: 0 }
  }
}

/**
 * 读整个存储文档。renders 是「每次落盘时 AGENTS.md 的内容摘要 + 当时的规则摘要」，
 * 用于回答一个只有会话历史能问出来的问题：这个会话启动时，规则是哪一版。
 * 旧版本的文件没有 renders，按空数组处理，不影响读取规则。
 */
function readStoreDoc(file) {
  const raw = readText(file)
  if (!raw.trim()) return { rules: [], renders: [] }
  try {
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : parsed?.rules
    const renders = Array.isArray(parsed?.renders) ? parsed.renders : []
    return { rules: normalizeRules(list), renders }
  } catch {
    return { rules: [], renders: [] }
  }
}

function readStore(file) {
  return readStoreDoc(file).rules
}

function buildState() {
  const home = dshHome()
  const agentsPath = join(home, AGENTS_FILE)
  const rulesPath = join(home, JSON_FILE)
  const sharedPath = join(agentsHome(), AGENTS_FILE)
  const claudePath = join(home, CLAUDE_FILE)
  const agentsText = readText(agentsPath)
  const agentsMeta = fileMeta(agentsPath)
  const split = splitAgentsMd(agentsText)
  return {
    ok: true,
    version: SCHEMA_VERSION,
    dshHome: home,
    paths: { agents: agentsPath, rules: rulesPath, shared: sharedPath, claude: claudePath },
    rules: readStore(rulesPath),
    files: {
      agents: {
        exists: agentsMeta.exists,
        size: agentsMeta.size,
        hasBlock: split.hasBlock,
        manualBytes: manualBytes(agentsText),
      },
      shared: fileMeta(sharedPath),
      claude: fileMeta(claudePath),
    },
    limits: { maxRules: MAX_RULES, maxRuleChars: MAX_RULE_CHARS },
  }
}

/**
 * 记一条渲染历史：这份 AGENTS.md 内容的摘要，和它里面装着哪几条规则。
 * 同一份内容只保留一条（重复写就换到末尾）：内容相同说明规则集也相同，
 * 留两条只会让「会话启动时是哪一版」这个查询出现歧义。
 */
function appendRender(renders, entry) {
  const list = (Array.isArray(renders) ? renders : []).filter(
    (item) => item && item.fileDigest !== entry.fileDigest,
  )
  list.push(entry)
  return list.slice(-RENDERS_LIMIT)
}

/** 写 AGENTS.md + JSON，返回落盘后的规则。 */
function persist(rules) {
  const home = dshHome()
  const clean = normalizeRules(rules)
  const rulesPath = join(home, JSON_FILE)
  const agentsPath = join(home, AGENTS_FILE)
  const agentsText = mergeAgentsMd(readText(agentsPath), renderBlock(clean))
  mkdirSync(dirname(rulesPath), { recursive: true })
  writeFileSync(agentsPath, agentsText, 'utf8')
  const previous = readStoreDoc(rulesPath)
  const renders = appendRender(previous.renders, {
    fileDigest: sha1Hex(agentsText),
    at: Date.now(),
    rules: digestRules(clean),
  })
  writeFileSync(
    rulesPath,
    JSON.stringify({ version: SCHEMA_VERSION, rules: clean, renders }, null, 2) + '\n',
    'utf8',
  )
  return clean
}

/** 把 AGENTS.md 里手写的内容抽成规则，接在现有规则后面（按文本去重）。 */
function importFromAgentsMd() {
  const home = dshHome()
  const agentsPath = join(home, AGENTS_FILE)
  const imported = parseRulesFromMd(readText(agentsPath))
  if (!imported.length) return { rules: readStore(join(home, JSON_FILE)), imported: 0 }
  const current = readStore(join(home, JSON_FILE))
  const seen = new Set(current.map((rule) => rule.text))
  const merged = current.slice()
  let added = 0
  for (const text of imported) {
    if (seen.has(text)) continue
    seen.add(text)
    merged.push({ id: '', text, enabled: true })
    added += 1
  }
  return { rules: persist(merged), imported: added }
}

// ── 增量注入：会话级状态全部来自会话历史，不新增持久化文件 ──────────────────

let userMessageFactory = null

/**
 * 官方 createUserMessage：给消息补 role/id 并冻结。
 * 拿得到就用真的，拿不到（依赖解析路径不同）退化成同样的形状，别让注入整条挂掉。
 */
async function makeUserMessage(input) {
  if (!userMessageFactory) {
    try {
      const llm = await import('@deepseek-ai/dsh-llm')
      userMessageFactory =
        typeof llm.createUserMessage === 'function'
          ? llm.createUserMessage
          : (payload) => ({ ...payload, role: 'user', id: randomUUID() })
    } catch {
      userMessageFactory = (payload) => ({ ...payload, role: 'user', id: randomUUID() })
    }
  }
  return userMessageFactory(input)
}

function isRuleSource(source) {
  return (
    typeof source === 'object' &&
    source !== null &&
    source.kind === RULE_SOURCE_KIND &&
    Array.isArray(source.changes)
  )
}

/**
 * 从会话历史里读三样东西：
 *   changes        本插件注入过的规则变更（按发生顺序），锚点上的增量补丁；
 *   baselineText   官方基线正文——里面带着 AGENTS.md 全文，是锚点的主来源；
 *   baselineDigest 基线记录的文件摘要，正文解析不出来时的兜底。
 * 全部都只从 user/message 事件里取，所以重启后照样读得回来。
 */
function readSessionState(agent) {
  const state = { changes: [], hasInjection: false, baselineDigest: '', baselineText: '' }
  const session = agent?.session
  const nodes = session?.surface?.nodes
  if (!nodes || typeof session.eventAt !== 'function') return state
  for (const seq of nodes) {
    let event
    try {
      event = session.eventAt(seq)
    } catch {
      continue
    }
    if (!event || event.type !== 'user/message') continue
    const source = event.data?.source
    if (!source || typeof source !== 'object') continue
    if (isRuleSource(source)) {
      state.hasInjection = true
      for (const change of source.changes) {
        if (!change || typeof change.digest !== 'string' || !change.digest) continue
        state.changes.push({
          action: change.action === 'remove' ? 'remove' : 'add',
          digest: change.digest,
        })
      }
      continue
    }
    // 官方基线：正文里有 AGENTS.md 全文，changes 里还带文件摘要。后出现的替代基线覆盖前面的。
    if (source.kind !== 'agent-instructions' || source.baseline !== true) continue
    const text = messageText(event.data?.content)
    if (text) state.baselineText = text
    for (const change of Array.isArray(source.changes) ? source.changes : []) {
      if (!change || typeof change.digest !== 'string') continue
      if (change.action !== 'set' && change.action !== 'replace') continue
      if (typeof change.path === 'string' && change.path.endsWith(AGENTS_FILE)) {
        state.baselineDigest = change.digest
      }
    }
  }
  return state
}

function messageText(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const part of content) {
    if (part && typeof part.text === 'string') parts.push(part.text)
  }
  return parts.join('\n')
}

/**
 * 锚点主来源：直接解析基线正文里的托管块。
 *
 * 这是「会话先开、规则后改」唯一算得准的路子——渲染历史只记录本插件写过的版本，
 * 会话启动时那一版可能从来没被这个版本写过（别的东西写的，或者 renders 本来就是空的）。
 * 正文是模型真正看见过的东西，规则怎么渲染出去，就能怎么解析回来。
 * 返回 null 表示正文里找不到 AGENTS.md 那一段，交给兜底。
 */
function anchorFromBaseline(state) {
  if (!state.baselineText) return null
  const section = agentsSectionFromBaseline(state.baselineText)
  if (!section) return null
  return digestsOfTexts(parseBlockRules(section))
}

/** 兜底：拿基线摘要去渲染历史里找当时那一版。只有本插件写过那一版才找得到。 */
function anchorFromRenders(renders, digest) {
  if (!digest) return null
  for (const entry of Array.isArray(renders) ? renders : []) {
    if (!entry || entry.fileDigest !== digest) continue
    if (!Array.isArray(entry.rules)) continue
    return entry.rules.map((item) => String(item?.digest ?? '')).filter(Boolean)
  }
  return null
}

/**
 * 会话当前的规则视图 = 基线那一版的摘要集合 + 之后每次注入的加减。
 * 只用注入历史当锚点是不行的：首轮注入了一条删除，次轮就会把基线里那些没被提到
 * 的规则当成新增，全部重发一遍。
 */
function sessionAnchor(doc, state) {
  const base = anchorFromBaseline(state) ?? anchorFromRenders(doc.renders, state.baselineDigest)
  if (!base) return null
  const anchor = new Set(base)
  for (const change of state.changes) {
    if (change.action === 'remove') anchor.delete(change.digest)
    else anchor.add(change.digest)
  }
  return [...anchor]
}

/**
 * 算出这个会话该补哪几条规则，并包成一条 user 消息。
 * 返回 undefined 表示「这轮什么都不说」——没有变化、认不出锚点、或者根本没有规则。
 */
async function incrementalMessageFor(agent) {
  const home = dshHome()
  const doc = readStoreDoc(join(home, JSON_FILE))
  if (!doc.rules.length && !doc.renders.length) return undefined
  const state = readSessionState(agent)
  const anchor = sessionAnchor(doc, state)
  if (!anchor) return undefined
  const diff = diffRules(anchor, doc.rules)
  if (!hasDiff(diff)) return undefined
  const text = renderIncrementalReminder(diff)
  if (!text) return undefined
  return makeUserMessage({
    content: [{ type: 'text', text }],
    source: {
      kind: RULE_SOURCE_KIND,
      form: 'incremental',
      changes: incrementalChanges(diff),
    },
  })
}

export function apply(ctx) {
  // 钩子先注册：即使这个 profile 没有 webServer，规则增量注入也该工作。
  if (typeof ctx.on === 'function') {
    ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
      const decision = await next()
      if (!decision || decision.kind === 'reject') return decision
      let message
      try {
        message = await incrementalMessageFor(agent)
      } catch (err) {
        try {
          ctx.logger?.warn?.(`[${NS}] 增量规则计算失败: ${err?.message || err}`)
        } catch {
          /* 日志失败不影响这一轮 */
        }
        return decision
      }
      signal?.throwIfAborted?.()
      if (!message) return decision
      const list = Array.isArray(decision.messages) ? decision.messages : []
      if (list.some((item) => item && item.id === message.id)) return decision
      // 紧跟在这次真正被认领的消息后面：用户刚说完话，提醒就贴在那句之后。
      const claimed = Array.isArray(messages) ? messages : []
      const lastClaimed = list.findLastIndex((item) => claimed.includes(item))
      const at = lastClaimed >= 0 ? lastClaimed + 1 : list.length
      return { ...decision, messages: list.toSpliced(at, 0, message) }
    })
  }

  const webServer = ctx.webServer ?? (typeof ctx.get === 'function' ? ctx.get('webServer') : undefined)
  if (!webServer || typeof webServer.register !== 'function') {
    try {
      ctx.logger?.warn?.(`[${NS}] 当前 profile 没有 webServer，规则面板的读写接口未注册。`)
    } catch {
      /* 日志失败不影响加载 */
    }
    return
  }

  /** 浏览器信任栅栏：自定义路由必须过一遍，否则可被任意网页读写本机规则。 */
  function rejected(req, res) {
    try {
      const conn = ctx.connection ?? (typeof ctx.get === 'function' ? ctx.get('connection') : undefined)
      if (!conn || typeof conn.requestRejection !== 'function') return false
      const code = conn.requestRejection(req)
      if (code === undefined || code === null || code === false) return false
      res.statusCode = typeof code === 'number' ? code : 403
      res.end()
      return true
    } catch {
      return false
    }
  }

  function sendJson(res, code, payload) {
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': String(body.length),
    })
    res.end(body)
  }

  function readBody(req, limit = 512 * 1024) {
    return new Promise((resolve) => {
      let size = 0
      const chunks = []
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > limit) {
          req.destroy()
          resolve('')
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', () => resolve(''))
    })
  }

  ctx.effect(
    () =>
      webServer.register({
        kind: 'prefix',
        path: ROUTE,
        async handler(req, res) {
          if (rejected(req, res)) return
          try {
            if (req.method === 'GET') {
              sendJson(res, 200, buildState())
              return
            }
            if (req.method !== 'POST') {
              sendJson(res, 405, { ok: false, error: 'method not allowed' })
              return
            }
            const raw = await readBody(req)
            let payload = {}
            try {
              payload = raw ? JSON.parse(raw) : {}
            } catch {
              sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' })
              return
            }
            const op = String(payload.op || '')
            if (op === 'save') {
              const rules = persist(payload.rules)
              sendJson(res, 200, { ...buildState(), rules, saved: rules.length })
              return
            }
            if (op === 'import') {
              const { imported } = importFromAgentsMd()
              sendJson(res, 200, { ...buildState(), imported })
              return
            }
            sendJson(res, 400, { ok: false, error: '未知操作: ' + op })
          } catch (err) {
            sendJson(res, 500, { ok: false, error: String(err?.message || err) })
          }
        },
      }),
    `${NS}: route`,
  )

  try {
    ctx.logger?.info?.(`[${NS}] 规则面板接口已注册 ${ROUTE}，落地 ${join(dshHome(), AGENTS_FILE)}`)
  } catch {
    /* 日志失败不影响加载 */
  }
}

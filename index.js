/**
 * dsh-agent-rules — Host 半侧。
 *
 * 在设置页里维护一份「全局规则」列表，渲染进 ~/.dsh/AGENTS.md 的托管块。
 * DSH 内置的 @deepseek-ai/dsh-agent-instructions（dsh-base 已挂载，预算 64 KB）
 * 会在每个会话的首次请求把这份文件作为工作区指令注入，所以规则天然全局生效。
 *
 * 只做两件事：一个 JSON 存储、一份 markdown 落地。不碰 prompt assemble，
 * 不和别的插件抢 system 段。
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  MAX_RULES,
  MAX_RULE_CHARS,
  SCHEMA_VERSION,
  manualBytes,
  mergeAgentsMd,
  normalizeRules,
  parseRulesFromMd,
  renderBlock,
  splitAgentsMd,
} from './rules.js'

const NS = 'dsh-agent-rules'
const ROUTE = '/dsh-agent-rules'
const JSON_FILE = 'agent-rules.json'
const AGENTS_FILE = 'AGENTS.md'
const CLAUDE_FILE = 'CLAUDE.md'

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

function readStore(file) {
  const raw = readText(file)
  if (!raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : parsed?.rules
    return normalizeRules(list)
  } catch {
    return []
  }
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

/** 写 JSON + 重渲染 AGENTS.md，返回落盘后的规则。 */
function persist(rules) {
  const home = dshHome()
  const clean = normalizeRules(rules)
  const rulesPath = join(home, JSON_FILE)
  mkdirSync(dirname(rulesPath), { recursive: true })
  writeFileSync(
    rulesPath,
    JSON.stringify({ version: SCHEMA_VERSION, rules: clean }, null, 2) + '\n',
    'utf8',
  )
  const agentsPath = join(home, AGENTS_FILE)
  const next = mergeAgentsMd(readText(agentsPath), renderBlock(clean))
  writeFileSync(agentsPath, next, 'utf8')
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

export function apply(ctx) {
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

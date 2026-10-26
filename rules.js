/**
 * dsh-agent-rules — 规则数据模型与 AGENTS.md 渲染（纯逻辑，无 IO，可单测）。
 *
 * 数据分两处：
 *   ~/.dsh/agent-rules.json  本面板托管的结构化规则（id / text / enabled）
 *   ~/.dsh/AGENTS.md         由本插件渲染出的 markdown，DSH 内置
 *                            @deepseek-ai/dsh-agent-instructions 会加载它
 *
 * AGENTS.md 里只有两个标记之间的内容是托管区，标记之外的手写内容原样保留，
 * 面板不会覆盖用户自己写的东西。
 */

export const BLOCK_START = '<!-- dsh-agent-rules:start -->'
export const BLOCK_END = '<!-- dsh-agent-rules:end -->'
export const MAX_RULES = 200
export const MAX_RULE_CHARS = 2000
export const SCHEMA_VERSION = 1

let seq = 0

/** 规则 id：时间戳 + 自增 + 随机尾巴，够唯一且可读。 */
export function newRuleId() {
  seq = (seq + 1) % 1000
  return `r${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

/** 统一换行、去掉控制字符、裁剪长度。 */
export function normalizeText(value, max = MAX_RULE_CHARS) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim()
    .slice(0, max)
}

/**
 * 清洗任意输入成合法规则数组：去空、去重 id、补 id、补 enabled。
 * @param input 任意形状的规则列表
 */
export function normalizeRules(input) {
  const list = Array.isArray(input) ? input : []
  const seen = new Set()
  const out = []
  for (const raw of list) {
    if (!raw) continue
    const text = normalizeText(typeof raw === 'string' ? raw : raw.text)
    if (!text) continue
    let id = typeof raw === 'object' && raw.id ? normalizeText(raw.id, 64) : ''
    if (!id || seen.has(id)) id = newRuleId()
    seen.add(id)
    out.push({ id, text, enabled: typeof raw === 'object' ? raw.enabled !== false : true })
    if (out.length >= MAX_RULES) break
  }
  return out
}

/** 一条规则渲染成一个 markdown 列表项；多行规则用续行缩进。 */
export function renderRuleLine(rule) {
  const lines = normalizeText(rule?.text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (!lines.length) return ''
  const [first, ...rest] = lines
  return ['- ' + first, ...rest.map((line) => '  ' + line)].join('\n')
}

/** 只渲染启用中的规则；一条都没有时返回空串（调用方据此摘掉标记块）。 */
export function renderBlock(rules) {
  const items = normalizeRules(rules)
    .filter((rule) => rule.enabled)
    .map(renderRuleLine)
    .filter(Boolean)
  if (!items.length) return ''
  return [BLOCK_START, ...items, BLOCK_END].join('\n')
}

/** 把 AGENTS.md 切成「托管块之外的前文 / 之外的后文」；没有块时全文都算手写内容。 */
export function splitAgentsMd(existing) {
  const text = String(existing ?? '').replace(/\r\n?/g, '\n')
  const at = text.indexOf(BLOCK_START)
  if (at < 0) return { before: text, after: '', hasBlock: false }
  const endAt = text.indexOf(BLOCK_END, at)
  if (endAt < 0) return { before: text.slice(0, at), after: '', hasBlock: true }
  return {
    before: text.slice(0, at),
    after: text.slice(endAt + BLOCK_END.length),
    hasBlock: true,
  }
}

/**
 * 把托管块拼回 AGENTS.md：块外内容原样保留，块放最后。
 * 返回空串表示这个文件应该被清空（没有规则也没有手写内容）。
 */
export function mergeAgentsMd(existing, block) {
  const { before, after } = splitAgentsMd(existing)
  const head = before.replace(/^\s+/, '').replace(/\s+$/, '')
  const tail = after.replace(/^\s+/, '').replace(/\s+$/, '')
  const parts = []
  if (head) parts.push(head)
  if (block) parts.push(block)
  if (tail) parts.push(tail)
  return parts.length ? parts.join('\n\n') + '\n' : ''
}

/** 取托管块里已经渲染出去的规则文本（用于和 json 对账）。 */
export function parseBlockRules(existing) {
  const text = String(existing ?? '').replace(/\r\n?/g, '\n')
  const at = text.indexOf(BLOCK_START)
  if (at < 0) return []
  const endAt = text.indexOf(BLOCK_END, at)
  const body = text.slice(at + BLOCK_START.length, endAt < 0 ? text.length : endAt)
  return splitListItems(body)
}

/** 把 markdown 列表拆成条目，续行并回上一条。 */
function splitListItems(body) {
  const out = []
  let current = null
  for (const raw of String(body ?? '').split('\n')) {
    const line = raw.replace(/\s+$/, '')
    const bullet = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/)
    if (bullet) {
      if (current) out.push(normalizeText(current))
      current = bullet[1]
      continue
    }
    if (!line.trim()) {
      if (current) out.push(normalizeText(current))
      current = null
      continue
    }
    if (current !== null) current += '\n' + line.replace(/^\s{1,4}(?=\S)/, '').trim()
    else current = line
  }
  if (current) out.push(normalizeText(current))
  return out.filter(Boolean)
}

/**
 * 导入：把 AGENTS.md 里托管块之外的手写内容拆成规则文本。
 * 有列表就按列表项拆，没有列表就按空行分段。
 */
export function parseRulesFromMd(existing) {
  const { before, after } = splitAgentsMd(existing)
  const manual = [before, after].join('\n\n').trim()
  if (!manual) return []
  if (/^\s*(?:[-*+]|\d+[.)])\s+/m.test(manual)) return splitListItems(manual)
  return manual
    .split(/\n{2,}/)
    .map((chunk) => normalizeText(chunk))
    .filter(Boolean)
}

/** 手写内容的字节数（托管块之外），面板用来提示「这里还有你自己写的 X」。 */
export function manualBytes(existing) {
  const { before, after } = splitAgentsMd(existing)
  const manual = [before, after].join('\n').trim()
  return manual ? Buffer.byteLength(manual, 'utf8') : 0
}

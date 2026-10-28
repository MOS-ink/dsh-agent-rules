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

import { createHash } from 'node:crypto'

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

// ── 增量注入：摘要、对账与提醒文案 ──────────────────────────────────────────

/** 一段文本的 SHA-1。官方指令加载器对 AGENTS.md 用的就是这个算法，两边必须一致。 */
export function sha1Hex(text) {
  return createHash('sha1').update(String(text ?? ''), 'utf8').digest('hex')
}

/** 一条规则的内容摘要；改字即变值，用来判断「这条被改过」。 */
export function ruleDigest(rule) {
  return sha1Hex(normalizeText(rule?.text))
}

/** 启用中的规则压成 [{id, digest}]，只在渲染历史里用（正文里没有 id，锚点不靠它）。 */
export function digestRules(rules) {
  return normalizeRules(rules)
    .filter((rule) => rule.enabled)
    .map((rule) => ({ id: rule.id, digest: ruleDigest(rule) }))
}

/**
 * 从官方基线消息正文里取出 AGENTS.md 那一段。
 *
 * 基线正文是 `Instructions from: <显示路径>\n\n<文件全文>` 一段挨一段拼起来的。
 * 用户全局文件排在最前，所以取第一个路径以 AGENTS.md 结尾的段即可：
 * 那段没有托管块（说明会话启动时还没有规则）时返回空串，对账方按「一条都没下发过」处理，
 * 这个语义是对的——模型确实没看见过。
 *
 * @param text 基线消息里那条 text part 的完整正文
 */
export function agentsSectionFromBaseline(text) {
  const body = String(text ?? '')
  const marker = 'Instructions from: '
  let at = body.indexOf(marker)
  while (at >= 0) {
    const lineEnd = body.indexOf('\n', at)
    const path = (lineEnd < 0 ? body.slice(at + marker.length) : body.slice(at + marker.length, lineEnd)).trim()
    if (path.endsWith('AGENTS.md')) {
      const contentStart = lineEnd < 0 ? body.length : lineEnd
      const nextHeader = body.indexOf('\n' + marker, contentStart)
      const frameEnd = body.indexOf('</system-reminder>', contentStart)
      let end = body.length
      if (nextHeader >= 0) end = Math.min(end, nextHeader)
      if (frameEnd >= 0) end = Math.min(end, frameEnd)
      return body.slice(contentStart, end).trim()
    }
    at = body.indexOf(marker, at + marker.length)
  }
  return ''
}

/**
 * 片段文本 → 摘要集合。这是锚点的唯一身份：正文里没有规则 id，
 * 同一段文字就是同一条规则，改一个字就是另一条。
 */
export function digestsOfTexts(texts) {
  return (Array.isArray(texts) ? texts : []).map((text) => sha1Hex(normalizeText(text))).filter(Boolean)
}

/**
 * 当前规则相比锚点集合有什么变化。纯集合运算：
 * 当前有、锚点没有 → 新增；锚点有、当前没有 → 移除（改文本自然是一删一增）。
 * @param anchor 会话已经看到过的规则摘要数组
 * @param rules 当前规则列表
 */
export function diffRules(anchor, rules) {
  const before = new Set()
  for (const digest of Array.isArray(anchor) ? anchor : []) {
    if (typeof digest === 'string' && digest) before.add(digest)
  }
  const current = new Set()
  const added = []
  for (const rule of normalizeRules(rules)) {
    if (!rule.enabled) continue
    const digest = ruleDigest(rule)
    if (current.has(digest)) continue
    current.add(digest)
    if (!before.has(digest)) added.push({ text: rule.text, digest })
  }
  const removed = [...before].filter((digest) => !current.has(digest))
  return { added, removed }
}

/** 有没有值得一提的变化。 */
export function hasDiff(diff) {
  return Boolean(diff && (diff.added.length || diff.removed.length))
}

/** 规则正文不能带出框架的闭合标签，否则模型会把注入框提前关掉。 */
function escapeFrameBody(body) {
  return String(body ?? '').replaceAll('</system-reminder>', '<\\/system-reminder>')
}

/**
 * 渲染增量提醒的模型可见文本。
 * 只列新增/改动后的规则原文；消失的那些合并成一行——它们的旧文本不再有意义。
 */
export function renderIncrementalReminder(diff) {
  if (!hasDiff(diff)) return ''
  const blocks = []
  if (diff.added.length) {
    blocks.push(
      'The global agent rules changed after this session started. ' +
        'The rules below were added or edited since then; where they conflict with rules loaded earlier in this conversation, these take precedence.',
    )
    blocks.push(diff.added.map((item) => renderRuleLine({ text: item.text })).filter(Boolean).join('\n'))
  }
  if (diff.removed.length) {
    const count = diff.removed.length
    blocks.push(
      count === 1
        ? '1 rule was removed, disabled, or replaced by an edited version and no longer applies.'
        : `${count} rules were removed, disabled, or replaced by edited versions and no longer apply.`,
    )
  }
  return ['<system-reminder>', escapeFrameBody(blocks.join('\n\n')), '</system-reminder>'].join('\n')
}

/**
 * 增量消息的 source.changes：只带摘要，不带 id。
 * 下一次对账就是拿这些摘要做集合加减，所以消息本身完全自描述。
 */
export function incrementalChanges(diff) {
  return [
    ...diff.added.map((item) => ({ action: 'add', digest: item.digest })),
    ...diff.removed.map((digest) => ({ action: 'remove', digest })),
  ]
}

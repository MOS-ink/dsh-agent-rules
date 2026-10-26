import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BLOCK_END,
  BLOCK_START,
  manualBytes,
  mergeAgentsMd,
  normalizeRules,
  parseBlockRules,
  parseRulesFromMd,
  renderBlock,
  splitAgentsMd,
} from '../rules.js'

test('normalizeRules drops empties, keeps ids unique, defaults enabled', () => {
  const rules = normalizeRules([
    { id: 'a', text: '  第一条  ' },
    { id: 'a', text: '重复 id' },
    { text: '' },
    null,
    { id: 'b', text: '停用的', enabled: false },
    '字符串规则',
  ])
  assert.equal(rules.length, 4)
  assert.equal(rules[0].text, '第一条')
  assert.equal(rules[0].enabled, true)
  assert.equal(rules[1].enabled, true)
  assert.equal(rules[2].enabled, false)
  assert.equal(rules[3].text, '字符串规则')
  const ids = new Set(rules.map((rule) => rule.id))
  assert.equal(ids.size, rules.length)
  assert.ok(rules.every((rule) => rule.id.length > 0))
})

test('renderBlock renders only enabled rules and indents continuation lines', () => {
  const block = renderBlock([
    { id: 'a', text: '开启的', enabled: true },
    { id: 'b', text: '关掉的', enabled: false },
    { id: 'c', text: '多行\n第二行', enabled: true },
  ])
  const lines = block.split('\n')
  assert.equal(lines[0], BLOCK_START)
  assert.equal(lines[lines.length - 1], BLOCK_END)
  assert.ok(block.includes('- 开启的'))
  assert.ok(!block.includes('关掉的'))
  assert.ok(block.includes('- 多行\n  第二行'))
})

test('renderBlock is empty when nothing is enabled', () => {
  assert.equal(renderBlock([{ id: 'a', text: 'x', enabled: false }]), '')
  assert.equal(renderBlock([]), '')
})

test('mergeAgentsMd keeps manual content around the managed block', () => {
  const existing = '# 我自己的笔记\n\n这段是手写的。\n'
  const block = renderBlock([{ id: 'a', text: '规则一', enabled: true }])
  const merged = mergeAgentsMd(existing, block)
  assert.ok(merged.startsWith('# 我自己的笔记'))
  assert.ok(merged.includes(block))
  assert.ok(merged.indexOf('这段是手写的。') < merged.indexOf(BLOCK_START))
  assert.ok(merged.endsWith('\n'))
})

test('mergeAgentsMd is idempotent', () => {
  const block = renderBlock([{ id: 'a', text: '规则一', enabled: true }])
  const once = mergeAgentsMd('# 手写\n', block)
  const twice = mergeAgentsMd(once, block)
  assert.equal(twice, once)
})

test('removing every rule drops the block but keeps manual text', () => {
  const block = renderBlock([{ id: 'a', text: '规则一', enabled: true }])
  const withBlock = mergeAgentsMd('# 手写\n', block)
  const cleared = mergeAgentsMd(withBlock, '')
  assert.equal(cleared, '# 手写\n')
  assert.ok(!cleared.includes(BLOCK_START))
})

test('splitAgentsMd reports manual bytes outside the block', () => {
  const block = renderBlock([{ id: 'a', text: '规则一', enabled: true }])
  const merged = mergeAgentsMd('# 手写两字\n', block)
  const split = splitAgentsMd(merged)
  assert.equal(split.hasBlock, true)
  assert.ok(split.before.includes('# 手写两字'))
  assert.ok(manualBytes(merged) > 0)
  assert.equal(manualBytes(block), 0)
})

test('parseBlockRules reads back what renderBlock wrote', () => {
  const block = renderBlock([
    { id: 'a', text: '规则一', enabled: true },
    { id: 'c', text: '多行\n第二行', enabled: true },
  ])
  assert.deepEqual(parseBlockRules(block), ['规则一', '多行\n第二行'])
})

test('parseRulesFromMd imports list items', () => {
  const md = '- 不要擅自结束对话\n- 回答先给结论\n\n- 第三条\n'
  assert.deepEqual(parseRulesFromMd(md), ['不要擅自结束对话', '回答先给结论', '第三条'])
})

test('parseRulesFromMd imports paragraphs when there is no list', () => {
  const md = '第一段规则说明。\n\n第二段规则说明。\n'
  assert.deepEqual(parseRulesFromMd(md), ['第一段规则说明。', '第二段规则说明。'])
})

test('parseRulesFromMd ignores the managed block', () => {
  const block = renderBlock([{ id: 'a', text: '托管规则', enabled: true }])
  const merged = mergeAgentsMd('手写一条\n', block)
  assert.deepEqual(parseRulesFromMd(merged), ['手写一条'])
})

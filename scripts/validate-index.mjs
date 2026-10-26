#!/usr/bin/env node
/**
 * 校验 market/index.json 是否为合法的插件市场索引格式 1。
 *
 * 用法：
 *   node scripts/validate-index.mjs [文件] [索引的最终 URL]
 *
 * 索引 URL 参与相对图标解析，所以要通过它给出文件将被托管的位置。
 * 校验器来自 @deepseek-ai/dsh-plugin-market-index —— 在 DeepSeek Harness
 * 的依赖环境里才能解析到它。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const file = process.argv[2] || 'market/index.json'
const indexUrl = process.argv[3] || 'https://example.com/market/index.json'

let parseMarketIndex
try {
  ;({ parseMarketIndex } = await import('@deepseek-ai/dsh-plugin-market-index'))
} catch {
  console.error(
    '无法解析 @deepseek-ai/dsh-plugin-market-index。\n' +
      '请在 DeepSeek Harness 的依赖环境里运行，或先把该包安装到可解析的位置。',
  )
  process.exit(2)
}

let parsed
try {
  parsed = JSON.parse(readFileSync(resolve(file), 'utf8'))
} catch (err) {
  console.error(`读取或解析失败：${err.message}`)
  process.exit(1)
}

try {
  const index = parseMarketIndex(parsed, indexUrl)
  console.log(`ok: ${index.plugins.length} 个插件`)
  for (const plugin of index.plugins) {
    const versions = plugin.versions.map((entry) => entry.version).join(', ')
    console.log(`  ${plugin.name}  ${versions}`)
  }
} catch (err) {
  if (err && typeof err.path === 'string') {
    console.error(`invalid: ${err.path} ${err.reason}`)
    process.exit(1)
  }
  throw err
}

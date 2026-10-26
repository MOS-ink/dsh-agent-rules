#!/usr/bin/env node
/**
 * 发布到 npm 官方源，等待 npmmirror 同步，并核对两边的版本可见性。
 *
 *   node scripts/publish.mjs            # 发布当前 package.json 版本
 *   node scripts/publish.mjs --dry-run  # 只跑前置检查
 *
 * npmmirror（registry.npmmirror.com）是 npm 官方源的全量镜像，不能单独发布；
 * 发一次官方源，镜像会在几分钟内自己跟上。这个脚本就是替你把那段等待盯完。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const DRY = process.argv.includes('--dry-run')
const MIRROR = 'https://registry.npmmirror.com'
const OFFICIAL = 'https://registry.npmjs.org'

function run(args, opts = {}) {
  const result = spawnSync(NPM, args, {
    stdio: 'inherit',
    cwd: ROOT,
    shell: process.platform === 'win32',
    ...opts,
  })
  if (result.status !== 0) {
    console.error(`\n失败：npm ${args.join(' ')}`)
    process.exit(result.status ?? 1)
  }
}

function capture(args) {
  const result = spawnSync(NPM, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    cwd: ROOT,
  })
  return { ok: result.status === 0, out: (result.stdout || '').trim(), err: (result.stderr || '').trim() }
}

async function head(url) {
  try {
    const res = await fetch(url, { redirect: 'error' })
    return res.status
  } catch {
    return 0
  }
}

console.log(`包：${PKG.name}@${PKG.version}`)

const who = capture(['whoami'])
if (!who.ok) {
  console.error('\n未登录 npm。先执行 npm login（浏览器授权），再回来跑这个脚本。')
  process.exit(1)
}
console.log(`账号：${who.out}`)

const taken = await head(`${OFFICIAL}/${PKG.name}/${PKG.version}`)
if (taken === 200) {
  console.error(`\n${PKG.name}@${PKG.version} 已经发布过了。升版本号再发。`)
  process.exit(1)
}
console.log(`版本占位：${PKG.name}@${PKG.version} 未被占用`)

console.log('\n跑测试…')
run(['test'])

if (DRY) {
  console.log('\n--dry-run：前置检查通过，未发布。')
  process.exit(0)
}

console.log('\n发布…')
run(['publish', '--access', 'public'])

console.log('\n等 npmmirror 同步…')
const deadline = Date.now() + 10 * 60 * 1000
let synced = false
while (Date.now() < deadline) {
  const status = await head(`${MIRROR}/${PKG.name}/${PKG.version}`)
  if (status === 200) {
    synced = true
    break
  }
  await new Promise((resolve) => setTimeout(resolve, 10_000))
  process.stdout.write(status === 200 ? '' : '.')
}

console.log('')
if (synced) {
  console.log(`镜像已同步：${MIRROR}/${PKG.name}/${PKG.version}`)
} else {
  console.log(`镜像 10 分钟内未同步。稍后用这条命令复查：`)
  console.log(`  curl -s ${MIRROR}/${PKG.name}/${PKG.version}`)
}

console.log('\n下一步：把 market/index.json 里这一版的 source 改成 npm')
console.log(`  { "type": "npm" }`)
console.log('然后 commit 并 push，索引源即刻生效。')

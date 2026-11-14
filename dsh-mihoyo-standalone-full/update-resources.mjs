#!/usr/bin/env node
/**
 * 增量拉取 miao-plugin 的 meta 资源（meta-gs / meta-sr）。
 *
 * 思路照搬 GsCore 的 download_core：
 *   1. 一次 GitHub 递归树 API 拿到上游全部文件清单（path + size）
 *   2. 对比本地，算出缺的和变了的
 *   3. 多源并发下载，raw 直连不通就换镜像
 *   4. 全程打印进度
 *
 * 用法：
 *   node update-resources.mjs                 # 同步两个游戏
 *   node update-resources.mjs --dry-run       # 只看会动哪些文件
 *   node update-resources.mjs --only gs       # 只更新原神
 *   node update-resources.mjs --only sr       # 只更新星铁
 *   node update-resources.mjs --force         # 忽略大小对比，全部重下
 *   node update-resources.mjs --concurrency 4 # 并发数（默认 6）
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const TARGET_ROOT = join(
  SCRIPT_DIR,
  'data/miao-root/plugins/miao-plugin/resources',
)
const UPSTREAM_REPO = 'yoimiya-kokomi/miao-plugin'
const UPSTREAM_BRANCH = 'master'

// 下载源，按顺序试；先测一次再决定顺序
const RAW_SOURCES = [
  {
    name: 'raw.github',
    build: (p) =>
      `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${UPSTREAM_BRANCH}/${p}`,
  },
  {
    name: 'ghfast',
    build: (p) =>
      `https://ghfast.top/https://raw.githubusercontent.com/${UPSTREAM_REPO}/${UPSTREAM_BRANCH}/${p}`,
  },
  {
    name: 'jsdelivr',
    build: (p) =>
      `https://cdn.jsdelivr.net/gh/${UPSTREAM_REPO}@${UPSTREAM_BRANCH}/${p}`,
  },
]

const ARGS = process.argv.slice(2)
const DRY_RUN = ARGS.includes('--dry-run')
const FORCE = ARGS.includes('--force')
const onlyIdx = ARGS.indexOf('--only')
const ONLY = onlyIdx >= 0 ? ARGS[onlyIdx + 1] : null
const concIdx = ARGS.indexOf('--concurrency')
const CONCURRENCY = concIdx >= 0 ? Math.max(1, Number(ARGS[concIdx + 1]) || 6) : 6

const DIRS =
  ONLY === 'gs'
    ? ['meta-gs']
    : ONLY === 'sr'
      ? ['meta-sr']
      : ['meta-gs', 'meta-sr']

function listFiles(root) {
  const out = []
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name)
      if (ent.isDirectory()) walk(full)
      else if (ent.isFile()) out.push(relative(root, full))
    }
  }
  if (existsSync(root)) walk(root)
  return out
}

/** 拿上游清单：一次递归树请求 */
async function fetchUpstreamTree() {
  const api = `https://api.github.com/repos/${UPSTREAM_REPO}/git/trees/${UPSTREAM_BRANCH}?recursive=1`
  const r = await fetch(api, {
    headers: { 'user-agent': 'dsh-update-resources' },
    signal: AbortSignal.timeout(60000),
  })
  if (!r.ok) throw new Error(`GitHub API ${r.status} ${r.statusText}`)
  const j = await r.json()
  if (j.truncated) {
    throw new Error('上游文件树被截断（>100k 条目），请改用 --only 分批')
  }
  return j.tree.filter(
    (n) =>
      n.type === 'blob' &&
      DIRS.some((d) => n.path.startsWith(`resources/${d}/`)),
  )
}

/** 探测下载源：拿最小的那个 data.json 试 */
async function pickSource() {
  const probe = `resources/meta-gs/artifact/index.js`
  for (const src of RAW_SOURCES) {
    const t0 = Date.now()
    try {
      const r = await fetch(src.build(probe), {
        method: 'HEAD',
        signal: AbortSignal.timeout(15000),
      })
      if (r.ok) {
        console.log(`  ${src.name.padEnd(12)} ${String(Date.now() - t0).padStart(5)} ms`)
        return src
      }
    } catch {
      // 下一个
    }
    console.log(`  ${src.name.padEnd(12)}   FAIL`)
  }
  throw new Error('所有下载源都不通')
}

async function downloadOne(path, size, src) {
  const dst = join(TARGET_ROOT, path.replace(/^resources\//, ''))
  const had = existsSync(dst)
  if (!FORCE && had && statSync(dst).size === size) return 'skip'

  if (DRY_RUN) return had ? 'update' : 'add'

  mkdirSync(dirname(dst), { recursive: true })
  const r = await fetch(src.build(path), { signal: AbortSignal.timeout(120000) })
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${path}`)
  const buf = Buffer.from(await r.arrayBuffer())
  writeFileSync(dst, buf)
  return had ? 'update' : 'add'
}

// ---- main ----

console.log('=== miao resources incremental update ===')
console.log(`target : ${TARGET_ROOT}`)
console.log(`mode   : ${DRY_RUN ? 'dry-run' : 'apply'}${FORCE ? ' +force' : ''}`)
console.log(`dirs   : ${DIRS.join(', ')}   concurrency: ${CONCURRENCY}\n`)

if (!existsSync(TARGET_ROOT)) {
  console.error(`target dir missing: ${TARGET_ROOT}`)
  process.exit(1)
}

console.log('[1/4] fetch upstream tree')
const tree = await fetchUpstreamTree()
const totalBytes = tree.reduce((a, n) => a + (n.size || 0), 0)
console.log(
  `  ${tree.length} files, ${(totalBytes / 1048576).toFixed(1)} MB upstream`,
)

console.log('\n[2/4] local scan')
const localCount = DIRS.reduce(
  (a, d) => a + listFiles(join(TARGET_ROOT, d)).length,
  0,
)
console.log(`  ${localCount} files locally`)

console.log('\n[3/4] pick download source')
const src = await pickSource()

console.log(`\n[4/4] download via ${src.name}`)
const stats = { add: 0, update: 0, skip: 0, fail: 0 }
let done = 0
const queue = [...tree]

async function worker() {
  while (queue.length) {
    const item = queue.shift()
    if (!item) break
    try {
      const action = await downloadOne(item.path, item.size, src)
      stats[action] += 1
    } catch (e) {
      stats.fail += 1
      console.log(`  FAIL ${item.path}: ${e.message}`)
    }
    done += 1
    if (done % 200 === 0) {
      console.log(
        `  ${done}/${tree.length}  +${stats.add} ~${stats.update} =${stats.skip} !${stats.fail}`,
      )
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker))

console.log('\n=== done ===')
console.log(
  `+${stats.add} added, ~${stats.update} updated, =${stats.skip} skipped, !${stats.fail} failed`,
)
if (DRY_RUN) console.log('(dry-run: nothing written)')
else if (stats.add + stats.update > 0) console.log('restart the service to take effect')
if (stats.fail > 0) process.exitCode = 1

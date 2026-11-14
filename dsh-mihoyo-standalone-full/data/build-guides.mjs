// 批量：给所有角色抓一份最新攻略，存 data/guides/，写 index.json
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const 跑 = promisify(execFile)
const 根 = '/opt/dsh-mihoyo-standalone'
const 数据 = 根 + '/data'
const 指南 = 数据 + '/guides'
fs.mkdirSync(指南, { recursive: true })

const 读名单 = (游) => {
  const f = 数据 + '/miao-root/plugins/miao-plugin/resources/meta-' + 游 + '/character/data.json'
  if (!fs.existsSync(f)) return []
  const j = JSON.parse(fs.readFileSync(f, 'utf8'))
  const 列 = Array.isArray(j) ? j : Object.values(j)
  return 列.map((c) => c && (c.name || c.名称)).filter(Boolean)
}
const 别名表 = {}
try {
  for (const 游 of ['meta-gs', 'meta-sr']) {
    const f = 数据 + '/miao-root/plugins/miao-plugin/resources/' + 游 + '/character/alias.js'
    if (!fs.existsSync(f)) continue
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/^\s*['"]?([^'":]+?)['"]?\s*:\s*'([^']*)'/gm)) {
      for (const x of m[2].split(',')) { const k = x.trim().toLowerCase(); if (k) 别名表[k] = m[1].toLowerCase() }
    }
  }
} catch {}
const 原神 = 读名单('gs')
const 星铁 = 读名单('sr')
console.log('名单', 原神.length, 星铁.length)

const indexF = 指南 + '/index.json'
let 索引 = {}
try { 索引 = JSON.parse(fs.readFileSync(indexF, 'utf8')) } catch {}
const 键 = (游, 名) => 游 + ':' + String(名).trim().toLowerCase()
const 已有 = (游, 名) => {
  const e = 索引[键(游, 名)]
  return e && e.图片 && e.图片.length && e.图片.every((f) => fs.existsSync(f))
}

const 任务 = []
for (const 名 of 原神) 任务.push({ 游: 'gs', 名 })
for (const 名 of 星铁) 任务.push({ 游: 'sr', 名 })
const 待 = 任务.filter((t) => !已有(t.游, t.名))
console.log('待抓', 待.length, '已有', 任务.length - 待.length)

let i = 0, 成功 = 0, 失败 = []
const 并发 = Number(process.argv[2] || 3)
async function 工(t) {
  const n = ++i
  const 开始 = Date.now()
  try {
    const r = await 跑('/usr/local/bin/node', [数据 + '/guide-worker.mjs', t.名, t.游, 指南], { timeout: 300000, maxBuffer: 8 * 1024 * 1024 })
    const 行 = String(r.stdout || '').trim().split('\n').filter(Boolean).pop()
    const j = JSON.parse(行)
    if (!j.ok) throw new Error(j.说 || 'fail')
    // 把 cache 里的文件挪进 guides 目录（worker 直接写了 guides）
    const 条 = { 游: t.游, 名: j.查询 || t.名, 标题: j.标题, 更新: j.更新, 来源: j.来源, 图片: j.图片 }
    索引[键(t.游, t.名)] = 条
    索引[键(t.游, j.查询 || t.名)] = 条
    for (const [a, 正式] of Object.entries(别名表)) if (正式 === String(j.查询 || t.名).toLowerCase()) 索引[键(t.游, a)] = 条
    成功++
    console.log(`[${n}/${待.length}] OK ${t.游} ${t.名} ${j.更新 || ''} ${((Date.now() - 开始) / 1000).toFixed(0)}s`)
  } catch (e) {
    失败.push(t.游 + ':' + t.名)
    console.log(`[${n}/${待.length}] FAIL ${t.游} ${t.名} ${String(e.message).slice(0, 80)}`)
  }
  fs.writeFileSync(indexF, JSON.stringify(索引, null, 1))
}

const 队列 = 待.slice()
await Promise.all(Array.from({ length: 并发 }, async () => {
  while (队列.length) await 工(队列.shift())
}))
fs.writeFileSync(indexF, JSON.stringify(索引, null, 1))
console.log('DONE 成功', 成功, '失败', 失败.length)
fs.writeFileSync(指南 + '/fail.txt', 失败.join('\n'))

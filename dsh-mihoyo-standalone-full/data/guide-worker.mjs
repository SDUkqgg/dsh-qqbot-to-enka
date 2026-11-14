// guide-worker：从米游社抓角色攻略，按文章顺序取全部图，拼成 820 宽长图，超长切段
// 用法：node guide-worker.mjs <角色名> <gs|sr> <输出目录>
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const [名, 游戏, 输出目录] = [process.argv[2] || '', process.argv[3] || 'gs', process.argv[4] || '/tmp']
const 期望游戏 = 游戏 === 'sr' ? 6 : 2

const h = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124',
  referer: 'https://www.miyoushe.com/',
  'x-rpc-app_version': '2.70.0',
  'x-rpc-client_type': '4',
  'x-rpc-language': 'zh-cn'
}

const 说 = (o) => { console.log(JSON.stringify(o)); process.exit(0) }
if (!名) 说({ ok: false, 说: '缺角色名' })

const 键 = (await import('node:crypto')).createHash('sha1').update(名 + 游戏).digest('hex').slice(0, 10)
const 元 = 输出目录 + '/guide-' + 键 + '.json'
try {
  const st = fs.statSync(元)
  if (Date.now() - st.mtimeMs < 24 * 3600 * 1000) {
    const j = JSON.parse(fs.readFileSync(元, 'utf8'))
    if (j.图片 && j.图片.every((f) => fs.existsSync(f))) { j['缓存'] = true; 说(j) }
  }
} catch {}
const { default: sharp } = await import('sharp')

// 别名反查：meta-gs / meta-sr 的 character/alias.js
const 反别名 = {}
try {
  const 数据 = new URL('.', import.meta.url).pathname
  for (const 游 of ['meta-gs', 'meta-sr']) {
    const f = 数据 + 'miao-root/plugins/miao-plugin/resources/' + 游 + '/character/alias.js'
    if (!fs.existsSync(f)) continue
    const 原 = fs.readFileSync(f, 'utf8')
    for (const m of 原.matchAll(/^\s*['"]?([^'":]+?)['"]?\s*:\s*'([^']*)'/gm)) {
      for (const x of m[2].split(',')) { const k = x.trim().toLowerCase(); if (k) 反别名[k] = m[1] }
    }
  }
} catch {}
const 真名 = 反别名[String(名).trim().toLowerCase()] || 名
const 基础名 = 真名.replace(/LV\.?\d+$/i, '').replace(/Pro$/i, '').trim()
const 搜词 = async (kw) => {
  const r = await fetch('https://bbs-api.miyoushe.com/post/wapi/searchPosts?keyword=' + encodeURIComponent(kw), { headers: h })
  return await r.json().catch(() => null)
}
let 搜J = await 搜词(真名 + ' 攻略')
let 列0 = (搜J?.data?.posts || []).map((x) => x.post).filter((p) => p && p.post_id && p.game_id === 期望游戏)
if (!列0.length && 基础名 !== 真名) { 搜J = await 搜词(基础名 + ' 攻略'); 列0 = (搜J?.data?.posts || []).map((x) => x.post).filter((p) => p && p.post_id && p.game_id === 期望游戏) }
const 搜 = { ok: true }
const 搜J2 = 搜J
const 列 = 列0
if (!列.length) 说({ ok: false, 说: '米游社没搜到攻略' })

const 最新 = Math.max(...列.map((p) => p.updated_at || p.created_at || 0))
const 打分 = (p) => {
  let s = 0
  if (p.subject.includes(真名) || p.subject.includes(基础名)) s += 2
  if (/攻略|配队|养成|解析|一图|指南/.test(p.subject)) s += 3
  s += Math.min(6, (p.images || []).length)
  const 时 = (p.updated_at || p.created_at || 0) * 1000
  const 天 = (Date.now() - 时) / 86400000
  if (天数差(p) <= 30) s += 8
  else if (天数差(p) <= 90) s += 4
   else if (天数差(p) <= 200) s += 1
  if (p.updated_at && p.updated_at >= 最新 - 7 * 86400) s += 2
  if (/剧情|经验|准备|杂谈|抽取建议/.test(p.subject)) s -= 6
  return s
}
function 天数差(p) { return (Date.now() - (p.updated_at || p.created_at || 0) * 1000) / 86400000 }
const 选 = 列.map((p) => ({ p, s: 打分(p), n: (p.images || []).length })).sort((a, b) => b.s - a.s || b.n - a.n)[0].p

const 取帖 = async (id) => {
  const 主 = ['https://bbs-api.miyoushe.com', 'https://api-takumi.mihoyo.com']
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(主[i % 2] + '/post/wapi/getPostFull?post_id=' + id, { headers: h, signal: AbortSignal.timeout(25000) })
      const j = await r.json().catch(() => null)
      if (j?.data?.post?.post) return j.data.post.post
    } catch {}
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)))
  }
  return null
}
let 帖 = null
for (const 候选 of 列.slice(0, 5)) {
  const t = await 取帖(候选.post_id)
  if (!t) continue
  const c = (t.content || '') + JSON.stringify(t.structured_content || '')
  if (/upload-bbs[^"']+\.(jpg|jpeg|png|webp)/i.test(c)) { 帖 = t; break }
}
if (!帖) {
  // 封面兜底：接口读不到时，用搜索结果里的封面图（至少有一张）
  const 备 = 列.find((x) => (x.images || []).length)
  if (备) 帖 = { subject: 备.subject, post_id: 备.post_id, content: (备.images || []).map((u) => '<img src="' + u + '">').join(''), structured_content: '', user: {} }
}
if (!帖) 说({ ok: false, 说: '文章读不到' })

let 顺序 = []
try {
  const sc = typeof 帖.structured_content === 'string' ? JSON.parse(帖.structured_content) : 帖.structured_content
  const raw = JSON.stringify(sc || {})
  for (const m of raw.matchAll(/https:\/\/upload-bbs[^"\\]+\.(?:jpg|jpeg|png|webp)/gi)) 顺序.push(m[0])
} catch {}
const 内容图 = [...(帖.content || '').matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]).filter((u) => /upload-bbs.*\.(jpg|jpeg|png|webp)/i.test(u))
顺序 = [...new Set([...顺序, ...内容图])]
if (!顺序.length) 说({ ok: false, 说: '文章里没有图' })

const 片 = []
for (const u of 顺序) {
  try {
    const r = await fetch(u, { headers: { 'user-agent': h['user-agent'], referer: 'https://www.miyoushe.com/' }, signal: AbortSignal.timeout(40000) })
    const b = Buffer.from(await r.arrayBuffer())
    if (b.length < 20000) continue
    const meta = await sharp(b).metadata()
    if (!meta.width || meta.height < 40) continue
    const res = await sharp(b).resize({ width: 820 }).jpeg({ quality: 82 }).toBuffer()
    const m2 = await sharp(res).metadata()
    片.push({ b: res, w: m2.width, h: m2.height })
  } catch {}
}
if (!片.length) 说({ ok: false, 说: '图片都下载失败' })

// 按高度切段，每段不超过 9000 像素
const 段 = []
let 当前 = []
let 高 = 0
for (const p of 片) {
  if (高 + p.h > 9000 && 当前.length) { 段.push(当前); 当前 = []; 高 = 0 }
  当前.push(p); 高 += p.h
}
if (当前.length) 段.push(当前)

fs.mkdirSync(输出目录, { recursive: true })
const 文件 = []
for (let i = 0; i < 段.length; i++) {
  const g = 段[i]
  const w = Math.max(...g.map((x) => x.w))
  const hh = g.reduce((a, x) => a + x.h, 0)
  let y = 0
  const 层 = []
  for (const x of g) { 层.push({ input: x.b, left: 0, top: y }); y += x.h }
  const out = path.join(输出目录, `guide-${键}-${i + 1}.jpg`)
  await sharp({ create: { width: w, height: hh, channels: 3, background: '#ffffff' } }).composite(层).jpeg({ quality: 80 }).toFile(out)
  文件.push(out)
}

const 结果 = {
  ok: true,
  标题: 帖.subject,
  查询: 真名,
  更新: new Date(((列.find((x) => x.post_id === 帖.post_id) || {}).updated_at || 帖.updated_at || 0) * 1000).toISOString().slice(0, 10),
  来源: 'https://www.miyoushe.com/article/' + 帖.post_id,
  作者: 帖.user?.nickname || '',
  图片: 文件
}
try { fs.writeFileSync(元, JSON.stringify(结果), 'utf8') } catch {}
说(结果)

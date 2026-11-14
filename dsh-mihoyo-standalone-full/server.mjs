// dsh-mihoyo-standalone · 独立看板服务
// 不依赖 DSH：直接复用 dsh-mihoyo 的请求处理函数，自己起一个本地 HTTP 服务。
// 只读业务数据；出图接口与此前一致（写入 家/cache），不触碰 DSH、不启动 QQ 机器人。
import http from 'node:http'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from 'node:fs'
import { extname, join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const 根 = dirname(fileURLToPath(import.meta.url))
const 公共 = join(根, 'public')
const 家 = process.env.DSH_MIHOYO_HOME || join(根, 'data')
const 端口 = Number(process.env.MIHOYO_STANDALONE_PORT || process.env.PORT || 8788)
const 主机 = String(process.env.MIHOYO_HOST || '127.0.0.1')
// 先把数据目录定下来并写回环境变量，再动态载入业务模块，
// 这样 lib/index.js 里的“家”跟看板读的是同一个目录，不会绕回本机已有账号。
process.env.DSH_MIHOYO_HOME = 家
const { 处理请求 } = await import('./lib/index.js')
const { 启机器人, 停机器人, 机器人状态, 存机器人配置 } = await import('./lib/bot.js')

const 类型 = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

function 读Json(路, 默认 = null) {
  try { return JSON.parse(readFileSync(路, 'utf8').replace(/^\uFEFF/, '')) } catch { return 默认 }
}

function 铺数据目录() {
  try {
    mkdirSync(家, { recursive: true })
    const 写 = (名, 体) => { const 路 = join(家, 名); if (!existsSync(路)) writeFileSync(路, JSON.stringify(体, null, 2), 'utf8') }
    写('users.json', {})
    写('aliases.json', { gs: {}, sr: {}, zzz: {} })
    写('bot.json', { appId: '', appSecret: '', autoStart: false, sandbox: false })
    写('state.json', { uid: '', server: 'cn_gf01', nickname: '', cookie: '', stoken: '', mid: '', boundAt: '', lastCheckAt: '', lastError: '', panelCache: null })
    mkdirSync(join(家, 'cache'), { recursive: true })
  } catch (e) { console.log('数据目录初始化失败：' + String(e?.message || e)) }
}
铺数据目录()

let 名字表 = null
function 读名字表() {
  if (名字表) return 名字表
  名字表 = {}
  try {
    const 基 = join(家, 'miao-root', 'plugins', 'miao-plugin', 'resources', 'meta-sr', 'character')
    for (const d of readdirSync(基)) {
      const j = 读Json(join(基, d, 'data.json'))
      if (j?.id) 名字表[String(j.id)] = j.name || d
    }
  } catch {}
  return 名字表
}

function 脱敏用户(人) {
  const 出 = { games: {} }
  for (const [g, v] of Object.entries(人?.games || {})) {
    const 列 = (v?.列表 || []).map((x) => ({ uid: String(x?.uid || ''), server: x?.server || '', nickname: x?.nickname || '' }))
    if (!列.length && v?.uid) 列.push({ uid: String(v.uid), server: v.server || '', nickname: v.nickname || '' })
    出.games[g] = { uid: String(v?.uid || ''), server: v?.server || '', nickname: v?.nickname || '', 列表: 列 }
  }
  return 出
}

function 本地面板(game, uid) {
  const 档 = 读Json(join(家, 'miao-root', 'data', 'PlayerData', game, String(uid) + '.json'))
  if (!档?.avatars) return []
  const 表 = 读名字表()
  return Object.entries(档.avatars).map(([id, a]) => ({
    id, name: a.name || 表[id] || ('#' + id), level: a.level ?? null,
    star: a.star || a.rarity || null, cons: a.cons ?? a.constellation ?? null,
  }))
}

function 星铁角色(uid) {
  const 档 = 读Json(join(家, 'miao-root', 'data', 'PlayerData', 'sr', String(uid) + '.json'))
  if (!档?.avatars) return []
  const 表 = 读名字表()
  return Object.entries(档.avatars).map(([id, a]) => ({
    id, name: a.name || 表[id] || ('#' + id), level: a.level, star: a.star,
  }))
}

function 原神角色() {
  const st = 读Json(join(家, 'state.json'), {})
  return (st.chars || []).map((c) => ({ id: c.id, name: c.name, level: c.level, star: c.star, 突破: c.突破, 命座: c.constellation }))
}

function 机器人日志(文本) {
  try {
    const 路 = join(家, 'bot.log')
    const 旧 = existsSync(路) ? readFileSync(路, 'utf8') : ''
    const 行 = 旧.split('\n').filter(Boolean).slice(-199)
    行.push(new Date().toISOString() + ' ' + String(文本).replace(/[A-Za-z0-9_-]{20,}/g, (m) => m.slice(0, 4) + '…'))
    writeFileSync(路, 行.join('\n') + '\n', 'utf8')
  } catch {}
}

function 指令表() {
  return {
    gs: {
      名: '原神', 前缀: '#', 说明: '米游社扫码登录 + miao 面板，角色名可用代称',
      项: [
        ['#帮助 / #菜单', '帮助图', 1],
        ['#扫码登录', '米游社扫码，拿 cookie 后三游戏绑定一次搞定', 1],
        ['#绑定 UID', '绑定原神 UID', 1],
        ['#uid', '三游戏绑定卡（不展示凭据）', 1],
        ['#解绑', '删掉你自己的绑定', 1],
        ['#版本', '版本信息', 1],
        ['#面板', '角色列表图', 1],
        ['#更新面板', '强制重抓面板', 1],
        ['#名字（例：#钟离）', '角色详情卡', 1],
        ['#名字面板 / #名字 面板 / 卡片 / 详情', '同角色卡', 1],
        ['#名字圣遗物 / #名字 武器', '圣遗物、武器大图', 1],
        ['#名字天赋 / 命座 / 材料 / 图鉴', '四项资料页', 1],
        ['#圣遗物列表 / #武器列表', '全部圣遗物 / 武器', 1],
        ['#名字伤害', '伤害详情（还没接，先看卡里的暴击/期望）', 0],
        ['#深渊 / #幽境 / #剧诗', '需米游社战绩接口，未接', 0],
        ['#签到 / #体力 / #今日素材', '需米游社接口，未接', 0],
        ['#抽卡记录 / #十连 / #定轨', '未接', 0],
        ['#探索 / #日历 / #兑换码', '未接', 0],
      ],
    },
    sr: {
      名: '星铁', 前缀: '*', 说明: '走 Enka 展柜，角色要放在游戏内「数据共享 → 角色展柜」',
      项: [
        ['*帮助 / *菜单', '星铁帮助图', 1],
        ['*绑定 UID', '绑定星铁 UID', 1],
        ['*解绑', '删掉你自己的绑定', 1],
        ['*面板 / *uid / *列表', '角色列表图', 1],
        ['*更新面板 / *刷新面板', '强制重抓展柜', 1],
        ['*名字（例：*流萤 / *千冶刃）', '详情卡：属性、光锥、遗器、评分、伤害表', 1],
        ['*名字面板 / *详情 / *卡片', '同详情卡', 1],
        ['*名字伤害 / *伤害 名字', '伤害计算表', 1],
        ['*名字星魂 / 命座 / 光锥 / 遗器 / 评分 / 词条', '限定关注点（同一张卡）', 1],
        ['*图鉴 名字 / *名字图鉴', '角色图鉴卡（本地数据）', 1],
        ['*深渊 / *模拟宇宙', '未接', 0],
        ['*抽卡 / *签到', '未接', 0],
        ['不带前缀直接发角色名', '自动识别游戏并出卡', 1],
      ],
    },
    zzz: {
      名: '绝区零', 前缀: '%', 说明: 'Enka 有数据但缺角色名映射，面板还没接',
      项: [
        ['%绑定 UID', '绑定绝区零 UID', 1],
        ['%面板', '未接（Enka 缺角色名映射）', 0],
        ['%名字', '未接', 0],
      ],
    },
    通用: {
      名: '通用', 前缀: '', 说明: '不分游戏的账号与帮助',
      项: [
        ['#帮助 / #菜单', '帮助图', 1],
        ['#uid / #绑定 UID / #解绑', '绑定与账号', 1],
        ['#版本', '版本', 1],
        ['不带前缀发角色名', '自动匹配游戏（多游戏同名会提示加前缀）', 1],
      ],
    },
  }
}

const 渲染并发数 = Math.max(1, Number(process.env.MIHOYO_RENDER_CONCURRENCY || 1))
let 渲染中 = 0
const 渲染队 = []
function 开跑渲染(项) {
  渲染中++
  Promise.resolve().then(项.任务).then(项.res).catch(项.rej).finally(() => {
    渲染中--
    const 下一个 = 渲染队.shift()
    if (下一个) 开跑渲染(下一个)
  })
}
function 排队渲染(任务, 超时 = 150000) {
  return new Promise((res, rej) => {
    const 项 = { 任务, res, rej, at: Date.now() }
    if (渲染中 < 渲染并发数 && 渲染队.length === 0) {
      开跑渲染(项)
      return
    }
    if (渲染队.length >= 40) { rej(Object.assign(new Error('排队太多'), { 码: 503 })); return }
    渲染队.push(项)
    setTimeout(() => {
      const i = 渲染队.indexOf(项)
      if (i >= 0) {
        渲染队.splice(i, 1)
        rej(Object.assign(new Error('排队超时'), { 码: 503 }))
      }
    }, 超时)
  })
}
const 要排队 = (子) => /^(list|sr|srhelp|srwiki|wiki|panel\/png|miao\/profile|miao\/render)(\/|\?|$)/.test(子)

const 日志夹 = join(家, 'logs')
function 记日志(级, 源, 文) {
  const 时 = new Date()
  try {
    mkdirSync(日志夹, { recursive: true })
    appendFileSync(join(日志夹, 时.toISOString().slice(0, 10) + '.ndjson'),
      JSON.stringify({ t: 时.toISOString(), lv: 级, src: 源, msg: String(文).slice(0, 3000) }) + '\n', 'utf8')
  } catch {}
  try { console.log('[' + 级 + '][' + 源 + '] ' + 文) } catch {}
}

const 原consoleLog = console.log.bind(console)
console.log = (...a) => {
  原consoleLog(...a)
  try {
    const 文0 = a.map((x) => (typeof x === 'string' ? x : String(x))).join(' ')
    if (文0.startsWith('[dsh-mihoyo]')) {
      const 文 = 文0.replace('[dsh-mihoyo] ', '')
      记日志(/失败|出错|错误|Error|异常/.test(文) ? 'err' : 'info', '业务', 文)
    }
  } catch {}
}

function 读日志(日, 源, 级, 词) {
  const 出 = []
  const 路 = join(日志夹, 日 + '.ndjson')
  if (existsSync(路)) {
    读Json0(路).forEach((x) => 出.push(x))
  }
  const 录 = join(家, 'bot.log')
  if (existsSync(录)) {
    readFileSync(录, 'utf8').split('\n').filter(Boolean).slice(-300).forEach((l) => {
      const m = /^(\S+) (.*)$/.exec(l)
      出.push({ t: m ? m[1] : '', lv: /错=|失败/.test(l) ? 'err' : 'ok', src: '机器人', msg: m ? m[2] : l })
    })
  }
  return 出.filter((x) => (!源 || x.src === 源) && (!级 || x.lv === 级) && (!词 || String(x.msg || '').toLowerCase().includes(词) || String(x.src || '').includes(词)))
    .sort((a, b) => String(a.t).localeCompare(String(b.t)))
}

function 读Json0(路) {
  try {
    return readFileSync(路, 'utf8').split('\n').filter(Boolean).slice(-2000).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

const 缩略夹 = join(根, 'runtime', 'thumbs')
function 缩略(名) {
  try {
    const 出 = join(缩略夹, 名)
    if (existsSync(出)) return 出
    const 源 = join(家, 'cache', 名)
    if (!existsSync(源)) return null
    const png = PNG.sync.read(readFileSync(源))
    const 宽 = Math.min(360, png.width)
    const 高 = Math.max(1, Math.round(png.height * 宽 / png.width))
    const 新 = new PNG({ width: 宽, height: 高 })
    for (let y = 0; y < 高; y++) for (let x = 0; x < 宽; x++) {
      const sx = Math.min(png.width - 1, Math.round(x * png.width / 宽))
      const sy = Math.min(png.height - 1, Math.round(y * png.height / 高))
      const si = (sy * png.width + sx) * 4, di = (y * 宽 + x) * 4
      新.data[di] = png.data[si]; 新.data[di + 1] = png.data[si + 1]; 新.data[di + 2] = png.data[si + 2]; 新.data[di + 3] = png.data[si + 3]
    }
    mkdirSync(缩略夹, { recursive: true })
    writeFileSync(出, PNG.sync.write(新))
    return 出
  } catch { return null }
}

function 图库() {
  const 夹 = join(家, 'cache')
  try {
    return readdirSync(夹).filter((f) => f.toLowerCase().endsWith('.png')).map((f) => {
      const st = statSync(join(夹, f))
      return { name: f, size: st.size, mtime: st.mtimeMs }
    }).sort((a, b) => b.mtime - a.mtime)
  } catch { return [] }
}

function 汇总() {
  const 用户表 = 读Json(join(家, 'users.json'), {}) || {}
  const 条 = Object.entries(用户表).map(([q, 人]) => {
    const 用户 = 脱敏用户(人)
    return {
      q,
      qqName: String(人?.qqName || ''),
      games: 用户.games,
      boundAt: 人?.boundAt || '',
      srChars: 用户.games.sr?.uid ? 星铁角色(用户.games.sr.uid) : [],
      chars: {
        gs: (用户.games.gs?.列表 || []).map((x) => ({ uid: x.uid, server: x.server, nickname: x.nickname, chars: 本地面板('gs', x.uid) })),
        sr: (用户.games.sr?.列表 || []).map((x) => ({ uid: x.uid, server: x.server, nickname: x.nickname, chars: 本地面板('sr', x.uid) })),
      },
    }
  })
  const 计数 = (g) => 条.filter((x) => x.games[g]?.uid).length
  const 图 = 图库()
  const 配置 = 读Json(join(家, 'bot.json'), {}) || {}
  return {
    时间: new Date().toISOString(),
    用户数: 条.length,
    绑定: { gs: 计数('gs'), sr: 计数('sr'), zzz: 计数('zzz') },
    缓存: { 张数: 图.length, 字节: 图.reduce((s, x) => s + x.size, 0) },
    机器人: { 自动启动: !!配置.autoStart, 在线: !!机器人状态().在线, appId尾: String(配置.appId || '').slice(-4) },
    渲染: { 进行中: 渲染中, 排队: 渲染队.length, 并发上限: 渲染并发数 },
    原神角色: 原神角色(),
    用户: 条,
    图库: 图.slice(0, 80),
  }
}

function 发Json(res, o, 码 = 200) {
  const 体 = Buffer.from(JSON.stringify(o))
  res.writeHead(码, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': 体.length })
  res.end(体)
}

function 发静态(res, 路, 码 = 200) {
  if (!existsSync(路) || !statSync(路).isFile()) return false
  const 体 = readFileSync(路)
  res.writeHead(码, { 'content-type': 类型[extname(路).toLowerCase()] || 'application/octet-stream', 'content-length': 体.length, 'cache-control': 'no-store' })
  res.end(体)
  return true
}

const 服务器 = http.createServer(async (req, res) => {
  const url = String(req.url || '/')
  const 路径 = url.split('?')[0]
  try {
    // 业务接口：原样交给 dsh-mihoyo 的处理函数（同源校验、限位、错误映射都在里面）
    if (路径 === '/dsh-mihoyo' || 路径.startsWith('/dsh-mihoyo/')) {
      const 子路径 = 路径.replace('/dsh-mihoyo', '').replace(/^\/+/, '')
      const 起 = Date.now()
      res.once('finish', () => {
        if (!/\.(png|jpe?g|webp|css|js|ico)$/i.test(路径)) {
          const 级 = res.statusCode >= 500 ? 'err' : res.statusCode >= 400 ? 'warn' : 'ok'
          记日志(级, '请求', req.method + ' ' + url + ' → ' + res.statusCode + ' ' + (Date.now() - 起) + 'ms')
        }
      })
      if (要排队(子路径)) {
        try {
          return await 排队渲染(() => 处理请求(req, res))
        } catch (e) {
          if (!res.headersSent) return 发Json(res, { ok: false, 说: '现在出图的人有点多，排一下队，稍后再发一次' }, e.码 || 503)
          return
        }
      }
      return await 处理请求(req, res)
    }
    if (路径.startsWith('/api/') && 路径 !== '/api/events' && 路径 !== '/api/logs') {
      const 起0 = Date.now()
      res.once('finish', () => {
        const 级0 = res.statusCode >= 500 ? 'err' : res.statusCode >= 400 ? 'warn' : 'ok'
        记日志(级0, '接口', req.method + ' ' + url + ' → ' + res.statusCode + ' ' + (Date.now() - 起0) + 'ms')
      })
    }
    if (路径 === '/api/logs') {
      if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') return 发Json(res, { ok: false, 说: '来源不对' }, 403)
      const 参 = new URL(url, 'http://x').searchParams
      const 日 = String(参.get('date') || new Date().toISOString().slice(0, 10))
      const 源 = String(参.get('src') || '')
      const 级 = String(参.get('lv') || '')
      const 词 = String(参.get('q') || '').toLowerCase()
      const 限 = Math.max(1, Math.min(1000, Number(参.get('lines') || 300)))
      const 全部 = 读日志(日, 源, 级, 词)
      return 发Json(res, { ok: true, 日期: 日, 总数: 全部.length, 条目: 全部.slice(-限) })
    }
    if (路径 === '/api/user/name') {
      if (req.method !== 'POST') return 发Json(res, { ok: false, 说: '要用 POST' }, 405)
      if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') return 发Json(res, { ok: false, 说: '来源不对' }, 403)
      let 入 = null
      try {
        const 块 = []
        for await (const c of req) { 块.push(c); if (Buffer.concat(块).length > 4096) return 发Json(res, { ok: false, 说: 'body 太大' }, 413) }
        入 = JSON.parse(Buffer.concat(块).toString('utf8') || '{}')
      } catch { return 发Json(res, { ok: false, 说: 'body 不是 JSON' }, 400) }
      const q = String(入?.q || '').trim()
      const 名 = String(入?.name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24)
      if (!q) return 发Json(res, { ok: false, 说: '缺 q' }, 400)
      const 表 = 读Json(join(家, 'users.json'), {}) || {}
      if (!表[q]) return 发Json(res, { ok: false, 说: '没有这个用户' }, 404)
      表[q].qqName = 名
      writeFileSync(join(家, 'users.json'), JSON.stringify(表, null, 2), 'utf8')
      记日志('ok', '操作', '设置显示名 ' + 名.slice(0, 20))
      return 发Json(res, { ok: true, qqName: 名 })
    }
    if (路径 === '/api/bot/log') {
      const 路 = join(家, 'bot.log')
      const 文 = existsSync(路) ? readFileSync(路, 'utf8') : ''
      return 发Json(res, { ok: true, 日志: 文.split('\n').filter(Boolean).slice(-40) })
    }
    if (路径 === '/api/bot') {
      const 配置 = 读Json(join(家, 'bot.json'), {}) || {}
      return 发Json(res, { ok: true, 机器人: 机器人状态(), 已填: !!(配置.appId && 配置.appSecret), appId尾: String(配置.appId || '').slice(-4) })
    }
    if (路径 === '/api/bot/config') {
      if (req.method !== 'POST') return 发Json(res, { ok: false, 说: '要用 POST' }, 405)
      if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') return 发Json(res, { ok: false, 说: '来源不对' }, 403)
      let 入 = null
      try {
        const 块 = []
        for await (const c of req) { 块.push(c); if (Buffer.concat(块).length > 8192) return 发Json(res, { ok: false, 说: 'body 太大' }, 413) }
        入 = JSON.parse(Buffer.concat(块).toString('utf8') || '{}')
      } catch { return 发Json(res, { ok: false, 说: 'body 不是 JSON' }, 400) }
      const appId = String(入?.appId || '').trim()
      const appSecret = String(入?.appSecret || '').trim()
      if (!/^\d{5,20}$/.test(appId)) return 发Json(res, { ok: false, 说: 'appId 一般是数字，5–20 位' }, 400)
      if (!/^[\w-]{8,80}$/.test(appSecret)) return 发Json(res, { ok: false, 说: 'appSecret 看着不对（8–80 位字母数字）' }, 400)
      const 存 = 存机器人配置({ appId, appSecret, sandbox: !!入?.sandbox })
      记日志('ok', '操作', '保存 QQBOT 配置 appId 尾号 ' + String(appId).slice(-4))
      const 配置 = 读Json(join(家, 'bot.json'), {}) || {}
      return 发Json(res, { ok: true, 说: '配置已保存，可以启动 QQBOT 了', appId尾: String(配置.appId || '').slice(-4), 机器人: 机器人状态() })
    }
    if (路径 === '/api/bot/start' || 路径 === '/api/bot/stop') {
      if (req.method !== 'POST') return 发Json(res, { ok: false, 说: '要用 POST' }, 405)
      if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') return 发Json(res, { ok: false, 说: '来源不对' }, 403)
      const 配置 = 读Json(join(家, 'bot.json'), {}) || {}
      if (路径.endsWith('start')) {
        if (!配置.appId || !配置.appSecret) return 发Json(res, { ok: false, 说: 'bot.json 里没有 appId/appSecret' }, 400)
        const r = await 启机器人(试端口).catch((e) => ({ ok: false, 说: String(e?.message || e) }))
        await new Promise((r2) => setTimeout(r2, 1200))
        const 态 = 机器人状态()
        记日志(态.在线 ? 'ok' : 'err', '操作', '启动 QQBOT → ' + (态.在线 ? '在线' : ('离线 ' + (态.错 || r?.说 || ''))))
        机器人日志('start ' + (r?.说 || '') + ' | 在线=' + 态.在线 + ' | 错=' + (态.错 || ''))
        return 发Json(res, { ok: !!r?.ok, 说: r?.说 || '', 机器人: 态 })
      }
      const r = 停机器人()
      记日志('ok', '操作', '停止 QQBOT')
      机器人日志('stop')
      return 发Json(res, { ok: true, 说: r?.说 || '已停', 机器人: 机器人状态() })
    }
    if (路径 === '/api/commands') return 发Json(res, { ok: true, 版本: '8', 分组: 指令表() })
    if (路径 === '/api/summary') return 发Json(res, 汇总())
    if (路径 === '/api/gallery') return 发Json(res, { 图库: 图库() })
    if (路径 === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' })
      const 发 = () => { try { res.write('data: ' + JSON.stringify(汇总()) + '\n\n') } catch {} }
      发()
      const 定 = setInterval(发, 4000)
      req.on('close', () => clearInterval(定))
      return
    }
    if (路径.startsWith('/api/thumb/')) {
      const 名 = basename(decodeURIComponent(路径.slice('/api/thumb/'.length)))
      if (!/\.png$/i.test(名)) return 发Json(res, { ok: false, 说: '只发 png' }, 400)
      const 缩 = 缩略(名)
      if (!缩) return 发Json(res, { ok: false, 说: '没有这张图' }, 404)
      return 发静态(res, 缩)
    }
    if (路径.startsWith('/api/img/')) {
      const 名 = basename(decodeURIComponent(路径.slice('/api/img/'.length)))
      if (!/\.png$/i.test(名)) return 发Json(res, { ok: false, 说: '只发 png' }, 400)
      const 文件 = join(家, 'cache', 名)
      if (!existsSync(文件)) return 发Json(res, { ok: false, 说: '没有这张图' }, 404)
      return 发静态(res, 文件)
    }
    if (路径 === '/' || 路径 === '/index.html') return 发静态(res, join(公共, 'index.html'))
    if (发静态(res, join(公共, basename(路径)))) return
    发Json(res, { ok: false, 说: '没有这个地址' }, 404)
  } catch (e) {
    try { 发Json(res, { ok: false, 说: String(e?.message || e).slice(0, 160) }, 500) } catch {}
  }
})

let 试端口 = 端口
function 监听() {
  服务器.listen(试端口, 主机, () => {
    记日志('ok', '服务', '启动 ' + 主机 + ':' + 试端口 + ' 数据目录 ' + 家)
    console.log('dsh-mihoyo 独立看板已启动：http://127.0.0.1:' + 试端口)
    console.log('数据目录：' + 家)
    console.log('按 Ctrl+C 停止。')
    if (process.env.MIHOYO_STANDALONE_BOT === '1') {
      const 配置 = 读Json(join(家, 'bot.json'), {}) || {}
      if (配置.appId && 配置.appSecret) {
        启机器人(试端口).then((r) => console.log('QQBOT: ' + (r?.说 || JSON.stringify(r)))).catch((e) => console.log('QQBOT 启动失败：' + String(e?.message || e).slice(0, 120)))
      } else {
        console.log('QQBOT: bot.json 里没有 appId/appSecret，跳过')
      }
    }
  })
}
服务器.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && 试端口 < 端口 + 10) {
    试端口++
    setTimeout(监听, 200)
  } else {
    console.error('启动失败：' + e.message)
    process.exit(1)
  }
})
监听()

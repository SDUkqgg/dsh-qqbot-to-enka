// dsh-mihoyo（宿主半边）v2
// 审查后修：body 上限、写操作只认 POST + JSON、GET 不写盘、探针不假阳性、
// 上游错误码映射、状态原子写与损坏备份、缓存兜底。

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, renameSync, copyFileSync, readdirSync, unlinkSync, rmSync } from 'node:fs'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'

const 跑命令 = promisify(execFile)
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { 自启, 启机器人, 停机器人, 机器人状态, 存机器人配置 } from './bot.js'
import { PNG } from 'pngjs'

export const inject = ['webServer']

// 深色底的列表图：从下往上找最后一行有亮色文字的行，裁掉下方空白
function 裁列表图(pngPath) {
  try {
    const png = PNG.sync.read(readFileSync(pngPath))
    const { width, height, data } = png
    let 末 = 0
    for (let y = height - 1; y >= 0; y--) {
      let 有字 = false
      for (let x = 0; x < width; x += 4) {
        const i = (y * width + x) * 4
        if (data[i] + data[i + 1] + data[i + 2] > 300) { 有字 = true; break }
      }
      if (有字) { 末 = y; break }
    }
    const 目标高 = Math.min(height, 末 + 36)
    if (目标高 < 300 && 末 === 0) return
    if (目标高 > 200 && 目标高 < height - 1) {
      const 新png = new PNG({ width, height: 目标高 })
      PNG.bitblt(png, 新png, 0, 0, width, 目标高, 0, 0)
      writeFileSync(pngPath, PNG.sync.write(新png))
    }
  } catch {}
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

const 活跃轮廓 = new Set()
const 强制冷却 = new Map()
const 角色卡渲染中 = new Map()   // 同一张卡并发只渲染一次

function 清旧轮廓() {
  // Edge headless 先返回、子进程稍后才释放 profile；每次出图前顺手清掉 1 分钟前的
  try {
    const 基 = 家
    for (const 名 of readdirSync(基)) {
      if (!名.startsWith('_edgeprof-') && 名 !== '_edgeprof') continue
      if (活跃轮廓.has(名)) continue
      const 全 = join(基, 名)
      try {
        const st = statSync(全)
        if (Date.now() - st.mtimeMs > 60000) rmSync(全, { recursive: true, force: true, maxRetries: 3 })
      } catch {}
    }
  } catch {}
}

function 清profile(目录) {
  try { rmSync(目录, { recursive: true, force: true, maxRetries: 2 }) } catch {}
}

function 记本地(文本) {
  try { if (globalThis.console?.log) console.log('[dsh-mihoyo] ' + 文本) } catch {}
}

const 家 = process.env.DSH_MIHOYO_HOME || (process.platform === 'win32' ? 'F:\\dsh\\mihoyo' : join(process.cwd(), 'data'))

function 找浏览器() {
  const 自定 = String(process.env.MIHOYO_BROWSER || '').trim()
  const 候选 = 自定 ? [自定] : []
  if (process.platform === 'win32') {
    候选.push('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
    候选.push('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe')
    候选.push('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  } else {
    候选.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
      '/snap/bin/chromium', '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/usr/local/bin/chromium')
  }
  return 候选.find((x) => x && existsSync(x)) || ''
}
function 浏览器参() { return process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] }

const 状态文件 = join(家, 'state.json')
const 体上限 = 64 * 1024

const 默认状态 = {
  uid: '', server: 'cn_gf01', nickname: '',
  cookie: '', stoken: '', mid: '',
  boundAt: '', lastCheckAt: '', lastError: '',
  panelCache: null,
}

function 读状态() {
  try {
    if (!existsSync(状态文件)) return { ...默认状态 }
    return { ...默认状态, ...JSON.parse(readFileSync(状态文件, 'utf8').replace(/^\uFEFF/, '')) }
  } catch {
    try { copyFileSync(状态文件, 状态文件 + '.broken-' + Date.now()) } catch {}
    return { ...默认状态 }
  }
}

let 已收紧权限 = false
function 收紧目录权限() {
  if (已收紧权限) return
  已收紧权限 = true
  try {
    execFileSync('icacls', [家, '/inheritance:r', '/grant:r', process.env.USERNAME + ':(OI)(CI)F'], { stdio: 'ignore', timeout: 8000 })
  } catch {}
}

function 存状态(补) {
  const 新 = { ...读状态(), ...补 }
  const 目录新 = !existsSync(家)
  mkdirSync(dirname(状态文件), { recursive: true })
  if (目录新) 收紧目录权限()
  const 临时 = 状态文件 + '.' + process.pid + '.' + Date.now() + '.tmp'
  writeFileSync(临时, JSON.stringify(新, null, 2) + '\n', 'utf8')
  renameSync(临时, 状态文件)
  return 新
}

function 对外(s) {
  const 有凭据 = Boolean(String(s.cookie || '').trim() || String(s.stoken || '').trim())
  return {
    uid: s.uid, server: s.server, nickname: s.nickname,
    hasUid: Boolean(s.uid),
    hasCredential: 有凭据,
    bound: Boolean(s.uid) && 有凭据,
    boundAt: s.boundAt, lastCheckAt: s.lastCheckAt, lastError: s.lastError,
  }
}

async function 读体(req, 上限 = 体上限) {
  let 长 = 0
  const 块们 = []
  for await (const 块 of req) {
    长 += 块.length
    if (长 > 上限) { try { req.resume() } catch {}; throw Object.assign(new Error('body 太大'), { 码: 413 }) }
    块们.push(块)
  }
  return Buffer.concat(块们).toString('utf8')
}

const 菜单 = [].map(([game, items]) => ({ game, items }))

const 探针 = {
  Enka: { url: 'https://enka.network/api/uid/618285856', json: true },
  米游社接口: { url: 'https://api-takumi-record.mihoyo.com/game_record/app/genshin/api/index?server=cn_gf01&role_id=100000001' },
  米游社登录: { url: 'https://passport-api.mihoyo.com/account/ma-cn-passport/web/queryQRLoginStatus', method: 'POST', body: '{"ticket":"probe"}' },
}

let 健康缓存 = { at: 0, 值: null }
const 面板缓存 = new Map() // uid -> {at, 数据}
const 最近查询 = { uid: '' }

async function 探(名, 定) {
  const 起 = Date.now()
  try {
    const r = await fetch(定.url, {
      method: 定.method || 'GET',
      headers: {
        'user-agent': 'dsh-mihoyo/0.2 (+local)',
        accept: 'application/json',
        ...(定.body ? { 'content-type': 'application/json' } : {}),
      },
      body: 定.body,
      signal: AbortSignal.timeout(6000),
    })
    let 附加 = ''
    if (定.json && r.ok) {
      try {
        const j = await r.json()
        附加 = j && j.playerInfo ? '· 数据正常' : '· 返回无 playerInfo'
      } catch { 附加 = '· 不是 JSON' }
    }
    if (!定.json && r.ok) {
      try {
        const j = await r.json()
        if (j && typeof j.retcode === 'number' && j.retcode !== 0) 附加 = '· retcode=' + j.retcode + '（需登录）'
      } catch {}
    }
    return { 名, ok: r.status >= 200 && r.status < 300, status: r.status, ms: Date.now() - 起, 附加 }
  } catch (e) {
    return { 名, ok: false, status: 0, ms: Date.now() - 起, 附加: String(e?.message || e).slice(0, 100) }
  }
}

let 健康在跑 = null
async function 健康(强制 = false) {
  if (!强制 && 健康缓存.值 && Date.now() - 健康缓存.at < 30000) return { ...健康缓存.值, 缓存: true }
  if (!强制 && 健康在跑) return 健康在跑
  健康在跑 = (async () => {
  const 结果们 = await Promise.all(Object.entries(探针).map(([名, 定]) => 探(名, 定)))
  const 值 = { 全通: 结果们.every((x) => x.ok), 检查: Object.fromEntries(结果们.map((x) => [x.名, x])), 时间: new Date().toISOString() }
  健康缓存 = { at: Date.now(), 值 }
  return 值
  })().finally(() => { 健康在跑 = null })
  return 健康在跑
}

const 角色名 = {
  10000002: '神里绫华', 10000003: '琴', 10000005: '旅行者', 10000006: '丽莎', 10000007: '旅行者',
  10000014: '芭芭拉', 10000015: '凯亚', 10000016: '迪卢克', 10000020: '雷泽', 10000021: '安柏',
  10000022: '温迪', 10000023: '香菱', 10000024: '北斗', 10000025: '行秋', 10000026: '魈',
  10000027: '凝光', 10000029: '可莉', 10000030: '钟离', 10000031: '菲谢尔', 10000032: '班尼特',
  10000033: '达达利亚', 10000034: '诺艾尔', 10000035: '七七', 10000036: '重云', 10000037: '甘雨',
  10000038: '阿贝多', 10000039: '迪奥娜', 10000041: '莫娜', 10000042: '刻晴', 10000043: '砂糖',
  10000044: '辛焱', 10000045: '罗莎莉亚', 10000046: '胡桃', 10000047: '枫原万叶', 10000048: '烟绯',
  10000049: '宵宫', 10000050: '托马', 10000051: '优菈', 10000052: '雷电将军', 10000053: '早柚',
  10000054: '珊瑚宫心海', 10000055: '五郎', 10000056: '九条裟罗', 10000057: '荒泷一斗',
  10000058: '八重神子', 10000059: '鹿野院平藏', 10000060: '夜兰', 10000061: '绮良良',
  10000062: '埃洛伊', 10000063: '申鹤', 10000064: '云堇', 10000065: '神里绫人',
  10000067: '久岐忍', 10000068: '纳西妲', 10000069: '莱依拉', 10000070: '流浪者', 10000071: '赛诺',
  10000072: '妮露', 10000073: '提纳里', 10000074: '坎蒂丝', 10000076: '迪希雅',
  10000077: '艾尔海森', 10000078: '瑶瑶', 10000079: '米卡', 10000080: '卡维', 10000081: '白术',
  10000082: '琳妮特', 10000083: '林尼', 10000084: '菲米尼', 10000085: '那维莱特', 10000086: '莱欧斯利',
  10000087: '夏洛蒂', 10000088: '娜维娅', 10000089: '芙宁娜', 10000090: '夏沃蕾', 10000091: '千织',
  10000093: '闲云', 10000094: '阿蕾奇诺', 10000095: '克洛琳德', 10000096: '赛索斯',
  10000097: '希格雯', 10000098: '艾梅莉埃', 10000099: '卡齐娜', 10000100: '玛拉妮', 10000101: '基尼奇',
  10000102: '希诺宁', 10000103: '恰斯卡', 10000104: '茜特菈莉', 10000105: '玛薇卡',
}


async function 拉米游社角色(cookie, uid, server) {
  if (!cookie) return null
  const 服 = server || 'cn_gf01'
  const 基头 = {
    cookie,
    'content-type': 'application/json',
    'x-rpc-app_version': '2.71.1',
    'x-rpc-client_type': '5',
    'x-rpc-device_id': '586f1440-856a-4243-8076-2b0a12314197',
    'x-rpc-device_name': 'Xiaomi MI 8',
    'x-rpc-device_model': 'MI 8',
    'x-rpc-sys_version': '12',
    'x-rpc-channel': 'miyousheluodi',
    'x-rpc-app_id': 'bll8iq97cem8',
    referer: 'https://app.mihoyo.com',
    'user-agent': 'okhttp/4.9.3',
  }
  const 落 = []
  const 试 = async (路径, 体对象, 头名) => {
    const 体 = JSON.stringify(体对象)
    const sig = 签名('', 体)
    const r = await fetch('https://api-takumi-record.mihoyo.com/game_record/app/genshin/api/' + 路径, {
      method: 'POST', headers: { ...基头, [头名]: sig.ds }, body: 体, signal: AbortSignal.timeout(12000),
    })
    const j = await r.json().catch(() => ({}))
    return { 状态: r.status, 体: j }
  }
  for (const 路径 of ['character/list', 'character']) {
    for (const 头名 of ['DS', 'ds']) {
      try {
        const { 状态, 体 } = await 试(路径, { server: 服, role_id: String(uid) }, 头名)
        if (体?.retcode === 0) {
          const 列表 = (体?.data?.list || []).map((x) => ({
            id: x.id, name: x.name || ('角色#' + x.id), level: x.level ?? null,
            constellation: x.actived_constellation_num ?? null, fetter: x.fetter ?? null,
            rarity: x.rarity ?? null,
          }))
          return { 列表, 路径, 头名 }
        }
        落.push(路径 + '/' + 头名 + ' → HTTP ' + 状态 + ' retcode ' + (体?.retcode ?? '?') + ' ' + String(体?.message || ''))
      } catch (e) { 落.push(路径 + '/' + 头名 + ' → ' + String((e && e.message) || e)) }
    }
  }
  return { 错: 落.join(' | ').slice(0, 300) }
}

// 武器 / 圣遗物名字表（从 miao meta 生成）
let 武名 = {}
let 圣名 = {}
const 读Json去BOM = (路径2) => JSON.parse(readFileSync(路径2, 'utf8').replace(/^\uFEFF/, ''))
try { 武名 = 读Json去BOM(join(家, 'weapons.json')) } catch {}
try { 圣名 = 读Json去BOM(join(家, 'artifacts.json')) } catch {}

function Enka详情(a) {
  const 属 = a.fightPropMap || {}
  const 数 = (k) => (属[k] === undefined ? null : Math.round(Number(属[k]) * 10) / 10)
  const 装 = (a.equipList || []).map((e) => {
    const f = e.flat || {}
    if (e.weapon) {
      const 精 = e.weapon.affixMap ? (Object.values(e.weapon.affixMap)[0] + 1) : 1
      return { 类: '武器', id: e.itemId, name: 武名[e.itemId] || ('武器#' + e.itemId), level: e.weapon.level ?? null, 精炼: 精, star: f.rankLevel ?? null }
    }
    if (e.reliquary) {
      const 套 = 圣名[e.itemId] || {}
      const 图标槽 = /_([1-5])(?:\.|$)/.exec(String(f.icon || ''))
      const 槽位 = 图标槽 ? Number(图标槽[1]) : (e.itemId % 10)
      const 槽名 = { 1: '生之花', 2: '死之羽', 3: '时之沙', 4: '空之杯', 5: '理之冠' }[槽位] || ''
      return {
        类: '圣遗物', id: e.itemId,
        name: 套.name || (槽名 ? 槽名 + '（未收录）' : ('遗物#' + e.itemId)),
        套装: 套.set || '未收录套装',
        level: e.reliquary.level ?? null, star: f.rankLevel ?? null, 主词条: e.reliquary.mainPropId ?? null,
      }
    }
    return null
  }).filter(Boolean)
  return {
    属性: {
      hp: 数('2000'), atk: 数('2001'), def: 数('2002'),
      暴击率: 数('20') === null ? null : Math.round(数('20') * 1000) / 10,
      暴击伤害: 数('22') === null ? null : Math.round(数('22') * 1000) / 10,
      充能: 数('23') === null ? null : Math.round(数('23') * 1000) / 10,
      精通: 数('28'),
    },
    武器: 装.find((x) => x.类 === '武器') || null,
    圣遗物: 装.filter((x) => x.类 === '圣遗物'),
    天赋: a.skillLevelMap ? Object.values(a.skillLevelMap) : [],
  }
}

// 角色名以 miao meta 为准（127 个），内置表只做兜底
try {
  const 外部 = JSON.parse(readFileSync(join(家, 'roles.json'), 'utf8'))
  for (const [k, v] of Object.entries(外部)) 角色名[k] = v
} catch {}

async function 拉面板(uid, 强制 = false) {
  const 缓 = 强制 ? null : 面板缓存.get(uid)
  if (缓 && Date.now() - 缓.at < 120000) return { ...缓.数据, 缓存: true }
  let r
  try {
    r = await fetch('https://enka.network/api/uid/' + encodeURIComponent(uid), {
      headers: { 'user-agent': 'dsh-mihoyo/0.2 (+local)', accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
  } catch (e) {
    if (缓) return { ...缓.数据, 缓存: true, 过期: true }
    throw Object.assign(new Error('连不上 Enka：' + String(e?.message || e)), { 码: 502 })
  }
  if (!r.ok) {
    if (缓) return { ...缓.数据, 缓存: true, 过期: true }
    const 码 = r.status === 400 || r.status === 404 ? 400 : r.status === 429 ? 429 : 502
    throw Object.assign(new Error('Enka 回 ' + r.status), { 码, 上游: r.status })
  }
  const j = await r.json()
  const 玩家 = j.playerInfo || {}
  const 数据 = {
    uid: String(j.uid || uid),
    nickname: 玩家.nickname || '',
    level: 玩家.level || null,
    signature: 玩家.signature || '',
    worldLevel: 玩家.worldLevel || null,
    chars: (() => {
      const 详 = j.avatarInfoList || []
      if (详.length) {
        return 详.map((a) => ({
          id: a.avatarId,
          name: 角色名[a.avatarId] || ('角色#' + a.avatarId),
          level: a.propMap?.['4001']?.ival ?? null,
          constellation: a.talentIdList?.length ?? 0,
          fetter: a.fetterInfo?.expLevel ?? null,
          ...Enka详情(a),
          完整: true,
        }))
      }
      // Enka 只给了展柜摘要（showAvatarInfoList）：名字和等级有，命座没有
      return (玩家.showAvatarInfoList || []).map((a) => ({
        id: a.avatarId,
        name: 角色名[a.avatarId] || ('角色#' + a.avatarId),
        level: a.level ?? null,
        constellation: null,
        fetter: null,
        完整: false,
      }))
    })(),
    fetchedAt: new Date().toISOString(),
    source: 'Enka.Network',
  }
  面板缓存.set(uid, { at: Date.now(), 数据 })
  最近查询.uid = uid
  if (面板缓存.size > 20) { const 最老 = 面板缓存.keys().next().value; 面板缓存.delete(最老) }
  return 数据
}


// ── 米游社扫码登录 ──
const 登录头 = {
  'x-rpc-app_id': 'bll8iq97cem8',
  'x-rpc-client_type': '4',
  'x-rpc-game_biz': 'bbs_cn',
  'x-rpc-device_fp': '38d7fa104e5d7',
  'x-rpc-device_id': '586f1440-856a-4243-8076-2b0a12314197',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'content-type': 'application/json',
}
const 登录站 = 'https://passport-api.miyoushe.com/account/ma-cn-passport/web/'
const 登录端 = 登录站
const DS盐 = 'xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs'

// 米游社国服 DS：md5('salt=…&t=…&r=…&b=…&q=…')
function 签名(查询 = '', 体 = '') {
  const t = String(Math.floor(Date.now() / 1000))
  const r = String(Math.floor(Math.random() * 900000) + 100000)
  const h = createHash('md5')
  h.update('salt=' + DS盐 + '&t=' + t + '&r=' + r + '&b=' + (体 || '') + '&q=' + (查询 || ''))
  return { ds: t + ',' + r + ',' + h.digest('hex'), t, r }
}

function 拿Cookie(列表) {
  const 出 = {}
  for (const 行 of 列表 || []) Object.assign(出, 拆Cookie([行]))
  return 出
}

const 登录会话 = { ticket: '', at: 0, status: '' }
// 每个发起人一张二维码，互不覆盖（群聊里多人同时扫）
const 扫码表 = new Map()
const 新会话号 = () => Math.random().toString(36).slice(2) + Date.now().toString(36)

async function 建二维码() {
  const r = await fetch(登录站 + 'createQRLogin', {
    method: 'POST', headers: 登录头, body: '{}', signal: AbortSignal.timeout(12000),
  })
  const j = await r.json().catch(() => ({}))
  if (!j?.data?.url || !j?.data?.ticket) {
    throw Object.assign(new Error('米游社没给二维码：' + (j?.message || ('HTTP ' + r.status))), { 码: 502 })
  }
  const QRCode = (await import('qrcode')).default
  const png = await QRCode.toDataURL(j.data.url, { margin: 1, width: 320 })
  登录会话.ticket = j.data.ticket
  登录会话.at = Date.now()
  登录会话.status = 'Created'
  return { url: j.data.url, ticket: j.data.ticket, qr: png, at: Date.now() }
}

function 拆Cookie(列表) {
  const 出 = {}
  for (const 行 of 列表 || []) {
    const 段 = String(行).split(';')[0]
    const i = 段.indexOf('=')
    if (i > 0) 出[段.slice(0, i).trim()] = 段.slice(i + 1).trim()
  }
  return 出
}

async function 查扫码(ticket) {
  const r = await fetch(登录端 + 'queryQRLoginStatus', {
    method: 'POST', headers: 登录头, body: JSON.stringify({ ticket }), signal: AbortSignal.timeout(12000),
  })
  const 头 = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : []
  const j = await r.json().catch(() => ({}))
  if (j?.retcode !== 0) throw Object.assign(new Error(j?.message || '查扫码失败'), { 码: 502 })
  const 态 = String(j?.data?.status || '')
  if (态 !== 'Confirmed') return { status: 态, bound: false }
  const ck = 拿Cookie(头)
  const 串 = Object.entries(ck).map(([k, v]) => k + '=' + v).join('; ')
  if (!串) return { status: 态, bound: false, 说: '确认了但没拿到 cookie' }
  let 角色 = null
  try { 角色 = await 拉角色(串) } catch (e) { 角色 = { 错: String(e?.message || e) } }
  return {
    status: 态, bound: true,
    cookie: 串, stoken: ck.stoken || '', mid: ck.mid || ck.account_id || '',
    角色: 角色?.列表 || [], 角色错: 角色?.错 || '',
  }
}

async function 拉角色(cookie) {
  if (!cookie) return null
  const 三游 = ['hk4e_cn', 'hkrpg_cn', 'nap_cn']
  const 全 = []
  let 最后错 = ''
  for (const biz of 三游) {
    const 查 = 'game_biz=' + biz
    const sig = 签名(查, '')
    let r
    try {
      r = await fetch('https://api-takumi.mihoyo.com/binding/api/getUserGameRolesByCookie?' + 查, {
        headers: {
          cookie,
          ds: sig.ds,
          'x-rpc-app_version': '2.71.1',
          'x-rpc-client_type': '5',
          'x-rpc-device_id': '586f1440-856a-4243-8076-2b0a12314197',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
        signal: AbortSignal.timeout(12000),
      })
    } catch (e) {
      最后错 = String(e?.message || e).slice(0, 60)
      continue
    }
    const j = await r.json().catch(() => ({}))
    if (j?.retcode !== 0) { 最后错 = j?.message || ('HTTP ' + r.status); continue }
    for (const x of (j?.data?.list || [])) {
      全.push({
        game: x.game_biz || biz, uid: String(x.game_uid || ''), server: x.region || '',
        nickname: x.nickname || '', level: x.level || null,
      })
    }
  }
  if (!全.length) return { 错: 最后错 || '没查到任何游戏角色', retcode: -1 }
  return { 列表: 全 }
}


// ── 多人多游戏绑定（users.json）──
const 用户文件 = join(家, 'users.json')
function 读用户们() {
  // 坏文件先备份，别让下一次写入把别人整份覆盖掉
  try {
    if (!existsSync(用户文件)) return {}
    const j = JSON.parse(readFileSync(用户文件, 'utf8').replace(/^\uFEFF/, ''))
    return j && typeof j === 'object' ? j : {}
  } catch { try { copyFileSync(用户文件, 用户文件 + '.broken-' + Date.now()) } catch {}; return {} }
}
function 存用户们(全) {
  mkdirSync(家, { recursive: true })
  const 临 = 用户文件 + '.' + process.pid + '.' + Date.now() + '.tmp'
  writeFileSync(临, JSON.stringify(全, null, 2) + '\n', 'utf8')
  renameSync(临, 用户文件)
}
function 取用户(q) {
  const 表 = 读用户们()
  return 表[q] || null
}
const 游戏代码 = { gs: '原神', sr: '星铁', zzz: '绝区零' }
const Enka路径 = { gs: 'https://enka.network/api/uid/', sr: 'https://enka.network/api/hsr/uid/', zzz: 'https://enka.network/api/zzz/uid/' }

function 同源(req) {
  // Host 白名单挡住 DNS rebinding；Origin / Sec-Fetch-Site 挡住跨站页面
  const 主 = String(req.headers.host || '')
  const 主名 = 主.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  const 白名单 = String(process.env.MIHOYO_ALLOW_HOSTS || '').split(',').map((x) => x.trim()).filter(Boolean)
  const 本机 = /^(127\.0\.0\.1|localhost|::1)$/i.test(主名)
  if (!本机 && !白名单.includes(主名) && !白名单.includes(主)) return false
  const 源 = String(req.headers.origin || '')
  if (源) {
    try { if (new URL(源).host !== 主) return false } catch { return false }
  }
  const 站 = String(req.headers['sec-fetch-site'] || '')
  if (站 && 站 !== 'same-origin' && 站 !== 'none') return false
  return true
}



export async function 处理请求(req, res) {
        let 路径 = String(req.url || '').split('?')[0].replace('/dsh-mihoyo', '').replace(/^\/+/, '').replace(/\/+$/, '')
        const 参数 = new URL(String(req.url || ''), 'http://127.0.0.1').searchParams
        const 写 = (o, 码 = 200) => {
          if (res.headersSent || res.writableEnded || res.destroyed) return
          try {
            res.writeHead(码, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(o))
          } catch {}
        }
        const 方法 = String(req.method || 'GET').toUpperCase()
        try {
          if (!路径) 路径 = 'state'

          if (路径 === 'version') {
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            return 写({ ok: false, 说: '版本源还没接：上游没有可读的版本文件，这里不假装有数据' }, 501)
          }
          if (路径 === 'roles') {
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            const st = 读状态()
            if (!st.cookie) return 写({ ok: false, 说: '还没登录，先发 #扫码登录' }, 400)
            const 角 = await 拉角色(st.cookie)
            if (!角 || !角.列表) return 写({ ok: false, 说: 角?.错 || '没查到角色' }, 502)
            存状态({ ...st, roles: 角.列表, lastCheckAt: new Date().toISOString() })
            try {
              const 表 = 读用户们()
              const 键 = { hk4e_cn: 'gs', hkrpg_cn: 'sr', nap_cn: 'zzz' }
              for (const [q, 人] of Object.entries(表)) {
                if (!人 || !人.cookie) continue
                人.games = 人.games || {}
                for (const r of 角.列表) {
                  const g = 键[r.game]
                  if (!g) continue
                  if (g === 'gs' && 人.games.gs?.uid) continue
                  人.games[g] = { uid: r.uid, server: r.server, nickname: r.nickname }
                }
              }
              存用户们(表)
            } catch {}
            return 写({ ok: true, 角色: 角.列表.map((x) => ({ game: x.game, uid: x.uid, nickname: x.nickname, server: x.server, level: x.level })) })
          }
          if (路径 === 'config') {
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            if (方法 === 'POST') {
              if (!/^application\/json\s*(;|$)/i.test(String(req.headers['content-type'] || ''))) return 写({ ok: false, 说: 'content-type 要是 application/json' }, 415)
              let 入
              try { 入 = JSON.parse(await 读体(req) || '{}') } catch { return 写({ ok: false, 说: 'body 不是 JSON' }, 400) }
              if (!入 || typeof 入 !== 'object' || Array.isArray(入)) return 写({ ok: false, 说: 'body 要是一个对象' }, 400)
              const 动作 = String(入.动作 || '')
              if (动作 === '重建别名') {
                try { await 跑命令(process.execPath, [join(家, 'tools', 'build-aliases.mjs')], { cwd: 家, timeout: 90000 }) } catch (e) { return 写({ ok: false, 说: '重建失败：' + String(e?.message || e).slice(0, 80) }, 500) }
                let 别 = {}
                try { 别 = JSON.parse(readFileSync(join(家, 'aliases.json'), 'utf8')) } catch {}
                return 写({ ok: true, 说: '别名表重建好了', 别名: { gs: Object.keys(别.gs || {}).length, sr: Object.keys(别.sr || {}).length, zzz: Object.keys(别.zzz || {}).length } })
              }
              if (动作 === '刷新三游戏') {
                const st = 读状态()
                if (!st.cookie) return 写({ ok: false, 说: '还没登录' }, 400)
                const 角 = await 拉角色(st.cookie)
                if (!角 || !角.列表) return 写({ ok: false, 说: 角?.错 || '没查到角色' }, 502)
                存状态({ ...st, roles: 角.列表, lastCheckAt: new Date().toISOString() })
                return 写({ ok: true, 角色: 角.列表.map((x) => ({ game: x.game, uid: x.uid, nickname: x.nickname, server: x.server })) })
              }
              return 写({ ok: false, 说: '不认识的动作用' }, 400)
            }
            let 别 = {}
            try { 别 = JSON.parse(readFileSync(join(家, 'aliases.json'), 'utf8')) } catch {}
            return 写({
              ok: true,
              别名: { gs: Object.keys(别.gs || {}).length, sr: Object.keys(别.sr || {}).length, zzz: Object.keys(别.zzz || {}).length, 建于: 别.建于 || '' },
              数据源: [
                { 名: '原神', 源: 'Enka · 角色展柜', 状态: '可用' },
                { 名: '星铁', 源: 'EnkaHSR / Mihomo', 状态: '可用' },
                { 名: '绝区零', 源: '米游社（无公开接口）', 状态: '不可用' }
              ],
              说明: '别名由 miao 的 meta 生成（abbr / alias）；重建后不用重启，机器人 60 秒内自动换新',
            })
          }
          if (路径 === 'srwiki') {
            try {
              if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
              清旧轮廓()
              const 名W = String(参数.get('char') || '').trim().slice(0, 30)
              if (!名W) return 写({ ok: false, 说: '要一个角色名' }, 400)
              const 安W = 名W.replace(/[^\w\u4e00-\u9fa5.-]/g, '')
              const 出W = join(家, 'cache', 'srwiki-' + 安W + '.png')
              if (!existsSync(出W)) {
                const 临W = join(家, '_srwiki-' + process.pid + '-' + Date.now())
                const 工W = join(家, 'miao-root', 'plugins', 'miao-plugin', 'sr-wiki-worker.mjs')
                try { await 跑命令(process.execPath, [工W, 名W], { cwd: join(家, 'miao-root'), timeout: 90000, env: { ...process.env, MIAO_OUT: 临W } }) } catch (e) { return 写({ ok: false, 说: '图鉴没画出来' }, 502) }
                try { renameSync(临W + '.png', 出W) } catch (e) { return 写({ ok: false, 说: '图鉴没落盘' }, 502) }
              }
              const 图W = readFileSync(出W)
              res.writeHead(200, { 'content-type': 'image/png', 'content-length': 图W.length, 'cache-control': 'no-store' })
              return res.end(图W)
            } catch (e) { return 写({ ok: false, 说: 'srwiki: ' + String(e?.message || e).slice(0, 120) }, 500) }
          }
          if (路径 === 'srhelp') {
            try {
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            清旧轮廓()
            const 出图H = join(家, 'cache', 'srhelp.png')
            if (!existsSync(出图H)) {
              const 临时基H = join(家, '_srhelp-' + process.pid + '-' + Date.now())
              const 工人H = join(家, 'miao-root', 'plugins', 'miao-plugin', 'sr-help-worker.mjs')
              try { await 跑命令(process.execPath, [工人H], { cwd: join(家, 'miao-root'), timeout: 90000, env: { ...process.env, MIAO_OUT: 临时基H } }) } catch (e) { return 写({ ok: false, 说: '帮助图没画出来' }, 502) }
              try { renameSync(临时基H + '.png', 出图H) } catch (e) { return 写({ ok: false, 说: '帮助图没落盘' }, 502) }
            }
            const 图H = readFileSync(出图H)
            res.writeHead(200, { 'content-type': 'image/png', 'content-length': 图H.length, 'cache-control': 'no-store' })
            return res.end(图H)
            } catch (e) { return 写({ ok: false, 说: 'srhelp: ' + String(e?.message || e).slice(0, 160) }, 500) }
          }
          if (路径 === 'users') {
            const q = String(参数.get('q') || '').trim()
            if (q && (!/^[A-Za-z0-9_-]{6,64}$/.test(q) || /^(__|constructor$|prototype$)/.test(q))) return 写({ ok: false, 说: 'q 的格式不对' }, 400)
            if (方法 === 'GET') {
              if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
              const 表 = 读用户们()
              const 脱敏 = (人) => {
                if (!人) return null
                const 游 = {}
                for (const [k, v] of Object.entries(人.games || {})) 游[k] = { uid: v.uid, server: v.server, nickname: v.nickname }
                return { games: 游, boundAt: 人.boundAt || '', 有凭据: Boolean(人.cookie) }
              }
              const 全 = {}
              for (const [k, v] of Object.entries(表)) 全[k] = 脱敏(v)
              return 写({ ok: true, 用户: q ? 脱敏(表[q]) : 全, 游戏: 游戏代码 })
            }
            if (方法 !== 'POST') return 写({ ok: false, 说: '要用 POST' }, 405)
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            if (!/^application\/json\s*(;|$)/i.test(String(req.headers['content-type'] || ''))) return 写({ ok: false, 说: 'content-type 要是 application/json' }, 415)
            let 入
            try { 入 = JSON.parse(await 读体(req) || '{}') } catch (e) { return 写({ ok: false, 说: 'body 不是 JSON' }, 400) }
            if (!入 || typeof 入 !== 'object' || Array.isArray(入)) return 写({ ok: false, 说: 'body 要是一个 JSON 对象' }, 400)
            const 谁 = String(入.q || '').trim()
            if (!谁) return 写({ ok: false, 说: '要给 q（QQ 号）' }, 400)
            if (!/^[A-Za-z0-9_-]{6,64}$/.test(谁) || /^(__|constructor$|prototype$)/.test(谁)) return 写({ ok: false, 说: 'q 的格式不对' }, 400)
            const 表 = 读用户们()
            if (入.remove === true) {
              delete 表[谁]
              存用户们(表)
              return 写({ ok: true, 说: '已解绑', q: 谁 })
            }
            const 人 = 表[谁] || { games: {}, boundAt: new Date().toISOString() }
            人.games = 人.games || {}
            if (入.cookie) 人.cookie = String(入.cookie)
            if (入.mid) 人.mid = String(入.mid)
            const 游 = String(入.game || 'gs')
            if (!Object.hasOwn(游戏代码, 游)) return 写({ ok: false, 说: 'game 只认 gs / sr / zzz' }, 400)
            if (入.uid) {
              if (!/^\d{6,12}$/.test(String(入.uid))) return 写({ ok: false, 说: 'UID 不对' }, 400)
              let 补 = { nickname: '', server: '' }
              try {
                const st0 = JSON.parse(readFileSync(join(家, 'state.json'), 'utf8').replace(/^\uFEFF/, '')) || {}
                const 角 = (st0.状态?.roles || st0.roles || [])
                const 中 = 角.find((r) => String(r.uid) === String(入.uid))
                if (中) { 补.nickname = 中.nickname || ''; 补.server = 中.server || '' }
              } catch {}
              人.games[游] = { uid: String(入.uid), server: String(入.server || 补.server || (游 === 'gs' ? 'cn_gf01' : 'prod_gf_cn')), nickname: String(入.nickname || 补.nickname || '') }
            }
            人.boundAt = new Date().toISOString()
            表[谁] = 人
            存用户们(表)
            return 写({ ok: true, 用户: 人 })
          }
          if (路径 === 'state') {
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            const 状态 = 读状态()
            const 缓 = 面板缓存.get(最近查询.uid || 状态.uid) || null
            return 写({ ok: true, 状态: 对外(状态), 缓存: 缓 ? { ...缓.数据, cachedAt: new Date(缓.at).toISOString() } : null })
          }
          if (路径 === 'menu') {
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            let 带状态 = 菜单
            try {
              const 登记 = JSON.parse(readFileSync(join(家, 'commands.json'), 'utf8').replace(/^\uFEFF/, ''))
              const 说明表 = new Map()
              for (const 组 of 菜单 || []) for (const [令, 说明] of 组.items || []) 说明表.set(String(令).split(' ')[0], 说明)
              const 组们 = []
              for (const 组 of 登记.清单 || []) {
                const 项 = []
                for (const [令, 态] of 组.items || []) {
                  const 基 = String(令).split(' ')[0]
                  const 旧说明 = 说明表.get(基) || ''
                  const 说明 = String(态).startsWith('已接')
                    ? (旧说明 ? 旧说明.replace(/^\[[^\]]*\]\s*/, '') : '可用')
                    : (旧说明 ? 旧说明.replace(/^\[[^\]]*\]\s*/, '') : '还没接')
                  项.push([令, '[' + 态 + '] ' + 说明])
                }
                组们.push({ game: 组.game, items: 项 })
              }
              if (组们.length) {
                const 已有 = new Set(组们.map((g) => g.game))
                for (const 组 of 菜单 || []) if (!已有.has(组.game) && !['原神', '账号'].includes(组.game)) 组们.push(组)
                带状态 = 组们
              }
            } catch {}
            return 写({ ok: true, 菜单: 带状态 })
          }
          if (路径 === 'data') {
            if (方法 !== 'GET') return 写({ ok: false, 说: '要用 GET' }, 405)
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            // 遮一下 openid：只露头尾，别的字段一个凭据都不带
            const 遮 = (q) => {
              const s = String(q || '')
              if (!s) return ''
              if (s.length <= 4) return '…'
              if (s.length <= 12) return s.slice(0, 2) + '…' + s.slice(-2)
              return s.slice(0, 4) + '…' + s.slice(-4)
            }
            let 状 = {}
            try { 状 = 对外(读状态()) } catch {}
            let 用户们 = {}
            try { 用户们 = 读用户们() } catch {}
            const 用户 = []
            for (const [q, v] of Object.entries(用户们 || {})) {
              const g = v?.games || {}
              const gs = g.gs || {}
              const 游戏 = [gs.uid ? '原神' : '', g.sr?.uid ? '星铁' : '', g.zzz?.uid ? '绝区零' : ''].filter(Boolean).join(' / ') || '—'
              用户.push({
                谁: 遮(q),
                uid: gs.uid || '',
                昵称: gs.nickname || '',
                服务器: gs.server || '',
                星铁: g.sr?.uid || '',
                绝区零: g.zzz?.uid || '',
          绑定: { gs: g.gs ? { uid: g.gs.uid || '', 昵称: g.gs.nickname || '', 服务器: g.gs.server || '' } : null, sr: g.sr ? { uid: g.sr.uid || '', 昵称: g.sr.nickname || '', 服务器: g.sr.server || '' } : null, zzz: g.zzz ? { uid: g.zzz.uid || '', 昵称: g.zzz.nickname || '', 服务器: g.zzz.server || '' } : null },
                游戏,
                有凭据: Boolean(v?.cookie || v?.stoken || v?.mid) || (Boolean(状?.bound) && String(状?.uid || '') === String(gs.uid || '')),
                绑定于: v?.boundAt || '',
              })
            }
            用户.sort((a, b) => String(a.绑定于).localeCompare(String(b.绑定于)))
            let 缓存 = []
            try {
              for (const n of readdirSync(join(家, 'cache'))) {
                if (!/\.png$/i.test(n)) continue
                const st = statSync(join(家, 'cache', n))
                缓存.push({ 名: n, 大小: st.size, 时间: st.mtimeMs })
              }
            } catch {}
            缓存.sort((a, b) => b.时间 - a.时间)
            let 令总 = 0
            let 令通 = 0
            try {
              const 登记 = JSON.parse(readFileSync(join(家, 'commands.json'), 'utf8').replace(/^\uFEFF/, ''))
              for (const 组 of 登记.清单 || []) for (const [, 态] of 组.items || []) { 令总++; if (String(态).startsWith('已接')) 令通++ }
            } catch {}
            let 机 = null
            try { 机 = 机器人状态() } catch {}
            return 写({
              ok: true,
              概览: {
                用户数: 用户.length,
                有凭据数: 用户.filter((x) => x.有凭据).length,
                当前uid: 状?.uid || '',
                当前昵称: 状?.nickname || '',
                当前已绑定: Boolean(状?.bound),
                角色卡数: 缓存.filter((c) => c.名.startsWith('profile-')).length,
                 三游戏: { 原神: 用户.filter((u) => String(u.游戏 || '').includes('原神')).length, 星铁: 用户.filter((u) => String(u.游戏 || '').includes('星铁')).length, 绝区零: 用户.filter((u) => String(u.游戏 || '').includes('绝区零')).length },
                缓存体积: 缓存.reduce((s, c) => s + c.大小, 0),
                指令总数: 令总,
                指令已接: 令通,
                机器人在线: Boolean(机?.在线),
              },
              用户,
              缓存总数: 缓存.length,
              缓存: 缓存.slice(0, 24).map((c) => ({ 名: c.名, MB: Math.round(c.大小 / 104857.6) / 10, 时间: c.时间 })),
              机器人: 机 ? {
                在线: Boolean(机.在线), 收: 机.收 || 0, 答: 机.答 || 0, 起于: 机.起于 || '', 错: 机.错 || '',
                最近: (机.最近 || []).slice(-10).map((s) => String(s).replace(/[0-9A-Fa-f]{12,}/g, '…').slice(0, 80)),
              } : null,
            })
          }
          if (路径 === 'miao/render') {
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            清旧轮廓()
            const 模 = String(参数.get('tpl') || 'help/index').trim()
            if (!/^[a-z0-9/_-]{1,60}$/i.test(模)) return 写({ ok: false, 说: 'tpl 不合法' }, 400)
            const 插件根 = join(家, 'miao-root', 'plugins', 'miao-plugin')
            const 工人 = join(插件根, 'render-worker.mjs')
            if (!existsSync(工人)) return 写({ ok: false, 说: 'worker 不在' }, 500)
            const 缓存目录 = join(家, 'cache')
            try { mkdirSync(缓存目录, { recursive: true }) } catch {}
            const 缓存图 = join(缓存目录, 'render-' + 模.replace(/\//g, '_') + '.png')
            try {
              const st = statSync(缓存图)
              if (Date.now() - st.mtimeMs < 30 * 60 * 1000) {
                const 图 = readFileSync(缓存图)
                res.writeHead(200, { 'content-type': 'image/png', 'content-length': 图.length, 'cache-control': 'no-store' })
                return res.end(图)
              }
            } catch {}
            const 临时基 = join(家, '_render-' + process.pid + '-' + Date.now())
            const 出图 = 临时基 + '.png'
            try {
              await 跑命令(process.execPath, [工人, 模], {
                cwd: 插件根,
                timeout: 90000,
                env: { ...process.env, MIAO_OUT: 临时基 },
              })
            } catch (e) {
              记本地('渲染失败：' + String(e?.message || e).slice(0, 300))
              return 写({ ok: false, 说: '渲染失败，稍后再试' }, 502)
            }
            if (!existsSync(出图)) return 写({ ok: false, 说: '渲染没有产出图' }, 502)
            const 图 = readFileSync(出图)
            try { writeFileSync(缓存图, 图) } catch {}
            try { unlinkSync(出图) } catch {}
            res.writeHead(200, { 'content-type': 'image/png', 'content-length': 图.length, 'cache-control': 'no-store' })
            return res.end(图)
          }
          if (路径 === 'miao/profile') {
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            清旧轮廓()
            const uid = String(参数.get('uid') || '').trim()
            if (!/^[1-9]\d{8,9}$/.test(uid)) return 写({ ok: false, 说: 'uid 不合法' }, 400)
            const 角色 = String(参数.get('char') || '').trim().slice(0, 40)
            const 强制 = 参数.get('force') === '1'
            const 插件根 = join(家, 'miao-root', 'plugins', 'miao-plugin')
            const 工人 = join(插件根, 'profile-worker.mjs')
            if (!existsSync(工人)) return 写({ ok: false, 说: 'profile worker 不在' }, 500)
            const 缓存目录 = join(家, 'cache')
            try { mkdirSync(缓存目录, { recursive: true }) } catch {}
            const 缓存图 = join(缓存目录, 'profile-' + uid + '-' + (角色 || '首').replace(/[^\w\u4e00-\u9fa5-]/g, '') + '.png')
            if (!强制) {
              try {
                const st = statSync(缓存图)
                if (Date.now() - st.mtimeMs < 10 * 60 * 1000 && st.size > 100000) {
                  let 旧图 = null
                  try { 旧图 = readFileSync(缓存图) } catch {}
                  if (旧图 && 旧图.length > 5000) {
                    res.writeHead(200, { 'content-type': 'image/png', 'content-length': 旧图.length, 'cache-control': 'no-store' })
                    return res.end(旧图)
                  }
                }
              } catch {}
            }
            // 同一张卡只渲染一次，后来的请求搭同一趟车
            let 任务 = 角色卡渲染中.get(缓存图)
            if (!任务) {
              任务 = (async () => {
                const 临时基 = join(家, '_profile-' + process.pid + '-' + Date.now())
                const 出图 = 临时基 + '.png'
                try {
                  await 跑命令(process.execPath, [工人, uid, 角色], {
                    cwd: 插件根,
                    timeout: 120000,
                    env: { ...process.env, MIAO_OUT: 临时基 },
                  })
                  if (!existsSync(出图)) throw new Error('没有产出图')
                  const 图 = readFileSync(出图)
                  if (图.length < 5000) throw new Error('图不完整')
                  // 先写临时文件再改名，别让并发请求读到半截 PNG
                  try {
                    writeFileSync(缓存图 + '.tmp', 图)
                    renameSync(缓存图 + '.tmp', 缓存图)
                  } catch {}
                  try {
                    for (const 名 of readdirSync(缓存目录)) {
                      if (!名.startsWith('profile-')) continue
                      const 路 = join(缓存目录, 名)
                      try { if (Date.now() - statSync(路).mtimeMs > 48 * 3600 * 1000) unlinkSync(路) } catch {}
                    }
                  } catch {}
                  return 图
                } finally {
                  try { unlinkSync(出图) } catch {}
                  try { unlinkSync(缓存图 + '.tmp') } catch {}
                }
              })().finally(() => 角色卡渲染中.delete(缓存图))
              角色卡渲染中.set(缓存图, 任务)
            }
            try {
              const 图 = await 任务
              res.writeHead(200, { 'content-type': 'image/png', 'content-length': 图.length, 'cache-control': 'no-store' })
              return res.end(图)
            } catch (e) {
              const 日志 = String((e && (e.stdout || e.stderr)) || '').trim()
              const 停 = /STOP: ([^\r\n]+)/.exec(日志)
              const 因 = 停 ? 停[1] : String(e?.message || e)
              记本地('角色卡失败：' + 因.slice(0, 200))
              return 写({ ok: false, 说: 停 ? 停[1].slice(0, 140) : '这次没画出来，稍后再试' }, 502)
            }
          }
          if (路径 === 'sr') {
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            清旧轮廓()
            const uid1 = String(参数.get('uid') || '').trim()
            if (!/^[1-9]\d{7,9}$/.test(uid1)) return 写({ ok: false, 说: '星铁 UID 不合法' }, 400)
            const 插件根 = join(家, 'miao-root', 'plugins', 'miao-plugin')
            const 工人 = join(插件根, 'sr-worker.mjs')
            if (!existsSync(工人)) return 写({ ok: false, 说: '星铁 worker 不在' }, 500)
            const 缓存目录 = join(家, 'cache')
            try { mkdirSync(缓存目录, { recursive: true }) } catch {}
            const 角缓存 = String(参数.get('char') || '').trim().slice(0, 40).replace(/[^\w\u4e00-\u9fa5-]/g, '')
            const 模缓存 = String(参数.get('mode') || '').trim() === 'dmg' ? 'dmg' : 'profile'
            const 缓存图 = join(缓存目录, 'sr-' + uid1 + (角缓存 ? '-' + 角缓存 : '') + '-' + 模缓存 + '.png')
            if (参数.get('force') !== '1') {
              try {
                const st = statSync(缓存图)
                if (Date.now() - st.mtimeMs < 10 * 60 * 1000 && st.size > 20000) {
                  const 旧图 = readFileSync(缓存图)
                  res.writeHead(200, { 'content-type': 'image/png', 'content-length': 旧图.length, 'cache-control': 'no-store' })
                  return res.end(旧图)
                }
              } catch {}
            }
            const 临时基 = join(家, '_sr-' + process.pid + '-' + Date.now())
            const 出图 = 临时基 + '.png'
            try {
              const 角色名 = String(参数.get('char') || '').trim().slice(0, 40)
              const 模式 = String(参数.get('mode') || '').trim() === 'dmg' ? 'dmg' : ''
              const 参数列 = 角色名 ? [工人, uid1, 角色名].concat(模式 ? [模式] : []) : [工人, uid1]
              await 跑命令(process.execPath, 参数列, { cwd: 插件根, timeout: 120000, env: { ...process.env, MIAO_OUT: 临时基 } })
            } catch (e) {
              const 日志2 = String((e && (e.stdout || e.stderr)) || '').trim()
              const 停2 = /STOP: ([^\r\n]+)/.exec(日志2)
              try { unlinkSync(出图) } catch {}
              记本地('星铁面板失败：' + (停2 ? 停2[1] : String(e?.message || e).slice(0, 140)))
              return 写({ ok: false, 说: 停2 ? 停2[1].slice(0, 120) : '这次没画出来' }, 502)
            }
            if (!existsSync(出图)) return 写({ ok: false, 说: '没有产出图' }, 502)
            let 图4 = null
            try { 图4 = readFileSync(出图) } catch { try { unlinkSync(出图) } catch {}; return 写({ ok: false, 说: '图读不出来' }, 502) }
            { const 临名 = 缓存图 + '.tmp-' + process.pid + '-' + Date.now(); try { writeFileSync(临名, 图4); renameSync(临名, 缓存图) } catch { try { unlinkSync(临名) } catch {} } }
            try { unlinkSync(出图) } catch {}
            res.writeHead(200, { 'content-type': 'image/png', 'content-length': 图4.length, 'cache-control': 'no-store' })
            return res.end(图4)
          }
          if (路径 === 'uidlist') {
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            清旧轮廓()
            const q = String(参数.get('q') || '').trim().slice(0, 80)
            if (!q) return 写({ ok: false, 说: '缺 q' }, 400)
            const 工人 = join(家, 'uid-worker.mjs')
            if (!existsSync(工人)) return 写({ ok: false, 说: 'uid worker 不在' }, 500)
            const 键 = createHash('sha1').update(q).digest('hex').slice(0, 12)
            const 缓存目录 = join(家, 'cache')
            try { mkdirSync(缓存目录, { recursive: true }) } catch {}
            const 缓存图 = join(缓存目录, 'uids-' + 键 + '.png')
            if (参数.get('force') !== '1') {
              try {
                const st = statSync(缓存图)
                if (Date.now() - st.mtimeMs < 60 * 1000 && st.size > 8000) {
                  const 旧图 = readFileSync(缓存图)
                  res.writeHead(200, { 'content-type': 'image/png', 'content-length': 旧图.length, 'cache-control': 'no-store' })
                  return res.end(旧图)
                }
              } catch {}
            }
            const 临时基 = join(家, '_uid-' + process.pid + '-' + Date.now())
            const 出图 = 临时基 + '.png'
            try {
              await 跑命令(process.execPath, [工人, q], { cwd: 家, timeout: 60000, env: { ...process.env, MIAO_OUT: 临时基 } })
            } catch (e) {
              const 日志2 = String((e && (e.stdout || e.stderr)) || '').trim()
              const 停2 = /STOP: ([^\r\n]+)/.exec(日志2)
              try { unlinkSync(出图) } catch {}
              记本地('uid卡失败：' + (停2 ? 停2[1] : String(e?.message || e).slice(0, 140)))
              return 写({ ok: false, 说: 停2 ? 停2[1].slice(0, 120) : '这次没画出来' }, 502)
            }
            if (!existsSync(出图)) return 写({ ok: false, 说: '没有产出图' }, 502)
            let 图3 = null
            try { 图3 = readFileSync(出图) } catch { try { unlinkSync(出图) } catch {}; return 写({ ok: false, 说: '图读不出来' }, 502) }
            { const 临名 = 缓存图 + '.tmp-' + process.pid + '-' + Date.now(); try { writeFileSync(临名, 图3); renameSync(临名, 缓存图) } catch { try { unlinkSync(临名) } catch {} } }
            try { unlinkSync(出图) } catch {}
            res.writeHead(200, { 'content-type': 'image/png', 'content-length': 图3.length, 'cache-control': 'no-store' })
            return res.end(图3)
          }
          if (路径 === 'myspanel') {
            // 走米游社私有接口（api-takumi-record / character/list），要扫码登录拿到的 cookie
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            const q0 = String(参数.get('q') || '').trim().slice(0, 80)
            const 表0 = 读用户们()
            const 凭 = (q0 && 表0[q0] && String(表0[q0].cookie || '')) || String(读状态().cookie || '')
            const uid0 = String(参数.get('uid') || '').trim() || String(表0[q0]?.games?.gs?.uid || '')
            const 服 = String(参数.get('server') || '').trim() || String(表0[q0]?.games?.gs?.server || 'cn_gf01')
            if (!凭) return 写({ ok: false, 说: '米游社接口获取失败', 因: '还没扫码登录米游社' }, 200)
            if (!uid0) return 写({ ok: false, 说: '米游社接口获取失败', 因: '没有 UID' }, 200)
            const 出 = await 拉米游社角色(凭, uid0, 服).catch((e) => ({ 错: String((e && e.message) || e) }))
            if (!出 || 出.错 || !Array.isArray(出.列表)) {
              return 写({ ok: false, 说: '米游社接口获取失败', 因: String((出 && 出.错) || '返回不对劲').slice(0, 120), retcode: 出?.retcode }, 200)
            }
            return 写({ ok: true, 来源: '米游社', uid: uid0, 服, 列表: 出.列表 }, 200)
          }
          if (路径 === 'list') {
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            清旧轮廓()
            const uid0 = String(参数.get('uid') || '').trim()
            if (!/^[1-9]\d{8,9}$/.test(uid0)) return 写({ ok: false, 说: 'uid 不合法' }, 400)
            const 插件根 = join(家, 'miao-root', 'plugins', 'miao-plugin')
            const 工人 = join(插件根, 'profile-worker.mjs')
            const 缓存目录 = join(家, 'cache')
            try { mkdirSync(缓存目录, { recursive: true }) } catch {}
            const 缓存图 = join(缓存目录, 'list-' + uid0 + '.png')
            if (参数.get('force') !== '1') {
              try {
                const st = statSync(缓存图)
                if (Date.now() - st.mtimeMs < 10 * 60 * 1000 && st.size > 20000) {
                  const 旧图 = readFileSync(缓存图)
                  res.writeHead(200, { 'content-type': 'image/png', 'content-length': 旧图.length, 'cache-control': 'no-store' })
                  return res.end(旧图)
                }
              } catch {}
            }
            const 临时基 = join(家, '_list-' + process.pid + '-' + Date.now())
            const 出图 = 临时基 + '.png'
            try {
              await 跑命令(process.execPath, [工人, uid0, 'list'], { cwd: 插件根, timeout: 90000, env: { ...process.env, MIAO_OUT: 临时基 } })
            } catch (e) {
              const 日志2 = String((e && (e.stdout || e.stderr)) || '').trim()
              const 停2 = /STOP: ([^\r\n]+)/.exec(日志2)
              try { unlinkSync(出图) } catch {}
              记本地('列表卡失败：' + (停2 ? 停2[1] : String(e?.message || e).slice(0, 140)))
              return 写({ ok: false, 说: 停2 ? 停2[1].slice(0, 120) : '这次没画出来' }, 502)
            }
            if (!existsSync(出图)) return 写({ ok: false, 说: '没有产出图' }, 502)
            let 图2 = null
            try { 图2 = readFileSync(出图) } catch { try { unlinkSync(出图) } catch {}; return 写({ ok: false, 说: '图读不出来' }, 502) }
            { const 临名 = 缓存图 + '.tmp-' + process.pid + '-' + Date.now(); try { writeFileSync(临名, 图2); renameSync(临名, 缓存图) } catch { try { unlinkSync(临名) } catch {} } }
            try { unlinkSync(出图) } catch {}
            res.writeHead(200, { 'content-type': 'image/png', 'content-length': 图2.length, 'cache-control': 'no-store' })
            return res.end(图2)
          }
          if (路径 === 'wiki') {
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            清旧轮廓()
            const 模 = String(参数.get('mode') || 'talent').trim()
            if (!['talent', 'cons', 'material', 'wiki'].includes(模)) return 写({ ok: false, 说: 'mode 只认 talent / cons / material / wiki' }, 400)
            const 名 = String(参数.get('char') || '').trim().slice(0, 40)
            if (!名) return 写({ ok: false, 说: '要给角色名' }, 400)
            if (!/^[\w\u4e00-\u9fa5-]+$/.test(名)) return 写({ ok: false, 说: '角色名不合法' }, 400)
            const 插件根 = join(家, 'miao-root', 'plugins', 'miao-plugin')
            const 工人 = join(插件根, 'wiki-worker.mjs')
            try {
              for (const 老图 of readdirSync(join(家, 'cache'))) {
                if (!老图.startsWith('wiki-')) continue
                const 老路 = join(家, 'cache', 老图)
                try { if (Date.now() - statSync(老路).mtimeMs > 7 * 24 * 3600 * 1000) unlinkSync(老路) } catch {}
              }
            } catch {}
            if (!existsSync(工人)) return 写({ ok: false, 说: 'wiki worker 不在' }, 500)
            const 缓存目录 = join(家, 'cache')
            try { mkdirSync(缓存目录, { recursive: true }) } catch {}
            try { for (const 名2 of readdirSync(家)) { if (!名2.startsWith('_wk-')) continue; const 路2 = join(家, 名2); try { if (Date.now() - statSync(路2).mtimeMs > 600000) unlinkSync(路2) } catch {} } } catch {}
            const 缓存图 = join(缓存目录, 'wiki-' + 模 + '-' + 名.replace(/[^\w\u4e00-\u9fa5-]/g, '') + '.png')
            if (参数.get('force') !== '1') {
              try {
                const st = statSync(缓存图)
                if (Date.now() - st.mtimeMs < 24 * 3600 * 1000 && st.size > 30000) {
                  const 旧图 = readFileSync(缓存图)
                  res.writeHead(200, { 'content-type': 'image/png', 'content-length': 旧图.length, 'cache-control': 'no-store' })
                  return res.end(旧图)
                }
              } catch {}
            }
            const 临时基 = join(家, '_wk-' + process.pid + '-' + Date.now())
            const 出图 = 临时基 + '.png'
            try {
              await 跑命令(process.execPath, [工人, 模, 名], {
                cwd: 插件根,
                timeout: 90000,
                env: { ...process.env, MIAO_OUT: 临时基 },
              })
            } catch (e) {
              const 日志 = String((e && (e.stdout || e.stderr)) || '').trim()
              const 停 = /STOP: ([^\r\n]+)/.exec(日志)
              try { unlinkSync(出图) } catch {}
              记本地('wiki 失败：' + (停 ? 停[1] : String(e?.message || e).slice(0, 160)))
              return 写({ ok: false, 说: 停 ? 停[1].slice(0, 120) : '这次没画出来' }, 502)
            }
            if (!existsSync(出图)) return 写({ ok: false, 说: '没有产出图' }, 502)
            let 图 = null
            try { 图 = readFileSync(出图) } catch { try { unlinkSync(出图) } catch {}; return 写({ ok: false, 说: '图读不出来' }, 502) }
            { const 临名 = 缓存图 + '.tmp-' + process.pid + '-' + Date.now(); try { writeFileSync(临名, 图); renameSync(临名, 缓存图) } catch { try { unlinkSync(临名) } catch {} } }
            try { unlinkSync(出图) } catch {}
            res.writeHead(200, { 'content-type': 'image/png', 'content-length': 图.length, 'cache-control': 'no-store' })
            return res.end(图)
          }
          if (路径 === 'miao/config') {
            const 根 = join(家, 'miao-root', 'plugins', 'miao-plugin')
            const 配置路径 = join(根, 'components', 'cfg.json')
            const 读配置值 = () => { try { return JSON.parse(readFileSync(配置路径, 'utf8')) } catch { return {} } }
            if (方法 === 'GET') {
              if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
              let 模式 = {}
              try {
                const 模 = await import('file:///' + join(根, 'config', 'system', 'cfg_system.js').replace(/\\/g, '/'))
                模式 = 模.cfgSchema || {}
              } catch (e) { 记本地('读 schema 失败：' + String(e?.message || e).slice(0, 200))
                return 写({ ok: false, 说: '读配置结构失败' }, 500) }
              const 段 = []
              for (const [键, 块] of Object.entries(模式)) {
                const 项 = []
                for (const [子键, c] of Object.entries(块.cfg || {})) {
                  项.push({ 键: 子键, 标题: c.title || 子键, 说明: c.desc || '', 默认: c.def, 类型: typeof c.def })
                }
                段.push({ 键, 标题: 块.title || 键, 项 })
              }
              return 写({ ok: true, 段, 值: 读配置值(), 文件: 配置路径 })
            }
            if (方法 !== 'POST') return 写({ ok: false, 说: '要用 POST' }, 405)
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            if (!/^application\/json\s*(;|$)/i.test(String(req.headers['content-type'] || ''))) return 写({ ok: false, 说: 'content-type 要是 application/json' }, 415)
            let 入 = {}
            try { 入 = JSON.parse(await 读体(req, 65536) || '{}') } catch (e) {
              return 写({ ok: false, 说: e?.码 === 413 ? 'body 太大（上限 64KB）' : 'body 不是 JSON' }, e?.码 === 413 ? 413 : 400)
            }
            if (!入 || typeof 入 !== 'object' || Array.isArray(入) || typeof 入.值 !== 'object' || !入.值) {
              return 写({ ok: false, 说: '要给 { 值: {...} }' }, 400)
            }
            // 只收 schema 里声明过的键，其它一律拒
            const 许 = new Set()
            try {
              const 模 = await import('file:///' + join(根, 'config', 'system', 'cfg_system.js').replace(/\\/g, '/'))
              for (const 块 of Object.values(模.cfgSchema || {})) for (const k of Object.keys(块.cfg || {})) 许.add(k)
            } catch (e) { return 写({ ok: false, 说: '读 schema 失败，拒绝写入' }, 500) }
            const 拒 = Object.keys(入.值).filter((k) => !许.has(k))
            if (拒.length) return 写({ ok: false, 说: '这些键不在配置项里：' + 拒.slice(0, 8).join(', ') }, 400)
            // 类型按 schema 的 def 走，避免给布尔键塞对象把 miao 弄崩
            const 类型表 = {}
            try {
              const 模 = await import('file:///' + join(根, 'config', 'system', 'cfg_system.js').replace(/\\/g, '/'))
              for (const 块 of Object.values(模.cfgSchema || {})) for (const [k, c] of Object.entries(块.cfg || {})) 类型表[k] = typeof c.def
            } catch {}
            for (const [k, v] of Object.entries(入.值)) {
              const 期 = 类型表[k]
              if (期 === 'boolean' && typeof v !== 'boolean') return 写({ ok: false, 说: k + ' 要是布尔值' }, 400)
              if (期 === 'number' && (typeof v !== 'number' || !Number.isFinite(v))) return 写({ ok: false, 说: k + ' 要是数字' }, 400)
              if (期 === 'string' && typeof v !== 'string') return 写({ ok: false, 说: k + ' 要是字符串' }, 400)
              if (typeof v === 'string' && v.length > 2000) return 写({ ok: false, 说: k + ' 太长' }, 400)
            }
            const 旧 = 读配置值()
            const 新 = { ...旧, ...入.值 }
            mkdirSync(join(根, 'components'), { recursive: true })
            const 临 = 配置路径 + '.' + process.pid + '.' + Date.now() + '.tmp'
            writeFileSync(临, JSON.stringify(新, null, '\t'))
            renameSync(临, 配置路径)
            return 写({ ok: true, 值: 新, 说: '存好了，miao 下次读配置就生效' })
          }
          if (路径 === 'miao') {
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            const 页面 = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>miao 配置</title>
<style>
body{margin:0;background:#0f141b;color:#e6edf3;font:13px/1.6 system-ui,'Microsoft YaHei',sans-serif}
.wrap{max-width:820px;margin:0 auto;padding:22px 18px 80px}
h1{font-size:17px;margin:0 0 4px}
.sub{color:#8b949e;font-size:12px;margin-bottom:18px}
.sec{border:1px solid #232b39;border-radius:10px;margin-bottom:14px;overflow:hidden;background:#121722}
.sec>summary{padding:11px 14px;cursor:pointer;font-weight:600;font-size:13px;background:#151c26;list-style:none}
.sec>summary::-webkit-details-marker{display:none}
.row{display:flex;align-items:center;gap:12px;padding:8px 14px;border-top:1px solid #1b2330}
.row .t{flex:1;min-width:0}
.row .t b{display:block;font-weight:500;font-size:12px}
.row .t span{display:block;color:#8b949e;font-size:11px;margin-top:1px}
input[type=text],input[type=number]{width:150px;font:inherit;font-size:12px;padding:4px 8px;border-radius:6px;border:1px solid #2d3646;background:#0d1218;color:inherit}
input[type=checkbox]{width:16px;height:16px}
.bar{position:fixed;left:0;right:0;bottom:0;padding:10px 18px;background:#0b1016;border-top:1px solid #232b39;display:flex;gap:12px;align-items:center}
button{font:inherit;font-size:12px;padding:6px 16px;border-radius:6px;border:1px solid #2d3646;background:#1b2532;color:inherit;cursor:pointer}
button:disabled{opacity:.5;cursor:default}
.msg{color:#7fd7a8;font-size:12px}
</style>
<div class="wrap"><h1>miao-plugin 配置</h1><div class="sub">和 Yunzai 后台那套是同一份 schema（<code>config/system/cfg_system.js</code>），改完写进 <code>components/cfg.json</code>。</div>
<div id="根">载入中…</div></div>
<div class="bar"><button id="存">保存</button><span class="msg" id="msg"></span></div>
<script>
var 值 = {}, 段 = [];
function el(t, cls, txt){ var d=document.createElement(t); if(cls)d.className=cls; if(txt!=null)d.textContent=txt; return d }
function 画(){
  var 根 = document.getElementById('根'); 根.innerHTML='';
  if(!段.length){ 根.textContent = '没有读到配置项'; return }
  段.forEach(function(块){
    var d = el('details','sec'); d.open = true;
    var sm = el('summary'); sm.textContent = 块.标题 + '（' + 块.项.length + '）'; d.appendChild(sm);
    块.项.forEach(function(项){
      var row = el('div','row');
      var t = el('div','t'); t.appendChild(el('b',null,项.标题)); if(项.说明) t.appendChild(el('span',null,项.说明));
      row.appendChild(t);
      var v = Object.prototype.hasOwnProperty.call(值, 项.键) ? 值[项.键] : 项.默认;
      if(项.类型 === 'boolean'){
        var cb = el('input'); cb.type='checkbox'; cb.checked = !!v;
        cb.onchange = function(){ 值[项.键] = cb.checked };
        row.appendChild(cb);
      } else {
        var ip = el('input'); ip.type = 项.类型 === 'number' ? 'number' : 'text'; ip.value = v == null ? '' : v;
        ip.oninput = function(){ var x = ip.value; 值[项.键] = 项.类型 === 'number' ? (x === '' ? 0 : Number(x)) : x };
        row.appendChild(ip);
      }
      d.appendChild(row);
    });
    根.appendChild(d);
  });
}
function 取(){
  fetch('/dsh-mihoyo/miao/config').then(function(r){ return r.json() }).then(function(j){
    if(!j.ok){ document.getElementById('根').textContent = '读配置失败：' + (j.说||''); return }
    段 = j.段 || []; 值 = j.值 || {}; 画();
  }).catch(function(e){ document.getElementById('根').textContent = '读配置失败：' + e });
}
document.getElementById('存').onclick = function(){
  var btn = this; btn.disabled = true; var m = document.getElementById('msg'); m.textContent='保存中…';
  fetch('/dsh-mihoyo/miao/config', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ 值: 值 }) })
    .then(function(r){ return r.json() }).then(function(j){ m.textContent = j.ok ? '存好了' : ('失败：' + (j.说||'')) })
    .catch(function(e){ m.textContent = '失败：' + e }).finally(function(){ btn.disabled = false });
};
取();
</script></html>`
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN' })
            return res.end(页面)
          }

          if (路径 === 'login/start') {
            if (方法 !== 'POST') return 写({ ok: false, 说: '要用 POST' }, 405)
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            try { await 读体(req, 4096) } catch {}
            const 码 = await 建二维码()
            const 谁 = String(参数.get('q') || '').trim()
            const sid = 新会话号()
            扫码表.set(sid, { ticket: 码.ticket, at: 码.at, q: 谁 })
            for (const [k, v] of 扫码表) if (Date.now() - v.at > 200000) 扫码表.delete(k)
            return 写({ ok: true, ...码, sid, 有效期: 180 })
          }
          if (路径 === 'login/poll') {
            if (方法 === 'GET' && String(req.headers['sec-fetch-mode'] || '') !== 'cors') {
              return 写({ ok: false, 说: '这个接口只接受页面里的请求' }, 403)
            }
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            const sid = String(参数.get('sid') || '').trim()
            const 靠 = sid ? 扫码表.get(sid) : null
            const ticket = String(靠?.ticket || (sid ? '' : (参数.get('ticket') || 登录会话.ticket)) || '').trim()
            if (sid && !靠) return 写({ ok: false, 说: '这个扫码会话已过期，重新发起' }, 410)
            if (!ticket) return 写({ ok: false, 说: '没有 ticket，先发起扫码' }, 400)
            const 起 = 靠?.at || 登录会话.at
            if (Date.now() - 起 > 190000) return 写({ ok: false, 说: '二维码已过期，重新发起', status: 'Expired' }, 410)
            const 结果 = await 查扫码(ticket)
            const { cookie, stoken, mid, 角色, ...干净 } = 结果 || {}
            if (结果?.bound && 靠?.q) {
              const 表 = 读用户们()
              const 人 = 表[靠.q] || { games: {} }
              人.cookie = cookie || ''
              人.stoken = stoken || ''
              人.mid = mid || ''
              人.games = 人.games || {}
              for (const r of 角色 || []) {
                const g = r.game === 'hk4e_cn' ? 'gs' : (r.game === 'hkrpg_cn' ? 'sr' : (r.game === 'nap_cn' ? 'zzz' : ''))
                if (g && r.uid) {
                  const 旧表 = 人.games[g]?.列表 || (人.games[g]?.uid ? [{ uid: 人.games[g].uid, server: 人.games[g].server || '', nickname: 人.games[g].nickname || '' }] : [])
                  const 项 = { uid: String(r.uid), server: r.server || '', nickname: r.nickname || '' }
                  const 合 = 旧表.filter((x) => x.uid !== 项.uid)
                  合.push(项)
                  // 一个游戏可以有多个 UID（官服 + B服）。主 uid 保持第一项，全部放进 列表。
                  const 主 = 合[0]
                  人.games[g] = { ...主, 列表: 合 }
                }
              }
              人.boundAt = new Date().toISOString()
              表[靠.q] = 人
              存用户们(表)
              扫码表.delete(sid)
              干净.已绑定到 = 靠.q
              if (结果.角色错) 干净.提示 = '登录成功，但读角色失败：' + String(结果.角色错).slice(0, 80)
            } else if (结果?.bound) {
              // 没有 sid/q 时退回单用户全局（旧面板路径）
              存状态({ cookie, stoken, mid, boundAt: new Date().toISOString(), lastError: '', uid: 角色?.[0]?.uid || 读状态().uid, server: 角色?.[0]?.server || 'cn_gf01', nickname: 角色?.[0]?.nickname || '', roles: 角色 || [] })
              干净.已绑定 = true
            }
            return 写({ ok: true, ...干净 })
          }
          if (路径 === 'bot') {
            if (方法 === 'GET') {
              if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
              return 写({ ok: true, 机器人: 机器人状态() })
            }
            if (方法 !== 'POST') return 写({ ok: false, 说: '要用 POST' }, 405)
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            if (!/^application\/json\s*(;|$)/i.test(String(req.headers['content-type'] || ''))) return 写({ ok: false, 说: 'content-type 要是 application/json' }, 415)
            let 入 = {}
            try { 入 = JSON.parse(await 读体(req, 8192) || '{}') } catch { return 写({ ok: false, 说: 'body 不是 JSON' }, 400) }
            return 写({ ok: true, 机器人: 存机器人配置(入 || {}) })
          }
          if (路径 === 'bot/start') {
            if (方法 !== 'POST') return 写({ ok: false, 说: '要用 POST' }, 405)
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            const 结果 = await 启机器人(插件端口 || process.env.DSH_PORT)
            return 写({ ...结果, 机器人: 机器人状态() })
          }
          if (路径 === 'bot/stop') {
            if (方法 !== 'POST') return 写({ ok: false, 说: '要用 POST' }, 405)
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            停机器人()
            return 写({ ok: true, 机器人: 机器人状态() })
          }
          if (路径 === 'health') {
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            const 结果 = await 健康(参数.get('force') === '1')
            return 写({ ok: true, ...结果 })
          }
          if (路径 === 'chars') {
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            return 写({ ok: false, 说: '米游社全量角色接口还没接通（character/list 需要 POST+DS，上游现在回 405）；目前只有 Enka 展柜' }, 501)
          }
          if (路径 === 'panel/png') {
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            清旧轮廓()
            const uid0 = String(参数.get('uid') || '').trim()
            const 名 = String(参数.get('char') || '0').trim()
            if (!/^\d{6,12}$/.test(uid0)) return 写({ ok: false, 说: 'UID 要 6–12 位数字' }, 400)
            let 面板0
            let 强制0 = String(参数.get('force') || '') === '1'
            if (强制0) {
              const 上次 = 强制冷却.get(uid0) || 0
              if (Date.now() - 上次 < 45000) 强制0 = false
              else 强制冷却.set(uid0, Date.now())
            }
            try { 面板0 = await 拉面板(uid0, 强制0) } catch (e) { return 写({ ok: false, 说: String(e?.message || e).slice(0, 120) }, 502) }
            const 列表 = 面板0.chars || []
            if (!列表.length) return 写({ ok: false, 说: '这个 UID 的展柜是空的' }, 404)
            const 谁0 = String(参数.get('who') || '').trim()
            const 筛选 = 谁0 ? 列表.filter((c) => String(c.name).includes(谁0)) : 列表
            const 模式0 = (名 === 'list' || 名 === '全部') ? 'chars' : (名 === 'artis' || 名 === '圣遗物' ? 'artis' : (名 === 'weapons' || 名 === '武器' ? 'weapons' : ''))
            if (模式0) {
              const 标题0 = 模式0 === 'artis' ? '圣遗物' : (模式0 === 'weapons' ? '武器' : '角色')
              const 行们0 = (模式0 === 'artis'
                ? 筛选.flatMap((c) => (c.圣遗物 || []).map((a) => `<div class="r"><div><b>${esc(a.name)}</b><span class="lv">${esc(c.name)} · +${a.level ?? '?'}${a.star ? ' · ' + a.star + '★' : ''}</span></div><span class="sub">${esc(a.套装 || '套装未知')}</span></div>`))
                : 模式0 === 'weapons'
                  ? 筛选.filter((c) => c.武器).map((c) => `<div class="r"><div><b>${esc(c.武器.name)}</b><span class="lv">${esc(c.name)} · Lv${c.武器.level ?? '?'} · 精${c.武器.精炼}${c.武器.star ? ' · ' + c.武器.star + '★' : ''}</span></div></div>`)
                  : 筛选.map((c) => {
                    const 属 = c.属性 || {}
                    return `<div class="r"><div><b>${esc(c.name)}</b><span class="lv">Lv${c.level ?? '?'}${c.constellation ? ' · ' + c.constellation + '命' : ''}</span></div>
<span class="sub">${c.武器 ? c.武器.name + ' 精' + c.武器.精炼 : '无武器'} · 遗物 ${(c.圣遗物 || []).length} 件 · HP ${属.hp ? Math.round(属.hp) : '?'} · 暴击 ${属.暴击率 ?? '?'}%</span></div>`
                  })
              ).join('')
              const 页0 = `<!doctype html><html lang="zh"><meta charset="utf-8"><style>
body{margin:0;background:#0d1117;font:14px/1.6 system-ui,'Microsoft YaHei',sans-serif;color:#e6edf3}
.card{width:720px;padding:24px 28px}
.top{display:flex;align-items:baseline;gap:10px;border-bottom:1px solid #21262d;padding-bottom:10px;margin-bottom:14px}
.n{font-size:22px;font-weight:700}.l{color:#8b949e;font-size:12px}
.r{padding:9px 2px;border-bottom:1px solid #1b2129;display:flex;flex-direction:column;gap:3px}
.r b{font-size:16px}.lv{color:#8b949e;font-size:12px;margin-left:8px}.sub{color:#8b949e;font-size:12px}
.f{margin-top:14px;color:#484f58;font-size:11px}
</style><div class="card"><div class="top"><div class="n">${esc(面板0.nickname || '旅行者')}</div><div class="l">UID ${uid0} · ${标题0} ${模式0 === 'chars' ? 列表.length + ' 个' : ''} · Enka</div></div>${行们0}<div class="f">dsh-mihoyo · 数据来自角色展柜</div></div></html>`
              const 临时0 = join(家, 'list-' + process.pid + '-' + Date.now())
              const 轮廓0 = join(家, '_edgeprof-' + process.pid + '-' + Date.now())
              try { 活跃轮廓.add(轮廓0.slice(家.length + 1)) } catch {}
              writeFileSync(临时0 + '.html', 页0, 'utf8')
              const 边0 = 找浏览器()
              if (!边0) { try { unlinkSync(临时0 + '.html') } catch {}; return 写({ ok: false, 说: '找不到 Edge' }, 501) }
              try {
                await 跑命令(边0, ['--headless=new', ...浏览器参(), '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--user-data-dir=' + 轮廓0, '--force-device-scale-factor=1', '--window-size=780,3000', '--screenshot=' + 临时0 + '.png', 'file:///' + 临时0.replace(/\\/g, '/') + '.html'], { timeout: 30000 })
              } catch (e) {
                try { unlinkSync(临时0 + '.html') } catch {}
                return 写({ ok: false, 说: '渲染失败' }, 502)
              }
              for (let i = 0; i < 40 && !existsSync(临时0 + '.png'); i++) await new Promise((r) => setTimeout(r, 250))
              try { 活跃轮廓.delete(轮廓0.slice(家.length + 1)) } catch {}
              清profile(轮廓0)
              if (!existsSync(临时0 + '.png')) { try { unlinkSync(临时0 + '.html') } catch {}; return 写({ ok: false, 说: '渲染没有产出图' }, 502) }
              try { unlinkSync(临时0 + '.html') } catch {}
              裁列表图(临时0 + '.png')
              const 图0 = readFileSync(临时0 + '.png')
              try { unlinkSync(临时0 + '.png') } catch {}
              res.writeHead(200, { 'content-type': 'image/png', 'content-length': 图0.length, 'cache-control': 'no-store' })
              return res.end(图0)
            }
            let 角 = null
            if (/^\d+$/.test(名)) 角 = 列表[Number(名)] || null
            else 角 = 列表.find((c) => c.name === 名) || null
            if (!角) return 写({ ok: false, 说: '没有这个角色' }, 404)
            const 属 = 角.属性 || {}
            const 行们 = [
              ['生命', 属.hp], ['攻击', 属.atk], ['防御', 属.def],
              ['暴击率', 属.暴击率 === null || 属.暴击率 === undefined ? null : 属.暴击率 + '%'],
              ['暴击伤害', 属.暴击伤害 === null || 属.暴击伤害 === undefined ? null : 属.暴击伤害 + '%'],
              ['元素充能', 属.充能 === null || 属.充能 === undefined ? null : 属.充能 + '%'],
              ['元素精通', 属.精通],
            ].filter(([, v]) => v !== null && v !== undefined)
            const 武 = 角.武器 ? `${角.武器.name} · Lv${角.武器.level ?? '?'} · 精${角.武器.精炼}` : '没有武器数据'
            const 遗 = (角.圣遗物 || []).map((a) => `<div class="r"><span>${esc(a.name)}</span><span>+${a.level ?? '?'} · ${a.star ? a.star + '★' : ''}</span></div>`).join('')
            const 格 = 行们.map(([k, v]) => `<div class="a"><b>${k}</b><span>${v}</span></div>`).join('')
            const 页 = `<!doctype html><html lang="zh"><meta charset="utf-8"><style>
body{margin:0;background:#0d1117;font:14px/1.6 system-ui,'Microsoft YaHei',sans-serif;color:#e6edf3}
.card{width:720px;padding:26px 30px}
.top{display:flex;align-items:baseline;gap:12px;border-bottom:1px solid #21262d;padding-bottom:12px;margin-bottom:16px}
.n{font-size:26px;font-weight:700}
.l{color:#8b949e}
.sec{margin:14px 0}
.h{font-size:12px;color:#8b949e;letter-spacing:.08em;margin-bottom:6px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.a{background:#161b22;border:1px solid #21262d;border-radius:8px;padding:8px 10px}
.a b{display:block;font-size:11px;color:#8b949e;font-weight:500}
.a span{font-size:15px;font-weight:600}
.w{background:#161b22;border:1px solid #21262d;border-radius:8px;padding:10px 12px}
.r{display:flex;justify-content:space-between;padding:5px 2px;border-bottom:1px solid #1b2129}
.r:last-child{border-bottom:0}
.f{margin-top:16px;color:#484f58;font-size:11px}
</style><div class="card">
<div class="top"><div class="n">${esc(角.name)}</div><div class="l">Lv${角.level ?? '?'} · 命座 ${角.constellation ?? '?'}</div></div>
<div class="sec"><div class="h">面板</div><div class="grid">${格}</div></div>
<div class="sec"><div class="h">武器</div><div class="w">${esc(武)}</div></div>
<div class="sec"><div class="h">圣遗物</div><div class="w">${遗 || '没有数据'}</div></div>
<div class="f">UID ${uid0} · Enka · dsh-mihoyo</div>
</div></html>`
            const 临时 = join(家, 'card-' + process.pid + '-' + Date.now())
            const 轮廓 = join(家, '_edgeprof-' + process.pid + '-' + Date.now())
            try { 活跃轮廓.add(轮廓.slice(家.length + 1)) } catch {}
            writeFileSync(临时 + '.html', 页, 'utf8')
            const 边 = 找浏览器()
            if (!边) return 写({ ok: false, 说: '找不到 Edge，没法截图' }, 501)
            try {
              await 跑命令(边, ['--headless=new', ...浏览器参(), '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--user-data-dir=' + 轮廓, '--force-device-scale-factor=2', '--window-size=780,900', '--screenshot=' + 临时 + '.png', 'file:///' + 临时.replace(/\\/g, '/') + '.html'], { timeout: 30000 })
            } catch (e) {
              try { unlinkSync(临时 + '.html') } catch {}
              return 写({ ok: false, 说: '截图失败：' + String(e?.message || e).slice(0, 100) }, 502)
            }
            try { unlinkSync(临时 + '.html') } catch {}
            // Edge 的 headless=new 会先返回、子进程稍后才落盘，这里等它几秒
            for (let i = 0; i < 40 && !existsSync(临时 + '.png'); i++) await new Promise((r) => setTimeout(r, 250))
            try { 活跃轮廓.delete(轮廓.slice(家.length + 1)) } catch {}
            清profile(轮廓)
            if (!existsSync(临时 + '.png')) return 写({ ok: false, 说: '截图没生成（Edge 没有落盘）' }, 502)
            const 图 = readFileSync(临时 + '.png')
            try { unlinkSync(临时 + '.png') } catch {}
            res.writeHead(200, { 'content-type': 'image/png', 'content-length': 图.length, 'cache-control': 'no-store' })
            return res.end(图)
          }
          if (路径 === 'panel') {
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            const game = String(参数.get('game') || 'gs')
            const uid = String(参数.get('uid') || 读状态().uid || '').trim()
            if (!Object.hasOwn(Enka路径, game)) return 写({ ok: false, 说: 'game 只认 gs / sr / zzz' }, 400)
            if (!/^\d{6,12}$/.test(uid)) return 写({ ok: false, 说: 'UID 要 6–12 位数字' }, 400)
            if (game !== 'gs') {
              const r = await fetch(Enka路径[game] + encodeURIComponent(uid), {
                headers: { 'user-agent': 'dsh-mihoyo/0.2', accept: 'application/json' },
                signal: AbortSignal.timeout(15000),
              })
              if (!r.ok) return 写({ ok: false, 说: 'Enka ' + game + ' HTTP ' + r.status }, r.status === 404 ? 404 : 502)
              const j = await r.json()
              return 写({ ok: true, 面板: { game, uid, 原始: j } })
            }
            const 面板 = await 拉面板(uid)
            return 写({ ok: true, 面板: { ...面板, game: 'gs' } })
          }
          if (路径 === 'bind') {
            if (方法 !== 'POST') return 写({ ok: false, 说: '要用 POST' }, 405)
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            if (!/^application\/json\s*(;|$)/i.test(String(req.headers['content-type'] || ''))) {
              return 写({ ok: false, 说: 'content-type 要是 application/json' }, 415)
            }
            let 入
            try { 入 = JSON.parse(await 读体(req) || '{}') } catch (e) { return 写({ ok: false, 说: e.码 === 413 ? 'body 太大' : 'body 不是 JSON' }, e.码 || 400) }
            if (!入 || typeof 入 !== 'object' || Array.isArray(入)) return 写({ ok: false, 说: 'body 要是一个 JSON 对象' }, 400)
            const uid = String(入.uid || '').trim()
            if (uid && !/^\d{9,10}$/.test(uid)) return 写({ ok: false, 说: 'UID 要 9–10 位数字' }, 400)
            const 补 = {}
            for (const k of ['uid', 'server', 'nickname', 'cookie', 'stoken', 'mid']) {
              if (Object.prototype.hasOwnProperty.call(入, k)) 补[k] = String(入[k] || '')
            }
            if (!Object.keys(补).length) return 写({ ok: false, 说: '没有要更新的字段' }, 400)
            补.lastError = ''
            补.boundAt = new Date().toISOString()
            const 状态 = 存状态(补)
            return 写({ ok: true, 状态: 对外(状态) })
          }
          if (路径 === 'unbind') {
            if (方法 !== 'POST') return 写({ ok: false, 说: '要用 POST' }, 405)
            if (!同源(req)) return 写({ ok: false, 说: '来源不对' }, 403)
            if (!/^application\/json\s*(;|$)/i.test(String(req.headers['content-type'] || ''))) {
              return 写({ ok: false, 说: 'content-type 要是 application/json' }, 415)
            }
            try { await 读体(req, 4096) } catch (e) { return 写({ ok: false, 说: e.码 === 413 ? 'body 太大' : 'body 读不了' }, e.码 || 400) }
            const 状态 = 存状态({ uid: '', cookie: '', stoken: '', mid: '', nickname: '', boundAt: '', lastCheckAt: '', lastError: '', panelCache: null })
            面板缓存.clear(); 健康缓存 = { at: 0, 值: null }
            return 写({ ok: true, 状态: 对外(状态) })
          }
          return 写({ ok: false, 说: '没有这个接口' }, 404)
        } catch (e) {
          const 码 = e?.码 || 500
          记本地('接口出错：' + String(e?.message || e).slice(0, 200))
          return 写({ ok: false, 说: 码 === 502 ? '后端没连上，稍后再试' : '这次没成，稍后再试' }, 码)
        }
}
let 插件端口 = ''
export function apply(ctx) {
  const 端口 = (() => { try { return ctx.get('webServer')?.port || globalThis.__dshPort || '' } catch { return '' } })()
  插件端口 = String(端口 || process.env.DSH_PORT || '')
  setTimeout(() => { 自启(端口 || process.env.DSH_PORT).catch(() => {}) }, 3000)
  ctx.effect(() => {
    const 撤 = ctx.webServer.register({
      kind: 'prefix',
      path: '/dsh-mihoyo',
      handler: 处理请求,
    })
    return () => { try { 撤() } catch {} }
  }, 'dsh-mihoyo: /dsh-mihoyo 路由')
}
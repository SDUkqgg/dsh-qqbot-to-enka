// dsh-mihoyo · QQ 指令机器人（第二个号，纯指令，不过 LLM）
// 只做三件事：连开放平台、按前缀路由到本地米游社接口、把结果发回同一个会话。

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

const 家 = process.env.DSH_MIHOYO_HOME || 'F:\\dsh\\mihoyo'
const 配置文件 = join(家, 'bot.json')
const 前缀 = /^[#＃*＊%％]/
const 别名表 = { 少女: '哥伦比娅', 雷神: '雷电将军', 影: '雷电将军', 心海: '珊瑚宫心海', 草神: '纳西妲', 水神: '芙宁娜', 火神: '玛薇卡', 岩王帝君: '钟离', 芙芙: '芙宁娜', 雷电影: '雷电将军', 雷电: '雷电将军', 纳西达: '纳西妲' }
let 别名缓存 = { 时: 0, 表: {} }
import { lookupCommand } from './commands.mjs'

// 强制刷新的冷却：防止任何人反复触发把 Enka / 米游社 打满
const 强刷冷却 = new Map()
const 强刷同人间隔 = 10 * 60 * 1000 // 同一人同游戏 10 分钟
const 强刷全局间隔 = 60 * 1000 // 任意两次强制刷新之间至少 60 秒
let 强刷全局上次 = 0

function 读别名表 () {
  try {
    const f = 家 + '/aliases.json'
    const 秒 = Date.now()
    if (秒 - 别名缓存.时 < 60000) return 别名缓存.表
    const j = JSON.parse(readFileSync(f, 'utf8'))
    const 表 = {}
    for (const 游 of ['gs', 'sr', 'zzz']) for (const [k, v] of Object.entries(j[游] || {})) 表[k] = v
    别名缓存 = { 时: 秒, 表 }
    return 表
  } catch { return 别名缓存.表 }
}
const 正名 = (s) => { const k = String(s || '').trim(); return 读别名表()[k] || 别名表[k] || k }
let 分游缓存 = { 时: 0, 表: { gs: {}, sr: {}, zzz: {} } }
function 读分游别名 () {
  const 秒 = Date.now()
  if (秒 - 分游缓存.时 < 60000) return 分游缓存.表
  try {
    const j = JSON.parse(readFileSync(家 + '/aliases.json', 'utf8'))
    分游缓存 = { 时: 秒, 表: { gs: j.gs || {}, sr: j.sr || {}, zzz: j.zzz || {} } }
  } catch {}
  return 分游缓存.表
}
const 游名表 = { gs: '原神', sr: '星铁', zzz: '绝区零' }
const 游前缀 = { gs: '#', sr: '*', zzz: '%' }


const 状态 = {
  在线: false,
  错: '',
  appId尾: '',
  起于: '',
  收: 0,
  答: 0,
  最近: [],
}

function 读配置() {
  try {
    if (!existsSync(配置文件)) return {}
    return JSON.parse(readFileSync(配置文件, 'utf8')) || {}
  } catch { try { copyFileSync(配置文件, 配置文件 + '.broken-' + Date.now()) } catch {}; return {} }
}

function 存配置(补) {
  const 新 = { ...读配置(), ...补 }
  mkdirSync(家, { recursive: true })
  const 临 = 配置文件 + '.' + process.pid + '.tmp'
  writeFileSync(临, JSON.stringify(新, null, 2) + '\n', 'utf8')
  renameSync(临, 配置文件)
  return 新
}

let 客户端 = null
// 热重载时上一份模块的客户端还连着网关，必须停掉，否则一条消息会被回多次
try { globalThis.__dshMihoyoBot?.stop?.() } catch {}
globalThis.__dshMihoyoBot = null
const 已处理消息 = new Map()

function 记(行) {
  状态.最近.unshift(new Date().toISOString().slice(11, 19) + ' ' + 行)
  状态.最近 = 状态.最近.slice(0, 30)
}


const 睡 = (ms) => new Promise((r) => setTimeout(r, ms))

async function 扫码登录流程(bot, msg, 回) {
  const target = msg.replyTarget
  const 谁 = String(msg.senderId || msg.senderOpenid || msg.groupOpenid || '').trim()
  记QQ昵称(谁, msg.author?.nickname || msg.nickname || msg.sender?.nickname || '')
  await 回('二维码来了，三分钟内用米游社扫，扫完在手机上确认。')
  let j
  try { j = await 本地('login/start?q=' + encodeURIComponent(谁), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }) }
  catch (e) { await 回('要不到二维码：' + String(e?.message || e)); return }
  if (!j?.ok) { await 回('要不到二维码：' + (j?.说 || '没有返回')); return }
  try {
    const 底 = String(j.qr || '').split(',')[1] || ''
    if (!底) { await 回('二维码图是空的'); return }
    const 文件 = join(家, 'qr-' + Date.now() + '.png')
    mkdirSync(家, { recursive: true })
    writeFileSync(文件, Buffer.from(底, 'base64'))
    await bot.sendFile(target, { localPath: 文件 }, { fileName: 'qrcode.png' })
    try { setTimeout(() => { try { unlinkSync(文件) } catch {} }, 200000) } catch {}
  } catch (e) {
    await 回('发二维码图失败：' + String(e?.message || e))
    return
  }
  try {
    const 配 = 读配置()
    if (!配.ownerOpenid) { 存配置({ ownerOpenid: 谁 }); 记('主人记为 ' + String(谁).slice(0, 8)) }
  } catch {}
  for (let i = 0; i < 60; i++) {
    await 睡(3000)
    let p
    try { p = await 本地('login/poll?sid=' + encodeURIComponent(j.sid || '') + '&ticket=' + encodeURIComponent(j.ticket)) } catch { continue }
    if (!p) continue
    if (p.status === 'Confirmed') {
      if (!p.bound) { await 回('确认了，但没拿到凭据，重扫一次'); return }
      if (p.已绑定到) {
        const 提 = p.提示 ? '\n' + p.提示 : ''
        await 回('绑定成功，已记在你名下。' + 提 + '\n发 #面板 查自己，或 #面板 UID 查别人。')
      } else {
        await 回('登录成功，但没落到你的名字上：' + (p.说 || '服务端没返回归属'))
      }
      return
    }
    if (!p.ok && p.status !== 'Created' && p.status !== 'Scanned') { await 回(p.说 || '查询失败'); return }
  }
  await 回('二维码过期了，重发 #扫码登录')
}

// 命令表：全部同步本地 /dsh-mihoyo 接口，不经过模型
async function 路由(文本, 回, 谁 = '', 目标 = null, bot = null) {
  const 干净 = String(文本 || '').trim()
  const 命 = 干净.match(/^[#＃]([^\s]*)\s*(.*)$/)
  const 星命 = 干净.match(/^[*＊]\s*([^\s]*)\s*(.*)$/)
  const 绝命 = 干净.match(/^[%％]\s*([^\s]*)\s*(.*)$/)
  if (!命 && !星命 && !绝命) {
    // 没带前缀：如果整句就是一个游戏角色名/简称，按它的游戏自动进对应查询
    const 裸 = 干净.trim()
    if (裸 && /^[^\s]{1,12}$/.test(裸) && !/^\d+$/.test(裸)) {
      const 分 = 读分游别名()
      const 中 = ['gs', 'sr', 'zzz'].filter((g) => 分[g] && 分[g][裸])
      if (中.length === 1) {
        const g = 中[0]
        if (g === 'zzz') { await 回('绝区零的查询还没接上，先认出来了：' + 裸); return true }
        return 路由((g === 'gs' ? '#面板 ' : 游前缀[g]) + 裸, 回, 谁, 目标, bot)
      }
      if (中.length > 1) {
        await 回('「' + 裸 + '」这几个游戏都有：' + 中.map((g) => 游名表[g] + '(' + 游前缀[g] + ')').join(' / ') + '。加前缀再发一次。')
        return true
      }
    }
    return false
  }
  let 令 = 命 ? 命[1] : ''
  const 参 = 命 ? 命[2].trim() : ''
  // 自检：代码里有、命令表里没有的词会被记下来，方便补表
  if (令 && !lookupCommand(令)) {
    记(`[路由] 未登记命令：${令}`)
  }
  // miao 的写法：#米游社更新面板 / #mys更新面板 / #原神米游社面板更新 / #米游社获取游戏角色详情
  // 我们只读 Enka 展柜，这些一律退化成「强制刷新面板」（真走米游社私有接口那条还过不了人机验证）
  let 强刷 = false
  let 走米游社 = false
  {
    const 剥 = 令.replace(/^(原神|星铁|绝区零)?(米游社|mys)/i, '')
    const 是更新 = /^(全部面板更新|更新全部面板|获取游戏角色详情|更新面板|面板更新|刷新面板)$/
    if (剥 !== 令 && 是更新.test(剥)) {
      强刷 = true
      走米游社 = true
      if (/^星铁/.test(令)) 令 = '星铁面板'
      else if (/^绝区零/.test(令)) 令 = '绝区零面板'
      else 令 = '更新面板'
    } else if (/^(面板更新|全部面板更新|更新全部面板|获取游戏角色详情)$/.test(令)) {
      强刷 = true
      令 = '更新面板'
    }
  }

  // 星铁（*）/ 绝区零（%）前缀：miao 的写法
  if (星命 || 绝命) {
    const 游 = 星命 ? 'sr' : 'zzz'
    const 令2 = String(星命 ? 星命[1] : 绝命[1]).trim().replace(/^(星铁|原神)?(米游社|mys)/i, '')
    const 参2 = String(星命 ? 星命[2] : 绝命[2]).trim()
    const 叫 = 游 === 'sr' ? '星铁' : '绝区零'
    if (游 === 'zzz') {
      const 号0 = 参2 || (/^(?:绑定)?(\d{6,10})$/.exec(令2) || [])[1] || ''
      if (号0) {
        const j0 = await 本地('users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: 谁, uid: 号0, game: 'zzz' }) }).catch(() => null)
        await 回(j0?.ok ? ('绝区零 UID ' + 号0 + ' 记下了，查询接口还在接') : ('绑定失败：' + (j0?.说 || '服务端没响应')))
      } else {
        await 回('绝区零查询还没接上（缺数据源），绑定可以先发 %绑定 UID。')
      }
      return true
    }
    const 号2 = 参2 || (/^(?:绑定)?(\d{6,10})$/.exec(令2) || [])[1] || ''
    if (号2) {
      const j = await 本地('users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: 谁, uid: 号2, game: 游 }) }).catch(() => null)
      await 回(j?.ok ? ('星铁 UID ' + 号2 + ' 记下了，发 *面板 看列表') : ('绑定失败：' + (j?.说 || '服务端没响应')))
      return true
    }
    if (/^(面板|uid|列表|更新面板|刷新面板|更新列表)$/i.test(令2)) {
      const 我2 = await 取我(谁).catch(() => null)
      const uid2 = 我2?.games?.[游]?.uid || ''
      if (!uid2) { await 回('还没绑星铁 UID：发 *绑定 你的UID（星铁号是 9 位左右）'); return true }
      if (!目标 || !bot) { await 回('星铁 UID ' + uid2); return true }
      try {
        const 强 = /^(更新面板|刷新面板|更新列表)$/.test(令2) ? '&force=1' : ''
        const 图2 = await 本地图('sr?uid=' + encodeURIComponent(uid2) + 强, 130000)
        await bot.sendImage(目标, { buffer: 图2 })
        状态.答++
        记('答 [*面板] ' + uid2)
      } catch (e) {
        const 因 = String(e?.message || e)
        记('星铁列表失败：' + 因.slice(0, 140))
        const 说 = (() => { try { return JSON.parse(因).说 || '' } catch { return '' } })()
        await 回('星铁面板没画出来：' + (说 || (/404/.test(因) ? 'Enka 上没有这个 UID（展柜要公开）' : '稍后再试')))
      }
      return true
    }
    if (/^(帮助|菜单|help|星铁帮助)$/i.test(令2)) {
      try {
        const 图帮 = await 本地图('srhelp', 90000)
        if (目标 && bot) { await bot.sendImage(目标, { buffer: 图帮 }); 状态.答++; 记('答 [*帮助图]'); return true }
      } catch (e) { 记('星铁帮助图失败：' + String(e?.message || e).slice(0, 60)) }
      await 回('星铁能用：\n*面板 —— 角色列表（Enka 全部角色）\n*名字 —— 详情卡（面板/星魂/光锥/遗器评分都在卡里）\n*名字伤害 —— 伤害计算表\n*面板 名字 / *详情 名字 —— 同样出详情卡\n*星魂 名字 / *光锥 名字 / *遗器 名字 / *评分 名字\n*绑定 UID —— 换绑星铁号\n注：角色名可用简称（*少女 这种）')
      return true
    }
    const 词表 = '面板|详情|卡片|伤害|星魂|命座|光锥|遗器|评分|词条'
    const 前令 = 令2.match(new RegExp('^(' + 词表 + ')([^\\s]+)$'))
    const 后令 = 令2.match(new RegExp('^(.+?)(' + 词表 + ')$'))
    const 词令 = 前令 || (后令 ? [后令[0], 后令[2], 后令[1]] : null)
    if (词令 && !参2) {
      const 词 = 词令[1]
      const 名 = 词令[2].trim()
      const 我词 = await 取我(谁).catch(() => null)
      const uid词 = 我词?.games?.sr?.uid || ''
      if (!uid词) { await 回('先 *绑定 你的星铁 UID，再发 *名字'); return true }
      if (!目标 || !bot) { await 回('星铁 UID ' + uid词); return true }
      const 模 = 词 === '伤害' ? '&mode=dmg' : ''
      try {
        const 图词 = await 本地图('sr?uid=' + encodeURIComponent(uid词) + '&char=' + encodeURIComponent(正名(名)) + 模, 130000)
        await bot.sendImage(目标, { buffer: 图词 })
        状态.答++
        记('答 [*' + 词 + '] ' + 名)
      } catch (e) {
        const 因词 = String(e?.message || e)
        const 说词 = (() => { try { return JSON.parse(因词).说 || '' } catch { return '' } })()
        记('星铁' + 词 + '失败：' + 因词.slice(0, 140))
        if (/暂无/.test(因词)) await 回('这个号的展柜里没有' + 名 + '。把他放进游戏内「数据共享 → 角色展柜」后，等 5 分钟再发一次。')
        else await 回('星铁' + 词 + '没画出来：' + (说词 || '名字对不对？'))
      }
      return true
    }
    if (/伤害$/.test(令2)) {
      const 名伤 = 令2.replace(/伤害$/, '').trim()
      const 我伤 = await 取我(谁).catch(() => null)
      const uid伤 = 我伤?.games?.sr?.uid || ''
      if (!uid伤) { await 回('先 *绑定 你的星铁 UID'); return true }
      if (!目标 || !bot) { await 回('星铁 UID ' + uid伤); return true }
      try {
        const 图伤 = await 本地图('sr?uid=' + encodeURIComponent(uid伤) + '&char=' + encodeURIComponent(名伤) + '&mode=dmg', 130000)
        await bot.sendImage(目标, { buffer: 图伤 })
        状态.答++
        记('答 [*伤害] ' + 名伤)
      } catch (e) {
        const 因伤 = String(e?.message || e)
        const 说伤 = (() => { try { return JSON.parse(因伤).说 || '' } catch { return '' } })()
        记('星铁伤害失败：' + 因伤.slice(0, 140))
        await 回('星铁伤害没画出来：' + (说伤 || '角色名对不对？'))
      }
      return true
    }
    if (/攻略$/.test(令2)) {
      const 名g = 令2.replace(/攻略$/, '').trim() || 参2
      if (!名g) { await 回('要角色名：*名字攻略'); return true }
      if (!目标 || !bot) { await 回('攻略：' + 名g); return true }
      try {
        const j = await 本地('guide?name=' + encodeURIComponent(正名(名g)) + '&game=sr', undefined, 300000)
        if (!j?.ok) { await 回('攻略没抓到：' + (j?.说 || '米游社那边没有')); return true }
        await 回('攻略：' + (j.标题 || 名g) + (j.更新 ? '\n更新：' + j.更新 : '') + '\n' + (j.来源 || ''))
        const { readFileSync } = await import('node:fs')
        for (const f of (j.图片 || [])) { await bot.sendImage(目标, { buffer: readFileSync(f) }); await new Promise((r) => setTimeout(r, 1200)) }
        状态.答++
        记('答 [*攻略] ' + 名g)
      } catch (e) { await 回('攻略没抓到：' + String(e?.message || e).slice(0, 80)) }
      return true
    }
    if (/^(图鉴|资料)/.test(令2) || /图鉴$/.test(令2)) {
      const 名w = 令2.replace(/^(图鉴|资料)/, '').replace(/图鉴$/, '').trim() || 参2
      if (!名w) { await 回('要角色名：*图鉴 名字'); return true }
      if (!目标 || !bot) { await 回('图鉴：' + 名w); return true }
      try {
        const 图w = await 本地图('srwiki?char=' + encodeURIComponent(正名(名w)), 90000)
        await bot.sendImage(目标, { buffer: 图w })
        状态.答++
        记('答 [*图鉴] ' + 名w)
      } catch (e) {
        const 因w = String(e?.message || e)
        await 回('图鉴没画出来：' + (/404/.test(因w) ? '本地没有这个角色的资料' : '稍后再试'))
      }
      return true
    }
    if (/^(绑定|绑定uid)$/i.test(令2)) { await 回('发 *绑定 你的星铁 UID（数字）'); return true }
    const 我3 = await 取我(谁).catch(() => null)
    const uid3 = 我3?.games?.sr?.uid || ''
    if (!uid3) { await 回('先 *绑定 你的星铁 UID，再发 *名字'); return true }
    if (!目标 || !bot) { await 回('星铁 UID ' + uid3); return true }
    try {
      const 图3 = await 本地图('sr?uid=' + encodeURIComponent(uid3) + '&char=' + encodeURIComponent(正名(令2)), 130000)
      await bot.sendImage(目标, { buffer: 图3 })
      状态.答++
      记('答 [*角色] ' + 令2)
    } catch (e) {
      const 因3 = String(e?.message || e)
      const 说3 = (() => { try { return JSON.parse(因3).说 || '' } catch { return '' } })()
      记('星铁详情失败：' + 因3.slice(0, 140))
      if (/暂无/.test(因3)) await 回('这个号的展柜里没有' + 令2 + '。把他放进游戏内「数据共享 → 角色展柜」后，等 5 分钟再发一次。')
      else await 回('星铁详情没画出来：' + (说3 || '名字对不对？星铁角色名要写全'))
    }
    return true
  }


  if (/^(帮助|菜单|help)$/i.test(令)) {
    if (目标 && bot) {
      try {
        const 图 = await 本地图('miao/render?tpl=help/index')
        await bot.sendImage(目标, { buffer: 图 })
        状态.答++
        记('答 [帮助图]')
        return true
      } catch (e) {
        记('帮助图失败，回文本：' + String(e?.message || e).slice(0, 60))
      }
    }
    await 回('米游社指令：\n#扫码登录 / #绑定 UID / #uid / #解绑\n#面板 或 #uid —— 角色列表图\n#名字（例：#钟离 / #少女）—— 角色卡\n#名字面板 / #名字圣遗物 / #名字武器\n#名字天赋 / #名字命座 / #名字材料 / #名字图鉴\n#圣遗物 [名字] / #武器 [名字]\n\n星铁（* 开头）：*绑定 UID / *面板 / *名字 / *名字伤害\n绝区零（% 开头）：%绑定 UID（查询待接）')
    return true
  }
  if (令 === '版本') {
    const j = await 本地('version').catch(() => null)
    await 回(j?.ok ? `版本：原神 ${j.原神 || '?'} · 星铁 ${j.星铁 || '?'} · 绝区零 ${j.绝区零 || '?'}` : '取不到版本信息')
    return true
  }
  if (令 === '解绑') {
    const j = await 本地('users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: 谁, remove: true }) }).catch(() => null)
    await 回(j?.ok ? '你自己这条绑定已经删了，群里别人不受影响。' : '解绑失败：' + (j?.说 || '没有响应'))
    return true
  }
  if (令 === 'uid' || 令 === '绑定' || /^绑定\d{6,12}$/.test(令) || /^uid\d{6,12}$/i.test(令)) {
    const 号 = 参 || (/^(?:绑定|uid)(\d{6,12})$/i.exec(令) || [])[1] || ''
    if (!号) {
      const 我 = await 取我(谁).catch(() => null)
      const g = 我?.games?.gs
      if (!g?.uid) { await 回('你还没绑，先发 #扫码登录，或 #绑定 UID'); return true }
      const 字 = `你绑的 UID ${g.uid}${g.nickname ? '（' + g.nickname + '）' : ''}`
      if (!目标 || !bot) { await 回(字); return true }
      try {
        let 图 = null
        try { 图 = await 本地图('uidlist?q=' + encodeURIComponent(谁), 60000) } catch { 图 = await 本地图('list?uid=' + encodeURIComponent(g.uid), 115000) }
        await bot.sendImage(目标, { buffer: 图 })
        状态.答++
        记('答 [uid图] ' + g.uid)
      } catch (e) {
        记('uid 图失败：' + String(e?.message || e).slice(0, 120))
        await 回(字)
      }
      return true
    }
    const j = await 本地('users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: 谁, uid: 号, game: 'gs' }) }).catch(() => null)
    if (j?.ok && 令 === 'uid') await 回('已切到 UID ' + 号 + '，后面的查询都用这个')
    else await 回(j?.ok ? '你名下记下了 UID ' + 号 : '绑定失败：' + (j?.说 || ''))
    return true
  }
  if (令 === '帮助图' || 令 === '菜单图') {
    if (!目标 || !bot) { await 回('这个会话发不了图'); return true }
    try {
      const 图 = await 本地图('miao/render?tpl=help/index')
      await bot.sendImage(目标, { buffer: 图 })
      状态.答++
      记('答 [帮助图]')
    } catch (e) {
      记('出图失败：' + String(e?.message || e).slice(0, 160))
      await 回('出图没成功，稍后再试')
    }
    return true
  }
  if (令 === '圣遗物列表' || 令 === '武器列表' || 令 === '圣遗物' || 令 === '武器') {
    if (!目标 || !bot) { await 回('这个会话发不了图'); return true }
    let 查的 = /^\d{6,12}$/.test(参) ? 参 : ''
    if (!查的) {
      const 我 = await 取我(谁).catch(() => null)
      查的 = 我?.games?.gs?.uid || ''
      const 群 = 目标?.scope === 'group'
      const 是号主 = String(谁) === String(读配置().ownerOpenid || '')
      if (!查的 && !是号主) { await 回('群里每个人用自己的：#绑定 UID 绑一下'); return true }
      if (!查的) { const st = await 本地('state').catch(() => null); 查的 = st?.状态?.uid || '' }
    }
    if (!查的) { await 回('你还没绑 UID，先 #扫码登录 或 #绑定 UID'); return true }
    const 模 = (令 === '圣遗物列表' || 令 === '圣遗物') ? 'artis' : 'weapons'
    const 谁0 = /^\d{6,12}$/.test(参) ? '' : 参
    try {
      const 图 = await 本地图('panel/png?uid=' + encodeURIComponent(查的) + '&char=' + 模 + (谁0 ? '&who=' + encodeURIComponent(谁0) : ''))
      await bot.sendImage(目标, { buffer: 图 })
      状态.答++
      记('答 [' + 令 + '] ' + 查的)
    } catch (e) {
      记(令 + '失败：' + String(e?.message || e).slice(0, 120))
      await 回('出图没成功，稍后再试')
    }
    return true
  }
  if (令 === '面板图' || 令 === '出图' || 令 === '角色图' || 令 === '角色' || 令 === '角色卡片') {
    if (!目标 || !bot) { await 回('这个会话发不了图'); return true }
    const 数字 = /^\d{6,12}$/.test(参) ? 参 : ''
    const 角色名 = 数字 ? '' : 参
    let 查的 = 数字
    if (!查的) {
      const 我 = await 取我(谁).catch(() => null)
      查的 = 我?.games?.gs?.uid || ''
      const 群 = 目标?.scope === 'group'
      const 是号主 = String(谁) === String(读配置().ownerOpenid || '')
      if (!查的 && !是号主) {
        await 回('群里每个人用自己的：#绑定 UID 绑一下，再发 #面板图')
        return true
      }
      if (!查的) { const st = await 本地('state').catch(() => null); 查的 = st?.状态?.uid || '' }
    }
    if (!查的) { await 回('你还没绑 UID，先 #扫码登录 或 #绑定 UID'); return true }
    try {
      const 图 = 角色名
        ? await 角色卡图(查的, 角色名)
        : await 本地图('panel/png?uid=' + encodeURIComponent(查的) + '&char=0')
      await bot.sendImage(目标, { buffer: 图 })
      状态.答++
      记('答 [面板图] ' + 查的 + (角色名 ? ' / ' + 角色名 : ''))
    } catch (e) {
      记('出图失败：' + String(e?.message || e).slice(0, 160))
      await 回('出图没成功，稍后再试')
    }
    return true
  }
  if (令 === '面板帮助' || 令 === '帮助面板') {
    await 回('面板相关：\n#面板 —— 角色列表图\n#面板 名字 / #角色 名字 / #查询 名字 —— 单个角色大卡（米游社同款）\n#圣遗物 [名字] / #武器 [名字] —— 装备清单\n#更新面板 —— 绕过缓存重新拉 Enka\n\n数据来自 Enka 角色展柜，需要在游戏里把角色放进展示柜并打开「显示角色详情」。')
    return true
  }
  if (令 === '深渊' || 令 === '深渊12层' || 令 === '本期深渊' || 令 === '幽境' || 令 === '剧诗' || 令 === '幻想真境剧诗' || 令 === '签到' || 令 === '体力' || 令 === '原石' || 令 === '抽卡记录' || 令 === '导入抽卡记录' || 令 === '兑换码' || 令 === '活动' || 令 === '日历') {
    await 回('这条要米游社私有接口，现在过不了人机验证（返回 1034），我不做假数据。能用的是：#面板 #角色 名字 #圣遗物 #武器 #帮助')
    return true
  }
  if (令 === '查询') {
    if (!目标 || !bot) { await 回('这个会话发不了图'); return true }
    if (!参) { await 回('用法：#查询 角色名，比如 #查询 荧'); return true }
    const 参2 = 参
    const 我 = await 取我(谁).catch(() => null)
    let 查的 = 我?.games?.gs?.uid || ''
    const 是号主 = String(谁) === String(读配置().ownerOpenid || '')
    if (!查的 && !是号主) { await 回('先 #绑定 你的UID'); return true }
    if (!查的) { const st = await 本地('state').catch(() => null); 查的 = st?.状态?.uid || '' }
    if (!查的) { await 回('你还没绑 UID'); return true }
    try {
      const 图 = await 角色卡图(查的, 参2)
      await bot.sendImage(目标, { buffer: 图 })
      状态.答++
      记('答 [查询] ' + 参2)
    } catch (e) {
      记('查询失败：' + String(e?.message || e).slice(0, 120))
      await 回('没查到这个角色，或者没在展柜里')
    }
    return true
  }
  if (令 === '更新面板' || 令 === '刷新面板') {
    if (!目标 || !bot) { await 回('这个会话发不了图'); return true }
    let 查的 = /^\d{6,12}$/.test(参) ? 参 : ''
    if (!查的) {
      const 我 = await 取我(谁).catch(() => null)
      查的 = 我?.games?.gs?.uid || ''
      const 是号主 = String(谁) === String(读配置().ownerOpenid || '')
      if (!查的 && !是号主) { await 回('先 #绑定 你的UID'); return true }
      if (!查的) { const st = await 本地('state').catch(() => null); 查的 = st?.状态?.uid || '' }
    }
    if (!查的) { await 回('你还没绑 UID'); return true }
    if (走米游社) {
      const jm = await 本地('myspanel?q=' + encodeURIComponent(谁) + '&uid=' + encodeURIComponent(查的)).catch(() => null)
      if (!jm || !jm.ok || !Array.isArray(jm.列表)) { await 回('米游社接口获取失败'); return true }
      const 行们 = jm.列表.slice(0, 20).map((c) => `${c.name || ('#' + c.id)} Lv${c.level ?? '?'}${c.constellation ? ' · ' + c.constellation + '命' : ''}`)
      记('答 [米游社更新面板] ' + 查的 + ' 共' + jm.列表.length)
      await 回(['米游社 角色面板 · UID ' + jm.uid, ...行们, (jm.列表.length > 20 ? `…共 ${jm.列表.length} 个` : '')].filter(Boolean).join('\n'))
      return true
    }
    await 回('重新拉取中，稍等几秒…')
    try {
      const 图 = await 本地图('list?uid=' + encodeURIComponent(查的) + '&force=1', 120000)
      await bot.sendImage(目标, { buffer: 图 })
      状态.答++
      记('答 [更新面板] ' + 查的)
    } catch (e) {
      记('更新面板失败：' + String(e?.message || e).slice(0, 120))
      await 回('刷新没成功，稍后再试')
    }
    return true
  }
  if (走米游社 && (令 === '星铁面板' || 令 === '绝区零面板')) {
    await 回('米游社这条只接了原神；星铁先用 *面板，绝区零还没数据源')
    return true
  }
  if (令 === '面板' || 令 === '星铁面板' || 令 === '绝区零面板' || 令 === '绝区零' || 令 === '星铁') {
    const 游 = 令 === '星铁面板' || 令 === '星铁' ? 'sr' : (令 === '绝区零面板' || 令 === '绝区零' ? 'zzz' : 'gs')
    // #面板 名字 —— 当单角色卡处理（miao 的用法）
    if (游 === 'gs' && 参 && !/^\d{6,12}$/.test(参) && 目标 && bot) {
      const 我0 = await 取我(谁).catch(() => null)
      const 主0 = String(读配置().ownerOpenid || '')
      const 是号主0 = Boolean(主0) && String(谁) === 主0
      let 卡的 = 我0?.games?.gs?.uid || ''
      if (!卡的 && 是号主0) { const st0 = await 本地('state').catch(() => null); 卡的 = st0?.状态?.uid || '' }
      if (!卡的) { await 回('群里每个人用自己的：#绑定 UID 绑一下，再发 #面板 名字'); return true }
      if (卡的) {
        try {
          const 图 = await 角色卡图(卡的, 正名(参))
          await bot.sendImage(目标, { buffer: 图 })
          状态.答++
          记('答 [面板-角色] ' + 参)
        } catch (e) {
          记('角色卡失败：' + String(e?.message || e).slice(0, 140))
          await 回('出图没成功，稍后再试')
        }
        return true
      }
    }
    let 查的 = 参
    if (!查的) {
      const 我 = await 取我(谁).catch(() => null)
      查的 = 我?.games?.[游]?.uid || 我?.games?.gs?.uid || ''
      const 群 = 目标?.scope === 'group'
      const 是号主 = String(谁) === String(读配置().ownerOpenid || '')
      if (!查的 && !是号主) {
        await 回('你还没绑 UID。发 #绑定 你的UID 就行，群里每个人各绑各的。')
        return true
      }
      if (!查的 && 游 === 'gs') {
        const st = await 本地('state').catch(() => null)
        查的 = st?.状态?.uid || ''
      }
    }
    if (!查的) { await 回('你还没绑 UID。先 #扫码登录，或 #绑定 UID'); return true }
    if (强刷) {
      const 同人 = `${谁}|${游}`
      const 此人上次 = 强刷冷却.get(同人) || 0
      const 人剩 = 强刷同人间隔 - (Date.now() - 此人上次)
      if (人剩 > 0) {
        await 回(`强制刷新冷却中，${Math.ceil(人剩 / 60000)} 分钟后再说。普通查询随时能用。`)
        return true
      }
      const 全局剩 = 强刷全局间隔 - (Date.now() - 强刷全局上次)
      if (全局剩 > 0) {
        await 回(`刚有人刷过，${Math.ceil(全局剩 / 1000)} 秒后再试。`)
        return true
      }
      强刷冷却.set(同人, Date.now())
      强刷全局上次 = Date.now()
    }
    const j = await 本地('panel?game=' + 游 + '&uid=' + encodeURIComponent(查的) + (强刷 ? '&force=1' : '')).catch(() => null)
    if (!j?.ok) { await 回('查不到：' + (j?.说 || '没有响应')); return true }
    if (游 !== 'gs') { await 回(`${游} 面板接口已通，字段解析还没做（返回原始数据 ${JSON.stringify(j.面板?.原始 || {}).slice(0, 300)}）`); return true }
    const 人 = j.面板
    const 行 = [`${人.nickname || ''} UID ${人.uid} Lv${人.level || '?'}`]
    for (const c of (人.chars || []).slice(0, 12)) {
      const 武 = c.武器 ? ` · ${c.武器.name} 精${c.武器.精炼}` : ''
      const 属 = c.属性 && c.属性.hp ? ` · HP${Math.round(c.属性.hp)} 暴击${c.属性.暴击率 ?? '?'}%` : ''
      行.push(`${c.name} Lv${c.level ?? '?'}${武}${属}`)
    }
    if (!人.chars?.length) { 行.push('展柜里没有角色'); await 回(行.join('\n')); return true }
    if (目标 && bot) {
      try {
        let 图 = null
        try { 图 = await 本地图('list?uid=' + encodeURIComponent(查的) + (强刷 ? '&force=1' : ''), 115000) } catch { 图 = await 本地图('panel/png?uid=' + encodeURIComponent(查的) + '&char=list') }
        await bot.sendImage(目标, { buffer: 图 })
        状态.答++
        记('答 [面板图-列表] ' + 查的)
        return true
      } catch (e) {
        记('列表图失败，回文本：' + String(e?.message || e).slice(0, 120))
      }
    }
    行.push('数据：' + (人.source || 'Enka'))
    await 回(行.join('\n'))
    return true
  }
  if (令 === '扫码登录') {
    await 回('扫码在我这边做：打开 DSH 的「米游社查询」面板 → 绑定 → 我要二维码。机器人这边只做查询。')
    return true
  }
  if (文本.trim().startsWith('#') || 文本.trim().startsWith('＃')) {
    // miao 的「角色名直呼」：#雷神 / #雷神面板 / #雷神圣遗物 / #雷神武器 / #雷神天赋 / #雷神命座 / #雷神材料
  if (目标 && bot && /^[\u4e00-\u9fa5A-Za-z·]{1,14}$/.test(令)) {
    const 后缀表 = [['突破材料', 'material'], ['图文攻略', 'guide'], ['攻略', 'guide'], ['图鉴', 'wiki'], ['资料', 'wiki'], ['圣遗物', 'artis'], ['命之座', 'cons'], ['材料', 'material'], ['养成', 'material'], ['天赋', 'talent'], ['技能', 'talent'], ['命座', 'cons'], ['武器', 'weapons'], ['面板', 'card'], ['卡片', 'card'], ['详情', 'card'], ['伤害', 'card']]
    let 名 = 令
    let 式 = 'card'
    for (const [尾, 模] of 后缀表) {
      if (令.length > 尾.length && 令.endsWith(尾)) { 名 = 令.slice(0, -尾.length); 式 = 模; break }
    }
    const 型词 = { 面板: 'card', 卡片: 'card', 详情: 'card', 伤害: 'card', 圣遗物: 'artis', 武器: 'weapons', 天赋: 'talent', 技能: 'talent', 命座: 'cons', 命之座: 'cons', 材料: 'material', 突破材料: 'material', 养成: 'material', 图鉴: 'wiki', 资料: 'wiki' }
    if (式 === 'card' && 参 && 型词[参]) 式 = 型词[参]
    const 要伤害 = 式 === 'card' && (/伤害$/.test(令) || 参 === '伤害')
    名 = 正名(名)
    if (式 === 'guide') {
      try {
        const j = await 本地('guide?name=' + encodeURIComponent(名) + '&game=gs', undefined, 300000)
        if (!j?.ok) { await 回('攻略没抓到：' + (j?.说 || '米游社那边没有')); return true }
        await 回('攻略：' + (j.标题 || 名) + (j.更新 ? '\n更新：' + j.更新 : '') + '\n' + (j.来源 || ''))
        const { readFileSync } = await import('node:fs')
        for (const f of (j.图片 || [])) { await bot.sendImage(目标, { buffer: readFileSync(f) }); await new Promise((r) => setTimeout(r, 1200)) }
        状态.答++
        记('答 [攻略] ' + 名)
      } catch (e) { await 回('攻略没抓到：' + String(e?.message || e).slice(0, 80)) }
      return true
    }
    const 图鉴类 = 式 === 'talent' || 式 === 'cons' || 式 === 'material' || 式 === 'wiki'
    let 出图 = null
    try {
      if (图鉴类) {
        // 只吃本地 meta，跟自己有没有这个角色无关
        出图 = await 本地图('wiki?mode=' + 式 + '&char=' + encodeURIComponent(名), 115000)
      } else {
        const 我 = await 取我(谁).catch(() => null)
        const 主 = String(读配置().ownerOpenid || '')
        const 是号主 = Boolean(主) && String(谁) === 主
        let 查的 = 我?.games?.gs?.uid || ''
        if (!查的 && 是号主) { const st = await 本地('state').catch(() => null); 查的 = st?.状态?.uid || '' }
        if (!查的) { await 回('群里每个人用自己的：先 #绑定 UID，再发 #名字 这种'); return true }
        if (名 && 查的) {
          let 名单 = (globalThis.__dshMihoyoNames || new Map()).get(查的) || null
          if (!名单 || Date.now() - 名单.at > 120000) {
            const pj = await 本地('panel?uid=' + encodeURIComponent(查的)).catch(() => null)
            const 名们 = (pj?.面板?.chars || []).map((c) => c.name).filter(Boolean)
            if (名们.length) {
              名单 = { at: Date.now(), 名们 }
              globalThis.__dshMihoyoNames = globalThis.__dshMihoyoNames || new Map()
              globalThis.__dshMihoyoNames.set(查的, 名单)
            }
          }
          if (false && 名单 && !名单.名们.includes(名)) { await 回('你的展柜里没有「' + 名 + '」。要在游戏里把角色放进展柜并打开「显示角色详情」，5 分钟后再试'); return true }
          if (名单 && 名单.名们.includes(名)) {
            出图 = 式 === 'artis'
              ? await 本地图('panel/png?uid=' + encodeURIComponent(查的) + '&char=artis&who=' + encodeURIComponent(名), 115000)
              : 式 === 'weapons'
                ? await 本地图('panel/png?uid=' + encodeURIComponent(查的) + '&char=weapons&who=' + encodeURIComponent(名), 115000)
                : await 角色卡图(查的, 名)
          }
        }
      }
          if (!出图 && 名) {
            try { 出图 = await 角色卡图(查的, 名) } catch {}
          }
    } catch (e) {
      记('角色名直呼失败：' + String(e?.message || e).slice(0, 140))
      出图 = null
    }
    if (出图) {
      try {
        if (要伤害) await 回('伤害详情模式还没接，先看卡里的暴击伤害和期望伤害数值')
        await bot.sendImage(目标, { buffer: 出图 })
        状态.答++
        记('答 [' + 令 + ']')
      } catch (e) {
        记('发送失败：' + String(e?.message || e).slice(0, 120))
        await 回('图发不出去，稍后再试')
      }
      return true
    }
  }
  if (令 === '版本' || 令 === '喵喵版本' || 令 === '插件版本') {
    await 回('dsh-mihoyo 0.1.0\nmiao-plugin 模板 2.3.3\n数据源：Enka 角色展柜（UID 只读展示柜数据）\n角色卡 / 资料卡 / 列表图 本地渲染\n米游社私有接口当前不通（retcode 1034）')
    return true
  }
  if (令 === '我的ck' || 令 === '查看ck' || 令 === '查看cookie') {
    await 回('凭据不展示、不外发。要换号就 #扫码登录 重扫，要去掉就 #解绑。')
    return true
  }
  if (令 === '删除ck' || 令 === '删除cookie') {
    const j = await 本地('users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: 谁, remove: true }) }).catch(() => null)
    await 回(j?.ok ? '凭据和绑定都清掉了' : '没清掉：' + (j?.说 || '服务端没响应'))
    return true
  }
  await 回('这条还没接。能用的：#帮助 #面板 #角色 名字 #查询 名字 #名字 #名字天赋 #名字命座 #名字材料 #名字图鉴 #圣遗物 [名字] #武器 [名字] #绑定 UID #uid #解绑 #扫码登录')
    return true
  }
  return false
}

let 本地口 = 'http://127.0.0.1:' + (process.env.DSH_PORT || '60908')
function 设本地端口(port) {
  if (port) 本地口 = 'http://127.0.0.1:' + port
}

async function 本地图(路径, 毫秒 = 60000) {
  const r = await fetch(本地口 + '/dsh-mihoyo/' + 路径, { signal: AbortSignal.timeout(毫秒) })
  if (!r.ok) {
    let 文2 = ''
    try { 文2 = await r.text() } catch {}
    throw new Error(文2.slice(0, 160) || ('HTTP ' + r.status))
  }
  return Buffer.from(await r.arrayBuffer())
}

// 单角色大卡：先走 miao 原版卡，失败退回自绘卡
async function 角色卡图(uid, 名, 强制) {
  const 尾 = 强制 ? '&force=1' : ''
  try {
    return await 本地图('miao/profile?uid=' + encodeURIComponent(uid) + '&char=' + encodeURIComponent(名) + 尾, 115000)
  } catch (e) {
    记('miao 卡失败，退回自绘：' + String(e?.message || e).slice(0, 120))
    return await 本地图('panel/png?uid=' + encodeURIComponent(uid) + '&char=' + encodeURIComponent(名 || '0'))
  }
}

async function 取我(谁) {
  if (!谁) return null
  const j = await 本地('users?q=' + encodeURIComponent(谁)).catch(() => null)
  return j?.用户 || null
}

async function 本地(路径, 选项, 毫秒 = 20000) {
  const r = await fetch(本地口 + '/dsh-mihoyo/' + 路径, { ...(选项 || {}), signal: AbortSignal.timeout(毫秒) })
  return r.json()
}

export function 记QQ昵称(q, 名) {
  try {
    const 名0 = String(名 || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24)
    if (!q || !名0) return
    const 表 = 读用户们()
    if (!表[q]) return
    if (表[q].qqName === 名0) return
    表[q].qqName = 名0
    存用户们(表)
  } catch {}
}

export function 机器人状态() {
  const 配 = 读配置()
  return {
    ...状态,
    有配置: Boolean(配.appId && 配.appSecret),
    自启: Boolean(配.autoStart ?? 配['自启']),
  }
}

export function 存机器人配置(入) {
  const 补 = {}
  if (typeof 入.appId === 'string' && 入.appId.trim()) 补.appId = 入.appId.trim()
  if (typeof 入.appSecret === 'string' && 入.appSecret.trim()) 补.appSecret = 入.appSecret.trim()
  const 自启值 = typeof 入.autoStart === 'boolean' ? 入.autoStart : (typeof 入.自启 === 'boolean' ? 入.自启 : null)
  if (自启值 !== null) 补.autoStart = 自启值
  存配置(补)
  return 机器人状态()
}

export async function 启机器人(端口) {
  if (端口) 设本地端口(端口)
  if (客户端 && 状态.在线) return { ok: true, 说: '已经在线' }
  if (客户端) { try { 客户端.stop?.() } catch {}; 客户端 = null; 状态.在线 = false }
  // 跨模块兜底：热重载后旧模块的定时器可能还活着，先掐掉它建的那条连接
  try { globalThis.__dshMihoyoBot?.stop?.() } catch {}
  globalThis.__dshMihoyoBot = null
  const 配 = 读配置()
  if (!配.appId || !配.appSecret) return { ok: false, 说: '还没填 AppID / AppSecret' }
  状态.错 = ''; 状态.连接中 = true; 状态.appId尾 = String(配.appId).slice(-4)
  try {
    const { QQBot } = await import('@tencent-connect/qqbot-nodejs')
    const bot = new QQBot({ appId: 配.appId, appSecret: 配.appSecret, accountId: 'mihoyo' })
    globalThis.__dshMihoyoBot = bot
    bot.on?.('message', (ctx, m) => {
      状态.消息事件 = (状态.消息事件 || 0) + 1
      记('message 事件：' + String(m?.content || '').slice(0, 40))
    })
    bot.on?.('rawEvent', (ctx) => {
      状态.原事件 = (状态.原事件 || 0) + 1
      const t = ctx?.t || ctx?.type || '?'
      if ((状态.原事件 || 0) <= 10) 记('原事件 ' + String(t))
    })
    bot.use(async (ctx, next) => {
      const msg = ctx?.message || {}
      const 文 = msg.content || msg.text || ''
      const 发 = async (回复) => {
        await bot.send({ target: msg.replyTarget || { scope: msg.kind === 'group' ? 'group' : 'c2c', targetId: msg.groupOpenid || msg.senderId, msgId: msg.id }, content: String(回复).slice(0, 1800) })
        状态.答++
        记('答 ' + String(回复).slice(0, 30))
      }
      const 简 = String(文).trim()
      const 谁 = String(msg.senderId || msg.senderOpenid || '').trim()
      const 消息号 = String(msg.id || msg.messageId || msg.msgId || '')
      if (消息号) {
        if (已处理消息.has(消息号)) return next()
        已处理消息.set(消息号, Date.now())
        while (已处理消息.size > 500) 已处理消息.delete(已处理消息.keys().next().value)
      }
      if (!前缀.test(简)) return next()
      状态.收++
      状态.原文字 = 文.slice(0, 80)
      if (/^[#＃](扫码登录|登录)$/.test(简)) {
        const 是私聊 = msg.kind === 'c2c' || msg.kind === 'dm'
        if (!是私聊) { await 发('扫码只走私聊：单独发我 #扫码登录，群里发的话二维码会被别人扫走。'); return }
        if (!谁) { await 发('取不到你的身份，换私聊再试。'); return }
        await 扫码登录流程(bot, msg, 发)
        return
      }
      记('收 ' + 简.slice(0, 40))
      try {
        const 已处理 = await 路由(文, 发, 谁, msg.replyTarget, bot)
        if (!已处理) await 发('不认识的指令，发 #帮助')
      } catch (e) {
        状态.错 = String(e?.message || e)
        记('错 ' + 状态.错.slice(0, 60))
      }
    })
    客户端 = bot
    globalThis.__dshMihoyoBot = bot
    状态.起于 = new Date().toISOString()
    bot.on?.('ready', () => { 状态.在线 = true; 状态.连接中 = false; 记('网关 READY') })
    bot.start().catch((e) => {
      状态.在线 = false; 状态.连接中 = false
      状态.错 = String(e?.message || e).slice(0, 200)
      客户端 = null
      记('连不上 ' + 状态.错.slice(0, 60))
    })
    return { ok: true, 说: '正在连接网关…' }
  } catch (e) {
    客户端 = null
    状态.在线 = false
    状态.连接中 = false
    状态.错 = String(e?.message || e).slice(0, 200)
    return { ok: false, 说: '启动失败：' + 状态.错 }
  }
}

export function 停机器人() {
  try { 客户端?.stop?.() } catch {}
  try { globalThis.__dshMihoyoBot?.stop?.() } catch {}
  globalThis.__dshMihoyoBot = null
  客户端 = null
  状态.在线 = false
  状态.错 = ''
  return { ok: true }
}

export async function 自启(端口) {
  try {
    for (const 名 of readdirSync(家)) if (/^qr-\d+\.png$/.test(名)) { try { unlinkSync(join(家, 名)) } catch {} }
  } catch {}
  const 配 = 读配置()
  if ((配.autoStart ?? 配['自启']) && 配.appId && 配.appSecret) return 启机器人(端口)
  return { ok: false, 说: '没开自启' }
}

export { 路由 }

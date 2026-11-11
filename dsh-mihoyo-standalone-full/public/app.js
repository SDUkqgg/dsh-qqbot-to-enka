// dsh-mihoyo standalone · 看板前端（无框架）
const $ = (s) => document.querySelector(s)
const $$ = (s) => Array.from(document.querySelectorAll(s))
const 基 = ''
const 图前缀 = ['srwiki-', 'srhelp', 'uid-', 'sr-', 'list-', 'panel-', 'wiki-', 'gs-']
let 状态 = null
let 当前筛选 = '全部'
let es = null

const 游名 = { gs: '原神', sr: '星铁', zzz: '绝区零' }
const 游列 = (u, g) => {
  const v = u?.games?.[g]
  if (!v) return []
  if (v.列表 && v.列表.length) return v.列表
  return v.uid ? [{ uid: v.uid, server: v.server, nickname: v.nickname }] : []
}
function 用户标 (u, i) {
  if (u?.qqName) return u.qqName
  const s = String(u?.q || '')
  if (/^\d{5,12}$/.test(s)) return s
  for (const g of Object.values(u?.games || {})) if (g && g.nickname) return g.nickname
  return '群友 ' + (i + 1)
}
const 尾号 = (q) => { const s = String(q || ''); return s.length > 6 ? s.slice(-6) : '' }
const 短 = (q) => { const s = String(q || ''); return s.length > 14 ? s.slice(0, 8) + '…' + s.slice(-4) : s }
const fmtSize = (n) => n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB'
const fmtTime = (ms) => new Date(ms).toLocaleString('zh-CN', { hour12: false })

function 切换 (名) {
  if (location.hash !== '#' + 名) history.replaceState(null, '', '#' + 名)
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === 名))
  $$('.tab').forEach((s) => s.classList.toggle('on', s.id === 'tab-' + 名))
  const 标 = { overview: ['总览', '原神 · 星铁 · 绝区零 的绑定与出图'], users: ['用户', '按 QQ 分组的绑定与出图入口'], chars: ['角色', '已抓到的角色数据'], commands: ['指令', '三个游戏的指令表，标了已接/未接'], gallery: ['图库', '缓存面板图，点开看大图'], service: ['服务', '健康检查与命令覆盖'], logs: ['日志', '服务、操作、请求、机器人的实时日志'] }[名]
  $('#pageTitle').textContent = 标[0]
  $('#pageSub').textContent = 标[1]
  if (名 === 'service') 载服务()
  if (名 === 'chars') 画角色(状态)
  if (名 === 'commands') 画指令()
  if (名 === 'logs') 开日志()
  else 停日志()
}

async function 取Json (路) {
  const r = await fetch(基 + 路, { headers: { 'accept': 'application/json' } })
  const j = await r.json().catch(() => null)
  if (!r.ok || !j || j.ok === false) throw new Error(j?.说 || ('接口 ' + r.status))
  return j
}

async function 取图 (路) {
  const r = await fetch(基 + 路)
  const ct = r.headers.get('content-type') || ''
  if (!ct.includes('image')) {
    const j = await r.json().catch(() => null)
    throw new Error(j?.说 || '没出图')
  }
  return await r.blob()
}

function 弹图 (blob, 名) {
  const url = URL.createObjectURL(blob)
  $('#lbImg').src = url
  $('#lbName').textContent = 名 || ''
  $('#lightbox').classList.add('on')
}

function 关图 () {
  $('#lightbox').classList.remove('on')
  const img = $('#lbImg')
  if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src)
  img.src = ''
}

async function 出图 (按钮, 路, 名) {
  const 原 = 按钮.textContent
  按钮.disabled = true; 按钮.textContent = '生成中…'
  try { 弹图(await 取图(路), 名) } catch (e) { alert('没画出来：' + e.message) } finally { 按钮.disabled = false; 按钮.textContent = 原 }
}

function 画总览 (s) {
  $('#kUsers').textContent = s.用户数
  $('#kGs').textContent = s.绑定.gs
  $('#kSr').textContent = s.绑定.sr
  $('#kZzz').textContent = s.绑定.zzz
  $('#kCache').textContent = s.缓存.张数
  $('#kCacheSize').textContent = fmtSize(s.缓存.字节)
  $('#kBot').textContent = s.机器人.在线 ? '在线' : (s.机器人.自动启动 ? '已配置' : '未配置')
  $('#stamp').textContent = '更新 ' + new Date(s.时间).toLocaleTimeString('zh-CN', { hour12: false })

  const 快 = [
    ['原神列表图', '/dsh-mihoyo/list?force=1'],
    ['星铁列表图', '/dsh-mihoyo/sr?force=1'],
    ['星铁帮助图', '/dsh-mihoyo/srhelp'],
    ['星铁图鉴', '/dsh-mihoyo/srwiki?char=' + encodeURIComponent('千冶•刃')],
  ]
  $('#quick').innerHTML = ''
  for (const [名, 路] of 快) {
    const b = document.createElement('button')
    b.className = 'small'; b.textContent = 名
    b.onclick = () => 出图(b, 路, 名)
    $('#quick').appendChild(b)
  }

  const 近 = (s.图库 || []).slice(0, 8)
  $('#recent').innerHTML = 近.map((g) => `<img src="/api/thumb/${encodeURIComponent(g.name)}" title="${g.name}" onclick="开图('${g.name}')">`).join('')
  $('#recentCount').textContent = s.图库.length + ' 张'

  $('#overviewUsers').innerHTML = s.用户.map((u, i) => `<div class="mini">
    <div class="q" title="${u.q}">${用户标(u, i)}${尾号(u.q) ? ' <span class="tiny">尾号 ' + 尾号(u.q) + '</span>' : ''}</div>
    <div class="g">${['gs', 'sr', 'zzz'].map((g) => { const 列 = 游列(u, g); return 列.length ? 列.map((x) => `<span class="tag ${g}">${游名[g]} ${x.uid}${x.nickname ? ' · ' + x.nickname : ''}</span>`).join('') : `<span class="tag">${游名[g]} 未绑</span>` }).join('')}</div>
  </div>`).join('') || '<div class="tiny">还没有绑定</div>'
}

function 画用户 (s) {
  const 箱 = $('#usersBox')
  箱.innerHTML = ''
  s.用户.forEach((u, i) => {
    const d = document.createElement('div')
    d.className = 'ucard'
    const 按钮 = []
    按钮.push(`<button class="small" data-name-q="${u.q}">填 QQ 号</button>`)
    for (const x of 游列(u, 'gs')) 按钮.push(`<button class="small" data-g="gs" data-uid="${x.uid}">原神 ${x.uid.slice(-4)}${x.nickname ? ' ' + x.nickname : ''} 面板图</button>`)
    for (const x of 游列(u, 'sr')) 按钮.push(`<button class="small" data-g="sr" data-uid="${x.uid}">星铁 ${x.uid.slice(-4)} 面板图</button>`)
    d.innerHTML = `<div class="uid" title="${u.q}">${用户标(u, i)}${尾号(u.q) ? ' <span class="tiny">尾号 ' + 尾号(u.q) + '</span>' : ''}</div>
      <div class="g">${['gs', 'sr', 'zzz'].map((g) => { const 列 = 游列(u, g); return 列.length ? 列.map((x) => `<span class="tag ${g}">${游名[g]} ${x.uid}${x.nickname ? ' · ' + x.nickname : ''}</span>`).join('') : `<span class="tag">${游名[g]} 未绑</span>` }).join('')}</div>
      <div class="tiny" style="margin-top:6px">${u.srChars?.length ? '星铁角色 ' + u.srChars.length + ' 个：' + u.srChars.slice(0, 6).map((c) => c.name).join('、') : ''}</div>
      <div class="btns">${按钮.join('') || '<span class="tiny">这个用户没有绑定 UID</span>'}</div>`
    箱.appendChild(d)
  })
  箱.querySelectorAll('button[data-name-q]').forEach((b) => {
    b.onclick = async () => {
      const 新名 = prompt('这个用户的 QQ 号（或备注名，留空回到游戏昵称）', '')
      if (新名 === null) return
      try {
        const r = await fetch('/api/user/name', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: b.dataset.nameQ, name: 新名 }) })
        const j = await r.json()
        if (!j.ok) alert('没改成：' + (j.说 || ''))
      } catch (e) { alert('没改成：' + e.message) }
      上屏(await 取Json('/api/summary'))
    }
  })
  箱.querySelectorAll('button[data-g]').forEach((b) => {
    b.onclick = () => {
      const uid = b.dataset.uid
      const 路 = b.dataset.g === 'gs' ? `/dsh-mihoyo/list?uid=${uid}&force=1` : `/dsh-mihoyo/sr?uid=${uid}&force=1`
      出图(b, 路, uid + ' 面板')
    }
  })
}

function 画角色 (s) {
  const 人 = s.用户 || []
  const 块 = 人.map((u, i) => {
    const 名 = 用户标(u, i)
    const 段 = []
    for (const g of ['gs', 'sr']) {
      for (const x of (u.chars?.[g] || [])) {
        const 有 = (x.chars || []).length
        const 列 = 有 ? x.chars.map((c) => `<span class="chip" title="${c.id}">${c.name} <b>Lv.${c.level ?? '?'}</b></span>`).join('') : '<span class="chip dim">还没抓</span>'
        段.push(`<div class="tiny" style="margin:10px 0 4px">${游名[g]} ${x.uid}${x.nickname ? ' · ' + x.nickname : ''} <button class="small cfetch" data-g="${g}" data-uid="${x.uid}">抓取</button></div><div class="chips" id="cg-${g}-${x.uid}">${列}</div>`)
      }
    }
    if (!段.length) 段.push('<div class="tiny">没绑原神或星铁</div>')
    return `<div class="panel"><div class="ph"><b>${名}</b><span class="tiny">${(u.chars?.gs?.[0]?.chars?.length || 0) + (u.chars?.sr?.[0]?.chars?.length || 0)} 个角色</span></div>${段.join('')}</div>`
  }).join('') || '<div class="tiny">还没有用户</div>'
  $('#charBox').innerHTML = 块
  $$('.cfetch').forEach((b) => {
    b.onclick = async () => {
      const g = b.dataset.g, uid = b.dataset.uid
      b.disabled = true; b.textContent = '抓取中…'
      try {
        if (g === 'gs') {
          const j = await 取Json('/dsh-mihoyo/panel?game=gs&uid=' + uid)
          const 列 = j.面板?.chars || []
          $('#cg-gs-' + uid).innerHTML = 列.length ? 列.map((c) => `<span class="chip" title="${c.id}">${c.name} <b>Lv.${c.level ?? '?'}</b></span>`).join('') : '<span class="chip dim">没拿到角色</span>'
        } else {
          await 取Json('/dsh-mihoyo/list?uid=' + uid)
          上屏(await 取Json('/api/summary'))
        }
      } catch (e) {
        $('#cg-' + g + '-' + uid).innerHTML = '<span class="chip dim">抓取失败：' + e.message + '</span>'
      }
      b.disabled = false; b.textContent = '抓取'
    }
  })
}
let 日志计时 = null
const 转义 = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
async function 画日志 () {
  const 源 = $('#logFilters button.on')?.dataset.src || ''
  const 错 = $('#logErrOnly').classList.contains('on')
  const 词 = $('#logSearch').value.trim()
  const qs = new URLSearchParams({ lines: $('#logLines').value })
  if (源) qs.set('src', 源)
  if (错) qs.set('lv', 'err')
  if (词) qs.set('q', 词)
  try {
    const j = await 取Json('/api/logs?' + qs)
    $('#logCount').textContent = j.总数 + ' 条 · ' + j.日期
    const 盒 = $('#logList')
    const 贴底 = 盒.scrollTop + 盒.clientHeight > 盒.scrollHeight - 40
    盒.innerHTML = (j.条目 || []).map((x) => {
      const 时 = x.t ? new Date(x.t).toLocaleTimeString('zh-CN', { hour12: false }) : '—'
      const 级 = x.lv === 'err' ? '错误' : x.lv === 'warn' ? '注意' : '正常'
      return `<div class="logrow"><span class="lt">${时}</span><span class="lv ${x.lv}">${级}</span><span class="src">${转义(x.src || '')}</span><span>${转义(x.msg || '')}</span></div>`
    }).join('') || '<div class="tiny">这个筛选下没有日志</div>'
    if (贴底) 盒.scrollTop = 盒.scrollHeight
  } catch (e) { $('#logCount').textContent = '读取失败：' + e.message }
}
function 停日志 () { if (日志计时) { clearInterval(日志计时); 日志计时 = null } }
function 开日志 () { 停日志(); 画日志(); 日志计时 = setInterval(() => { if ($('#logAuto')?.checked) 画日志() }, 5000) }

function 绑日志控件 () {
  if (!$('#logFilters') || $('#logFilters').dataset.绑) return
  $('#logFilters').dataset.绑 = '1'
  $('#logFilters button[data-src]').forEach((b) => { b.onclick = () => { $('#logFilters button[data-src]').forEach((x) => x.classList.toggle('on', x === b)); 画日志() } })
  $('#logErrOnly').onclick = () => { $('#logErrOnly').classList.toggle('on'); 画日志() }
  $('#logSearch').oninput = () => 画日志()
  $('#logLines').onchange = () => 画日志()
  $('#logRefresh').onclick = () => 画日志()
  $('#logAuto').onchange = () => { if ($('#logAuto').checked) 开日志(); else 停日志() }
  $('#logDownload').onclick = async () => {
    const j = await 取Json('/api/logs?lines=1000')
    const 文 = (j.条目 || []).map((x) => x.t + ' [' + x.lv + '] [' + x.src + '] ' + x.msg).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([文], { type: 'text/plain' }))
    a.download = 'dsh-mihoyo-logs-' + j.日期 + '.log'
    a.click()
    URL.revokeObjectURL(a.href)
  }
}

let 指令缓存 = null
async function 画指令 (过滤 = '') {
  if (!指令缓存) {
    try { 指令缓存 = (await 取Json('/api/commands')).分组 } catch (e) { $('#cmdBoxes').innerHTML = '<div class="tiny">指令表读取失败：' + e.message + '</div>'; return }
  }
  const 词 = String(过滤 || $('#cmdSearch')?.value || '').trim().toLowerCase()
  const 列 = ['gs', 'sr', 'zzz', '通用']
  let 总 = 0
  $('#cmdBoxes').innerHTML = 列.map((k) => {
    const g = 指令缓存[k]
    if (!g) return ''
    const 项 = g.项.filter((x) => !词 || x[0].toLowerCase().includes(词) || x[1].toLowerCase().includes(词))
    总 += 项.length
    return `<div class="panel">
      <div class="ph"><b>${g.名} <span class="tiny">${g.前缀 || ''}</span></b><span class="tiny">${项.length} 条</span></div>
      <div class="tiny" style="margin-bottom:8px">${g.说明}</div>
      ${项.map((x) => `<div class="cmd"><span class="n" title="${x[0]}">${x[0]}</span><span class="tag ${x[2] ? 'gs' : ''}" style="${x[2] ? '' : 'opacity:.5'}">${x[2] ? '已接' : '未接'}</span></div>
      <div class="tiny" style="margin:-4px 0 8px 2px">${x[1]}</div>`).join('') || '<div class="tiny">没有匹配</div>'}
    </div>`
  }).join('')
  $('#cmdCount').textContent = '共 ' + 总 + ' 条（搜索过滤后）'
}
function 画图库 (s) {
  const 名 = Array.from(new Set((s.图库 || []).map((g) => g.name.split('-')[0] || 'other')))
  $('#galFilters').innerHTML = ['全部', ...名].map((n) => `<button class="small ${n === 当前筛选 ? 'on' : ''}" data-f="${n}">${n}</button>`).join('')
  $$('#galFilters button').forEach((b) => { b.onclick = () => { 当前筛选 = b.dataset.f; 画图库(状态) } })
  const 列 = (s.图库 || []).filter((g) => 当前筛选 === '全部' || g.name.startsWith(当前筛选))
  $('#gallery').innerHTML = 列.map((g) => `<div class="gal" onclick="开图('${g.name}')">
    <img loading="lazy" src="/api/thumb/${encodeURIComponent(g.name)}" alt="${g.name}">
    <div class="cap"><span>${g.name}</span><span>${fmtSize(g.size)}</span></div></div>`).join('')
}

window.开图 = (名) => {
  const img = new Image()
  img.onload = () => { $('#lbImg').src = img.src; $('#lbName').textContent = 名; $('#lightbox').classList.add('on') }
  img.src = '/api/img/' + encodeURIComponent(名)
}

function 上屏 (s) {
  状态 = s
  画总览(s); 画用户(s); 画角色(s); 画图库(s)
}

async function 载服务 () {
  const 箱 = $('#health'); 箱.innerHTML = ''
  try {
    const j = await 取Json('/dsh-mihoyo/health')
    const 检 = j.检查 || {}
    箱.innerHTML = Object.entries(检).map(([名, v]) => `<div class="k">${名}</div><div class="${v.ok ? 'ok' : 'bad'}">${v.ok ? '正常' : '异常'} · ${v.status || ''} ${v.ms ? v.ms + 'ms' : ''} <span class="tiny">${v.附加 || ''}</span></div>`).join('')
  } catch (e) { 箱.innerHTML = '<div class="k">健康检查</div><div class="bad">' + e.message + '</div>' }
  const 机 = $('#botBox')
  const 机器表单 = (已填) => `
    <div class="tiny" style="grid-column:1/-1">${已填 ? '要改配置就重新填一次 appId 和 appSecret。' : '第一次用先填 QQBOT 的 appId / appSecret（QQ 开放平台 → 机器人 → 开发设置）。'}</div>
    <div class="k">appId</div><div><input id="botAppId" class="inp" placeholder="纯数字 appId"></div>
    <div class="k">appSecret</div><div><input id="botSecret" class="inp" type="password" placeholder="appSecret"></div>
    <div class="k">环境</div><div><label class="tiny"><input id="botSandbox" type="checkbox"> 沙箱</label></div>
    <div class="k"></div><div><button class="small" id="botSave">保存并连接</button></div>`
  const 画机 = async () => {
    try {
      const b = await 取Json('/api/bot')
      const 器 = b.机器人 || {}
      const 已填 = !!b.已填
      const 开 = 器.在线 ? '<span class="ok">在线</span>' : '<span class="bad">离线</span>'
      if (!已填) {
        机.innerHTML = '<div class="k">QQBOT</div><div class="bad">还没填 appId / appSecret</div>' + 机器表单(false)
      } else {
        机.innerHTML = `<div class="k">在线</div><div>${开}</div>
          <div class="k">appId</div><div>尾号 ${b.appId尾 || 器.appId尾 || '----'}</div>
          <div class="k">收 / 答</div><div>${器.收 || 0} / ${器.答 || 0}</div>
          <div class="k">错</div><div class="tiny">${器.错 ? 器.错 : '—'}</div>
          <div class="k">最近</div><div class="tiny">${(器.最近 || []).slice(0, 4).join('<br>') || '—'}</div>
          <div class="k">开关</div><div class="row"><button class="small" id="botStart">启动 QQBOT</button><button class="small" id="botStop">停止</button></div>
          <div class="tiny" style="grid-column:1/-1">同一个 appId 只能有一处在线：DSH 插件那边开着时，这里就别再启动。</div>
          <details style="grid-column:1/-1"><summary class="tiny">修改配置</summary>${机器表单(true)}</details>`
      }
      const 保存 = async () => {
        const appId = ($('#botAppId')?.value || '').trim()
        const appSecret = ($('#botSecret')?.value || '').trim()
        const sandbox = !!$('#botSandbox')?.checked
        if (!appId || !appSecret) return alert('appId 和 appSecret 都要填')
        $('#botSave').disabled = true
        try {
          const r = await fetch('/api/bot/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appId, appSecret, sandbox }) })
          const j = await r.json()
          if (!j.ok) { alert('保存失败：' + (j.说 || '')); return }
          $('#botSave').textContent = '连接中…'
          try { await fetch('/api/bot/start', { method: 'POST' }) } catch {}
          for (let i = 0; i < 12; i++) {
            await new Promise((r2) => setTimeout(r2, 1500))
            try { const b2 = await 取Json('/api/bot'); if (b2.机器人?.在线 || b2.机器人?.错) break } catch {}
          }
        } catch (e) { alert('保存失败：' + e.message) }
        画机()
      }
      if ($('#botSave')) $('#botSave').onclick = 保存
      if ($('#botStart')) $('#botStart').onclick = async (e) => {
        e.target.disabled = true; e.target.textContent = '连接中…'
        let 首包 = null
        try {
          const r = await fetch('/api/bot/start', { method: 'POST' })
          首包 = await r.json()
          if (!首包.ok) alert('启动失败：' + (首包.说 || ''))
        } catch (err) { alert('启动失败：' + err.message) }
        // 网关连接是异步的，启完后连轮询几秒，别停在“离线”上
        for (let i = 0; i < 20; i++) {
          await new Promise((r2) => setTimeout(r2, 1500))
          try {
            const b2 = await 取Json('/api/bot')
            if (b2.机器人?.在线 || b2.机器人?.错) break
          } catch {}
        }
        画机()
      }
      if ($('#botStop')) $('#botStop').onclick = async () => { try { await fetch('/api/bot/stop', { method: 'POST' }) } catch {} 画机() }
      const 日志盒 = document.createElement('div')
      日志盒.style = 'grid-column:1/-1; margin-top:6px'
      日志盒.innerHTML = '<div class="k">最近日志</div><pre id="botLogBox" class="tiny" style="white-space:pre-wrap;margin:4px 0 0"></pre>'
      机.appendChild(日志盒)
      try {
        const lg = await 取Json('/api/bot/log')
        $('#botLogBox').textContent = (lg.日志 || []).slice(-6).join('\n') || '—'
      } catch {}

    } catch (e) {
      机.innerHTML = '<div class="k">机器人</div><div class="bad">拿不到状态：' + e.message + '</div>'
    }
  }
  await 画机()

  const 命 = $('#cmds')
  try {
    const m = await 取Json('/dsh-mihoyo/menu')
    const 列 = m.清单 || m.菜单 || m.指令 || []
    命.innerHTML = 列.length ? 列.map((x) => `<div class="cmd"><span class="n">${x.指令 || x.命令 || x.name || x}</span><span class="tiny">${x.状态 || x.已接 ? '已接' : ''}</span></div>`).join('') : '<div class="tiny">没有拿到命令表</div>'
  } catch { 命.innerHTML = '<div class="tiny">命令表读取失败</div>' }
}

setInterval(() => { if (状态) $('#stamp').textContent = '更新 ' + new Date(状态.时间).toLocaleTimeString('zh-CN', { hour12: false }) }, 1000)

async function 启动 () {
  try {
    const s = await 取Json('/api/summary')
    上屏(s)
    $('#liveDot').classList.add('on'); $('#liveText').textContent = '实时'
  } catch (e) { alert('看板数据加载失败：' + e.message) }
  try {
    es = new EventSource('/api/events')
    es.onopen = () => { $('#liveDot').classList.add('on'); $('#liveText').textContent = '实时' }
    es.onerror = () => { $('#liveDot').classList.remove('on'); $('#liveText').textContent = '重连中…' }
    es.onmessage = (ev) => { try { 上屏(JSON.parse(ev.data)) } catch {} }
  } catch {}
}

$('#refresh').onclick = async () => {
  const b = $('#refresh'); b.disabled = true; b.textContent = '刷新中…'
  try { 上屏(await 取Json('/api/summary')); $('#liveText').textContent = '实时' } catch (e) { alert(e.message) } finally { b.disabled = false; b.textContent = '刷新' }
}
$('#nav').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) 切换(b.dataset.tab) })
$('#lbClose').onclick = 关图
$('#lightbox').onclick = (e) => { if (e.target.id === 'lightbox' || e.target.id === 'lbClose') 关图() }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') 关图() })

启动()
const 初始 = location.hash.slice(1)
if (['overview', 'users', 'chars', 'gallery', 'service'].includes(初始)) 切换(初始)

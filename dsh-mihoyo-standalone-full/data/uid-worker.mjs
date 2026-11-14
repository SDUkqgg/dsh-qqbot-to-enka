// uid-worker：出一张「绑定 UID 列表」小卡（一行一个号：昵称 / UID / 服务器 / 绑定时间）
// 用法：node uid-worker.mjs <q>   q = QQ 那边的用户标识；读 users.json，不碰任何凭据字段
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const 主 = (() => { try { return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url } catch { return false } })()

function 服名 (s) {
  const m = { cn_gf01: '官服 · 天空岛', cn_qd01: 'B服 · 世界树', cn_gf01_os: '国际服' }
  return m[s] || s || '未知'
}
function 时 (iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const 游名 = { gs: '原神', sr: '星穹铁道', zzz: '绝区零' }

async function 跑 () {
  const 家 = (process.env.DSH_MIHOYO_HOME || 'F:/dsh/mihoyo').replace(/\\/g, '/')
  const 输出基 = process.env.MIAO_OUT || (家 + '/_uid-out')
  const q = process.argv[2] || ''
  let 库 = {}
  try { 库 = JSON.parse(fs.readFileSync(家 + '/users.json', 'utf8').replace(/^\uFEFF/, '')) || {} } catch { 库 = {} }
  const 我 = 库[q] || null
  let 主人 = ''
  try { 主人 = String((JSON.parse(fs.readFileSync(家 + '/bot.json', 'utf8').replace(/^\uFEFF/, '')) || {}).ownerOpenid || '') } catch { 主人 = '' }
  const 行 = []
  const 见过 = new Set()
  const 当前 = 我?.games?.gs?.uid ? String(我.games.gs.uid) : ''
  if (我 && 我.games) {
    for (const 游 of ['gs', 'sr', 'zzz']) {
      const g = 我.games[游]
      if (g && g.uid) {
        见过.add(String(g.uid))
        行.push({ 游: 游名[游] || 游, uid: String(g.uid), 昵称: g.nickname || '—', 服: 服名(g.server), 时: 时(我.boundAt), 当前: String(g.uid) === 当前 })
      }
    }
  }
  // 米游社账号下还有别的角色（只在号主看时合并，避免跨人泄露）
  if (主人 && q === 主人) {
    try {
      const st = JSON.parse(fs.readFileSync(家 + '/state.json', 'utf8').replace(/^\uFEFF/, '')) || {}
      const 角 = st.状态?.roles || st.roles || []
      for (const r of 角) {
        const uid = String(r.uid || '')
        if (!uid || 见过.has(uid)) continue
        见过.add(uid)
        行.push({ 游: 游名.gs, uid, 昵称: r.nickname || '—', 服: 服名(r.server), 时: 时(st.状态?.boundAt || st.boundAt || ''), 当前: false, 另: true })
      }
    } catch {}
  }
  const 行html = 行.length
    ? 行.map((r) => `
      <div class="row">
        <div class="nick">${r.昵称}${r.当前 ? '<i class="tag">当前</i>' : ''}${r.另 ? '<i class="tag alt">账号内角色</i>' : ''}</div>
        <div class="uid">${r.uid}</div>
        <div class="meta">${r.游} · ${r.服}</div>
        <div class="when">${r.时}</div>
      </div>`).join('')
    : '<div class="empty">还没有绑定。发 #扫码登录 或 #绑定 UID</div>'

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f1420;font-family:"Microsoft YaHei","PingFang SC",sans-serif;color:#e8ecf5;padding:26px 30px;width:760px}
  .title{font-size:26px;font-weight:700;letter-spacing:1px}
  .title span{font-size:14px;font-weight:400;color:#8b95a8;margin-left:10px}
  .bar{height:3px;width:56px;background:#5b8cff;border-radius:2px;margin:10px 0 18px}
  .row{display:grid;grid-template-columns:150px 1fr 220px 150px;align-items:center;gap:12px;
       padding:14px 16px;background:#171d2b;border:1px solid #232c40;border-radius:10px;margin-bottom:10px}
  .nick{font-size:18px;font-weight:600;display:flex;align-items:center;gap:8px}
  .tag{font-style:normal;font-size:11px;padding:2px 7px;border-radius:5px;background:#3b6cf6;color:#fff}
  .tag.alt{background:#2a3446;color:#9ec5ff}
  .uid{font-size:17px;color:#9ec5ff;font-family:Consolas,monospace}
  .meta{font-size:13px;color:#93a0b8}
  .when{font-size:13px;color:#74819a;text-align:right}
  .empty{padding:28px;background:#171d2b;border:1px dashed #2a3446;border-radius:10px;color:#98a3b8;font-size:15px}
  .foot{margin-top:16px;font-size:12px;color:#5f6b82;text-align:right}
</style></head><body>
  <div class="title">绑定 UID<span>#uid</span></div>
  <div class="bar"></div>
  ${行html}
  <div class="foot">Created By dsh-mihoyo · 凭据不在此图</div>
</body></html>`

  const 候选 = [
    process.env.MIHOYO_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'
  ].filter(Boolean)
  const 边 = 候选.find((x) => fs.existsSync(x))
  if (!边) { console.log('STOP: 找不到 Edge'); process.exit(1) }
  const { createRequire } = await import('node:module')
  const { PNG } = createRequire(家 + '/miao-root/plugins/miao-plugin/package.json')('pngjs')
  const { execFileSync } = await import('node:child_process')
  const 临时 = 家 + '/_uid-' + process.pid + '-' + Date.now()
  const 轮廓 = 家 + '/_edgeprof-' + process.pid + '-' + Date.now()
  const 清 = () => {
    try { fs.rmSync(轮廓, { recursive: true, force: true }) } catch {}
    try { fs.unlinkSync(临时 + '.html') } catch {}
    try { fs.unlinkSync(临时 + '.png') } catch {}
  }
  try {
    fs.writeFileSync(临时 + '.html', html)
    execFileSync(边, ['--headless=new', ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--disable-gpu', '--hide-scrollbars', '--no-first-run',
      '--user-data-dir=' + 轮廓, '--force-device-scale-factor=1.2', '--window-size=760,1200',
      '--screenshot=' + 临时 + '.png', 'file:///' + 临时 + '.html'], { timeout: 30000, stdio: 'ignore' })
    for (let i = 0; i < 60 && !fs.existsSync(临时 + '.png'); i++) await new Promise((r) => setTimeout(r, 200))
    if (!fs.existsSync(临时 + '.png')) { console.log('STOP: 截图没落盘'); process.exit(1) }
    const png = PNG.sync.read(fs.readFileSync(临时 + '.png'))
    const 是墨 = (x, y) => { const i2 = (y * png.width + x) * 4; return Math.abs(png.data[i2] - 15) + Math.abs(png.data[i2 + 1] - 20) + Math.abs(png.data[i2 + 2] - 32) > 14 }
    let 末 = 0
    for (let y = png.height - 1; y >= 0; y--) { let 有 = false; for (let x = 0; x < png.width; x += 4) if (是墨(x, y)) { 有 = true; break } if (有) { 末 = y; break } }
    const 高 = Math.min(png.height, Math.max(120, 末 + 30))
    const 新 = new PNG({ width: png.width, height: 高 })
    PNG.bitblt(png, 新, 0, 0, png.width, 高, 0, 0)
    const buf = PNG.sync.write(新)
    fs.writeFileSync(输出基 + '.png', buf)
    console.log('OK ' + buf.length + ' -> ' + 输出基 + '.png')
  } finally { 清() }
}

if (主) 跑().then(() => process.exit(0)).catch((e) => { console.log('STOP: ' + String(e?.message || e).slice(0, 140)); process.exit(1) })

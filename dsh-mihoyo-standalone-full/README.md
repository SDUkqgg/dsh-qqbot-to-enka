# dsh-mihoyo-standalone

把 dsh-mihoyo 的后端接口和一套完整数据看板打包成一个可以单独启动的本地服务。
不依赖 DSH、不启动 QQ 机器人、不改任何系统设置。

## 一键启动

1. 装 Node.js 18+（本机已有）。
2. 双击 `start.bat`。
3. 浏览器打开 `http://127.0.0.1:8788`。

第一次启动如果缺依赖，`start.bat` 会自动跑一次 `npm install`（只装 pngjs，装在当前目录，不碰全局）。

## 目录约定

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DSH_MIHOYO_HOME` | `.data` | 数据目录；默认用包内干净目录，不读取本机已有账号数据 |
| `MIHOYO_STANDALONE_PORT` | `8788` | 服务端口，冲突时自动向上找空闲端口 |
| `PORT` | 同上 | 兼容用 |

默认数据目录是包内的 `data/`，第一次启动会自动铺好空的 `users.json`、`state.json`、`bot.json`、`aliases.json` 和 `cache/`，**不包含任何现成 UID 或绑定**。

想复用某台机器上已有的米游社数据（比如本机 `F:\dsh\mihoyo`），启动前设环境变量：

```
set DSH_MIHOYO_HOME=F:\dsh\mihoyo
start.bat
```

注意：出图这类走 miao 的功能还要求那个目录下有 `miao-root`（miao-plugin 本体和素材）；干净目录只有看板和数据接口可用。

## 页面

- 总览：用户/三游戏绑定/缓存/机器人配置的 KPI，快捷出图，最近缓存，绑定概览。
- 用户：按 QQ 分组，每个游戏给一个「出图」按钮（原神走 list，星铁走 sr）。
- 指令：三个游戏分栏的完整指令表（`/api/commands`，来源是实际接好的路由），带「已接/未接」标记，顶上可搜索。
- 角色：原神面板按需抓一次（`/dsh-mihoyo/panel?game=gs`）后摊开，星铁角色从 PlayerData 读。
- 图库：缓存 PNG 的缩略图墙，点开看原图；缩略图生成在 `runtime/thumbs`，不动数据目录。
- 服务：健康检查、机器人状态、命令覆盖。
- 地址支持 `/#users`、`/#chars`、`/#gallery`、`/#service` 直接打开对应页。

## 这个服务做了什么

- `/`：数据看板（总览 / 用户 / 角色 / 图库 / 服务），SSE 每 4 秒推一次最新汇总。
- `/dsh-mihoyo/*`：完整复用 dsh-mihoyo 的接口，和插件里的是同一套逻辑：
  - `state` `menu` `health` `bot` `data` `chars` `uidlist` `users`
  - `panel` `panel/png` `list` `miao/profile` `miao/render` `wiki`
  - `sr` `srhelp` `srwiki` `roles` `version` `config` `login/*`
  - 出图接口需要 Edge 浏览器（与插件一致），图片写进数据目录的 `cache/`。
- `/api/summary`：看板用的汇总 JSON（已去掉 cookie / token 等凭据字段）。
- `/api/gallery`：缓存图列表。
- `/api/img/<文件名>`：读缓存图。
- `/api/thumb/<文件名>`：360px 缩略图（存在本包 `runtime/thumbs`）。
- `/api/events`：SSE 实时推送。

## 对接 QQBOT

### 第一次：在页面上填

起服务后打开看板 → 「服务」页 → 机器人卡片。没配置时会直接显示 appId / appSecret 输入框：

1. QQ 开放平台 → 你的机器人 → 开发设置，复制 **appId** 和 **appSecret**。
2. 粘到页面里，按需勾「沙箱」，点「保存配置」。
3. 保存后再点「启动 QQBOT」。

密码框不会回显已保存的 secret，后端接口也从不返回它（只返回 appId 尾号）。配置落在 `data/bot.json`。

### 命令行方式

两条路：

1. 双击 `start-bot.bat`：起服务的同时连 QQ 机器人（等价于 `MIHOYO_STANDALONE_BOT=1`）。
2. 先 `start.bat`，在看板「服务」页点「启动 QQBOT」，或 `POST /api/bot/start`。

要点：

- 机器人凭证就读数据目录里的 `bot.json`（appId / appSecret），与插件同一份，不额外复制。
- 依赖 `@tencent-connect/qqbot-nodejs`，要求 **Node 20+**。`start.bat` 会优先用 DSH 自带的 Node 24；
  没有就退回系统 `node`，版本低于 20 时机器人连不上，页面本身仍然可用。
- **同一个 appId 只能有一处在线上**。DSH 插件那边开着机器人时，不要在这里再启动，否则会互相顶下线。
- 状态与控制：`GET /api/bot`、`POST /api/bot/start`、`POST /api/bot/stop`。
- 独立服务的机器人走的是同一套指令路由（lib/bot.js），前缀和别名规则与插件一致。

## 默认不带账号数据

包里自带的 `data/` 是空的：`users.json` 是 `{}`，`bot.json` 没有 appId/appSecret，`state.json` 没有 UID，`cache/` 空目录。
所以第一次启动看到的是空看板，不会出现开发机上的 UID、QQ 或图片。

想从头再来：停服务，删掉 `data/`，下次启动会重新铺一份空模板。

## Linux 部署

代码已按平台分支处理，可以直接跑在 Linux 上。要注意的是**运行时和浏览器**。

### 轻量版

1. 装依赖（以 Debian/Ubuntu 为例）：

   ```bash
   sudo apt install -y nodejs npm chromium fonts-noto-cjk
   ```

   Node 要 20 以上；Chromium 建议 112 以上（`--headless=new` 需要）。

2. 解压后进目录装 npm 依赖、起服务：

   ```bash
   npm install --omit=dev --registry https://registry.npmmirror.com
   chmod +x start.sh start-bot.sh
   ./start.sh
   ```

### 完整版

完整版里的 `runtime/node` 是 **Windows 版 node.exe**，Linux 上用不了。可以：

- 直接用系统的 node：把 `runtime/node` 删掉或改名，`./start.sh` 会自动用 `node`；
- 或者下载 linux-x64 的 Node 20+，解到 `runtime/node`，保持 `runtime/node/bin/node` 这个路径。

`data/miao-res` 和 `data/miao-root` 是平台无关的，照常可用。

### 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `MIHOYO_STANDALONE_PORT` | 8788 | 端口 |
| `MIHOYO_HOST` | 127.0.0.1 | 监听地址；对外服务设 `0.0.0.0` |
| `MIHOYO_ALLOW_HOSTS` | 空 | 额外允许的 Host，逗号分隔，例如 `example.com,1.2.3.4` |
| `MIHOYO_BROWSER` | 自动找 | Chromium/Chrome 路径，例如 `/usr/bin/chromium` |
| `DSH_MIHOYO_HOME` | `./data` | 数据目录 |
| `MIHOYO_STANDALONE_BOT` | 空 | 设 `1` 启动时连 QQBOT |

对外提供服务时记得同时设 `MIHOYO_HOST=0.0.0.0` 和 `MIHOYO_ALLOW_HOSTS`，否则同源校验会挡掉外部域名。

### systemd 示例

```ini
[Unit]
Description=dsh-mihoyo-standalone
After=network.target

[Service]
WorkingDirectory=/opt/dsh-mihoyo-standalone
Environment=MIHOYO_STANDALONE_PORT=8788
Environment=MIHOYO_HOST=0.0.0.0
Environment=MIHOYO_ALLOW_HOSTS=miao.example.com
ExecStart=/usr/bin/node server.mjs
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

### Linux 上的注意点

- 中文渲染依赖系统字体，没装 `fonts-noto-cjk` 会出方块。
- 用 root 跑 Chromium 必须 `--no-sandbox`，代码里在 Linux 已自动加；用 systemd 的普通用户跑不需要。
- 截图是 `--headless=new`；太老的 Chromium 可能不认，升级或改用 `--headless` 版浏览器。
- 出图依赖 Chromium 与字体，和 Windows 版排版可能有 1–2px 的差异，属正常。

## 不影响的边界

- 默认只读自己包里的 `data/`，不碰本机已有的米游社数据；除非显式设置 `DSH_MIHOYO_HOME` 指过去。
- 绑定与缓存都写在 `data/` 内；不写 DSH、不写宿主目录。
- 不读取、不返回 cookie / stoken / ltoken / mid / appSecret。
- 不注册开机启动、不占 DSH 端口、不改 cordis 配置。
- 这个服务里不启动 QQ 机器人；机器人仍由 DSH 插件负责。
- 关闭窗口 / Ctrl+C 即停止。

## 已知问题

- `/dsh-mihoyo/panel/png`（原神单人卡）依赖 Edge 无头截图；这台机器上 Edge 偶尔不落盘，
  会报「截图没生成（Edge 没有落盘）」，DSH 插件里同样会这样。看板里的原神入口走 `list` 和详情的
  `miao/profile`，这两条已验证正常（413KB / 2.1MB）。遇到时重试或重启 Edge 后再发。

## 看板说明

从 yunzai / miao-plugin 的看板思路上取：总览看全局，用户页按 QQ 分组给出每个游戏的出图入口，
角色页直接把已抓到的原神/星铁角色摊开，图库页把缓存面板图集中浏览，服务页保留健康检查与命令覆盖。
比插件自带的设置页少掉了「单人绑定测试」这类页面。
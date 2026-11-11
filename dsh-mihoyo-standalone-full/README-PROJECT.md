# dsh-qqbot-to-enka · 米游社三游戏 QQ 查询与数据看板（独立部署包）

一套不依赖 Yunzai / AstrBot / DSH 的独立服务：QQ 机器人接米游社与 Enka 数据，出原神、星铁的角色面板图，同时提供浏览器看板、日志页和资源更新机制。

仓库里的 `dsh-mihoyo-standalone-full/` 是完整包（自带 miao 素材与 Windows 版 Node 运行时）；只想要代码和页面时，也可以只取其中的 `server.mjs`、`lib/`、`public/`。

---

## 一、它是什么

- **QQ 机器人**：官方 QQ 机器人 SDK 直连（appId / appSecret），群里或私聊发指令，机器人回复角色列表、角色卡、帮助图、图鉴等图片。
- **数据看板**：`http://127.0.0.1:8788`，包含总览、用户、角色、指令、图库、日志、服务七个页面，SSE 实时刷新。
- **数据服务**：绑定（扫码登录 / 直接绑 UID）、三游戏角色查询、缓存、健康检查、机器人状态，全部走同一套 HTTP 接口。
- **资源维护**：内置资源清单与更新脚本，可从上游镜像补齐角色立绘、meta 数据；附带每日清理任务。

## 二、目录结构

```
dsh-mihoyo-standalone-full/
├─ server.mjs            独立 HTTP 服务入口（看板 API + 挂载业务接口 + 出图排队）
├─ lib/
│  ├─ index.js           业务接口：绑定、面板、列表、详情、图鉴、健康检查
│  └─ bot.js             QQ 机器人：指令路由、出图、扫码、绑定
├─ public/               看板前端（index.html / app.js / style.css）
├─ data/                 运行数据（默认数据目录）
│  ├─ miao-res/          miao 资源：meta-gs、meta-sr、图标、模板、角色立绘
│  ├─ miao-root/         miao-plugin 本体与 PlayerData 存档
│  ├─ users.json         用户绑定
│  ├─ bot.json           QQ 机器人 appId / appSecret
│  ├─ state.json         旧版单账号状态
│  ├─ aliases.json       角色别名
│  └─ cache/             出图缓存
├─ runtime/node/         自带的 Node 24（仅 Windows 版）
├─ node_modules/         运行依赖（pngjs / qrcode / QQ 机器人 SDK / ws）
├─ start.bat             Windows 一键启动
├─ start-bot.bat         Windows 启动并连接 QQ 机器人
├─ start.sh              Linux 启动（需系统 Node 20+）
├─ start-bot.sh          Linux 启动并连接机器人
├─ cleanup.sh            清理脚本（临时文件、过期缓存与日志）
└─ update-resources.mjs  资源更新脚本（服务器版按清单补齐）
```

## 三、启动

### Windows

双击 `start.bat`。自带 Node 24，不需要另装；出图依赖系统里的 Edge（Windows 10/11 通常自带）。

### Linux（Ubuntu 24.04 实测）

```bash
sudo apt install -y nodejs npm chromium fonts-noto-cjk
cd dsh-mihoyo-standalone-full
rm -rf runtime/node          # 自带的 node 是 Windows 版，Linux 用系统的
chmod +x start.sh start-bot.sh
./start.sh
```

### 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `MIHOYO_STANDALONE_PORT` | 8788 | 端口（被占用会顺延） |
| `MIHOYO_HOST` | 127.0.0.1 | 监听地址，公网部署设 `0.0.0.0` |
| `MIHOYO_ALLOW_HOSTS` | 空 | 允许的 Host，逗号分隔（公网域名或 IP） |
| `MIHOYO_BROWSER` | 自动找 | Chromium / Chrome / Edge 路径 |
| `MIHOYO_RENDER_CONCURRENCY` | 1 | 同时出图数量，内存小时保持 1 |
| `DSH_MIHOYO_HOME` | `./data` | 数据目录 |
| `MIHOYO_STANDALONE_BOT` | 空 | 设 1 时随服务自动连接 QQ 机器人 |

## 四、能做什么（当前已实现）

### QQ 指令

- 账号：`#扫码登录`、`#绑定 UID`、`#uid`、`#解绑`、`#版本`、`#帮助`
- 原神（`#`）：`#面板`、`#更新面板`、`#名字`（角色卡）、`#名字面板 / 卡片 / 详情`、`#名字圣遗物 / 武器 / 天赋 / 命座 / 材料 / 图鉴`、`#圣遗物列表`、`#武器列表`
- 星铁（`*`）：`*面板 / *uid / *列表`、`*更新面板`、`*名字`（详情卡）、`*名字伤害`、`*名字星魂 / 光锥 / 遗器 / 评分`、`*图鉴 名字`
- 绝区零（`%`）：`%绑定 UID`（面板未接）
- 无前缀直接发角色名：自动识别游戏并出卡

### 看板

- 总览：绑定数、缓存、机器人状态、渲染队列
- 用户：按 QQ 分组的绑定，可填显示名/QQ 号，每个 UID 一个出图入口
- 角色：按用户、按 UID 分组展示已缓存角色
- 指令：三个游戏的完整指令表，标注已接/未接，可搜索
- 图库：缓存图片缩略图墙
- 日志：服务 / 接口 / 请求 / 操作 / 机器人五类日志，可筛选、搜索、下载
- 服务：健康检查、机器人启停、最近日志

### 服务能力

- 出图串行队列（默认 1 并发），防止小内存机器被多个 headless 浏览器压垮
- 每日 04:30 清理临时文件、过期的 Edge 配置和旧缓存
- 资源更新脚本：按清单从镜像补齐角色立绘，可挂 systemd timer 每天跑
- 同源校验：默认只允许本机 Host；公网需显式配置 `MIHOYO_ALLOW_HOSTS`

## 五、资源来源与致谢

| 用途 | 来源 | 说明 |
| --- | --- | --- |
| 角色数据、面板渲染、圣遗物评分 | [yoimiya-kokomi/miao-plugin](https://github.com/yoimiya-kokomi/miao-plugin) | MIT；`resources/meta-gs`、`meta-sr`、模板与评分算法 |
| 角色立绘补充 | [kvcfdd/miao-res-plus](https://github.com/kvcfdd/miao-res-plus) | 较新的资源镜像（154 个角色目录），经 jsDelivr 拉取 |
| 原神 / 星铁面板数据 | [Enka Network](https://enka.network/) | 公开角色展柜 API，需在游戏内开启「显示角色详情」 |
| 米游社账号与角色列表 | 米游社 `api-takumi.mihoyo.com` | 扫码登录、`getUserGameRolesByCookie` |
| QQ 机器人 | [@tencent-connect/qqbot-nodejs](https://www.npmjs.com/package/@tencent-connect/qqbot-nodejs) | 官方机器人 SDK |
| 二维码 | qrcode | 扫码登录二维码 |
| 图片裁剪 | pngjs | 透明边裁剪、缩略图 |
| 浏览器渲染 | Edge / Chromium / Chrome | headless 截图，出图必需 |

miao-plugin 与 miao-res-plus 均按 MIT 使用；再分发时请保留各自 LICENSE 与署名。

## 六、已知缺陷与限制

1. **绝区零面板未接**：Enka 有绝区零数据，但缺角色名映射，`%面板` 只能绑定不能出图。
2. **米游社私有接口受限**：深渊、签到、体力、今日素材、抽卡记录等需要米游社私有接口或人机验证（1034），目前未实现。
3. **只能读角色展柜**：原神/星铁面板依赖 Enka 展柜，展柜没放的角色查不到，会提示「展柜里没有」；不是 bug。
4. **新角色资源滞后**：角色数据（meta）跟 miao 更新，但立绘需要额外资源包；上游没有的角色只能用通用图。
5. **圣遗物评分权重不全**：新角色（兹白、桑多涅、丝柯克等）没有自定义权重，走默认规则，评分偏「通用」。
6. **依赖系统浏览器**：出图依赖 Edge/Chromium，没装浏览器时看板和接口正常，图出不来。
7. **内存敏感**：单次出图会起 headless Chrome，约占 300–600 MB；1.7 GB 内存的机器必须保持并发 1，并建议加 swap。
8. **公网安全**：默认只监听本机；开公网务必配置 `MIHOYO_ALLOW_HOSTS`，并注意机器人凭证与用户 cookie 的存放。
9. **机器人单实例**：同一个 appId 只能一处在线，多开会让彼此掉线。
10. **数据不随包分发**：本包的 `data/` 是空模板，没有账号、绑定、缓存和凭据，首次启动需自行扫码或绑 UID。

## 七、状态

- 2026-11-11：原神 7.x 数据（127 角色、63 套圣遗物），星铁 8 角色实测出图，Linux（Ubuntu 24.04）部署验证通过。
- 服务端与 QQBOT、资源更新、日志、清理、排队均已上线。

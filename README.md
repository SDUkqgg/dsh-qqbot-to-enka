# dsh-qqbot-to-enka · 米游社三游戏 QQ 查询与数据看板（独立部署包）

一套不依赖 Yunzai / AstrBot / DSH 的独立服务：QQ 机器人接米游社与 Enka 数据，出原神、星铁的角色面板图，同时提供浏览器看板、日志页和资源更新机制。

> **素材在哪里（重要）**：本仓库只放代码和文档，`data/miao-res`（约 399 MB）与 `data/miao-root`（约 218 MB）没有入库。
> 单克隆仓库直接启动：看板、接口、绑定、日志、指令页都正常；但角色图鉴、角色面板卡、帮助图会因为缺素材而失败或回落到默认图。
> 完整素材在 [Releases](https://github.com/TaoFuFuu/dsh-qqbot-to-enka/releases/tag/v1.0.0)，拆成两个文件：`dsh-mihoyo-standalone-full.zip`（约 558 MB，代码+插件+meta+Node）和 `mihoyo-character-img.zip`（约 1.1 GB，角色立绘，解到 `data/miao-res/`）。
> **服务启动不会自动下载素材**，需要补新角色时运行包内 `update-resources.sh`（Linux）或 `update-resources.mjs`（本地脚本）。

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

## 八、素材放在哪、怎么装、怎么生效

### 1. 素材的目录结构

服务读取的素材都在数据目录（默认是包内的 `data/`）下面，结构不能改：

```
data/
├─ miao-res/
│  ├─ character-img/<角色名>/<序号>.jpg    角色立绘（图鉴、角色卡用）
│  ├─ meta-gs/                             原神数据（角色、武器、圣遗物、材料）
│  ├─ meta-sr/                             星铁数据
│  ├─ common/、character/、profile/、wiki/ 模板与图标
│  └─ ...
└─ miao-root/
   ├─ plugins/miao-plugin/                 miao-plugin 本体（含 resources/character-img）
   └─ data/PlayerData/{gs,sr,zzz}/          面板缓存，程序自动写入
```

只看角色图鉴和角色卡的话，最少需要 `data/miao-res/character-img` 与 `miao-res/meta-gs`、`meta-sr`；星铁和原神的面板卡还需要 `miao-root/plugins/miao-plugin` 本体。

### 2. 三种安装方式

**方式 A：直接用 Release 的完整包（推荐）**

下载 `dsh-mihoyo-standalone-full.zip`，解压后 `data/` 里已经带好全部素材，启动即生效，不需要额外操作。

**方式 B：克隆了代码仓库，素材从 Release 补**

```bash
git clone https://github.com/TaoFuFuu/dsh-qqbot-to-enka.git
cd dsh-qqbot-to-enka
# 下载 Release 的 zip，解压出 data/，然后合并进包内
unzip dsh-mihoyo-standalone-full.zip -d /tmp/miao-full
cp -r /tmp/miao-full/dsh-mihoyo-standalone-full/data/miao-res      dsh-mihoyo-standalone-full/data/
cp -r /tmp/miao-full/dsh-mihoyo-standalone-full/data/miao-root     dsh-mihoyo-standalone-full/data/
```

**方式 C：从上游更新素材（有新角色时）**

```bash
cd dsh-mihoyo-standalone-full
./update-resources.sh        # 从 GitHub 拉最新角色立绘，同步进 miao-res 与插件 resources
# 或
node update-resources.mjs    # 逐文件镜像方式（有清单，可断点续传）
```

Linux 上也可以挂成定时任务：

```bash
systemctl start mihoyo-res-update      # 立即跑一次
systemctl enable --now mihoyo-res-update.timer   # 每天 05:00 自动跑
```

### 3. 让素材生效

- **数据目录**：服务启动时数据目录取 `DSH_MIHOYO_HOME`，没设就是包内 `data/`。素材不在默认位置时，把 `DSH_MIHOYO_HOME` 指向含 `miao-res` 的目录，例如 `set DSH_MIHOYO_HOME=D:\miao-data`（Windows）或 `export DSH_MIHOYO_HOME=/opt/miao-data`。
- **不用重启**：图片是每次请求现读文件，补完立绘直接发指令就能出图。
- **要重启的情况**：替换了 `meta-gs` / `meta-sr` 这类数据文件（角色、武器、圣遗物列表），miao 在进程内会缓存，重启服务后生效：`systemctl restart dsh-mihoyo`。
- **权限**：Linux 下运行服务的用户必须对 `data/` 有读权限；`PlayerData` 目录需要写权限（程序会自动建）。
- **自检**：启动后看板「角色」页能看到按用户分组的角色；或者发一条 `#帮助` / `*面板` 能出图，就说明素材链路是通的。命令行查文件数：`ls data/miao-res/character-img | wc -l`，完整的包是 154 个目录。

### 4. Release 与仓库的分工

- 仓库：代码、文档、启动脚本、空数据模板；克隆即可跑服务和看板，但没图。
- Release：`dsh-mihoyo-standalone-full.zip`（约 620 MB），内含 `data/miao-res`、`data/miao-root`、Windows 版 Node 与全部代码，解压即完整。
- 服务**不会在启动时自动下载素材**；缺素材只会影响出图，看板、绑定、日志照常。

## 九、维护记录
- **角色攻略**：`#兹白攻略` / `*长夜月攻略` 会去米游社按「角色名 攻略」搜索，取图片最多的一篇，按正文顺序下载全部图，统一缩到 820 宽拼成长图，超过 9000 像素自动切成 2–3 张发送，缓存 24 小时；抓不到回链接。
与已做改动（2026-11-11）

- **数据源全量同步**：服务器从 `yoimiya-kokomi/miao-plugin` 的 `master` 拉整包（commit `9af2f32`，2026-11-11），覆盖 `resources/meta-gs`、`meta-sr`、`models/`、`apps/`、`resources/wiki`、`resources/common`。自定义 worker 与 `browser.mjs` 补丁在插件根目录，不在被覆盖的目录内。
- **资源目录打通**：`data/miao-res/meta-gs` 与 `meta-sr` 改为软链接，指向 `data/miao-root/plugins/miao-plugin/resources/` 下的对应目录。模板按 `_res_path` 取图标，如果仍指向旧 meta，新角色会表现为「头像空白、天赋图标是空框」。
- **缓存**：渲染结果缓存在 `data/cache`。替换资源后必须清空，否则会继续返回旧图：`find data/cache -type f -delete`。
- **跨平台出图**：`browser.mjs` 自动查找 Edge / Chrome / Chromium；Linux 下追加 `--no-sandbox --disable-dev-shm-usage`。
- **并发保护**：所有出图接口走串行队列，默认 1 并发，可用 `MIHOYO_RENDER_CONCURRENCY` 调整；排队超过 40 个或等待超过 150 秒会直接回「人有点多，稍后再试」。
- **资源更新**：`update-resources.sh` 从 GitHub API 下载整仓 zip 后 rsync 到两个资源目录，避免逐文件下载时的 404；Linux 上由 `mihoyo-res-update.timer` 每天 05:00 跑。
- **每日清理**：`cleanup.sh` 清临时目录、旧压缩包、超过 1 天的 Edge profile、超过 14 天的缓存与日志，cron 04:30。
- **已知缺口**：崩铁 4.7 的星神「阿哈」上游 `meta-sr` 尚未收录，发 `*阿哈` 会提示没有该角色，需等上游补齐。


- **uid 卡**：`uid-worker.mjs` 必须放在数据目录（`data/uid-worker.mjs`），漏了会退回角色列表图；它原先只认 Windows Edge，现已支持 `MIHOYO_BROWSER`、Linux 的 chrome/chromium，并加 `--no-sandbox`。
- **头像/天赋图标空白**：模板按 `_res_path` 取图标，旧 `meta-gs` 缺新角色目录。处理办法是把 `data/miao-res/meta-gs`、`meta-sr` 软链到插件 `resources` 下同名目录，再清空 `data/cache`。
- **新角色名字显示成「角色#10000125」**：面板列表的角色名来自 `data/roles.json`，缺这个文件时只剩内置老角色表。现已在 `lib/index.js` 里直接用 `meta-gs/character/data.json` 补齐。
- **别名查不到角色**：`#少女面板` 这类别名原先只查 `aliases.json`（默认空）。现在会加载 miao 的 `character/alias.js` 反向表，服务端统一把别名解析成正名；机器人侧也不再因为名字不在名单里就提前拦住。
- **帮助图 502**：`render-worker`、`profile-worker`、`wiki-worker` 里写死了 `F:/dsh/...`，Linux 上 `chdir` 失败。现改为读 `DSH_MIHOYO_HOME`。
- **#版本 501**：版本接口原来没有数据源，现返回 miao 插件版本与原神/星铁角色数。

- **出图体积**：所有图片返回前用 sharp 转 JPEG（最大宽 820，质量 80），天赋图从 2–3 MB 降到 300–600 KB，列表/卡片几十 KB，QQ 里可直接预览。sharp 是可选依赖，没装时退回原 PNG。

- **角色攻略**：`#兹白攻略` / `*长夜月攻略` 会去米游社按「角色名 攻略」搜索，取图片最多的一篇，按正文顺序下载全部图，统一缩到 820 宽拼成长图，超过 9000 像素自动切成 2–3 张发送；结果缓存 24 小时。抓不到时回链接。
- **攻略库（全量预抓）**：`data/guides/` 里存了全部 235 个角色（原神 127、星铁 108）的最新攻略，`index.json` 带标题、更新日期、来源和别名映射。`#名字攻略` / `*名字攻略` 先查这个库，命中直接发图，缺的才现抓。
- **`#更新资源`**：只有号主（first-message 绑定的账号）能触发，其他人发只会被拒。流程分三步：①把当前角色数据快照归档到 `data/archive/<日期_时分>/`（两份 data.json、两份 alias.js、roles.json、攻略索引）；②拉 miao 上游最新数据；③补缺的攻略、并把最旧的 30 个（超过 30 天没更新）重抓一遍。日志在 `data/update.log`。
- **手动跑更新**：服务器上 `bash update-all.sh`；只想补攻略用 `node build-guides.mjs --refresh 3`。

### 图标/头像空白排查

1. 确认 `data/miao-res/meta-gs/character/<角色名>/icons` 存在；不存在就把 `miao-res/meta-gs` 链到插件 `resources/meta-gs`。
2. 清空 `data/cache`，再发一次指令。
3. 仍空白就检查渲染时 `_res_path` 是否指向 `miao-res`，以及模板 `resources/wiki/character-talent.html` 是否与当前数据版本匹配。

# 可视化编辑器 · 桌面分发版（Electron 外壳）

把 `web-editor`（界面）与 `editor-mcp`（MCP 服务器）封成一个**双击即用**的桌面程序：

```
双击「可视化编辑器」
   ├─ 内置静态服务器      http://127.0.0.1:<自动挑端口>/        ← 界面在这里跑（替代 启动编辑器.py）
   ├─ Electron 窗口       加载上面这个地址（不是 file://，所以 /__log、/__components 都可用）
   └─ editor-mcp 子进程   http://127.0.0.1:37651/mcp            ← 外部 AI 客户端连这个地址
```

## 目录结构

| 路径 | 作用 |
| --- | --- |
| `main.js` | Electron 主进程：启动顺序、**无边框窗口（标题栏覆盖层）**、IPC、退出收尾、`--selftest` |
| `preload.cjs` | 唯一的桥：只暴露 `window.desktop`（看状态 / 查更新 / 开日志目录 / 重启 MCP / 同步窗口按钮配色 / 发日志） |
| `server/webServer.js` | `web-editor/启动编辑器.py` 的 **Node 等价物**（分发版机器上不一定有 Python） |
| `src/paths.js` | dev / 安装包两套路径布局；**所有可写数据都落 userData** |
| `src/components.js` | 组件目录落地：分发版把随包组件**种子**拷进 `userData/组件`（安装目录只读，导入组件包要能写） |
| `src/secureConfig.js` | 读加密配置（密钥优先级、解密、默认值兜底、取值校验、脱敏） |
| `src/mcpSupervisor.js` | 拉起 / 探测 / 接管 / 重启 / 收尾 `editor-mcp --http` |
| `src/updater.js` | 预留的更新接口：查清单 → 比版本 → 打开下载地址（自动安装留空挂点） |
| `src/logger.js` | 主进程日志（按天落盘 + 内存环形缓冲） |
| `config/` | 加密配置、密钥、构建期密钥（见下） |
| `scripts/embed-key.mjs` | 一键「生成密钥 → 加密配置 → 嵌入密钥 → 验证」 |
| `scripts/verify-desktop.mjs` | **无界面验证**（75 项，见下） |
| `scripts/bundle-mcp.mjs` | 把 `editor-mcp` 打成**自包含单文件**（分发版唯一可靠形态，见「打包」一节） |
| `dist-mcp/` | 上面那个脚本的产物（`editor-mcp.bundle.mjs`，约 2.4MB，已 gitignore） |

## 界面：只有一层菜单（无边框窗口）

桌面版**没有**原生标题栏与原生菜单 —— 用 Electron 的「隐藏标题栏 + 标题栏覆盖层」（Windows 上叫 WCO）：

```js
titleBarStyle: 'hidden',                                   // 不画原生标题栏（连带原生菜单栏）
titleBarOverlay: { color, symbolColor, height: 36 },       // 系统的最小化/最大化/关闭按钮画在网页右上角
Menu.setApplicationMenu(null)                              // 不设原生菜单
```

网页侧配合三件事（见 `web-editor/src/utils/desktopChrome.ts` 与 `src/index.css`）：

1. 菜单栏那一行声明为**窗口拖拽区**（`-webkit-app-region: drag`），里面的按钮/输入框自动 `no-drag`
   （否则菜单点不动）；
2. 右上角给那三颗系统按钮**留出 138px**（`--titlebar-gap`），标题文字不会被压在按钮下面；
3. **主题一变就同步按钮颜色**：读菜单栏的实际计算样式 → `desktop:set-titlebar` →
   主进程 `win.setTitleBarOverlay()`。颜色不写死，浅色/深色主题（light / monokai）自动跟着变；
   主进程只接受 `#rrggbb`，脏值忽略。

于是菜单只剩网页自己的那一条：**文件 / 编辑 / 视图 / 页面 / 桌面 / 帮助**。其中「桌面」是**只有桌面版才有**的
下拉（浏览器里 `window.desktop` 不存在，整个下拉不渲染 —— 网页版行为完全没变）：

| 项 | 说明 |
| --- | --- |
| 检查更新… / 打开更新下载页 | 走加密配置里的 `update.baseUrl` |
| 复制 MCP 地址 | 给外部 AI 客户端填的 `http://127.0.0.1:<port>/mcp` |
| MCP 服务状态 | 现场再做一次 `initialize` 握手探测，报状态/进程号/桥接端口/最近错误 |
| 重启 MCP 服务 | 菜单里就能重启，不用重启整个应用 |
| 打开日志目录 / 数据目录 / 配置目录 | 让用户自己去看现场（桌面版没有终端） |
| 关于 | 版本、Electron/Chromium/Node、页面与 MCP 地址、配置来源与提醒 |

> 没有原生菜单就没有它带的加速键，所以**只在开发模式**补了 `F12`/`Ctrl+Shift+I`（开发者工具）与
> `Ctrl+Shift+R`（重新加载）；生产环境**故意不补** —— 文档编辑器里误按 `Ctrl+R` 会丢掉没保存的内容。
> 首帧的窗口按钮是浅色默认值（主题存在网页 localStorage 里，主进程读不到），网页一加载就会同步成真实主题。


## 加密配置（更新地址等都在里面）

```
config/app-config.example.json   ← 明文源（改这个，人看）
config/config.key                ← AES-256-GCM 密钥（base64 的 32 字节）
config/app-config.enc            ← 应用真正读的加密配置
config/buildKey.mjs              ← 构建期兜底密钥（找不到 config.key 时用；**必须 .mjs**，见「打包」）
```

加密/解密由**独立工具** [`tools/secure-config`](../../tools/secure-config/) 完成，本目录**不复制任何 crypto 代码**，
只 `import()` 它的 `decryptConfig()`。要单独升级/搬走这个工具，直接动那一个文件即可。

配置项（都在 `app-config.example.json` 里，注释见 `src/secureConfig.js` 的 `DEFAULT_CONFIG`）：

| 键 | 作用 |
| --- | --- |
| `server.port` / `server.host` | 内置静态服务器（`0` = 自动挑空闲端口） |
| `server.openBrowser` | 额外用系统浏览器打开一份（默认 `false`：只用应用窗口） |
| `mcp.enabled` / `mcp.transport` / `mcp.httpPort` / `mcp.bridgePort` | MCP 是否随应用启动、监听端口、Live 桥接端口 |
| `mcp.autoRestart` / `mcp.readyTimeoutMs` / `mcp.allowWrite` | 崩溃是否退避重启、就绪等待上限、写开关（透传 `EDITOR_MCP_ALLOW_WRITE`） |
| `update.*` | 更新接口（见下节） |
| `logging.level` / `logging.keepDays` | 主进程**落盘**日志的最低级别（环形缓冲不受影响，否则诊断信息会丢） |

取值非法时**不会让应用起不来**：`src/secureConfig.js` 会把问题逐条列出来、按默认值兜底启动，并在窗口出来后弹一次。

```bash
# 改更新地址（或端口等）的标准流程
#   1) 编辑 config/app-config.example.json 里的 update.baseUrl / update.manifest
#   2) 重新生成密文与密钥模块
node scripts/embed-key.mjs            # 已有密钥就复用；要换密钥加 --rotate
#   3) 重新打包
npm run dist
```

**换更新地址不需要改代码、不需要重新打包前端**：安装包里 `resources/config/app-config.enc` 是普通文件，
替换它即可（运维现场换服务器就靠这个）。密钥来源优先级：
`--key` > 环境变量 `EDITOR_DESKTOP_CONFIG_KEY`（或 `..._KEY_FILE`）> `config/config.key` > `config/buildKey.js`。

> ⚠ **威胁模型**：应用必须能自己解密，所以密钥必然随包分发。它防的是"用户顺手改坏 / 一眼看穿接口地址"，
> **不是**有能力的攻击者。真正的秘密（token、私钥）不要写进配置文件。
> 换密钥后必须重新加密配置并重打包 —— `config/README.txt` 里记了每个文件的用途。

## 更新接口（**预留**）

流程：`GET <update.baseUrl><update.manifest>` → 比版本 → 有新版则给出下载地址 → 「打开下载页」交给系统浏览器。

* 清单（`latest.json`）约定见 `src/updater.js` 头部注释（含 `channels.<通道>` 覆盖、`mandatory`、`sha256`）。
* `install()` 是**故意留空**的挂点，调用时明确返回 `{ok:false, reserved:true}` —— 静默下载安装涉及签名与权限，
  要上线时在这里接。现在只把用户送到下载地址，不假装能自动升级。
* 下载地址只允许 `http(s)`：配置文件被改成 `file://` 或自定义协议时会被拒绝执行。

菜单：`工具 → 检查更新… / 打开更新下载页 / 复制 MCP 地址 / MCP 服务状态 / 重启 MCP 服务 / 打开日志·数据·配置目录 / 关于（版本 / 运行环境）`。

## 外部 AI 怎么连

1. 启动应用（MCP 会随应用一起起来）。
2. `工具 → 复制 MCP 地址`，得到 `http://127.0.0.1:37651/mcp`。
3. 在支持 **Streamable HTTP** 的 MCP 客户端里填这个地址（多客户端可同时连，各自独立会话）。
4. 只想用 stdio 的客户端：`node editor-mcp/dist/index.js --stdio`（不受本应用影响）。

MCP 的日志与无头文档目录都在 userData：
`%APPDATA%\可视化编辑器\`（Windows）下的 `logs/`、`workspace/`、`docs/`、`组件/`。

## 开发与运行

```bash
cd apps/desktop
npm install          # 下载 Electron 44（约 200MB；若装完没有 node_modules/electron/dist，见「Electron 版本」一节的手动补一步）

npm start            # 跑（读仓库里的 web-editor/dist 与 editor-mcp/dist）
npm run dev          # 同上（显式开发模式，日志里会标 dev）
npm run check        # 以 ?check=1 启动：界面右下角跑数据层/渲染层自检
npm run selftest     # 装完自检：真开窗加载页面 + 真连 MCP + 界面契约，写报告后退出（9 项）
npm run verify       # 无界面验证（75 项，不需要 Electron）
npm run dist         # 打 Windows 安装包（NSIS + 免安装 portable）
```

### 装完自检（`--selftest`）

分发版是双击启动的、没有终端；用户说"打不开"时，让他跑一次
`可视化编辑器.exe --selftest --selftest-out 报告.json`，就能拿到一份可发回来的报告：

```json
{ "summary": { "total": 9, "passed": 9, "failed": 0, "result": "PASS" },
  "checks": [ { "name": "界面：只有一条菜单栏，顺序符合惯例（文件/编辑/视图/页面/工具/帮助）", "pass": true,
                "evidence": "菜单栏数=1；下拉=文件 / 编辑 / 视图 / 页面 / 工具 / 帮助" },
              { "name": "无边框窗口：右上角给系统窗口按钮留了位（标题文字不会被压住）", "pass": true,
                "evidence": "菜单栏 padding-right=138px、--titlebar-gap=138px；标题右侧余量=936px" },
              { "name": "外部 AI 客户端能列出工具（tools/list）", "pass": true,
                "evidence": "工具数=108（例：doc.create, doc.open, doc.close）" } ] }
```

它验的 9 件事：加密配置能解开且无致命问题 → 静态服务器 200 → **页面真的渲染出编辑器界面**
（查 `data-panel="left|right"` / `data-canvas-body` / `data-paper` / `data-toolbar` 这些稳定标记，
并数组件按钮，不是"窗口开了就算"）→ **只有一条菜单栏且顺序符合惯例** → **菜单栏是拖拽区、菜单按钮不是**
→ **右上角给系统窗口按钮留了位** → MCP 就绪 → `initialize` + `tools/list` 拿到 108 个工具 →
更新接口配置可解析（**不联网**，自检不该依赖外网）。退出码 0/1。

后三条是本轮加"无边框窗口"时补的界面契约：这几件事**靠网页截图看不准**（系统那三颗按钮不在
`capturePage` 的结果里），所以直接用计算样式断言；任何一条坏掉都会表现为"拖不动窗口"或"标题被按钮压住"。

另有 `--shot <png>`：跑自检时把窗口内容截一张图（配合 `--shot-menu 工具` 会把「工具」菜单点开再截），
用来核对"看出来的问题"。系统级的三颗窗口按钮要用 OS 抓屏（`capturePage` 拍不到），
参考图见 [`docs/界面-单层菜单.png`](docs/界面-单层菜单.png)。

> 踩过的坑：一开始断言的是 `[data-palette]`，结果 0 —— 查源码发现那是**取色板色块**的标记
> （`ColorControl.tsx`），只有选中带颜色属性的组件时才出现；组件箱的稳定标记是 shell 上的
> `data-panel="left"`（`App.tsx`）。**断言写错会看起来像产品坏了**，所以证据要写清查的是什么。

> 网络慢/`spawn EPERM` 的两个坑（本机实测）：
> ① npm 的 postinstall 要 spawn 子进程，**在受限沙箱里会 EPERM**（`npm error code EPERM / syscall spawn`）——
> 换普通终端或在放宽的沙箱里跑；另外管道会给"看起来成功"的退出码，**别只看管道的 `$LASTEXITCODE`**。
> ② Electron 的二进制从 GitHub 下，慢的时候可以走镜像（只是构建期便利，可用环境变量覆盖）：
> `$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'`。

`npm run build` 相关：桌面版**不构建前端**，它加载 `web-editor/dist`。改了前端要先去 `web-editor` 跑 `npm run build`。

## 验证（`npm run verify`，75 项）

跑一次就知道"哪一层坏了"，全部只写临时目录：

* **A 布局**：dev / 安装包两套都验；断言可写数据**绝不落在安装目录**（Program Files 是只读的）。
* **A2 组件目录**：dev 不拷贝（保持热加载开发流程）；分发版首次把随包组件种子拷进 `userData/组件`；
  再次运行**不覆盖用户改过的组件**、但会把升级带来的新组件补进来。
* **B 加密配置**：随包密钥能解开；解出来与明文源逐字段一致；密文里查不到明文；错密钥 → 不崩、退回默认值并报"解密失败"；
  缺配置/明文兜底/坏端口/端口打架/非 http 更新地址/示例地址提醒；脱敏打码。
* **C 更新接口**：本地假更新服务器跑 12 项（有新版本 / 已最新 / 预发布忽略与放行 / 通道覆盖 / 404 / 非 JSON /
  非 http 下载地址 / disabled / `install()` 明确未实现）。
* **D 静态服务器**：`/`、SPA 回落、缺失资源 404、`/__components`、`/组件/<name>` 热加载、`/__loginfo`、
  `/__log` 落盘、`/__save`（含 `../`、`../../`、`C:/` 三种穿越都被 403）、`/__savePlugin`（含文件名白名单）、
  512KB 上限 413、未知 POST 404、`close()` 后端口释放。
* **E MCP 子进程**：真拉起 → 真握手（initialize 拿到 serverInfo）→ 真 `tools/list`（工具数 > 20）→ 真重启（换进程号）
  → 端口上已有 MCP 时**接管**而不重复拉起 → `stop()` 后端口释放 → **桥接端口被别人占着时优雅降级**
  （MCP 照常就绪、工具表照常返回，只在日志与「查看 MCP 状态」里说明"Live 通道会连到那个旧实例上"）；
  并比对用户的 `editor-mcp/workspace` 前后快照，证明验证过程**没碰活文档**。
* **F 静态检查**：全部新文件 `node --check`；`contextIsolation/nodeIntegration/sandbox` 三项基线；
  外链协议白名单；preload 只暴露 `window.desktop`；`extraResources` 齐全且**不含**
  `editor-mcp/node_modules`（那东西装不进安装包，见 G）。
* **F2 打包清单完整性**：入口的每个相对依赖都要被 `build.files` 覆盖（漏一个 → 双击没反应）；
  `server/**` 在清单里；`config/{app-config.enc, buildKey.mjs}` 在 extraResources；
  **用 Electron 自带的 Node** 在没有 `package.json` 的目录里加载随包密钥并解密配置。
* **G MCP 单文件打包**：esbuild 把 `editor-mcp` 打成 **2.4 MB 单文件**；把它单独放进一个
  **没有 node_modules 的隔离目录**里跑 `--list`（exit 0，108 工具 / 23 资源 / 12 提示词），
  再用真监管器把它当 MCP 拉起来做 `tools/list`（108 个真实工具名）—— 证明打包后的文件**自包含、能对外服务**。

> 受限沙箱里 **E / G 段会 SKIP**：`mcpSupervisor` 要捕获子进程的管道输出，沙箱禁止创建命名管道（`spawn EPERM`）。
> 想跑全量就用放宽的文件沙箱执行 `node scripts/verify-desktop.mjs`。

## 打包（electron-builder）

`package.json` 的 `build` 字段已经写好：

* `files`：只有外壳代码进 `asar`（**注意 `server/**` 必须列进去**，见下"真踩过的两个坑"）；
* `extraResources`：`web-editor/dist`、`web-editor/public/组件`、**`dist-mcp/editor-mcp.bundle.mjs`**、
  `tools/secure-config`、`config/app-config.enc`、`config/buildKey.mjs` 都放在 **asar 外面**的
  `resources/` 下 —— 子进程要从磁盘跑（asar 里的文件没法 spawn），配置与密钥要能现场替换；
* `win.target`：`nsis`（可选安装目录）+ `portable`（免安装单文件）；
* `win.signAndEditExecutable: false`：见下；
* `npm run dist` 会**先跑 `bundle:mcp`** 再打包，避免打进一个旧的单文件。

```bash
npm run bundle:mcp   # 只打 MCP 单文件 → dist-mcp/editor-mcp.bundle.mjs
npm run dist         # 产物在 apps/desktop/release/
```

> ⚠ **2026-09-28 现状：`npm run dist` 的第一步会失败** —— `bundle:mcp` 用 esbuild 打 `editor-mcp/dist/index.js`，
> 而 `editor-mcp/node_modules` 是当年手工拼的**符号链接**（`@modelcontextprotocol/sdk` / `ws` / `zod` →
> `D:\DSHClient\user\server\node_modules\.pnpm\…`），那个目录在 09-27 的迁移清理里被删了 → esbuild 报
> `Could not resolve "@modelcontextprotocol/sdk/server/stdio.js"`。**MCP 源码本身没坏**，坏的是依赖树。
> 在 `editor-mcp` 里跑一次 `npm install` 即可恢复；在那之前要打包，就跳过那一步**复用现有单文件**
> （它自包含、与源码无关；仅当 MCP 源码改过时才必须重打）：
>
> ```bash
> .\node_modules\.bin\electron-builder.cmd --win    # 不跑 bundle:mcp
> ```
>
> 另外打包/自检时**留意 `ELECTRON_RUN_AS_NODE`**：如果是从带这个变量的环境（例如 DSH 宿主进程起出来的终端）
> 启动打包版 exe，Electron 会以 Node 模式运行、直接报 `bad option: --selftest` 并退出码 9 ——
> 先 `Remove-Item Env:ELECTRON_RUN_AS_NODE` 再跑。

产物（本机实测，Electron **44.0.0**）：`可视化编辑器-0.1.0-x64.exe`（NSIS 安装包 **109.6 MB**）、
`可视化编辑器-0.1.0-portable.exe`（免安装 **109.4 MB**）、`win-unpacked/`。

**本机实测：两个产物都跑过 `--selftest`，都是 9/9 通过**（`mode=packaged`、`electron=44.0.0`、`node=24.18.1`，
密钥来自 `resources/config/buildKey.mjs`，MCP 列出 108 个工具；另有 3 条界面契约：只有一条菜单栏 /
菜单栏可拖拽 / 右上角给系统按钮留位）。

### Electron 版本：与 DSH 桌面版对齐（44.0.0）

2026-09-28 把 `electron` 从 `^33.2.0` 换成**钉死的 `44.0.0`**，理由与实测：

| | 旧（33.4.11） | 现在（44.0.0） | DSH 桌面版 |
| --- | --- | --- | --- |
| Node | 20.18.3 | **24.18.1** | 24.18.1 |
| Chromium | 130 | 152 | 152 |
| `globalThis.WebSocket` | ❌ 没有 | ✅ function | ✅ function |

**为什么必须换**：应用拉起的 MCP 子进程是「Electron 自己的 Node」（`ELECTRON_RUN_AS_NODE=1` + `process.execPath`），
而 `editor-mcp` 的 `liveBridge` 只认 `globalThis.WebSocket`（Node ≥22 才有，源码里没有 `ws` 回退）——
在 Node 20 上 MCP 侧连不上自己起的桥接 hub，`editor://bridge/status` 报 `connected:false / mode:headless`，
于是 **Live 能力（`doc.attach` 等"操作你正打开的那份文档"）在打包版里用不了**，所有工具退化成无头（`degraded:true`）。
换成 44.0.0 后子进程直接拿到 Node 24.18.1，问题消失，无需改 `editor-mcp` 一行代码。

**实测（升级后，开发版与打包版都验过）**——用 `editor-mcp/scripts/bridge-status.mjs` 一次看三段：

```
MCP 侧：connected=true, ready=true, mode="live"（situation: live：编辑器已接入，调用走编辑器实例）
hub 侧：editors=1, clients=2
★ Live 通道可用（三段都通）
```

**升级时的两个坑**：
1. `npm install electron@44` 之后 **postinstall 没有下载二进制**（`node_modules/electron/dist` 缺失、无 `path.txt`），
   `npm` 也没报错。手动补一次即可：`node node_modules/electron/install.js`（`ELECTRON_MIRROR` 指镜像更快）。
2. `electron-builder 25.1.8` 打 Electron 44 **实测可用**（NSIS + portable 都成功），不必跟着升级。

> ⚠ **`npm run dist` 的第一步仍会失败** —— `bundle:mcp` 用 esbuild 打 `editor-mcp/dist/index.js`，
> 而 `editor-mcp/node_modules` 是当年手工拼的**符号链接**（`@modelcontextprotocol/sdk` / `ws` / `zod` →
> `D:\DSHClient\user\server\node_modules\.pnpm\…`），那个目录在 09-27 的迁移清理里被删了 → esbuild 报
> `Could not resolve "@modelcontextprotocol/sdk/server/stdio.js"`。**MCP 源码本身没坏**，坏的是依赖树。
> 要恢复得连 `package.json` 一起补（`ws` / `react` / `react-dom` 被 import 但没声明，见 `editor-mcp` 的说明）；
> 在那之前要打包，就跳过那一步**复用现有单文件**（它自包含、与源码无关；仅当 MCP 源码改过时才必须重打）：
>
> ```bash
> .\node_modules\.bin\electron-builder.cmd --win    # 不跑 bundle:mcp
> ```
>
> 另外打包/自检时**留意 `ELECTRON_RUN_AS_NODE`**：如果是从带这个变量的环境（例如 DSH 宿主进程起出来的终端）
> 启动打包版 exe，Electron 会以 Node 模式运行、直接报 `bad option: --selftest` 并退出码 9 ——
> 先 `Remove-Item Env:ELECTRON_RUN_AS_NODE` 再跑。

### 真踩过的两个坑（都已修，且都补了自动断言）

1. **`build.files` 漏了 `server/**`** → asar 里没有 `server/webServer.js` → 打包版 ESM 入口
   一 `import` 就崩。桌面程序**没有终端**，现象只是"双击没反应/卡住"（主进程还活着、不写日志、不开端口）。
   定位办法：把 asar 当应用跑一次 `electron release/win-unpacked/resources/app.asar --selftest`，
   stderr 会直接给出 `ERR_MODULE_NOT_FOUND`。**断言**：`verify` 的 F2 段扫描入口的所有相对依赖，
   逐个对 `build.files` 做 glob 匹配，缺一个就 FAIL。
2. **随包密钥以前叫 `buildKey.js` 但内容是 ESM 语法** → 在免安装版的 `%TEMP%` 解包目录、
   或 Program Files 安装目录里，向上都找不到 `package.json`，Node 会按 **CommonJS** 解析 → `import()`
   语法错误 → 应用只好退回默认配置（更新地址变回示例地址）。仓库里跑 `win-unpacked` 时恰好向上能找到
   `apps/desktop/package.json`，**侥幸通过**，所以这个 bug 只在真实部署形态下暴露。
   改成 **`buildKey.mjs`**（`.mjs` 永远是 ESM）后解决；老的 `.js` 仍兼容读取。
   **断言**：`verify` 的 F2 段用 **Electron 自带的 Node**（现在是 24.18.1；旧版 33 是 20.18.3，
   没有"ESM 语法自动探测"；本机 Node 24 有，所以用 Node 24 验**验不出来**）在一个没有 `package.json`
   的目录里加载密钥并解密配置。

### 为什么 `win.signAndEditExecutable: false`

electron-builder 在 Windows 上编辑 exe 资源时会调用 app-builder 的 `rcedit`，而 app-builder **自己**
要去下载 `winCodeSign-2.6.0.7z`；那个包里含 **macOS 符号链接**（`darwin/10.12/lib/libcrypto.dylib` 等），
普通用户没有创建符号链接的特权 → 7za 解压报 `Cannot create symbolic link : 客户端没有所需的特权` → 构建失败
（JS 侧的 `SIGNTOOL_PATH` / `ELECTRON_BUILDER_BINARIES_MIRROR` 都拦不住，这条下载发生在 Go 二进制内部）。
关掉这一步后构建正常。**代价**：exe 保持 Electron 默认图标、没有版本信息（窗口标题、快捷方式名不受影响）。
想恢复资源编辑，二选一：
* 让当前账户获得创建符号链接的权限 —— 打开「设置 → 隐私和安全性 → 开发者选项 → 开发人员模式」（需要管理员）；
* 或在管理员身份的终端里跑 `npm run dist`。
然后删掉 `package.json` 里 `win.signAndEditExecutable` 这一行即可（记得配 `win.icon`）。

**尚未做**（后续要跟用户确认的）：
* 代码签名（没有证书，SmartScreen 会提示"未知发布者"）；
* 自动安装（`install()` 挂点）；
* 应用图标（现在用 Electron 默认图标：上面那条开关 + 一张 256×256 的 `build/icon.png` 即可）。



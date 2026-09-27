# 可视化编辑器 · 大版本重构设计方案（0.2.0 里程碑 → 0.3.0 重构版）

> 目标：把「Web 编辑器 + MCP 服务器 + Electron 桌面分发版 + 加密配置工具」这四块收成**一个安全、
> 不冗余、边界清晰**的产品。本文只写**能落到文件和断言上的设计**，不写口号。
> 现状事实全部来自 2026-09-28 的三份只读审计与本机实测（含脚本可复跑的结论）。
>
> **本次定位是大版本重构（0.3.0）**：安全边界、单一来源（版本/契约/数据模型）、目录边界三件事一起做，
> 因此目录优化不是"以后再说"，而是方案主体之一（§6）。版本计划见 §9，决策点见 §10。

---

## 0. 一句话结论

现在的架构**分层是对的，真相源不唯一**：同一个事实（版本号、组件清单、表格内核、静态服务器、
单文件 MCP）各有 2–4 份实现，靠人工同步；安全边界只做到"绑 127.0.0.1"，**没有对浏览器来源做任何把关**。
所以这次大版本重构干四件事：**① 堵安全口子 ② 每个事实只留一个写入者 ③ 用断言把约定钉死
④ 把目录边界划清（源码 / 契约 / 交付物 / 发行物 / 运行数据 / 工具 / 文档）**。

四件事不是并列的：①不能等，②③是④的地基（契约与版本先单一来源，再搬目录，否则搬迁期两套实现会互相掩盖错误）。

---

## 1. 现状（事实 + 证据）

### 1.1 部件与构建

| 部件 | 角色 | 构建 | 产物 |
|---|---|---|---|
| `web-editor/` | 编辑器页面（React + Vite，44 个内置组件 + 外部热加载组件） | `tsc -b && vite build` | `web-editor/dist/` |
| `editor-mcp/` | MCP 服务器（108 tools / 23 resources / 12 prompts）+ 桥接中转 hub | `tsc -b`；`apps/desktop/scripts/bundle-mcp.mjs` 打自包含单文件 | `editor-mcp/dist/`、`dist-mcp/editor-mcp.bundle.mjs` |
| `apps/desktop/` | Electron 44 外壳（内置静态服务器 + 拉起 MCP + 无边框窗口 + 更新接口） | `electron-builder --win` | `release/*.exe`（109.6 MB） |
| `tools/secure-config/` | 独立加解密工具（AES-256-GCM） | 无 | — |
| `apps/desktop/config/` | 加密配置 + 密钥 | `scripts/embed-key.mjs` | `app-config.enc` + `buildKey.mjs` |

三个包**各自 `npm install`**、三份 `package-lock.json`；`apps/desktop/scripts/bundle-mcp.mjs:32`
借用 `web-editor/node_modules/esbuild`（自己没有声明 esbuild）。

### 1.2 已经跑通的能力（可复跑）

- **Live 通道**：`agent → MCP(37651) → hub(37650) → 编辑器页面 → 真实文档`；Live 专属工具 `doc.attach`
  实测成功（`scripts/agent-live-check.mjs` 5/5）。
- **多实例共存**：两个 MCP 进程共用一个 hub，**两边都能拿到 Live**（`scripts/multi-connection-check.mjs` 10/10）。
- **会话自愈**：编辑器重启换代后，agent 拿着旧 `mcp-session-id` 继续调用不再卡死
  （`scripts/session-revive-check.mjs` 7/7）。
- **回归闸门**：`apps/desktop npm run verify` 77/77；`web-editor ?check=1` 295/295；打包版 `--selftest` 9/9。

### 1.3 实测出来的缺陷（本方案要逐个收口）

| # | 缺陷 | 证据 | 影响 |
|---|---|---|---|
| D1 | MCP HTTP 与桥接 hub **没有 Origin 校验、没有鉴权**，且 `allowWrite` 默认 true | `editor-mcp/src/http.ts`、`src/bridge/host.ts` 无 origin/token 字样；`app-config.example.json` `mcp.allowWrite: true` | 任何网页可 `POST text/plain` 到 37651 触发工具（写文件），可连 37650 冒充编辑器**读取被转发的请求内容** |
| D2 | 版本闸门是**全等比较** | `editor-mcp/src/bridge/liveBridge.ts:236/266` | 一个包升版本、另一个没升 → Live 整体失效（实测：编辑器 0.1.0 / MCP 0.2.0 → 拒绝） |
| D3 | 版本号散落 **5 处**必须完全相等 | 3×package.json + `config.ts:29` + `bridgeClient.ts:32` | 改漏一处 = Live 静默失效 |
| D4 | `_manifest.json` 写入形状与约定不符 | `editor-mcp/src/tools/plugin.ts:64` 写裸数组；`live.ts:221/230` 只认 `{files}`；磁盘实际是 `{"files":[…]}` | 纯静态托管下外部组件清单变空 |
| D5 | 组件知识不自动更新 | `component.*` 依赖 Live 或 `component-catalog.json` 快照 | 编辑器加了组件、MCP 看不到 |
| D6 | 表格内核 9 个纯函数两份实现 | `web-editor/.../tableKit.tsx` ↔ `editor-mcp/src/engine/tableKit.ts` | 无头模式与 Live 结果可能不一致 |
| D7 | 静态服务器两套实现（Node 与 Python）、组件清单 4 处实现 | `apps/desktop/server/webServer.js` 自述"原样移植"`启动编辑器.py` | 改一处漏一处 |
| D8 | 单文件 MCP 存在 3 份；`config.key` 明文进版本库；`buildKey.js` 兼容分支 | 审计；`.gitignore` | 交付污染、密钥泄露面 |
| D9 | 更新通道 `baseUrl` 是示例地址且无签名校验 | `updater.js`、`app-config.example.json:22` | 分发后无法安全更新 / 误把示例当契约 |
| D10 | 分发版 exe 无签名、无版本信息 | `win.signAndEditExecutable: false`（规避 winCodeSign 权限） | 资源管理器/Task Manager 显示 Electron 默认值 |

---

## 2. 设计原则

1. **单一写入者**：每个事实只有一个地方写（其余只读或派生）。判据是"能不能被一条断言抓住漂移"。
2. **默认拒绝**：网络面（HTTP/WS）默认拒绝非本机页面来源；写操作默认需要显式授权。
3. **失败要说人话且可诊断**：宁可明确报错，不要"看起来能用、实际连错实例/走了降级"。
4. **契约优先于实现**：桥接方法、组件契约、清单形状、配置键先定契约，再各写实现，并由**跨包断言**守住。
5. **不新增目录也能单一来源**（尊重"先不改目录"）：先用"生成 + 断言"消除漂移，等确认收益再升级为共享包。
6. **每一步都能回滚**：改动前备份、改动后跑固定闸门（见 §5.7）。

---

## 3. 安全模型

### 3.1 威胁模型（只列真实存在的）

| 威胁 | 场景 | 现状 | 对策（本方案） |
|---|---|---|---|
| **T1 本地网页 CSRF** | 用户浏览器打开恶意页 → `POST http://127.0.0.1:37651/mcp`（`text/plain` 不算复杂请求，**不触发预检**）→ 执行 `doc.create`/`plugin.create`/`export.*` | 无鉴权、无 Origin 校验、`allowWrite=true` → **可写文件** | P0-1：`Origin` 白名单（有 Origin 必须命中）+ `Host` 校验（防 DNS rebinding）；P0-2：Bearer token；P0-3：`allowWrite` 分发版默认 false |
| **T2 冒充编辑器** | 恶意页连 `ws://127.0.0.1:37650/bridge` 发 `bridge.hello{role:'editor'}` | hub 不校验来源 → **能收到转发给编辑器的请求**（可能含文档内容）、并能伪造回包 | P0-1 同款 Origin 校验 + hello 带 token |
| **T3 密钥与配置** | 拿到安装包即可解出加密配置 | 密钥 `buildKey.mjs` 随包（可推导），且 `config.key` 明文在版本库 | P0-4：`config.key` 移出版本库并 gitignore；文档写明"加密只是防误看，不是防逆向" |
| **T4 更新被投毒** | 假更新服务器推一个"新版本" | 只提醒示例地址，无签名/哈希校验 | P1：manifest 必须有 `sha256` + 可选 `signature`；拒绝示例域名；HTTPS 强制 |
| **T5 组件即代码** | 用户导入的 `.js` 插件在页面里执行 | 设计如此（纯 JS、无 fs/require），但可调 `/__save`、`/__savePlugin` | 明确"组件目录=可信用户数据"；写接口只允许写该目录且做文件名校验（已做）；不引入远程加载 |
| **T6 端口被占/被冒充** | 别的版本或别的程序占 37651 | 已修：版本不一致**拒绝接管** | 保持；并要求 hub 侧 token 一致才认"编辑器" |

### 3.2 边界（写进代码与文档）

```
┌─ 浏览器页面（编辑器自身） ─┐        ┌─ MCP 服务器（本机进程） ─┐
│ http://127.0.0.1:<随机>    │  WS    │ 37650 hub / 37651 HTTP   │
│  Origin = 上述地址          │ ─────▶ │ 只监听 127.0.0.1         │
└────────────────────────────┘        │ Origin 白名单 + token    │
        ▲                              └───────────┬──────────────┘
        │ 只由本应用窗口打开                        │ Bearer token（写进 agent 侧配置 headers）
┌───────┴──────────────┐                          ▼
│ Electron 外壳（桌面版）│                 ┌─ agent（DSH / 任意 MCP 客户端）─┐
│ userData 可写、包只读  │                 │ 用配置里的 token + URL 调用        │
└──────────────────────┘                 └──────────────────────────────────┘
```

**token 的传递**（不引入新依赖）：桌面版启动时生成/读取 `userData/bridge-token`（32 字节随机，
权限仅当前用户）；MCP 通过环境变量 `EDITOR_MCP_TOKEN` 拿到；agent 侧由用户在配置里填
`headers: { Authorization: "Bearer <token>" }`（官方 `dsh-mcp-client` 的 streamable-http 配置**已支持 `headers`**）。
未配置 token 时**保持当前行为但打警告**，避免把用户卡死（可配置 `EDITOR_MCP_REQUIRE_TOKEN=1` 强制）。

---

## 4. 目标架构（逻辑分层，不依赖目录名）

```
┌─────────────── 契约层（唯一真相，先文档后代码） ───────────────┐
│ bridge-protocol   桥接方法名/参数/错误码/能力清单             │
│ component-contract  外部插件契约 + _manifest.json 形状        │
│ config-schema     加密配置键（含 mcp.token/httpPort/allowWrite）│
└───────────────────────────────────────────────────────────────┘
        ▲ 派生                          ▲ 派生                 ▲ 派生
┌───────┴────────┐            ┌────────┴─────────┐   ┌────────┴─────────┐
│ web-editor      │            │ editor-mcp        │   │ apps/desktop      │
│ 页面：渲染/交互  │◀── WS ────▶│ hub + tools       │◀─▶│ 外壳：窗口/服务/拉起 │
│ 组件注册表       │            │ LiveBridge/无头引擎 │   │ 配置解密/更新/日志  │
└────────────────┘            └──────────────────┘   └──────────────────┘
        └──────────── 共享内核（现阶段=生成+断言，未来=packages/core） ────────┘
                         表格内核 / 转义 / 文档模型 / 清单读写
```

**职责铁律**（写进各 README 与断言）：

1. **编辑器是"文档真相"**：文档内容、组件渲染、导出（HTML/DOCX/React）只由它产出；MCP 不自己渲染。
2. **MCP 是"能力门面"**：只做协议转换 + 无头兜底；不复制编辑器的渲染/排版逻辑。
3. **桌面版是"壳"**：窗口、静态服务、拉起 MCP、配置密钥、更新；不含业务逻辑。
4. **无头兜底是"降级"，不是"第二实现"**：共享内核（表格/转义）必须同一份语义，禁止各写一套。

---

## 5. 关键机制设计

### 5.1 版本与协议协商（修 D2/D3）

- **单一版本源**：根 `package.json` 的 `version` 为唯一来源；其余位置**由脚本生成**（`tools/sync-contracts.mjs`
  把版本写进 `editor-mcp/src/version.ts` 与 `web-editor/src/version.ts`，两处只 import）。
  → 现阶段不改目录，用"生成文件 + verify 断言"实现同样的效果。
- **握手内容**（`bridge.hello`）：
  ```jsonc
  { "role": "editor", "version": "0.2.0", "protocol": 2,
    "features": { "exportDocx": true, "liveSelection": true, "realtime": true } }
  ```
- **闸门规则**（替换"版本全等"）：
  | 情况 | 行为 |
  |---|---|
  | `protocol` 相同 | **允许 Live**（版本不同只记 info：`编辑器 vX / MCP vY，协议 v2 兼容`） |
  | `protocol` 不同 | 尝试 Live，但**每次调用前先查 `features`**；缺失的能力走无头并注明"编辑器协议偏旧，请一起升级" |
  | 完全拿不到 hello | 无头 + `degraded:true`（现状） |
- **未知方法**：编辑器回 `METHOD_NOT_FOUND` 时，MCP **降级到无头并附提示**（现状是硬报错，见
  `fallback.ts:60-63`）；真正的方法名拼错会被 `--list` 与执行清单断言提前抓住。

### 5.2 组件（插件）单一真相（修 D4/D5）

| 事实 | 唯一写入者 | 其他方 |
|---|---|---|
| 组件目录 | dev：`web-editor/public/组件`；分发：`userData/组件`（首启种子拷贝） | 编辑器与 MCP **指向同一目录**（已成立，写进断言） |
| `_manifest.json` | **规范形状 `{"files":[…]}`**；MCP 的 `writeManifest` 改为写这个形状 | 编辑器读取端（P1 改）**兼容两种形状**（裸数组视为 `files`），过渡期不炸 |
| 组件清单的"服务端" | 桌面 webServer / Python 启动器的 `/__components` 都从目录列（已一致） | dev 中间件同款；`_manifest.json` 只作静态托管兜底 |
| 组件知识（schema/默认值） | **编辑器**（Live 的 `component.catalog`） | MCP 在握手成功后自动请求一次并落盘 `component-catalog.json`；离线时用快照并标注"快照时间" |
| 组件变更通知 | MCP 的 `watchPluginDir` 推 `resources/updated`（已有） | 编辑器侧「重载外部组件」按钮/MCP `plugin.reload` |

### 5.3 传输与会话（保持已修好的部分，补 P0）

- 只监听回环（已有）；**Origin 白名单 + Host 校验 + 可选 token**（新增，见 §3）。
- 会话：有状态会话保留（多客户端隔离），**未知会话按客户端 id 复活**（已实现，`http.ts`），
  DELETE 未知会话回 405（客户端可干净收场）。
- 多实例：`probeHub` 先探再绑，`hubOwner` 进诊断（已实现）。
- 诊断资源 `editor://bridge/status` 增加 `hubOwner`、`protocol`、`features` 字段。

### 5.4 配置与密钥（修 D8/D9）

- `config.key` **移出版本库**（保留 `buildKey.mjs` 作为分发形态）；`buildKey.js` 兼容分支删除（没有 v0.1 用户）。
- 密钥优先级、威胁模型写进 `apps/desktop/README.md`：**这是"防误看"，不是"防逆向"**。
- `mcp.allowWrite` 分发版默认 `false`（在示例配置与文档里明确"要用写工具必须改配置或给 token"）。
- 新增配置键：`mcp.requireToken`、`mcp.originAllow`（默认 `http://127.0.0.1:*`）。

### 5.5 更新通道（修 D9）

- manifest 契约：`{ version, minVersion, sha256, url, notes, signature? }`；客户端**必须校验 sha256**，
  有 `signature` 则验签；HTTPS 强制；`updates.example.com` 直接拒绝并提示"未配置更新地址"。

### 5.6 构建与发布

- **一次安装 / 一条命令**：根 `package.json`（`private`）提供编排：
  `npm run setup`（按序安装三个包）→ `npm run build`（web + mcp + bundle）→ `npm run verify`（三套闸门）
  → `npm run dist`（electron-builder）；每个包仍可单独跑（现状不破坏）。
- **产物落点**（P3 目录重排后生效，见 §6.2）：交付物 `dist/{web,mcp,desktop}`、发行物 `release/`、
  运行数据 `var/`；**编译产物留在包内 `*/dist`**（理由见 §6.3）。
  **单文件 MCP 只保留一份生成路径**（现在三份）。
- **可复现**：`bundle:mcp` 自己声明 `esbuild`（不再借用兄弟包 `node_modules`）；
  打包前 grep 断言"单文件里没有 `E:/`、`C:/Users`、`D:/DSHClient` 等开发机绝对路径"（已加过一次实测：0 处）。
- **打包元数据**：分发版 exe 目前无签名、无版本信息（`signAndEditExecutable:false` 规避 winCodeSign）。
  在 P3 里评估：用 `rcedit` 直接写图标与版本资源（不需要签名工具链），把 Task Manager 里的
  "Electron" 改成产品名；代码签名留到有证书时再说。

### 5.7 可观测与自检闸门（把约定钉死）

| 闸门 | 命令 | 现在 | 本方案补充的断言 |
|---|---|---|---|
| 前端 + 自检 | `npm run build`、`?check=1` | 295/295 | 组件清单形状、外部组件数（缺组件时 skip 而不是红） |
| MCP | `tsc -b`、`scripts/*-smoke.mjs` | ✅ | 协议/能力握手、METHOD_NOT_FOUND 降级 |
| 桥接 | `scripts/bridge-status.mjs` | ✅ | 增加 protocol/features 展示 |
| 端到端 | `scripts/agent-live-check.mjs` | 5/5 | 加"token 模式"与"无 token 被拒"两条 |
| 连接逻辑 | `scripts/multi-connection-check.mjs`、`session-revive-check.mjs` | 10/10、7/7 | — |
| 桌面 | `apps/desktop npm run verify` | 77/77 | Origin 校验、token、跨包版本/契约一致、拒绝接管 |
| 打包 | `--selftest` | 9/9 | 打包版 Live（版本对齐后）、token 生成与读取 |

---

## 6. 目录重构方案（本次大版本重构的核心）

### 6.1 定位：这是**开发侧**重构，用户数据零迁移

目录边界只影响仓库与构建，**不改变任何对外契约**：

| 不变（用户/agent 无感） | 会变（只影响我们自己的仓库） |
|---|---|
| 端口 37650 / 37651 / 5179、只绑回环 | 仓库内路径与脚本 |
| `%APPDATA%\可视化编辑器\{workspace,组件,logs,docs}` | 文档里的相对路径、`.dsh/skills` 里的路径 |
| `EDITOR_MCP_WORKSPACE` / `EDITOR_MCP_PLUGIN_DIR` / `EDITOR_MCP_BRIDGE_URL` 等环境变量名 | `electron-builder` 的 `files`/`extraResources` |
| 加密配置键（只新增，不重命名） | 各包 `dist/` 的落点与 `.gitignore` 规则 |

⇒ **升级用户零迁移**：文档、组件、设置原样在；唯一可见变化是安装包名里的版本号。

### 6.2 目标目录树（推荐形态）

```
E:\可视化编辑器\                         ← 仓库根：索引 + 忽略规则 + 编排脚本
├─ README.md  ARCHITECTURE.md  CHANGELOG.md  AGENTS.md  .gitignore
├─ package.json                          【编排】private，根脚本 install/build/verify/dist/selfcheck
├─ contracts\                            【契约·唯一真相】protocol.ts · component-contract.ts ·
│                                         config-schema.ts · version.json（由 tools/sync-contracts.mjs 生成到两端）
├─ web-editor\                           【源码】src\ public\ scripts\ vite/ts 配置 + dist\（包内编译产物）
├─ editor-mcp\                           【源码】src\ scripts\ package.json + dist\（包内编译产物）
├─ apps\desktop\                         【源码】main.js preload.cjs src\ server\ scripts\ config\
├─ tools\                                【工具·入库】secure-config\ · cdp\（自检探针）· sync-contracts.mjs
├─ dist\                                 【交付物·不入库】mcp\editor-mcp.bundle.mjs · desktop\（win-unpacked）
├─ release\                              【发行物·不入库】可视化编辑器-<版本>-x64.exe / -portable.exe
├─ var\                                  【运行数据·不入库】logs\ · caches\ · mcp-workspace\ · shots\
└─ .dsh\                                 【DSH 约定】必须留在根（skills\ 等），不可移动
```

### 6.3 为什么**编译产物留在包内**、只有"交付物+运行数据"移出

这点与早先"连构建产物也移出去"的想法不同，**理由是硬的**：

1. **模块解析**：把 `editor-mcp/dist/index.js` 挪到顶层 `dist/mcp/` 后，Node 会从
   `dist/mcp/` → `dist/` → 仓库根 逐级找 `node_modules`，**永远找不到 `editor-mcp/node_modules`** → 直接崩。
   要让"编译产物出包"成立，前置条件是**依赖提升到根**（workspaces 一次安装），那是 P2 之后的事。
2. **`bin` 契约**：`editor-mcp/package.json` 的 `bin` 必须指向包内文件，指到包外会让 `npm link`/npx 失效。
3. **`tsconfig` 的 `rootDir/outDir`**：输出到包外会让 `rootDir` 推导出界、增量构建与 sourcemap 路径错乱。

所以目标边界是：**包内 `dist/` = 编译产物（可删可重建、不入库）；顶层 `dist/` = 交付物；`release/` = 发行物；`var/` = 运行数据。**
"彻底版"（编译产物也出包）写进 P2 的前置条件，等一次安装生效后再评估。

### 6.4 分类规则（判据明确，别再靠感觉）

| 类别 | 判据 | 位置 | 入库 |
|---|---|---|---|
| 源码 | 人要读要改的 | `web-editor\{src,public,scripts}`、`editor-mcp\src`、`apps\desktop\{main.js,preload.cjs,src,server,scripts}`、`tools\**` | ✅ |
| 契约 | 两端都要一致的 | `contracts\`（生成物 `version.json` 也入库，便于 diff） | ✅ |
| 编译产物 | `tsc`/`vite` 生成 | `*/dist\`、`*.tsbuildinfo` | ❌ |
| 交付物 | 要装进安装包/给外部用 | `dist\mcp\*.mjs`、`dist\desktop\` | ❌ |
| 发行物 | 直接交给用户的 | `release\*.exe` | ❌ |
| 运行数据 | 跑起来才有、含隐私 | `var\{logs,caches,mcp-workspace,shots}`、`%APPDATA%\可视化编辑器\*` | ❌ |
| 生成文档 | 从注册表/运行态生成 | `?spec=1` 清单、自检报告、截图 | ❌（落 `var\`） |
| 开发文档 | 人写的说明 | 根 README/ARCHITECTURE/CHANGELOG/AGENTS、各包 README | ✅ |

### 6.5 搬迁与引用同步（逐项，改一处漏一处会直接坏）

| # | 从 | 到 | 必须同步改 | 验证 |
|---|---|---|---|---|
| M1 | `web-editor/dist\` | `dist\web\` | `web-editor/vite.config.ts`（`outDir`、`emptyOutDir`）｜`apps/desktop/package.json` 的 `extraResources[].from`｜`src/paths.js`（dev 的 webRoot）｜`server/webServer.js`（dist 推导）｜`web-editor/启动编辑器.py`（DIST）｜`.gitignore`｜4 份 README | 构建后 `dist\web\index.html` 存在；dev 启动器与桌面版都能打开；`verify` 的 webRoot 断言过 |
| M2 | `apps/desktop/dist-mcp\` + `editor-mcp/dist/editor-mcp.bundle.mjs` | `dist\mcp\editor-mcp.bundle.mjs`（**唯一一份**） | `apps/desktop/scripts/bundle-mcp.mjs`（默认输出）｜`src/paths.js`（`mcpEntry`）｜`editor-mcp/scripts/*.mjs`（默认 bundle 路径）｜`.probe-capabilities` 类探针默认值｜打包 `extraResources` | 三个脚本都能找到 bundle；`verify` 的 G 段（自包含打包）过 |
| M3 | `apps/desktop/release\` | `release\` | `apps/desktop/package.json` 的 `directories.output`｜README 的产物名/体积｜`.gitignore` | `npm run dist` 后 exe 落在 `release\`；`--selftest` 9/9 |
| M4 | `apps/desktop/{.npm-cache,.electron-cache,.electron-builder-cache}` + 各包日志/自检报告 | `var\caches\`、`var\logs\` | 三个 npm/electron 环境变量（在编排脚本里统一设置）｜`paths.js` 的 logDir（dev）｜`.gitignore` | 再跑一次安装/打包不产生包内垃圾 |
| M5 | `editor-mcp/workspace\`（**活文档**） | `var\mcp-workspace\` | `editor-mcp/src/config.ts` 的默认 workspace｜`EDITOR_MCP_WORKSPACE` 用法示例｜README | **先复制 → `Get-FileHash` 逐文件比对 → 切默认 → 保留旧目录一个版本周期**；`doc.list` 数量一致 |
| M6 | `web-editor/logs\` | 探针 → `tools\cdp\`（入库）；日志/截图 → `var\logs`、`var\shots` | `web-editor/README.md` 里的自检命令｜探针脚本里的 Edge 路径（`C:\Program Files (x86)\...\msedge.exe` 参数化） | 新克隆仓库按 README 能跑通 `?check=1`（现在做不到，因为探针在 gitignore 里） |
| M7 | `web-editor/docs\组件与属性说明清单.md`、`docx-verify.txt` | `var\docs\`（生成物出库） | `webServer.js` 的 `/__save` 只允许写 `docsDir`（已支持覆盖）｜README | `?spec=1` 仍能生成，但不再污染源码树 |
| M8 | `apps/desktop/config/config.key` | 移出版本库（保留 `buildKey.mjs`） | `paths.js` 的密钥优先级｜`embed-key.mjs`｜`verify` 的两条断言 | `git ls-files` 里没有 `config.key`；打包版仍能解出配置 |
| M9 | 契约与版本 | `contracts\` + 生成到两端的 `version.ts` | `editor-mcp/src/config.ts`、`web-editor/src/mcp/bridgeClient.ts`、`apps/desktop/src/mcpSupervisor.js` | `verify` 的"版本号跨包一致"断言过；手改任一处会被断言抓住 |

### 6.6 `.gitignore` 新规则（有个必须避开的陷阱）

```gitignore
node_modules/
*/dist/            # 包内编译产物（顶层 dist/ 由下面单独管）
dist/              # 顶层交付物
release/           # 发行物
var/               # 运行数据：logs/caches/mcp-workspace/shots
*.tsbuildinfo
```

**陷阱**：早期规则是裸 `dist/`（匹配任意层级）。改成上面的写法时**必须确认顶层 `dist/` 仍被忽略**，
否则"交付物进版本库"会在某次 `git add -A` 后静默发生。→ 用 `git check-ignore -v dist/mcp/x` 做**断言**，
写进 `verify`（而不是靠人记）。

### 6.7 迁移纪律（每条都可回滚）

1. **一次只做一个 M 号**，独立提交；跑完该行的"验证"再进下一条。
2. 动任何文件前：`git status` 干净 → 需要时先备份（配置文件带时间戳 `.bak-*`）。
3. 活文档（M5）**只允许"先复制 + 哈希比对 + 再切默认"**，绝不原地移动；旧目录保留一个版本周期。
4. 脚本里的**相对深度**改动（`../../web-editor` → `../web-editor` 之类）必须一次改完并跑
   `node --check` + 对应闸门；这类错误不会在编辑期暴露，只在运行时炸。
5. 每阶段结束跑**固定四件套**：`tsc -b` / `npm run build` / `?check=1` / `apps/desktop npm run verify`
   + `--selftest`（打包阶段）。
6. 回滚 = `git revert` + 删除新目录（产物/运行数据都可重建，无数据损失）。

### 6.8 验收（重构完成的定义）

- **干净克隆**：`git clone` → 根一条命令（`npm run setup`）→ 三条命令内跑出可用的开发态；
  `npm run verify` 全绿；不需要手工把 `node_modules` 从别的包借过来。
- **干净机器**：只装我们发的 exe → 首启自动种子组件、生成 token、起 MCP、页面接上桥接 → `--selftest` 9/9。
- **没有第二份**：单文件 MCP 只 1 份生成路径；表格内核/转义/清单/静态服务器各 1 处实现；
  版本号 1 处来源；README 里"怎么跑"只在各自子 README。
- **没有临时垃圾**：仓库内不存在 `.tmp-*`、`.asar-probe/`、包内 cache/报告；`git check-ignore` 断言全过。

### 6.9 风险

| 风险 | 影响 | 对策 |
|---|---|---|
| 相对路径深度改漏 | 运行时炸（编辑期无感） | 一次改完 + `node --check` + 对应闸门；verify 加"路径解析"断言 |
| `.gitignore` 放宽导致产物入库 | 仓库膨胀、密钥泄露面 | `git check-ignore` 断言进 verify |
| 中文目录名在 NSIS/zip 下 | 打包或解压异常 | 新增目录名一律 ASCII（`dist/release/var/tools/contracts`），产品目录名保持不动（skill 与文档里的路径就不用改） |
| M5 活文档 | 用户文档丢失 | 复制 + 哈希比对 + 旧目录保留 |
| 契约层生成物被手工改 | 两端再次漂移 | 生成物带"DO NOT EDIT"头 + `--check` 模式断言 |

---

## 7. 去冗余清单（合并去向）

| 冗余 | 现状 | 合并去向 | 防漂移断言 |
|---|---|---|---|
| 表格内核 9 函数 | 编辑器 + MCP 各一份 | 现阶段：**MCP 侧改为引用同一份生成文件**（由 `tools/sync-contracts.mjs` 从编辑器源码抽取并加头注释）；将来：`packages/core` | 同一组用例跑两边结果必须相等 |
| `escapeHtml` 4 份、Markdown 转义 2 份、标尺 18px 2 份 | 编辑器内部 | 编辑器内先合并到 `src/utils/escape.ts` 等 | 单测/自检断言 |
| 静态服务器 2 份（Node / Python） | 桌面版 + 启动器 | **Node 版为唯一实现**；Python 版降级为"调 node 跑 webServer"或明确标注 dev-only 并加契约测试 | 两者对同一请求的响应逐项比对（已有 webServer 断言基础） |
| 组件清单 4 处实现 | dev 中间件 / Python / Node / `_manifest.json` | 统一形状 + 统一"列目录"语义 | 四处对同一目录返回一致 |
| 单文件 MCP 3 份 | `editor-mcp/dist`、`dist-mcp`、打包内 | 只保留构建输出一份（挪产物时执行） | 打包脚本断言"来源唯一" |
| README 重复讲"怎么跑" | 根 + 3 个子 README | 运行命令只留各自子 README，根只留索引 | 文档链接检查（可选） |
| 空挂点/未用导出 | `updater.install()`、`desktop:mcp-url`、`registrySize()`、`openPrintWindow()` | 删除或标注"未接线" | verify 断言"无未接线的 IPC 通道" |
| `config.key`、`buildKey.js` 分支、`.tmp-asar/` | 版本库/磁盘 | 移出 + gitignore（部分已做） | `git check-ignore` 断言 |

---

## 8. 与既有开发提示词的衔接

现在的约定主要活在 `.dsh/skills/visual-editor-plugin-dev/SKILL.md`（组件/插件）与三份 README 里。
本方案把"只靠人记"的部分变成**能自动检查**的部分：

1. SKILL.md 的 §1.7（清单 `files` 字段）→ 由 `verify` 断言 + MCP 写入修正固定下来。
2. 桥接方法清单 → 由 `tools/sync-contracts.mjs` 生成的 `protocol.ts` 成为唯一来源；
   编辑器 `liveMethods.ts` 的 `switch` 与 MCP 的工具表都断言"生成的清单里的方法都在"。
3. 版本单一来源 → 由生成文件 + 跨包断言固定（现在 5 处手改）。
4. 新增 `AGENTS.md`（仓库级）记录三件事：**目录边界（源码/发行物/工具）**、**单一写入者**、
   **改完必跑哪几道闸门**；让后续任何人（或 agent）不需要口口相传。
5. A4 预设提示词里仍写着 `mcp__editor__doc_create_<hash>` 的旧命名 → 改成"用 `Tool.listTools` 按关键词找
   `mcp__mcp-editor__*`"（这处已在 DSH 的 profile patch 里，需要你确认后再改）。

---

## 9. 落地路线图（大版本重构）

**版本计划**：`0.2.0` = 已提交的里程碑（Electron 44、Live 修复、会话自愈、多实例、依赖恢复）；
**`0.3.0` = 本次大版本重构**（安全边界 + 单一来源 + 目录重排 + 契约层），一次性发布，
`CHANGELOG.md` 写清"对开发者有破坏性、对已安装用户无感"；`1.0.0` 留给"契约与目录冻结、API 稳定"。

| 阶段 | 内容 | 改动面 | 验证口径 | 风险/回滚 |
|---|---|---|---|---|
| **P0 安全**（先行，独立可回滚） | Origin 白名单 + Host 校验 + 可选 token + `allowWrite` 默认 false + `config.key` 出库 | `editor-mcp/src/http.ts`、`bridge/host.ts`、`apps/desktop/{src,config,scripts}` | `verify` 新断言：跨源被拒、无 token（配置了 token 时）被拒、有 token 通过；`multi-connection`/`session-revive`/`agent-live` 仍全绿 | 中；未配置 token 时保持兼容；改动集中在传输层，单独回滚 |
| **P1 单一来源**（不改目录） | ① `_manifest.json` 写入形状修正 + 读取兼容 + 四处清单统一 ② 协议/能力协商替换版本全等，`METHOD_NOT_FOUND` 改降级 ③ `tools/sync-contracts.mjs` 生成版本与方法清单 ④ 表格内核同源 | `editor-mcp/src/{tools/plugin.ts,bridge/*,engine/tableKit.ts}`、`web-editor/src/{registry/live.ts,mcp/*}`、新增 `tools/` | 四件套全绿 + 新断言（清单形状、协议兼容、方法清单一致）；`?check=1`、108 工具数不变 | 低-中；每项独立提交 |
| **P2 收敛 + 契约层**（不改目录） | 根 `package.json` 编排（一次 install/build/verify/dist）、`contracts/` 落地、静态服务器归一（Python 版降级 dev-only + 契约测试）、删空挂点与冗余导出、README 去重、`bundle:mcp` 自带 esbuild | 根新增编排脚本、`contracts/`、各包脚本与 `src/utils` | 根一条命令跑完三套闸门；打包 `--selftest` 9/9；干净克隆可构建 | 中；不移动目录，随时回滚 |
| **P3 目录重排**（§6，本次重构核心） | M1–M9 逐条执行：交付物→`dist/`、发行物→`release/`、运行数据→`var/`、探针入库 `tools/cdp/`、生成物出库、活文档迁移、密钥出库 | 见 §6.5 表（每条自带"必须同步改"清单） | 每完成一个 M 号跑四件套；全部完成后走 §6.8 验收（干净克隆 + 干净机器） | 高；**一条一个提交**，回滚 = revert + 删新目录（无数据损失） |
| **P4 冻结** | `AGENTS.md`（目录边界/单一写入者/闸门清单）、README 索引化、`CHANGELOG` 定稿、断言补齐、版本单一来源校验进 CI | 文档 + `verify` | 任何人（或 agent）只读 AGENTS.md + 子 README 就能上手 | 低 |

**顺序说明**：P0 先做（安全不能等）；P1/P2 是 P3 的地基——**契约与版本先单一来源，再搬目录**，
否则搬迁过程中"两份实现 + 三个版本号"会互相掩盖错误。P3 的每条 M 号都**不依赖**下一条，可随时停。

---

## 10. 需要你决策的点

1. **token 策略**：接受"未配置 token 时保持现状 + 警告"（推荐，不会弄断你现在的 agent 链路），还是强制？
2. **`allowWrite` 默认值**：分发版默认 `false`（推荐）还是保持 `true`？
3. **Origin 白名单**：放行"无 Origin 的本地进程"（Node 客户端不发 Origin），配置了 token 时仍要求 token（推荐）？
4. **P3 边界**：按 §6.3 的论证——**编译产物留包内**、只把交付物/发行物/运行数据移出（推荐）；
   还是要"彻底版"（连 `*/dist` 也出包，前置是 P2 的 workspaces 一次安装）？
5. **版本号**：本次重构发 `0.3.0`（推荐），还是直接标 `1.0.0`？


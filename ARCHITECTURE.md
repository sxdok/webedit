# 可视化编辑器 · 大版本重构设计方案（0.2.0 里程碑 → 0.3.0 重构版）

> 目标：把「Web 编辑器 + MCP 服务器 + Electron 桌面分发版 + 加密配置工具」这四块收成**一个安全、
> 不冗余、边界清晰**的产品。本文只写**能落到文件和断言上的设计**，不写口号。
> 现状事实全部来自 2026-09-28 的三份只读审计与本机实测（含脚本可复跑的结论）。
>
> **本次定位是大版本重构（0.3.0）**：安全边界、单一来源（版本/契约/数据模型）、目录边界三件事一起做，
> 因此目录优化不是"以后再说"，而是方案主体之一（§6）。版本计划见 §13，决策点见 §14。
>
> 另含用户追加的四块：**菜单审计与改版（§7）**、**独立工具箱应用（§8，加密配置 + 授权签发 + 诊断）**、
> **授权体系（§9）**、**开发流程与适应性检查（§10）**。其中一条硬约束贯穿全文：
> **签发授权的能力必须与分发给客户的应用物理分离**——主应用只验证，签发只在独立的工具箱里。

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
├─ apps\toolbox\                         【源码·独立应用】加密配置 + 授权**签发** + 诊断（自行构建、独立产物，
│                                         不进客户分发、不进更新通道；见 §8）
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

## 7. 编辑器菜单与交互审计（改版方案）

依据：Electron 官方菜单模板（`File / Edit(undo,redo,cut,copy,paste,delete,selectAll) / View(zoomIn,zoomOut,resetZoom,togglefullscreen) / Help`）
与同类编辑器（Word / Figma / VS Code / Qt Designer）的通行位置。逐条对着 `web-editor/src/components/layout/MenuBar.tsx` 与
`src/components/layout/useShortcuts.ts` 核过。

### 7.1 现状（六个菜单的全部条目）

| 菜单 | 条目 | 快捷键（`useShortcuts`） |
|---|---|---|
| 文件 | 新建… / 打开（JSON）/ 打开 HTML（导入成组件）… / 从 URL 载入 HTML… / ─ / 保存（导出 JSON）/ ─ / 导出 HTML / 导出 React 代码 / 导出 Word（.docx）/ 打印… | Ctrl+N；打印菜单标注 Ctrl+P（无全局绑定，靠浏览器） |
| 编辑 | 撤销 / 重做 / ─ / 复制 / 粘贴 / 原地复制 / 删除 / ─ / 全选 / 清空当前模式内容 | Ctrl+Z、Ctrl+Shift+Z、Ctrl+C/V、Ctrl+D、Delete/Backspace、Ctrl+A |
| 视图 | 首选项… / ─ / 显示网格 / 显示标尺 / 显示辅助线 / 对齐吸附 / ─ / 缩放 50/75/100/适应宽度/适应页面 / ─ / 显示组件树 / Markdown 源码 / 图表按章编号 / 预览模式 | Ctrl+= / Ctrl+- / Ctrl+0（菜单未标） |
| 页面 | 纸张（A4/A3/A5/Letter/Legal/自定义）/ 纵向·横向 / 页边距预设 / 设备预设（web）/ 画布背景色 | — |
| 工具 | MCP 桥接：<状态> +（桌面版）检查更新… / 打开更新下载页 / 复制 MCP 地址 / MCP 服务状态 / 重启 MCP / 打开日志·数据·配置目录 / 关于（版本/运行环境） | — |
| 帮助 | 快捷键说明 / 诊断信息 / 下载日志文件 / 导出组件包 / 导入组件包 / 保存诊断报告 / 导出组件与属性说明清单 / 关于（文案行，disabled） | Ctrl+Shift+M（模式切换，菜单里没有入口）｜Tab/Shift+Tab、Enter（进出容器）、Ctrl+[ / Ctrl+]（层级） |

### 7.2 判定与改法（13 条）

| # | 现状 | 判定 | 改法 |
|---|---|---|---|
| M-1 | 首选项在**视图**首项（`MenuBar.tsx:158`） | ❌ 不合惯例：Windows 应用多在「工具→选项」或「编辑→首选项」；Chrome/VS Code 在应用/文件级 | 移到 **编辑 → 首选项…（末项）**，加 `Ctrl+,`；视图只管显示 |
| M-2 | **图表按章编号**在视图（`:174`） | ❌ 它改的是**输出内容**（图 X-Y/表 X-Y），不是显示 | 移到 **页面**（或改名为「文档」），与纸张/页边距同组 |
| M-3 | **关于**在工具（`:286`），帮助底部又有一行关于文案（`:435`） | ❌ 两处；惯例在帮助 | 只留 **帮助 → 关于**（含版本/运行环境/许可状态，见 §9） |
| M-4 | **检查更新…/打开下载页**在工具（`:230/:237`） | ⚠️ 可接受但不统一（Chrome/VS Code 在帮助） | 移到 **帮助**（与关于相邻）；工具只留运维类 |
| M-5 | **导出/导入组件包**（`:363/:377`）、**导出组件与属性说明清单**（`:418`）在帮助 | ❌ 数据导入导出不是"帮助" | 组件包进 **文件 → 导入/导出**；说明清单进 **文件 → 导出**（它是交付物） |
| M-6 | **编辑缺"剪切"**（菜单与快捷键都没有） | ❌ Electron 标准 Edit 必含 cut | 补 `Ctrl+X` + 菜单项 |
| M-7 | **视图缺"全屏"**；缩放菜单项未标快捷键 | ❌ Electron 标准 View 含 `togglefullscreen` | 补 **全屏（F11）**；缩放项标 `Ctrl+=/-/0` |
| M-8 | 重做只认 `Ctrl+Shift+Z`（`useShortcuts.ts:157-161`） | ⚠️ Windows 惯例还认 `Ctrl+Y` | 两者都支持，菜单里显示 `Ctrl+Y` |
| M-9 | **没有查找/替换** | ❌ 文档编辑器基本盘（Markdown 视图、长文档、表格内容都要） | 补 **编辑 → 查找/替换…（Ctrl+F）**，作用于画布文本与 Markdown 视图 |
| M-10 | 「保存（导出 JSON）」语义含糊（`:116`）；没有"另存为" | ⚠️ 用户分不清"保存到浏览器"与"导出文件" | 拆成 **保存到浏览器（Ctrl+S）** / **导出 JSON…（Ctrl+Shift+S）** / 导出 HTML / React / Word / 打印… |
| M-11 | 文件里没有**最近文档** | ⚠️ 常见能力（Electron 原生支持 recent documents） | 加 **文件 → 最近打开**（存 userData；与浏览器内的文档列表分开） |
| M-12 | 模式切换（`Ctrl+Shift+M`）没有菜单入口 | ⚠️ 快捷键孤儿 | **视图 → 模式：文档 / Web / PPT**（显示当前模式） |
| M-13 | 「页面」在两种模式下切换内容（`:178-225`） | ✅ 合理（已按模式分派） | 仅建议菜单名改 **页面 / 画布**，或在组内加"（文档模式）"提示 |

### 7.3 目标菜单结构（建议）

```
文件：新建…(Ctrl+N) · 打开…(Ctrl+O) · 最近打开 ▸ · 打开 HTML（导入）… · 从 URL 载入… ─
      保存到浏览器(Ctrl+S) · 导出 JSON…(Ctrl+Shift+S) ─
      导出 ▸（HTML / React / Word / 组件与属性说明清单） · 打印…(Ctrl+P) ─ 导入/导出组件包 ▸ · 退出
编辑：撤销(Ctrl+Z) · 重做(Ctrl+Y) ─ 剪切(Ctrl+X) · 复制(Ctrl+C) · 粘贴(Ctrl+V) · 原地复制(Ctrl+D) · 删除(Delete) ─
      全选(Ctrl+A) · 查找/替换…(Ctrl+F) ─ 清空当前模式内容 ─ 首选项…(Ctrl+,)
视图：模式（文档/Web/PPT） ─ 显示网格 · 标尺 · 辅助线 · 对齐吸附 · 组件树 · Markdown 源码 · 预览模式 ─
      缩放 ▸（50/75/100/适应宽度/适应页面，标 Ctrl+=/-/0） · 全屏(F11)
页面：纸张 ▸ · 方向 ▸ · 页边距 ▸ · 分页符 · 图表按章编号 ─ 画布（设备预设 / 背景色）
工具：MCP 桥接：<状态> · MCP 服务状态 · 重启 MCP · 复制 MCP 地址 ─ 打开日志/数据/配置目录
帮助：快捷键说明 · 诊断信息 · 下载日志 · 保存诊断报告 ─ 检查更新… · 打开下载页 ─ 关于（版本/许可）
```

**约定（写进断言）**：会弹窗的条目一律以 `…` 结尾；快捷键在菜单里显示且**全局唯一**；
破坏性操作（清空/删除）保留二次确认；同一命令只能有一个入口（现在是"关于"两处、"组件包"在帮助）。

### 7.4 断言（可直接加进 `?check=1` 或 verify）

- 菜单顺序 = `文件 编辑 视图 页面 工具 帮助`（已有断言，扩展为"条目标题集合"）。
- 每条命令**唯一入口**；`…` 结尾的条目确实会打开对话框。
- 快捷键表与菜单标注**一致**（例如菜单写 `Ctrl+Y` 就必须真能重做）。
- Electron 标准动作都在（cut/copy/paste/delete/selectAll/zoomIn/zoomOut/resetZoom/togglefullscreen 的等价项）。

---

## 8. 新增「工具箱」桌面应用（**独立应用**：加密配置 + 授权签发 + 诊断）

### 8.1 为什么，以及为什么**必须独立**

`tools/secure-config` 现在只有 CLI（`secure-config.mjs` + `selftest.mjs`），生成配置与授权文件要命令行 + 手写 JSON；
用户要求"加密工具等应做一个简单界面应用"，并且明确指出两条**不可妥协**的边界：

> **① 工具箱做成独立应用，不和主项目混用。**
> **② 主项目分发出去之后，授权不能由主项目自己生成 —— 那正好把授权控制的本意废掉了。**

第②条是安全设计的根：**签发能力必须与分发物物理分离**。只要"签发"这段代码（或它能加载的私钥）
出现在客户拿到的安装包里，任何客户都能给自己签一份永久授权 —— 授权就只是"仪式感"。
所以主应用与工具箱是**两个独立应用、两条分发渠道**：

| | 主应用（可视化编辑器） | 工具箱（内部/运营用） |
|---|---|---|
| 能力 | **只验证**：内置公钥 + 校验逻辑 + 生成请求文件 + 导入授权文件 | **只签发**：读请求文件 → 用私钥签授权文件；另含配置加密与诊断 |
| 分发 | 给客户（NSIS / portable；自动更新通道） | **不通过客户渠道分发**（内部机器；不进 release 的客户包、不进更新通道） |
| 私钥 | **不存在**（代码里也没有签发路径） | 运营机上以**口令加密的密钥文件**存在；不进仓库、不进任何安装包 |

### 8.2 形态（推荐 B1：独立应用）

| 方案 | 说明 | 取舍 |
|---|---|---|
| **B1（推荐）独立 Electron 应用** | 自己一个目录、自己的 `package.json` 与构建目标，产物是**第二个 exe**（`工具箱.exe`），技术栈与主应用一致 | 完全独立、双击即用、不依赖客户环境；代价是多一份 Electron 体积（~110MB，内部机器无所谓）；**注意：绝不与主应用共用入口** |
| B2 独立应用 + 系统 WebView（WebView2/Tauri 类） | 复用 Windows 自带的 WebView2，体积小很多 | 体积小；代价是引入第二套工具链与打包链（Rust/或额外 CLI），维护面变大 |
| B3 本地网页 UI（Node 起 `127.0.0.1:<端口>` + 浏览器打开） | 最轻，零打包 | 需要机器上有 Node；**签发私钥所在机器的进程隔离最弱**（任何本机网页都可能打到这个端口，必须 Origin+token，见 §5.3）；只适合开发者自用 |
| ~~A 同项目双入口（`可视化编辑器.exe --toolbox`）~~ | 曾经考虑过 | ❌ **违反用户第②条**：签发能力会随主安装包一起发到客户手里 |

**结论**：走 **B1**（独立应用、独立构建、独立分发），与主应用只共享**源码级的加密原语**（`tools/secure-config` 作为纯函数库被两边引用，但主应用只 import 验签部分）。B3 可作为开发者本机的临时形态，但**不得用于对外签发**。

### 8.3 功能（三个标签页，够用就好）

1. **配置**：列出当前配置（脱敏显示）· 生成/轮换密钥 · 加密（明文 JSON → `app-config.enc`）· 解密查看 · 校验（字段/地址/端口）· 备份与回滚（带时间戳）。
2. **授权（只有这里能签发）**：读取客户发来的**请求文件**（机器指纹 + 客户信息）→ 选版本/功能/有效期/维护期 → **生成签名授权文件**；
   本地台账（licenseId / 时间 / 客户 / 指纹 / 有效期，可导出 CSV）；续期与吊销（吊销靠"新授权 + 名单"下发，见 §9.4）。
3. **诊断**：端口探测（37650/37651）· 版本与运行时 · 日志打包导出 · 一键自检（复用主应用的 `--selftest` 结果文件）。

### 8.4 安全铁律（写进断言，不只写进文档）

1. **主应用不含签发路径**：主应用 bundle 内**不得出现**私钥读取/签名函数符号 → 由 `verify` 做"符号/字符串扫描"断言
   （`grep` 主 bundle 里不得有 `signLicense`、`privateKey`、`ed25519.sign` 之类）。
2. **私钥不进仓库、不进安装包**：只在运营机以口令加密的密钥文件存在；仓库里连测试私钥都不放（用"一次性生成的测试密钥对"跑单测）。
3. **工具箱不进客户分发**：`release/` 的客户包里没有工具箱；更新通道的 manifest 只描述主应用。
4. **主应用侧只有两件事**：生成请求文件（只读机器指纹，不联网）与导入授权文件（只验签）。
5. 工具箱默认不联外网（除"打开下载页"这类显式动作）。

---

## 9. 授权体系（License）设计

### 9.1 威胁模型（先说清防谁）

| 防 | 不防 |
|---|---|
| 把安装包/授权文件随手拷给同事直接用 | 铁了心的逆向（本地离线校验必然可被 patch） |
| 一台授权多机使用 | 虚拟机克隆的指纹伪装 |
| 改一个字节伪造授权 | 打补丁绕过校验 |
| **客户自己给自己签发授权**（→ 由 §8 的"签发/分发物理分离"防住） | — |

设计目标：**让"正常使用必须走授权流程"，让破解成本明显高于购买成本**，并且**不牺牲正版用户体验**（离线可用、换机有救济渠道）。

### 9.2 密钥层级（签发能力只在一处）

```
主签名密钥对（Ed25519，长期）
  ├─ 私钥：**只存在于工具箱/运营机**（口令加密的密钥文件）；不进仓库、不进任何安装包
  └─ 公钥：内置到主应用（与工具箱的"验证页"）用于离线验签

配置加密密钥（AES-256-GCM 的 `buildKey.mjs`）：与授权**无关**，只用于"防误看"配置文件 —— 两者不要混为一谈
```

**推论**：授权文件只能由持有私钥的运营机产生；客户机器上"能看到授权、能导入授权、能验证授权"，但**没有任何路径能生成授权**。

### 9.3 文件契约

**① 请求文件**（客户/运营在目标机器生成，`.req.json`）：
```jsonc
{ "v": 1, "product": "visual-editor", "requestId": "uuid",
  "machine": { "fingerprint": "sha256:…", "os": "windows", "hostnameHash": "…" },
  "app": { "version": "0.3.0", "channel": "stable" },
  "customer": { "name": "…", "email": "…", "note": "…" } }
```
指纹构成：CPU/主板/系统盘的稳定标识 + 产品盐做 SHA-256；**不采集**用户名、文档内容、MAC 列表等隐私。

**② 授权文件**（`.lic.json`，工具箱签发）：
```jsonc
{ "v": 1, "licenseId": "…", "edition": "pro",
  "features": ["export.docx", "export.pdf", "plugin.sign", "whiteLabel"],
  "machine": { "fingerprint": "sha256:…" },        // 或 { "floating": true }
  "issuedAt": "…", "notBefore": "…", "expiresAt": "…",
  "maintenanceUntil": "…",                          // 覆盖到哪个版本（与更新通道联动）
  "maxSeats": 1, "notes": "…" }
```
外加 `sig`：对**规范化 JSON**（键排序、无空白）的 Ed25519 签名（base64）。

### 9.4 校验与执行点

| 时机 | 行为 |
|---|---|
| 启动 | 验签 → 校验 `notBefore/expiresAt/machine` → 缓存结果（不每次读盘） |
| 关键功能（导出 docx/pdf、组件包签名、白标） | 走"功能门"检查 `features`；无授权时**功能可见但点击提示如何授权**（不藏功能） |
| 时钟回拨 | 记录最近一次运行时间；回拨超过阈值（如 24h）→ 标记异常并要求重新校验 |
| 换机 | 指纹不匹配 → 提示"联系获取新授权"（内部台账允许 1 次免费重签） |
| 更新 | 更新器检查 `maintenanceUntil` 是否覆盖目标版本，否则提示续期（不阻断安全更新） |

### 9.5 版本分级与免费策略（建议）

- **社区版**（无需授权）：编辑器全部编辑能力、导出 HTML/JSON、外部组件热加载、MCP 的**只读**工具。
- **专业版**（需授权）：导出 Word/PDF、批量导出、组件包签名与分发、白标/自定义品牌、MCP **写**工具批量操作。
- 理由：把"基本创造能力"免费，授权门槛放在**交付/量产/商用**环节——符合常见桌面工具的做法，也不会把
  现在用得很顺的 MCP 工作流一刀切断（MCP 只读仍免费）。

### 9.6 落地拆解（每步可独立交付；**签发只在工具箱**）

| 步 | 内容 | 谁的代码 | 产物/验证 |
|---|---|---|---|
| L1 | 指纹与文件契约定稿（含规范化 JSON 规则、请求/授权两个格式） | `tools/secure-config`（纯函数库，两边共用） | `fingerprint.mjs` / `license-format.mjs` + 单测（自检）；测试用**一次性生成**的密钥对 |
| L2 | CLI：`--request`（生成请求）· `--issue`（签发）· `--verify`（校验） | `tools/secure-config` | 命令行跑通；篡改一字节必失败（断言） |
| L3 | **主应用**接入：启动校验 + 功能门 + 生成请求文件 + 导入授权 + 「关于」显示许可状态 | `apps/desktop` + `web-editor`（**只 import 验签与请求部分**） | `verify` 断言：主 bundle 里**没有**签发/私钥符号；无授权时导出 Word 被拒且提示可读 |
| L4 | **工具箱**（独立应用）「授权」页 + 「配置」页 + 「诊断」页 | `apps/toolbox`（独立构建、独立产物） | 手工走一遍：客户机生成请求 → 工具箱签发 → 客户机导入 → 导出解锁；工具箱不在客户包里 |
| L5 | 试用与宽限（可选）：首启 14 天试用、到期宽限 7 天只读 | 主应用 | 断言试用期行为 |
| L6 | 运营流程与文档：签发台账、换机重签规则、吊销名单下发 | 工具箱 + 文档 | 写进 README；工具箱导出台账 CSV |

**诚实边界**（写进文档）：离线校验可被 patch；签名只保证"授权文件是真的、没被改过"，不保证"程序没被改过"。
后续若要更强，再考虑在线激活/定期回连（但那会牺牲离线可用性，需另做决策）。

---

## 10. 开发流程与适应性检查（以后继续开发编辑器 / 组件 / MCP）

### 10.1 对照业界做法

| 来源 | 借鉴的规则 |
|---|---|
| [Electron 官方应用菜单](https://www.electronjs.org/docs/latest/tutorial/application-menu) | 标准菜单角色：Edit 必含 cut/copy/paste/delete/selectAll；View 含 zoomIn/zoomOut/resetZoom/togglefullscreen；About/更新在 Help |
| [Figma 插件 API 稳定性](https://developers.figma.com/docs/plugins/stability-updates/) | **新增 = minor**（自动可用）；**改已有 API/行为 = major**（插件**不**自动升级，manifest 里声明 `api` 主版本，旧主版本尽量长期支持）；typings 可变；插件必须容忍**未知枚举**（别在 `default` 里直接抛错） |
| [MCP 规范 · Transports 安全警告](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) | Streamable HTTP：**MUST 校验 `Origin`**（防 DNS rebinding）、本地服务 SHOULD 只绑 127.0.0.1、SHOULD 实现鉴权；无效会话 MUST 回 404（我们的"会话复活"是对该条的**有意偏离**，见 §5.3，需在 README 说明理由） |
| [Cryptlex 离线授权](https://cryptlex.com/docs/licensing-models/offline-licenses) | 离线授权 = 请求文件（密钥+指纹）→ **有有效期的签名响应**→ 本机验签+指纹比对；换机/吊销只在重新下发时生效 |

### 10.2 三条流水线各自的"完成定义"

| 流水线 | 放哪 | 契约规则 | 必须过的闸门 |
|---|---|---|---|
| **编辑器内核**（框架/属性面板/画布/导出） | `web-editor/src/{components,store,utils,registry}` | 只做 **additive** 改动；破坏性改动必须 bump `contract` 主版本并写迁移说明 | `tsc -b` + `npm run build` + `?check=1` + `audit:dark` |
| **组件**（内置/外部插件） | 内置 `src/registry/components/**`；外部 `public/组件/*.js` | 同一个 `ComponentDefinition`；外部插件文件头/注册时声明 `api` 主版本；**新增 propSchema 控件必须让老插件安全忽略** | `plugin.validate` + `plugin.dryRun` + 「重载外部组件」+ `?check=1` |
| **MCP 工具** | `editor-mcp/src/tools/*` | 工具名 `<域>.<动作>` 稳定；**新增工具 = additive**；**新增参数必须可选**；错误码稳定；未知方法**降级不抛** | `tsc -b` + `--list` 数量断言 + `agent-live-check` / `multi-connection` / `session-revive` |
| **桌面外壳** | `apps/desktop/**` | IPC 通道只增不改语义；配置键只增不重命名 | `npm run verify` + 打包 `--selftest` |
| **工具箱 / 授权**（独立应用） | `apps/toolbox/**` + `tools/secure-config/**`（纯函数库） | 签发能力**只**在工具箱；请求/授权文件格式版本化（`v:1` 起），格式变更必须同时兼容旧版本校验 | 独立构建 + 独立 `--selftest`；**主应用 bundle 无签发/私钥符号**（字符串扫描断言）；篡改/过期/换机三类负例断言 |

### 10.3 版本与兼容策略（写进 `contracts/`）

- `productVersion`（对外版本，0.3.0）与 `protocolVersion` / `componentApiVersion` **分开**：前者按发布节奏走，
  后者只在**破坏性协议变更**时 +1（借助 §5.1 的协商，版本不同不再直接废掉 Live）。
- 兼容窗口：`protocol` 旧主版本**至少支持一个里程碑**（写进 CHANGELOG）；组件 `api` 旧主版本长期支持
  （Figma 的做法：老 major 不自动升级、尽量不废）。
- 未知值容错：MCP 遇到未知方法/未知字段 → 降级并记录；插件遇到未知 propSchema 控件 → 忽略该控件但**保留取值**。

### 10.4 质量闸门（一条命令跑完）

```
npm run verify        # 根编排：契约一致 + 版本一致 + 菜单结构 + 安全断言 + 三套子系统闸门 + 打包自检
```

当前已有：`tsc -b`、`vite build`、`?check=1`(295)、`audit:dark`、`verify`(77)、`--selftest`(9)、
`bridge-status`、`agent-live-check`(5)、`multi-connection`(10)、`session-revive`(7)。
本方案新增：契约/版本一致、清单形状、协议兼容、**Origin/鉴权**、**授权门**、菜单结构、路径解析（搬迁后）。

### 10.5 文档与提示词固化

- 新增仓库级 `AGENTS.md`：目录边界 + 单一写入者 + 三条流水线的兼容规则 + 闸门清单。
- 更新 `.dsh/skills/visual-editor-plugin-dev/SKILL.md`：加"外部插件 `api` 版本声明""未知控件容错""清单形状 `files`"。
- DSH 的 a4-doc 预设提示词里仍是旧命名 `mcp__editor__doc_create_<hash>` → 改为"用 `Tool.listTools` 按关键词找
  `mcp__mcp-editor__*`"（该文件在 DSH profile 里，需要你确认后我再改）。

---

## 11. 去冗余清单（合并去向）

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

## 12. 与既有开发提示词的衔接

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

## 13. 落地路线图（大版本重构，逐步拆解）

**版本计划**：`0.2.0` = 已提交的里程碑（Electron 44、Live 修复、会话自愈、多实例、依赖恢复）；
**`0.3.0` = 本次大版本重构**（安全边界 + 单一来源 + 目录重排 + 契约层 + 菜单改版 + 工具箱 + 授权），
一次性发布，`CHANGELOG.md` 写清"对开发者有破坏性、对已安装用户基本无感"；
`1.0.0` 留给"契约与目录冻结、API 稳定"。

### 13.1 阶段总表

| 阶段 | 内容 | 改动面 | 验证口径 | 风险/回滚 |
|---|---|---|---|---|
| **P0 安全**（先行） | Origin 白名单 + Host 校验 + 可选 token + `allowWrite` 默认 false + `config.key` 出库 | `editor-mcp/src/{http.ts,bridge/host.ts}`、`apps/desktop/{src,config,scripts}` | verify 新断言：跨源被拒、配了 token 时无 token 被拒、有 token 通过；`multi-connection`/`session-revive`/`agent-live` 仍全绿 | 中；未配置 token 保持兼容；传输层改动，单独回滚 |
| **P1 单一来源** | ① 清单形状（§5.2）② 协议/能力协商 + 未知方法降级（§5.1）③ `tools/sync-contracts.mjs` 生成版本与方法清单 ④ 表格内核同源 | `editor-mcp/src/{tools/plugin.ts,bridge/*,engine/tableKit.ts}`、`web-editor/src/{registry/live.ts,mcp/*}`、新增 `tools/` | 四件套全绿 + 新断言；`?check=1` 与 108 工具数不变 | 低-中；每项独立提交 |
| **P2 契约层 + 编排** | 根 `package.json`（`setup/build/verify/dist` 一条命令）、`contracts/` 落地（协议/组件契约/配置 schema/版本）、`bundle:mcp` 自带 esbuild | 根编排脚本、`contracts/`、各包脚本 | 一条命令跑完所有闸门；干净克隆可构建 | 中；不移动目录 |
| **P3 目录重排**（§6） | M1–M9 逐条：交付物→`dist/`、发行物→`release/`、运行数据→`var/`、探针入库 `tools/cdp/`、生成物出库、活文档迁移、密钥出库 | 见 §6.5（每条自带"必须同步改"清单） | 每完成一个 M 号跑四件套；完成后走 §6.8 验收 | 高；**一条一个提交**，revert 即回滚 |
| **P4 菜单改版**（§7） | M-1…M-13：首选项归位、关于/更新归帮助、组件包归文件、补剪切/查找/全屏/Ctrl+Y/最近文档、模式入口 | `web-editor/src/components/layout/{MenuBar.tsx,useShortcuts.ts}` + 对应 store 动作 | 菜单结构断言 + 快捷键一致性断言 + `?check=1` 全绿 | 低-中；纯前端，独立提交 |
| **P5 工具箱应用**（§8，**独立应用**） | `apps/toolbox`：配置 / 授权签发 / 诊断三页；独立构建与独立产物；**不进客户分发、不进更新通道**；`tools/secure-config` 作为纯函数库被两边引用 | 新增 `apps/toolbox/**`（自己的 `package.json` 与 electron-builder 目标）、`tools/secure-config` | 独立构建 + 独立 `--selftest`；客户 `release/` 里没有工具箱；主应用 bundle 无签发符号 | 中；全新目录，与主应用零耦合，删除即回滚 |
| **P6 授权体系**（§9） | L1 指纹/契约 → L2 CLI 签发·校验 → L3 主应用（**只验证**：启动校验 + 功能门 + 生成请求 + 导入授权）→ L4 工具箱授权页 → L5 试用 → L6 运营台账 | `tools/secure-config/**`、主应用「关于」与导出门、`apps/toolbox/**` | 篡改一字节被拒、过期/未来时间被拒、换机被拒、无授权时导出 Word 被拒且提示可读；签发文件只能由工具箱产生 | 中-高；分 6 小步，每步可停 |
| **P7 冻结** | `AGENTS.md`、skill 增补、README 索引化、CHANGELOG、断言全部并入 `npm run verify` | 文档 + 闸门 | 新人只读 AGENTS.md + 子 README 能上手 | 低 |

### 13.2 依赖关系（为什么是这个顺序）

```
P0 ─▶ P1 ─▶ P2 ─┬─▶ P3（目录）
                 ├─▶ P4（菜单）      ← P4/P5 依赖 P2 的契约与编排
                 ├─▶ P5（工具箱·独立应用）─▶ P6（授权：签发只在工具箱、主应用只验证）
                 └─▶ P7（冻结）      ← 所有断言齐了再冻结文档
```

- **P0 不能等**：这是当前唯一的"可被外部网页利用"的口子。
- **P1/P2 是 P3 的地基**：契约与版本先单一来源，再搬目录；否则搬迁期"两份实现 + 多个版本号"会互相掩盖错误。
- **P5/P6 的硬约束**（用户 2026-09-28 明确）：工具箱是**独立应用**，且**签发能力不得进入主应用分发物**——
  所以 P5 先落地"独立应用 + 独立产物"，P6 再把"签发"放在工具箱、把"验证/请求/导入"放在主应用。
  这条约束决定了 P6 不能"先图省事塞进主应用、以后再拆"：一旦随客户包发出去，授权就废了。
- 每个阶段内部都拆成可独立提交/回滚的小步（§6.5、§7.2、§9.6 各自成表）。

---

## 14. 需要你决策的点

1. **token 策略**：未配置时"保持现状 + 警告"（推荐）还是强制？
2. **`allowWrite` 默认值**：分发版默认 `false`（推荐）还是保持 `true`？
3. **Origin 白名单**：放行"无 Origin 的本地进程"、配了 token 时仍要 token（推荐）？
4. **P3 边界**：编译产物留包内、只移交付物/发行物/运行数据（推荐，理由见 §6.3），还是要"彻底版"？
5. **版本号**：本次发 `0.3.0`（推荐）还是直接 `1.0.0`？
6. **菜单改版尺度**：按 §7.3 的目标结构全改（推荐），还是只修 M-1/M-3/M-5/M-6 这几条明显不合理的？
7. **工具箱技术选型**（形态已定：**独立应用**）：B1 独立 Electron（推荐，双击即用、与主应用同栈）／B2 系统 WebView（体积小、多一套工具链）／B3 本地网页 UI（最轻，仅限开发机、不得对外签发）？
8. **工具箱的代码位置**：同一个仓库里的独立包 `apps/toolbox`（推荐，便于共用 `tools/secure-config` 纯函数库），还是**完全独立仓库**（隔离最彻底、但要手工同步契约）？
9. **免费策略**：§9.5 的"社区版免费 / 专业版授权"分级是否认可？（尤其"导出 Word/PDF"是否划入专业版——这直接影响你现在的使用）
10. **授权强度**：接受"离线校验 + 签名 + 指纹"（推荐，离线可用、可被 patch）还是要定期回连在线校验？



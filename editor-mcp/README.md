# editor-mcp —— 可视化编辑器 MCP 服务器

把可视化编辑器（文档 / Web **两模式**、**44 个内置组件 + 3 个外部插件**、**19 种属性控件**、目录自动发现、外部组件热加载、
画布分页、两份全组件示例）的能力，按《可视化编辑器 MCP 服务器》提示词封装成 MCP 服务器，
供 Claude / Cursor / Cline 等客户端用自然语言驱动。

## 当前进度（按规格 §12 阶段划分）

| 阶段 | 内容 | 状态 |
|---|---|---|
| 一 | 工程骨架 + stdio 启动 + 3 个 Tool（`doc.create` / `component.list` / `plugin.list`） | ✅ 已完成 |
| 二 | `bridge/liveBridge.ts`（WebSocket）+ `fallback.ts` 自动降级 | ✅ 已完成（**就绪判定以"编辑器接入数"为准**；`BRIDGE_OFFLINE` 与 `LIVE_FALLBACK` 都会降级） |
| 三 | 文档 / 模式 / 页面 / 画布 / 节点 / 属性六域 Tools | ✅ 已完成 |
| 四 | 组件注册表域 + 表格域（15 个）+ 历史 / 选择 / 导出域 | ✅ 已完成（另加 `component.catalog`：把编辑器注册表快照落成 `component-catalog.json` 供离线用） |
| 五 | 插件域全量（20 个）+ `plugin.dryRun` 沙箱 + 模板/类型/日志/manifest | ✅ 已完成 |
| 六 | Resources（含 Templates 与 Subscriptions）+ Prompts（11 个） | ✅ 已完成（15 静态 + 7 模板 = 22 个 Resource；11 个 Prompt） |
| 七 | 安全模块 + Streamable HTTP transport | ✅ 已完成（速率限制、写开关、`--http --port 37651` 有状态会话） |
| 八 | 编辑器侧 Bridge Server + 菜单开关 + 状态显示 | ✅ **已完成、Live 端到端已跑绿**（`--live --require-live` 20/20）。中转 hub 在 37650，编辑器侧 `web-editor/src/mcp/*` 接菜单与 `?bridge=1`；MCP 启动即接入中转，`editor://bridge/status` 区分"中转可达"与"编辑器已接入"。本轮修掉的问题见下面「阶段八修了什么」 |
| 九 | 端到端测试脚本 + README | ✅ 脚本已就位：`scripts/e2e-scenarios.mjs`（20 个场景，无头全跑、`--live` 拉起无头 Edge 跑 Live 场景）；本文档即 README |

能力总计：**Tools 108 个**（+`doc.attach`、`asset.embed`、`asset.embedFromHtml`、**`export.docx`**）、Resources 23、Prompts 12（+`html_to_document`）。
7 个 smoke 脚本（`smoke` / `bridge-smoke` / `tools-smoke` / `table-smoke` / `plugin-smoke` / `rpc-smoke` / `http-smoke`）全部通过。
端到端：`node scripts/e2e-scenarios.mjs --live --require-live` → **21/21 全部通过**（`Live 就绪=true`，判定耗时约 1 秒）。

## ★Agent 约定：要往编辑器里写，先看当前文档空不空（2026-09-29）

**背景**：编辑器里有"文档 / 页"两层概念 ——
- **工作区文档**（`<workspace>/<docId>.editor.json`）：无头通道读写，`doc.create/open/close/delete/duplicate` **只能**走这条；
- **编辑器里打开的文档**：UI 管理；`node.*` / `table.*` / `page.*` / `property.*` 这些写操作走 **Live**，**永远落在"当前打开的那一份"**上。
  （`doc.open/close/delete/duplicate` 在编辑器侧**有意不做 Live**：桥接不替用户重置/删除编辑器内容。）

所以"我要新建一份来写"在 Live 下没有直接入口。**约定如下**：

| 步骤 | 调用 | 说明 |
|---|---|---|
| ① 挂到编辑器当前文档 | `doc.attach` | 之后省略 `docId` 的调用都作用在它上面；返回 `via: "live"` 才算接上 |
| ② 看它空不空 | `doc.get` / `doc.summary` | `counts.documentNodes + counts.webNodes === 0`（或 `nodes === 0`）就是**空文档** |
| ③ 空 → 直接写 | `node.add` / `table.setData` … | 写进当前文档 |
| ③′ 非空 → 先新建一页 | **`doc.create`**（Live 可用） | 在**编辑器里新建一页并切过去**；语义与 UI 的「＋」一致：当前只有空白页就替换它，否则**新增一页**（纯增量，绝不删既有内容）。返回 `created: "editor-page"` |
| ④ 再写 | `node.add` … | 写进刚新建的那页 |

写操作需要 `EDITOR_MCP_ALLOW_WRITE=true`（桌面版首选项里有开关；默认关，写工具返回 `WRITE_DISABLED`）。
组件属性键要用**组件的真实 schema**（例：段落的正文键是 `html` 不是 `text`，写错键会被静默存下、界面仍显示占位符）——
拿不准就先 `component.schema`，或直接用 `node.settext`（自动挑 `text/html/items/caption`）。

## 能力声明：组件该怎么用（2026-09-23 补）

**为什么要专门写这块**：照着一份现成 HTML（《江苏誉创_金卫智慧舱_AGV方案_V5.0》）建文档时，
目录被做成了 `list`（Word 列表）而不是「目录」组件，图片留成了 `__AGVIMG1__` 占位符。
复盘下来两条原因不同：

| 现象 | 原因 | 处理 |
|---|---|---|
| 目录用 `list` 而不是 `toc` | **声明缺失**：源 HTML 里目录就是个 `<ol>`，而 prompts / 资源里**没有任何一句话**说"目录要用 toc 组件" —— 不是模型乱来 | 新增资源 **`editor://spec/doc-rules`**（判定规则表）+ `create_document` 里补"需要目录用 toc、别用 list 冒充" + 新增 Prompt **`html_to_document`**（搬 HTML 的映射规则：目录→toc、ol/ul→list/bullets、img→image…） |
| 5 张图没进来（占位符） | **payload 考虑**：源里 5 张图是内嵌 `data:image/...;base64`，直接回传会吃掉大量上下文 —— 这个理由是成立的 | 补两个**服务端**工具：`asset.embed { nodeId, path }`（本地图片文件）与 `asset.embedFromHtml { htmlPath, index, nodeId }`（HTML 里的第 N 张内嵌图，不给 index 先列清单）。base64 由服务端直接写进节点属性，**回包只给字节数/格式** —— 图片与 token 两边都不用牺牲 |

读边界（`asset.*` 的取舍）：**读**允许调用方指定的本地路径（这是"把用户手上的图搬进来"的前提），
但有图片后缀白名单 + 体积上限（`EDITOR_MCP_ASSET_MAX_MB`，默认 20MB）+ 每次调用记审计；
**写**仍只允许工作区/插件目录（`assertInside` 不变）。

## 阶段八修了什么（2026-09-23，Live 端到端从"跑不绿"到全绿）

按"症状 → 真因 → 修法"记下来，避免以后再踩：

| # | 症状 | 真因 | 修法 |
|---|---|---|---|
| 1 | 编辑器明明接上了，`editor://bridge/status.ready` 一直 false，等 30s 超时后才"突然"变 live | MCP 侧的 LiveBridge **只在第一次 live 调用时才惰性连接**；没人连中转，就没有任何人把"编辑器已接入"告诉它（hub 的 `bridge.editor` 广播它没订阅到） | `index.ts` 起完 hub **立刻** `liveBridge.start()`；`editor://bridge/status` 先 `ensureReady()` 再报状态（不再假阴） |
| 2 | 状态里分不清"连不上中转"和"中转在、编辑器没开" | `status()` 只有 `connected`/`ready` | 增加 `hubNoEditor` / `running` 字段 + `situation` 一句话说明；`ready=false` 时能一眼看出是哪一种 |
| 3 | 请求**编辑器里没打开的**文档时，返回的是"编辑器当前文档"的内容（静默给错数据） | 编辑器侧 `doc.get` 等忽略 `docId`，直接拿当前 doc 顶上 | `liveMethods.routeLive` 顶部加**文档域守卫**：`docId` 不是编辑器当前文档 → 抛 `LIVE_FALLBACK`，交回无头通道（找不到就如实 `DOC_NOT_FOUND`） |
| 4 | 于是"用 MCP 改我正在编辑的文档"没有入口（MCP 会话的当前文档常是无头建的） | 缺一个显式把两者对上的动作 | 新增 Tool **`doc.attach`**（+ 编辑器侧 live 方法）：只读地把 MCP 会话的"当前文档"切到编辑器打开的那份，之后省略 `docId` 的调用就作用在它上面 |
| 5 | `export.json {path}` 在编辑器开着时**不落盘**（文件节点数 = -1） | Live 侧是浏览器，写不了工作区任意路径，只回 JSON 文本 | MCP 侧在 Live 返回 `json` 且请求带 `path` 时**补写盘**，让 `{path}` 的语义与通道无关 |
| 6 | `component.list` 在编辑器开着时也只返回 3 个外部组件 | 它没走 Live（直接读组件目录 + 插件目录），而 `component.get/schema/categories` 走了 | `component.list` 改为**先试 Live**（编辑器是注册表唯一真源，47 个组件），无头再退回目录 + 插件 |
| 7 | 跑完 e2e 留下一堆无头 Edge，下一次跑"1 秒就绪"其实是**上次的残页**连上了新中转 | 收尾只用 `edge.kill()`，渲染进程活着 | 收尾改用 `taskkill /PID <pid> /T /F`（杀整棵进程树），并核对"跑完无残留" |

> 附：本机实测——**新起一个无头编辑器页面约 1 秒内就会接入桥接**。当初"接入 >30s"的判断是错的，
> 真因就是第 1 条（惰性连接）；e2e 的等待上限已从 30s 收到 20s，真出问题会更快失败。

## 规格 vs 实现：已知不一致（如实记录，避免"照着规格写却对不上"）

| # | 规格写法 | 实现 | 处理 |
|---|---|---|---|
| 1 | 编辑器侧"新增一个 WebSocket **服务**" | **浏览器页面不能监听端口** → 37650 上是本进程起的**中转 hub**，编辑器与 MCP 都作为客户端接入 | 已按此实现并在 `bridge/host.ts` 注释说明 |
| 2 | `reactJsxRuntime` 用 React **自动运行时**签名 | 编辑器只暴露 `React`；`reactJsxRuntime` 给的是**经典签名**（`createElement`） | 规格示例本身就是经典签名写法；`plugin.validate` 会提示不要用自动运行时签名 |
| 3 | `doc.create/open/close/delete/duplicate` 走 Live | 编辑器**有意不做**（避免毁掉用户未保存的文档）→ 返回 `LIVE_FALLBACK`，MCP 侧**静默降级到无头**并标 `degraded: true` | 已实现；`history.snapshot/restore/clear`、`mode.set('ppt')` 同理 |
| 4 | MCP Prompt 参数是"任意类型" | SDK 在**协议层**要求 string | 11 个 Prompt 的参数全部 `z.string()` / `z.enum` |
| 5 | 三模式（含 `ppt`） | 编辑器是**两模式**（文档 / Web）；PPT 是**组件分类**不是模式 | `mode.list` 如实返回三条并注明；`mode.set('ppt')` 走 `LIVE_FALLBACK` |
| 6 | `@editor/core` 共享 reducer | 未抽包 → MCP 侧是**平行实现**（`engine/session.ts` + `engine/tableKit.ts`），靠"同一套测试用例"钉住一致性 | 已在 README 说明；表格转义/A1 语义与编辑器 `tableKit` 一致 |


## 运行

```powershell
cd E:\可视化编辑器\editor-mcp
npm install          # 装 @modelcontextprotocol/sdk 与 zod
npm run build        # tsc -b → dist/
npm start            # = node dist/index.js --stdio

# 只看能力清单（不启动传输，用于核对注册了哪些 Tool）
node dist/index.js --list

# 调试：把每条消息摘要打到 stderr
node dist/index.js --stdio --debug
```

MCP 客户端配置（以 stdio 为例）：

```json
{
  "mcpServers": {
    "editor-mcp": {
      "command": "node",
      "args": ["E:\\可视化编辑器\\editor-mcp\\dist\\index.js", "--stdio"]
    }
  }
}
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `EDITOR_MCP_BRIDGE_URL` | `ws://127.0.0.1:37650` | Live Bridge 地址（阶段二起真正连接） |
| `EDITOR_MCP_WORKSPACE` | `<仓库根>/var/mcp-workspace`（P3-M5 起；原 `editor-mcp/workspace`） | 无头模式的文档目录（`<docId>.editor.json`） |
| `EDITOR_MCP_PLUGIN_DIR` | `web-editor/public/组件` | 外部插件目录 |
| `EDITOR_MCP_ALLOW_WRITE` | `true` | `false` 时所有写操作返回 `WRITE_DISABLED` |
| `EDITOR_MCP_RATE_LIMIT` | `100` | 单客户端每分钟调用上限（阶段七生效） |
| `EDITOR_MCP_BACKUP_KEEP` | `5` | `plugin.update` 备份保留个数（阶段五生效） |
| `EDITOR_MCP_ASSET_MAX_MB` | `20` | `asset.embed*` 单个图片文件的体积上限（MB） |

## 目录

```
editor-mcp/
├─ src/
│  ├─ index.ts          入口：--stdio / --http / --list / --debug
│  ├─ server.ts         McpServer 实例 + 能力注册
│  ├─ config.ts         环境变量 + **路径白名单** assertInside() + 写开关
│  ├─ errors.ts         规格 §9 的 17 个错误码 + 统一返回体 + runTool 外壳
│  ├─ log.ts            日志走 stderr（stdout 是 JSON-RPC 通道）+ audit.log + --debug
│  ├─ bridge/
│  │  ├─ host.ts        中转 hub（37650）：两侧都当客户端接进来
│  │  ├─ liveBridge.ts  MCP 侧的桥接客户端（MCP 启动即接入；`bridge.editor` 推送驱动 Live/无头切换）
│  │  ├─ fallback.ts    双通道降级 + 状态摘要（`bridgeSummary` / `bridgeSummaryLive`）
│  │  └─ headless.ts    无头引擎：与编辑器「导出 JSON」同格式的文档读写（原子写）
│  └─ tools/
│     ├─ index.ts       汇总注册（108 个 Tool）
│     ├─ document.ts    doc.*（含 doc.attach：接上编辑器当前文档）
│     ├─ asset.ts       asset.embed / asset.embedFromHtml：本地图 / HTML 内嵌图 → 节点（base64 不过模型上下文）
│     ├─ component.ts   component.list（Live 优先，无头退回目录 + 插件）
│     └─ plugin.ts      plugin.*（+ 共用的 scanPlugins）
└─ workspace/           默认文档目录（git 忽略）
```

## 两条说明（避免误解）

1. **`component.list` 不编造内置清单**。内置组件的真源是编辑器里的注册表：**桥接一开就由它提供**
   （`via=live`，实测 47 个 = 44 内置 + 3 外部）；没有编辑器时退回工作区里的 `component-catalog.json`，
   两者都没有才只返回插件目录里的外部组件，并在 `note` 里说明缺什么。
2. **`doc.create` 走无头**（编辑器有意不替用户新建/打开文档，见「已知不一致」第 3 条），所以返回 `degraded: true`；
   生成的文件与编辑器「导出 JSON」同格式，可以直接用编辑器打开。
   **想改用户正在编辑的那份文档，先 `doc.attach`**（把 MCP 会话的当前文档切到编辑器打开的那份），
   之后的 `node.*` / `property.*` / `page.*` / `history.*` 等省略 `docId` 的调用就会落到编辑器页面里（`via=live`）。

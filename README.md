# 可视化编辑器（工作区根目录）

本目录是**独立工作区根目录**，现在是三个应用 + 一个工具 + 一个工作区 Skill：

| 目录 | 是什么 |
|---|---|
| `web-editor/` | **主产品**：React + TypeScript 可视化编辑器（文档模式 / Web 模式双模，A4 排版 / 导出 HTML·Word·React / 外部热加载组件 / MCP Live 联动） |
| `editor-mcp/` | **MCP 服务器**：把编辑器接到 MCP 客户端（无头文档读写、组件/插件/资产/导出通道），Live 时通过本机桥接 hub `ws://127.0.0.1:37650/bridge` 与编辑器页面联动。分发版由 `apps/desktop/scripts/bundle-mcp.mjs` 打成**自包含单文件**（108 工具 / 23 资源 / 12 提示词），因为本机这份 `node_modules` 是指向 DSH pnpm store 的符号链接、装不进安装包 |
| `apps/desktop/` | **桌面分发版**（Electron 外壳）：双击即用 —— 内置静态服务器（`启动编辑器.py` 的 Node 等价物）+ 随应用启动的 MCP（`http://127.0.0.1:37651/mcp`）+ 预留更新接口；配置（含更新地址）用**加密配置文件**保存。窗口是**无边框 + 标题栏覆盖**（只有一条菜单：文件/编辑/视图/页面/工具/帮助，系统的 − □ × 与网页融为一体），参考图 `apps/desktop/docs/界面-单层菜单.png` |
| `tools/secure-config/` | **独立的加密配置工具**（零依赖，一个文件）：`keygen` / `encrypt` / `decrypt` / `verify` / `embed-key` / `selftest`。桌面版只 `import()` 它的解密函数，**不复制 crypto 代码** |
| `.dsh/skills/visual-editor-plugin-dev/` | 本工作区的 Skill：给编辑器新增/修改**组件与插件**的规范与验收清单 |

> 目录里没有数据库、也没有服务端：数据只有三层（浏览器 `localStorage` 的设置/日志/取色板、磁盘上的导出文件、
> 内存态的 MCP 桥接 hub）。详见 `web-editor/README.md` 的「存储：这个产品用什么"数据库"」一节。

## 怎么跑

### 一条命令（根目录，P2 起）

```powershell
cd E:\可视化编辑器
npm run setup          # 三个包各自装依赖（首次；apps/desktop 要下 Electron）
npm run build          # 生成契约 → MCP 编译 → 编辑器构建 → MCP 单文件打包
npm run verify         # 默认闸门（快）：契约一致 + 两端编译 + 单测 + 打包 + 服务器契约 + 桌面 verify
npm run verify:full    # 再加各 smoke / 页面自检(约 3 分钟) / PDF 样张 / Word 端到端
npm run dist           # 打 Windows 发行物
```

编排逻辑在 `tools/orchestrate.mjs`（每步打印结论、失败给可行动提示）。**文档里不再抄各项数字**
——以 `npm run verify` 的输出为准（抄数字是过期最快的一类文档）。

### 分头跑（调试单个包时）

```powershell
# web-editor：静态托管已构建的 dist（Python 降级启动器；规范实现是 apps/desktop/server/webServer.js）
D:\Python313\python.exe "E:\可视化编辑器\web-editor\启动编辑器.py" -p 5179
cd E:\可视化编辑器\web-editor ; npm run build        # 重新构建

# editor-mcp：stdio 起（DSH 里通常按 ~/.dsh/profiles/web/cordis.patch.yml 起）
cd E:\可视化编辑器\editor-mcp ; node dist/index.js --stdio

# apps/desktop：窗口 / 自检 / 无界面验证 / 打包
cd E:\可视化编辑器\apps\desktop
npm start ; npm run selftest ; npm run verify ; npm run dist
```

### 端口：**唯一出处**（其余 README 请指到这里，别各写一份）

| 端口 | 用途 | 代码里的权威位置 |
|---|---|---|
| **37650** | MCP ↔ 编辑器的桥接 hub（WebSocket） | `editor-mcp/src/config.ts` 的 `bridgeUrl` |
| **37651** | MCP 的 Streamable HTTP（agent 连这个） | 桌面壳注入的 `mcp.httpPort`（`apps/desktop/config/`） |
| **5179** | 编辑器的静态服务器（桌面版内置；Python 启动器同款默认值） | `apps/desktop/server/webServer.js` 的 `DEFAULT_PORT` |

> `apps/desktop/scripts/verify-desktop.mjs` 有三条断言盯着它：JS 与 Python 的默认端口一致、
> 根 README 写出了权威端口、任何 README 都不许出现"第三个"端口号。

**改更新地址（不用改代码、不用重新打包前端）**：编辑 `apps/desktop/config/app-config.example.json` 里的
`update.baseUrl` → `node apps/desktop/scripts/embed-key.mjs` → 重新打包；现场换服务器则直接替换安装目录里
`resources/config/app-config.enc`。详见 `apps/desktop/README.md`。

## 自检 / 测试怎么跑

| 对象 | 入口 | 说明 |
|---|---|---|
| 全部 | `npm run verify`（根） | 默认闸门；`--full` 加各 smoke 与端到端。**各项数字以它输出的结论为准** |
| web-editor | `http://127.0.0.1:5179/?check=1` 或 `npm --prefix apps/desktop run check:page` | 端到端断言（数据层 / 渲染 / 真实指针交互 / 分页页码 / 打印 / 导入导出 / 热加载 / 暗色审计 / 菜单与快捷键），报告渲染在页面右下角并写进 `document.title`（无头读它有 `check:page`，用 CDP） |
| web-editor | `?demo=1` / `?diag=1` / `?prefs=1` / `?spec=1` / `?load=<地址>` / `?loadJson=<地址>` / `?theme=monokai` / `?printdebug=1` / `?scroll=N` / `?select=<类型>` / `?exportPdf=<路径>` / `?exportDocx=<路径>` | 示例文档 / 诊断面板 / 首选项 / 组件说明清单 / 载入 HTML / 载入工程 JSON / 深色主题 / 打印排障 / 滚动定位 / 选中某类组件 / 导出 PDF / 导出 Word（后两条供脚本化验收用） |
| 导出物 | `npm --prefix apps/desktop run check:pdf` / `node apps/desktop/scripts/docx-word-check.mjs` | PDF 空白页固定样张矩阵（PyMuPDF 逐页判定） / Word 语义端到端（**真 Word** 转 PDF 后复核） |
| 静态服务器 | `npm --prefix apps/desktop run check:server` | 端点集 JS↔Python 一致 + 五个 `/__*` 接口形状 + 路径穿越/内部文件两条负例 |
| editor-mcp | `node editor-mcp/scripts/*.mjs`（auth / session / multi / bridge / tools / table / http / plugin / rpc） | 鉴权、会话自愈、多实例、桥接协议协商、工具面与插件沙箱等冒烟检查（详见 `editor-mcp/README.md`） |
| tools/secure-config | `node tools/secure-config/secure-config.mjs selftest` | 加密工具自检（往返 / 错密钥 / 篡改密文 / 篡改头部 AAD / 口令模式 / 密钥形状 / 来源优先级 / CLI） |
| 契约 | `node tools/sync-contracts.mjs --check` | 版本 / 协议 / 方法清单 / 环境变量 / 表格内核同源：与源不一致就退出 1 |


> ⚠ 无头跑 `?check=1` 要用**真实时间**等它跑完（自检靠一串 `setTimeout` 链 + 异步交互，全程约 2–3 分钟）；
> 用 `--dump-dom --virtual-time-budget` 取标题会**在第一段 `finish()` 就 dump**，那时只有 17 条却显示「17/17 全部通过」。
> 可靠做法见 `web-editor/README.md` 顶部（`logs/cdp-eval.mjs` + `logs/probe-selfcheck.js`，两者在 gitignore 的 `logs/` 下）。

## 版本管理（git）

本工作区自 2026-09-23 起用 git 管理（仓库级身份 `Sxdok <Sxdok@outlook.com>`），
`node_modules` / `dist` / `*.tsbuildinfo` / `__pycache__` / `web-editor/logs` 已在 `.gitignore` 中排除。

| 提交 | 内容 |
|---|---|
| `f3a3cbc` | 迁移后的基线快照（当时的两个编辑器 + 工具 + 验证证据，迁移后未改动）。⚠ 该提交的作者是迁移时的占位身份 `DSH local <dsh@localhost>`，其后提交为 `Sxdok <Sxdok@outlook.com>` |
| 后续提交 | ① 删除过时文件 ② 合入 A4 组件与三段式页码 ③ 文档描述修正 ④ 大文档配额 / 拖拽导入 / 提示条 / 保存开关等（见 `git log`） |
| `4818d23` | **清理前的最后一个提交**（见下节） |

## 迁移与清理记录

**迁移（2026-09-23）**：两个编辑器连同工具/证据从 `E:\HikRobot\{A4编辑器,web-editor}` 与 `E:\HikRobot\_萃取\newdoc`
整体搬到本目录（原目录已移走，不再保留副本）。两个应用内部一律用相对路径 / `__file__` 定位，
**源码中没有写死旧绝对路径**。规模核对：A4编辑器 0.4 MB / 70 文件；web-editor 103.0 MB / 7523 文件（含 node_modules 100.8 MB）。

**清理（2026-09-24，用户要求「确认一下有没有牵连和用处，没有就删了」）**：
逐项核对后删除下面 5 项 —— 核对方法是**全仓检索引用**（两个应用的源码/脚本/配置、工作区 Skill、DSH 配置）
+ 确认没有活进程在用（A4 编辑器端口 8080 无监听）+ 确认 MCP 的工作区是 `editor-mcp/workspace`（不是根 `docs/`）：

> 注：下表的 `tools/` 指的是**当时被删掉的那个旧 `tools/`**（一次性脚本与打印验证工具）。
> 现在仓库里的 `tools/secure-config/` 是 2026-09-25 新建的加密配置工具，与它无关、也没有继承关系。

| 已删 | 规模 | 为什么要删（核对结论） |
|---|---|---|
| `A4编辑器/` | 67 文件 / 0.2 MB | 旧的单文件 HTML 编辑器，已被 `web-editor` 全量取代；它的 `组件/*.js` 与现编辑器的 live 组件格式**互不兼容**，没有可复用资产；源码/脚本/Skill 对它**零引用**（只有两份 README 把它当"对照对象"与"怎么跑"，已改写） |
| `docs/验证证据/` | 74 文件 / **25.8 MB** | 开发期的截图与 PDF 证据，已被 `?check=1`（282 条）与 `web-editor/logs/` 的现役证据取代；无代码引用 |
| `tools/` | 44 文件 / 0.4 MB | ① `legacy-scripts/`（42 文件）是一次性脚本与源材料缓存，**路径写死指向已不存在的 `E:\HikRobot\...`**，其 README 自己标注"仅作历史记录"；② `check_print.py`（唯一的 PDF 级打印验证）现在**跑不完**：控制台 GBK 编码下打印带 `✗` 的结果即 `UnicodeEncodeError` 崩溃，且"界面残留"关键词表已与 `?demo=1` 的实际文案脱节 |
| `迁移记录.txt` | 5.6 KB | 迁移脚本的输出记录（规模/指纹/校验），内容要点已并入本节的"迁移"段 |
| `复核记录.txt` | 6.8 KB | 对迁移记录的独立复核（偏差与修正），结论已并入本节的"迁移"段 |

**恢复办法**（这些文件都完整存在于 git 历史里，随时可取回）：

```powershell
cd E:\可视化编辑器
# 全部取回（回到清理前）
git checkout 4818d23 -- A4编辑器 docs tools 迁移记录.txt 复核记录.txt
# 只取回某一份，例如那个 PDF 级打印验证工具
git show 4818d23:tools/check_print.py > check_print.py
# 或直接看当时的目录树
git ls-tree -r --name-only 4818d23 | Select-String "A4编辑器|验证证据|tools"
```

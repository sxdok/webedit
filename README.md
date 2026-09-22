# 可视化编辑器（A4 编辑器 + Web 编辑器）

本目录是本次开发成果的**独立工作区根目录**：两个可视化编辑器应用 + 开发期间用到的工具/测试脚本 + 验证证据。
在 DSH 里新建工作区时，**根目录建议就填这个目录**（`E:\可视化编辑器`），一个工作区即可覆盖两个应用与全部工具。

## 目录结构

```
E:\可视化编辑器\
  ├── A4编辑器\              单文件 HTML 编辑器（a4_editor.html + js/ 模块 + 组件/ 热加载目录）
  │   ├── a4_editor.html      入口（双击即可用浏览器打开）
  │   ├── js\                 20 个功能模块
  │   ├── 组件\               运行时热加载组件目录（改完点「重载外部组件」，无需构建）
  │   ├── 启动编辑器.py        本地静态服务器（推荐用这个打开，组件热加载/端口可控）
  │   └── README.md           该应用的完整说明（功能/组件清单/自检/操作）
  ├── web-editor\            React + TypeScript 可视化编辑器（文档模式 / Web 模式双模）
  │   ├── src\                源码（registry 组件注册表 / store 状态 / canvas / panels）
  │   ├── public\组件\       外部热加载组件（普通 JS，改完点「重载外部组件」）
  │   ├── dist\               构建产物（启动器默认服务这里）
  │   ├── node_modules\       依赖（已随迁移一起搬，离线可直接构建）
  │   ├── 启动编辑器.py        本地服务器 + SPA 回退 + /__components 清单
  │   └── README.md           该应用的完整说明（架构/打印契约/导出/热加载/验收对照）
  ├── tools\                  针对两个应用写的工具与测试脚本
  │   ├── check_print.py      打印分页验证（无头 Edge 打 PDF 后断言页尺寸/内容起点/界面残留/柱状图）
  │   ├── legacy-scripts\    开发期间用过的一次性脚本与源材料缓存（详见其中 README）
  │   └── README.md
  ├── docs\验证证据\          自检报告、打印/界面截图与 PDF（本对话里引用的验证证据）
  ├── 迁移记录.txt            迁移时的规模核对记录（含事后复核的修正）
  ├── 复核记录.txt            对"工作区 vs 对话记录"的独立复核（实测数据 + 发现的偏差）
  └── .gitignore              忽略 node_modules / dist / tsbuildinfo / __pycache__
```

## 怎么跑

**A4 编辑器**（单文件应用，无需构建）

```powershell
D:\Python313\python.exe "E:\可视化编辑器\A4编辑器\启动编辑器.py" -p 8080
# 浏览器打开 http://127.0.0.1:8080/ ；直接双击 a4_editor.html 也能用（组件热加载需要服务器）
```

**web-editor**（React 应用，已有 dist 与 node_modules）

```powershell
# 直接跑（用已构建的 dist）
D:\Python313\python.exe "E:\可视化编辑器\web-editor\启动编辑器.py" -p 5179
# 重新构建后再跑
cd E:\可视化编辑器\web-editor ; npm run build
```

## 自检 / 测试怎么跑

| 对象 | 入口 | 说明 |
|---|---|---|
| web-editor | `http://127.0.0.1:5179/?check=1` | **50 条端到端断言**（数据层/渲染/交互/打印/导出/热加载/验收项），报告渲染在页面左下角；打印该页可导出完整报告（PDF 里能看到全部 PASS/FAIL） |
| web-editor | `?demo=1` / `?diag=1` / `?theme=monokai` / `?printdebug=1` / `?scroll=N` | 示例文档 / 诊断面板 / 深色主题 / 打印排障 / 滚动定位 |
| A4 编辑器 | 应用内「自检」按钮（或 `?selftest=1`） | 37 条自检，报告可复制/打印 |
| 打印（两个应用） | `python tools\check_print.py` | 对 web-editor 打印结果做客观断言（页尺寸、内容起点、是否混入界面元素、柱状图是否输出） |

## 迁移说明

- 迁移时间：2026-09-23；来源：`E:\HikRobot\A4编辑器`、`E:\HikRobot\web-editor`（原目录已移走，不再保留副本）
- 规模核对（迁移前后一致）：A4编辑器 0.4 MB / 70 文件；web-editor 103.0 MB / 7523 文件（含 node_modules 100.8 MB）
- 另从 `E:\HikRobot\_萃取\newdoc` 收集：工具脚本 1 个、开发期脚本与源材料缓存 41 个、验证证据 41 个（截图/PDF）
  —— 这三项是**迁移脚本当时的记账口径**，事后复核实际为：`tools` 44 文件（含 2 份 README）、`legacy-scripts` 42 文件（41 个脚本 + README）、`docs\验证证据` 42 文件；两个应用本身的数目与全部指纹当时即精确。详见 `迁移记录.txt` 的「修正与复核」段与 `复核记录.txt`。
- 两个应用内部一律用相对路径 / `__file__` 定位，**已确认源码中没有写死旧绝对路径**（仅 README 里的命令示例已更新为新位置）
- `tools\legacy-scripts` 里的历史脚本**保留了当初的绝对路径**（它们指向旧的 `E:\HikRobot\...` 源材料），仅作记录，重新运行前需按需改路径

## 版本管理（git）

本工作区自 2026-09-23 起用 git 管理（仓库级身份 `Sxdok <Sxdok@outlook.com>`），`node_modules` / `dist` / `*.tsbuildinfo` / `__pycache__` 已在 `.gitignore` 中排除。历史里的关键提交：

| 提交 | 内容 |
|---|---|
| `f3a3cbc` | 迁移后的基线快照（两个编辑器 + 工具 + 证据，迁移后未改动）。**A4 编辑器原有的 3 个 `_bak_*.html` 备份只存在于这个提交里**，需要时 `git show f3a3cbc:"A4编辑器/_bak_editor_pre_split.html" > 文件名` 取回 |
| 后续提交 | 文档描述修正、过时文件清理、A4 组件与三段式页码合入 web-editor（见 `git log`） |

回滚点从"散落的 `_bak_*.html` 文件"改成了 git 历史。

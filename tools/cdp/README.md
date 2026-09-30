# tools/cdp/ —— 浏览器端探针（**入库**，可复用）

这些探针在 2026-09 之前散落在 `web-editor/logs/`（那目录是 gitignored 的运行数据），
每次都靠"翻旧日志找一个能用的脚本"。P3-M6 把**通用**的那几条收进这里，
以后要复现"要真实交互才出现"的问题，从这里开始。

## 常用探针

| 探针 | 用途 | 命令 |
|---|---|---|
| **eval** | 打开页面并执行一段**页面脚本文件**，把返回值打成 JSON；支持真刷新 / 真改视口 / 真改窗口尺寸 / 截图 | `node tools/cdp/eval.mjs "<url>" <jsFile>` |
| **shot** | 截图；可先用一段脚本把界面点成想要的状态再拍 | `node tools/cdp/shot.mjs "<url>" [输出png] [--js pre.js] [--full]` |
| **summary** | 页面脚本：界面关键结构（标题/面板/组件按钮数/纸张尺寸/菜单栏） | `node tools/cdp/eval.mjs "<url>" tools/cdp/probes/summary.js` |
| **selfcheck** | 页面脚本：轮询 `?check=1` 报告**直到稳定**，返回好/总数/失败清单 | `node tools/cdp/eval.mjs "<url>?check=1" tools/cdp/probes/selfcheck.js` |
| **pagetabs-geometry** | 页面脚本：连点「＋」造到 6 页，逐页量分页标签条的几何（标签行高/是否出滚动条/容器高）—— 用于"标签多到出滚动条时被压扁"这类布局 bug 的复现与回归 | `node tools/cdp/eval.mjs "<url>" tools/cdp/probes/pagetabs-geometry.js` |
| **prefs-layout** | 页面脚本：首选项弹窗的布局体检 —— 行内提示长度（>16 字就算超标）、气泡（`data-pref-tip`）数量与是否为空、有没有原生 `title`、控件列右边缘是否对齐、以及 `data-tip-text` 气泡是否**真的弹出**（配合 `--hover` 用真实指针事件） | `node tools/cdp/eval.mjs "<url>/?prefs=1" tools/cdp/probes/prefs-layout.js`；配 `--hover "[data-pref='autoSave'] [data-pref-tip]" --shot var/shots/x.png` 可拍下气泡 |
| **menu-submenu** | 页面脚本：二级菜单 hover 断链体检 —— 父行/面板几何、两者之间那块不属于谁的区域（死区）是谁、离开父项后多久消失（宽限是否达标）、目标项能否命中。配 `--moves` 可用**真实指针**走「导出 → 掠过兄弟子菜单行 → 折回导出面板 → Word 项」这条最坏路径 | `node tools/cdp/eval.mjs "<url>" tools/cdp/probes/menu-submenu.js` |

## 典型用法

```powershell
# 1) 先把编辑器跑起来（任选其一）
D:\Python313\python.exe web-editor\启动编辑器.py -q -p 5179        # 降级备用启动器
# 或：cd apps\desktop ; npm start                                  # 桌面版

# 2) 体检：页面有没有真的渲染出来
node tools/cdp/eval.mjs "http://127.0.0.1:5179/?demo=1" tools/cdp/probes/summary.js

# 3) 完整自检（约 3 分钟；结论与 check:page 一致）
node tools/cdp/eval.mjs "http://127.0.0.1:5179/?check=1" tools/cdp/probes/selfcheck.js

# 4) 交互后截图（先点开图片属性面板的 3 行，再拍）
node tools/cdp/shot.mjs "http://127.0.0.1:5179/?demo=1&select=image" var/shots/image-rows.png `
  --js tools/cdp/probes/summary.js
```

**临时页面脚本**不必入库：写进 `var/` 再用 `--expr "…"` 或给个文件路径即可 ——
`tools/cdp/` 只放**长期有用**的探针（入库意味着要维护它、要能独立跑通）。

## 约定（P3-M4/M6 起的目录分工）

| 东西 | 去哪 |
|---|---|
| 探针**代码** | `tools/cdp/`（入库、可复用） |
| 截图 | `var/shots/`（缺省值；运行数据，不进源码树） |
| 日志 / DOM 转储 / 临时页面脚本 | `var/logs/` |
| 一次性复现脚本 | `var/`（不入库；值得留的再提炼进 `tools/cdp/probes/`） |

## 环境要求

- **无头浏览器**：默认按常见路径找 Edge / Chrome；也可 `CDP_BROWSER=<可执行文件>` 指定。
- 端口：`eval` 用 9400、`shot` 用 9333（可分别用 `CDP_PORT_OFFSET` / `SHOT_PORT_OFFSET` 偏移，便于并行）。
- 探针只**读**页面（除 `--js` 明确让你点击交互外），不会改你的文档；
  临时浏览器 profile 建在系统临时目录，用完即删。

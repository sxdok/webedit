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
| `main.js` | Electron 主进程：启动顺序、窗口、菜单、IPC、退出收尾 |
| `preload.cjs` | 唯一的桥：只暴露 `window.desktop`（看状态 / 查更新 / 开日志目录 / 重启 MCP / 发日志） |
| `server/webServer.js` | `web-editor/启动编辑器.py` 的 **Node 等价物**（分发版机器上不一定有 Python） |
| `src/paths.js` | dev / 安装包两套路径布局；**所有可写数据都落 userData** |
| `src/components.js` | 组件目录落地：分发版把随包组件**种子**拷进 `userData/组件`（安装目录只读，导入组件包要能写） |
| `src/secureConfig.js` | 读加密配置（密钥优先级、解密、默认值兜底、取值校验、脱敏） |
| `src/mcpSupervisor.js` | 拉起 / 探测 / 接管 / 重启 / 收尾 `editor-mcp --http` |
| `src/updater.js` | 预留的更新接口：查清单 → 比版本 → 打开下载地址（自动安装留空挂点） |
| `src/logger.js` | 主进程日志（按天落盘 + 内存环形缓冲） |
| `config/` | 加密配置、密钥、构建期密钥（见下） |
| `scripts/embed-key.mjs` | 一键「生成密钥 → 加密配置 → 嵌入密钥 → 验证」 |
| `scripts/verify-desktop.mjs` | **无界面验证**（65 项，见下） |

## 加密配置（更新地址等都在里面）

```
config/app-config.example.json   ← 明文源（改这个，人看）
config/config.key                ← AES-256-GCM 密钥（base64 的 32 字节）
config/app-config.enc            ← 应用真正读的加密配置
config/buildKey.js               ← 构建期兜底密钥（找不到 config.key 时用）
```

加密/解密由**独立工具** [`tools/secure-config`](../../tools/secure-config/) 完成，本目录**不复制任何 crypto 代码**，
只 `import()` 它的 `decryptConfig()`。要单独升级/搬走这个工具，直接动那一个文件即可。

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

菜单：`工具 → 检查更新… / 打开更新下载页 / 复制 MCP 地址 / 查看 MCP 状态 / 重启 MCP 服务 / 查看当前配置（脱敏）`。

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
npm install          # 会下载 Electron（约 200MB）

npm start            # 跑（读仓库里的 web-editor/dist 与 editor-mcp/dist）
npm run dev          # 同上（显式开发模式，日志里会标 dev）
npm run check        # 以 ?check=1 启动：界面右下角跑数据层/渲染层自检
npm run verify       # 无界面验证（65 项，不需要 Electron）
npm run dist         # 打 Windows 安装包（NSIS + 免安装 portable）
```

`npm run build` 相关：桌面版**不构建前端**，它加载 `web-editor/dist`。改了前端要先去 `web-editor` 跑 `npm run build`。

## 验证（`npm run verify`，65 项）

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
  外链协议白名单；preload 只暴露 `window.desktop`；`extraResources` 齐全。

> 受限沙箱里 **E 段会 SKIP**：`mcpSupervisor` 要捕获子进程的管道输出，沙箱禁止创建命名管道（`spawn EPERM`）。
> 想跑全量就用放宽的文件沙箱执行 `node scripts/verify-desktop.mjs`。

## 打包（electron-builder）

`package.json` 的 `build` 字段已经写好：

* `files`：只有外壳代码进 `asar`；
* `extraResources`：`web-editor/dist`、`web-editor/public/组件`、`editor-mcp/dist` + `node_modules`、
  `tools/secure-config`、`config/app-config.enc` 都放在 **asar 外面**的 `resources/` 下 ——
  子进程要从磁盘跑（asar 里的文件没法 spawn），而且配置文件要能现场替换。
* `win.target`：`nsis`（可选安装目录）+ `portable`（免安装单文件）。

```bash
npm run dist        # 产物在 apps/desktop/release/
```

**尚未做**（后续要跟用户确认的）：
* 代码签名（没有证书，SmartScreen 会提示"未知发布者"）；
* 自动安装（`install()` 挂点）；
* 把 `editor-mcp/node_modules` 用 esbuild 打进单文件（现在整包会大一些，但最稳）。

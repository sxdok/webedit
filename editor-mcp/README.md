# editor-mcp —— 可视化编辑器 MCP 服务器

把可视化编辑器（文档 / Web / PPT 三模式、44 个内置组件 + 外部插件、18 种属性控件、目录自动发现、外部组件热加载）
的能力，按《可视化编辑器 MCP 服务器》提示词封装成 MCP 服务器，供 Claude / Cursor / Cline 等客户端用自然语言驱动。

## 当前进度（按规格 §12 阶段划分）

| 阶段 | 内容 | 状态 |
|---|---|---|
| 一 | 工程骨架 + stdio 启动 + 3 个 Tool（`doc.create` / `component.list` / `plugin.list`） | ✅ 已完成（`tsc -b` 0 错） |
| 二 | `bridge/liveBridge.ts`（WebSocket）+ `fallback.ts` 自动降级 | ⏳ 待做 |
| 三 | 文档 / 模式 / 页面 / 画布 / 节点 / 属性六域 Tools | ⏳ 待做 |
| 四 | 组件注册表域 + 表格域（15 个）+ 历史 / 选择 / 导出域 | ⏳ 待做 |
| 五 | 插件域全量（20 个）+ `plugin.dryRun` 沙箱 + 模板/类型/日志/manifest | ⏳ 待做（本阶段只落了 `plugin.list`） |
| 六 | Resources（含 Templates 与 Subscriptions）+ Prompts（11 个） | ⏳ 待做 |
| 七 | 安全模块 + Streamable HTTP transport | ⏳ 待做（`--http` 现在会明确报"未实现"，不假装可用） |
| 八 | 编辑器侧 Bridge Server + 菜单开关 + 状态显示 | ⏳ 待做 |
| 九 | 端到端测试脚本 + README | 部分（本文件） |

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
| `EDITOR_MCP_WORKSPACE` | `editor-mcp/workspace` | 无头模式的文档目录（`<docId>.editor.json`） |
| `EDITOR_MCP_PLUGIN_DIR` | `web-editor/public/组件` | 外部插件目录 |
| `EDITOR_MCP_ALLOW_WRITE` | `true` | `false` 时所有写操作返回 `WRITE_DISABLED` |
| `EDITOR_MCP_RATE_LIMIT` | `100` | 单客户端每分钟调用上限（阶段七生效） |
| `EDITOR_MCP_BACKUP_KEEP` | `5` | `plugin.update` 备份保留个数（阶段五生效） |

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
│  │  └─ headless.ts    无头引擎：与编辑器「导出 JSON」同格式的文档读写（原子写）
│  └─ tools/
│     ├─ index.ts       汇总注册（阶段一 3 个 Tool）
│     ├─ document.ts    doc.create
│     ├─ component.ts   component.list
│     └─ plugin.ts      plugin.list（+ 共用的 scanPlugins）
└─ workspace/           默认文档目录（git 忽略）
```

## 阶段一的两条说明（避免误解）

1. **`component.list` 不编造内置清单**。内置组件（44 个）的真源是编辑器里的注册表：开桥接后由它提供（阶段八），
   或把 `component-catalog.json` 放进工作区。两者都没有时，它只返回插件目录里的外部组件，并在 `note` 里说明缺什么。
   规格验收第 4 条（返回 48 个组件）要等阶段三/四接通注册表后再满足。
2. **`doc.create` 走无头**（Live Bridge 是阶段二），所以返回 `degraded: true`；
   生成的文件与编辑器「导出 JSON」同格式，可以直接用编辑器打开。

# contracts/ —— 跨包契约（单一来源的落点）

这个目录回答一个问题：**"同一件事实"被多个包引用时，谁是唯一来源、谁只是投影。**

| 文件 | 生成方式 | 唯一来源 | 谁在读 |
|---|---|---|---|
| `version.json` | 生成 | 根 `package.json` 的 `version` ＋ `editor-mcp/src/bridge/protocolGate.ts` 的 `EDITOR_PROTOCOL` | 桌面壳（发行物/诊断/更新）、两端 `version.ts` |
| `bridge-methods.json` | 生成 | `editor-mcp/src/tools/index.ts` 的 `reg(server, '…')` ＋ `web-editor/src/mcp/liveMethods.ts` 的 `case '…'` | 交叉检查"工具面与 live 方法面"有没有漂移 |
| `env-vars.json` | 生成 | `editor-mcp/src/**` 里出现的 `EDITOR_MCP_*` 键 | 桌面壳注入环境变量、运维/agent 排查 |
| 本 README | **手写** | —— | 人 |

生成与校验（**别手改生成物**）：

```bash
node tools/sync-contracts.mjs           # 重新生成
node tools/sync-contracts.mjs --check   # 只校验（不一致退出 1；`npm run verify` 会跑它）
```

## 刻意**不**放在这里的

| 事实 | 为什么不在 `contracts/` | 实际位置 |
|---|---|---|
| **组件与属性契约**（schema / 默认值 / 分类） | 它是**运行时**事实：真源是编辑器注册表（外部组件还会热加载），构建期算不出来 | 编辑器 `?spec=1` 导出说明清单；MCP 侧落盘 `component-catalog.json`（带快照时间） |
| **加密配置 schema** | 与具体发行物的密钥/密文绑在一起，属于桌面壳的部署契约 | `apps/desktop/config/` ＋ `tools/secure-config/` |
| **授权契约**（指纹/期限/功能门） | 属 P6，尚未实现 | 见 `ARCHITECTURE.md` §10 |

## 表格内核（`tableKit.pure.ts`）为什么也不在这里

它是**代码**而不是数据契约，所以放 `web-editor/src/registry/components/common/tableKit.pure.ts` 作唯一手写源，
由 `tools/sync-contracts.mjs` **复制**到 `editor-mcp/src/engine/tableKit.ts`（见 REFACTORING §15.16）。

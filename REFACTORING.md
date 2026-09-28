# 可视化编辑器 0.3.0 重构方案（整合版）

> **文档版本**：0.3.0-plan.1
> **编制日期**：2026-09-28
> **适用范围**：`web-editor` / `editor-mcp` / `apps/desktop` / `apps/toolbox` / `tools/secure-config` 全部包
> **文档定位**：本文是把「现状快照（As-Is）」「0.3.0 重构方案」「组件结构加载提示词」「属性编辑器提示词」「MCP 服务器提示词」四份材料合并为**一份可直接施工的蓝图**，并补充同类型项目通行的**开发流程、代码规范、接口规范**。
> **使用方式**：本文应保存为仓库根目录 `REFACTORING.md`，与 `ARCHITECTURE.md`（设计意图）、`现状文档.md`（As-Is 快照）三份并列阅读。**ARCHITECTURE.md 讲"为什么"，本文讲"怎么做"，现状文档讲"现在是什么"。**

---

## 目录

- [第 0 章 阅读路径与文档边界](#第-0-章-阅读路径与文档边界)
- [第 1 章 项目定位与基线](#第-1-章-项目定位与基线)
- [第 2 章 重构目标与原则](#第-2-章-重构目标与原则)
- [第 3 章 目标架构总览](#第-3-章-目标架构总览)
- [第 4 章 目录结构与边界规范](#第-4-章-目录结构与边界规范)
- [第 5 章 代码规范](#第-5-章-代码规范)
- [第 6 章 接口规范](#第-6-章-接口规范)
- [第 7 章 组件与属性体系](#第-7-章-组件与属性体系)
- [第 8 章 安全体系](#第-8-章-安全体系)
- [第 9 章 授权体系](#第-9-章-授权体系)
- [第 10 章 工具箱独立应用](#第-10-章-工具箱独立应用)
- [第 11 章 MCP 服务器重构](#第-11-章-mcp-服务器重构)
- [第 12 章 桌面外壳重构](#第-12-章-桌面外壳重构)
- [第 13 章 开发流程与协作规范](#第-13-章-开发流程与协作规范)
- [第 14 章 测试与验收](#第-14-章-测试与验收)
- [第 15 章 重构路线图](#第-15-章-重构路线图)
- [第 16 章 数据迁移指南](#第-16-章-数据迁移指南)
- [第 17 章 风险与对策](#第-17-章-风险与对策)
- [第 18 章 附录](#第-18-章-附录)

---

## 第 0 章 阅读路径与文档边界

### 0.1 三份文档的分工

| 文档 | 回答 | 受众 | 更新时机 |
|---|---|---|---|
| `现状文档.md` | 现在是什么（As-Is） | 新人、排查问题、审计 | 每次发版前快照 |
| `ARCHITECTURE.md` | 要变成什么、为什么 | 架构决策者、评审 | 大版本前 |
| **`REFACTORING.md`（本文）** | **怎么做、谁做、做到什么程度** | **施工者、CI、Review** | **每个 P 阶段开时更新** |
| `AGENTS.md`（P7 建立） | 一页纸速查：目录边界 + 单一写入者 + 闸门 | 所有人/agent | 冻结后基本不动 |

### 0.2 阅读路径

- **新加入的工程师**：第 0 章 → 第 4 章 → 第 5 章 → 第 13 章 → 第 15 章对应阶段
- **组件/插件开发者**：第 7 章 → 第 6.4 节 → 第 6.5 节
- **MCP 工具开发者**：第 11 章 → 第 6.1~6.3 节
- **桌面外壳/发布**：第 12 章 → 第 9 章 → 第 14 章
- **安全评审**：第 8 章 → 第 6.3 节 → 第 9 章
- **产品/运营**：第 9 章 → 第 10 章 → 第 1.3 节

### 0.3 硬约束（贯穿全文，不可协商）

1. **签发能力必须与客户分发物物理分离**：主应用只验证，签发只在工具箱。
2. **每个事实只有一个写入者**：版本号、组件清单、表格内核、静态服务器、单文件 MCP。
3. **默认拒绝**：网络面默认拒绝非本机来源，写操作默认需显式授权。
4. **失败要说人话且可诊断**：宁可明确报错，不要"看起来能用、实际连错实例"。
5. **每一步都能回滚**：改动前备份，改动后跑固定闸门。

---

## 第 1 章 项目定位与基线

### 1.1 一句话定位

一个**组件即插件**的可视化编辑器：支持**文档（A4/PPT）**与 **Web 界面**两种编辑模式，通过 **MCP 协议**把编辑能力开放给 AI agent，通过 **Electron** 分发为 Windows 桌面应用，通过**独立工具箱**完成加密配置与授权签发。

### 1.2 四层职责

```
┌── 契约层（唯一真相） ───────────────────┐
│ bridge-protocol · component-contract   │
│ config-schema · license-format         │
└─────────┬───────────────────────────────┘
          │ 派生
   ┌──────┴──────┬──────────────┬─────────────┐
   ▼             ▼              ▼             ▼
web-editor   editor-mcp    apps/desktop   apps/toolbox
(渲染/交互)  (能力门面)     (壳)           (签发+诊断)
   └──────────┬──────────────┘
              ▼
        共享内核（表格/转义/文档模型）
```

**职责铁律**：

| 角色 | 可以做什么 | 绝不能做什么 |
|---|---|---|
| **编辑器（web-editor）** | 文档真相、组件渲染、导出 HTML/DOCX/React | 不直接访问文件系统、不联网、不签发授权 |
| **MCP（editor-mcp）** | 协议转换、无头兜底、桥接中转 | 不复制编辑器渲染逻辑、不含签发路径 |
| **桌面壳（apps/desktop）** | 窗口、静态服务、拉起 MCP、配置解密、更新 | 不含业务逻辑、不含签发路径 |
| **工具箱（apps/toolbox）** | 签发授权、加密配置、诊断 | **不进客户分发物**、不联网（除显式动作） |

### 1.3 关键数字基线（2026-09-28）

| 项 | 数值 |
|---|---|
| 版本 | 三包均 0.2.0 |
| MCP 工具/资源/提示词 | 108 / 23 / 12 |
| 桥接方法 | 88 |
| 桌面 IPC | 14 通道 / 22 preload 成员 |
| 组件 | 内置 44 + 外部 3 |
| 自检断言 | `?check=1` 295 / `verify` 77 / `--selftest` 9 |
| 安装包 | 109.6 MB |

### 1.4 已跑通的核心能力（重构中不能破坏）

- Live 通道：agent → MCP(37651) → hub(37650) → 编辑器页面 → 真实文档
- 多实例共存：两个 MCP 进程共用一个 hub
- 会话自愈：编辑器重启后旧 `mcp-session-id` 继续可用
- 组件热加载：`public/组件/*.js` 改完点重载即生效

---

## 第 2 章 重构目标与原则

### 2.1 三个必达目标

1. **安全边界闭环**：堵住本机网页 CSRF、冒充编辑器、更新投毒三处口子。
2. **单一来源落地**：版本号、组件清单、表格内核、静态服务器、单文件 MCP 各只一份。
3. **目录边界清晰**：源码 / 契约 / 交付物 / 发行物 / 运行数据 / 工具 / 文档七类物理分离。

### 2.2 六条设计原则

| # | 原则 | 判据 |
|---|---|---|
| 1 | 单一写入者 | 能不能被一条断言抓住漂移 |
| 2 | 默认拒绝 | 网络面默认拒绝非本机来源 |
| 3 | 失败可诊断 | 报错信息含错误码 + 上下文 + 恢复建议 |
| 4 | 契约优先 | 先定契约再写实现，跨包断言守住 |
| 5 | 生成 + 断言优于新增目录 | 尊重"先不改目录"，用生成物 + verify 消漂移 |
| 6 | 可回滚 | 每步一个提交，`git revert` 即恢复 |

### 2.3 不同类项目借鉴清单

| 来源 | 借鉴 |
|---|---|
| Electron 官方菜单模板 | 标准 Edit/View 角色 |
| Figma 插件 API 稳定性 | 新增=minor、破坏=major、旧 major 长期支持 |
| MCP 规范 2025-06-18 | Origin 必须校验、绑 127.0.0.1、鉴权 |
| Cryptlex 离线授权 | 请求文件 + 有期限签名响应 + 本机验签 |
| Vite 官方插件规范 | 契约校验在开发期而非运行期 |
| React 18 官方 | 尽量 Server Components 思路（渲染契约纯函数） |
| Node.js Security Best Practices | 输入白名单、路径校验、速率限制 |
| Conventional Commits | 提交信息规范 |

---

## 第 3 章 目标架构总览

### 3.1 逻辑分层

```
┌──────────────────── 契约层 contracts/ ────────────────────┐
│ protocol.ts      桥接方法/参数/错误码/能力清单             │
│ component.ts     组件契约 + _manifest.json 形状            │
│ config.ts        加密配置键 schema                         │
│ license.ts       授权/请求文件格式                         │
│ version.json     唯一版本源（由 sync-contracts 生成）      │
└──────────┬────────────────┬────────────────┬───────────────┘
           │ 生成            │ 生成            │ 生成
   ┌───────┴───────┐ ┌──────┴───────┐ ┌─────┴────────┐
   ▼               ▼ ▼              ▼ ▼              ▼
web-editor    editor-mcp      apps/desktop    apps/toolbox
(页面)         (门面)          (壳)            (签发+诊断)
   │               │                │
   └── ws 37650 ───┴───── http ─────┘
                    │
              桥接中转 hub
```

### 3.2 数据流

```
用户操作
  ├─ 编辑器页面直接改 store → 渲染
  └─ 编辑器 → 桥接(ws) → hub → MCP → agent（推送事件）
agent 调用 MCP 工具
  ├─ Live 可用 → hub → 编辑器 → store → 渲染
  └─ Live 不可用 → 无头引擎 → workspace/*.editor.json
```

### 3.3 双通道优先级

```
工具调用 → withBridge(method, args, headless)
   ├─ Live 可用
   │   ├─ LIVE_FALLBACK: → 无头 + degraded:true
   │   ├─ BRIDGE_OFFLINE: → 无头 + degraded:true
   │   └─ <业务错误>: → 直接抛出（不降级）
   └─ Live 不可用 → 无头 + degraded:true
```

**不变式**：业务错误绝不静默降级，避免把编辑意图写进"错误的目标"。

---

## 第 4 章 目录结构与边界规范

### 4.1 目标目录树（P3 完成后）

```
<repo>/
├─ README.md  ARCHITECTURE.md  REFACTORING.md  现状文档.md  AGENTS.md  CHANGELOG.md
├─ package.json                      【编排】private，根脚本
├─ .gitignore  .eslintrc.cjs  .prettierrc  tsconfig.base.json
├─ .github/workflows/                【CI】三闸门 + 发布
├─ contracts/                        【契约·唯一真相】入库
│  ├─ protocol.ts  component.ts  config.ts  license.ts
│  └─ version.json                  由 tools/sync-contracts.mjs 生成，入库
├─ web-editor/                       【源码】dist/ 留在包内
│  ├─ src/  public/  scripts/  index.html  vite.config.ts
│  └─ dist/                         【编译产物·不入库】
├─ editor-mcp/                       【源码】dist/ 留在包内
│  ├─ src/  scripts/  package.json
│  └─ dist/                         【编译产物·不入库】
├─ apps/
│  ├─ desktop/                       【源码】壳
│  │  ├─ main.js  preload.cjs  src/  server/  scripts/  config/
│  └─ toolbox/                       【源码·独立应用】签发+诊断
│     ├─ main.js  preload.cjs  src/  scripts/  package.json
├─ tools/                            【工具·入库】
│  ├─ secure-config/                纯函数库（主应用+工具箱共用）
│  ├─ cdp/                          自检探针
│  ├─ sync-contracts.mjs            版本/契约生成
│  └─ pdf-blank-check.mjs           PDF 空白页检测
├─ dist/                             【交付物·不入库】
│  ├─ mcp/editor-mcp.bundle.mjs
│  └─ desktop/win-unpacked/
├─ release/                          【发行物·不入库】webedit-*.exe
├─ var/                              【运行数据·不入库】
│  ├─ logs/  caches/  mcp-workspace/  shots/  docs/
└─ .dsh/                             【DSH 约定·必须留根】
```

### 4.2 七类文件边界

| 类别 | 判据 | 位置 | 入库 |
|---|---|---|---|
| 源码 | 人要读要改 | `*/src/` `*/scripts/` | ✅ |
| 契约 | 两端必须一致 | `contracts/` | ✅ |
| 编译产物 | `tsc`/`vite` 生成 | `*/dist/` | ❌ |
| 交付物 | 要装进安装包 | `dist/mcp/` `dist/desktop/` | ❌ |
| 发行物 | 直接交给用户 | `release/*.exe` | ❌ |
| 运行数据 | 跑起来才有 | `var/` `%APPDATA%\webedit\` | ❌ |
| 生成文档 | 从注册表生成 | `var/docs/` | ❌ |
| 开发文档 | 人写的说明 | 根 + 各包 README | ✅ |

### 4.3 `.gitignore` 规范

```gitignore
node_modules/
*/dist/                 # 包内编译产物
dist/                   # 顶层交付物
release/                # 发行物
var/                    # 运行数据
*.tsbuildinfo
.tmp-*
.asar-probe/
*.log
.DS_Store
Thumbs.db
```

**陷阱**：早期 `dist/` 规则匹配任意层级。改名后必须确认顶层 `dist/` 仍被忽略，用断言守住：

```bash
git check-ignore -v dist/mcp/x || (echo "顶层 dist 未被忽略" && exit 1)
```

### 4.4 命名规范

| 项 | 规则 | 示例 |
|---|---|---|
| 目录名 | 一律 ASCII、kebab-case | `web-editor` `editor-mcp` `secure-config` |
| 产品展示名 | 中文品牌，不改 | 「可视化编辑器」 |
| npm 包名 | ASCII 短名 | `webedit` `editor-mcp` `@webedit/core` |
| 应用 ID | `com.webedit.app` | — |
| exe 名 | `webedit.exe` | 产品展示名走窗口标题 |
| userData 目录 | `%APPDATA%\webedit` | — |
| 组件文件名 | 与 `type` 一致 | `heading.tsx` `table.tsx` |
| 外部插件 | `type` 必须以 `live` 开头 | `liveNotice.js` |
| 契约文件 | kebab-case 或 camelCase | `protocol.ts` `component-contract.ts` |

---

## 第 5 章 代码规范

### 5.1 通用规范

| 项 | 规则 |
|---|---|
| 语言 | TypeScript strict（`strict: true`、`noImplicitAny`、`noUncheckedIndexedAccess`） |
| 格式 | Prettier：单引号、无分号可选、2 空格缩进、100 列宽、LF |
| Lint | ESLint + `@typescript-eslint` + `react-hooks` + `import/order` |
| 提交 | Conventional Commits（见 §13.4） |
| 注释 | 文件头职责注释 + 导出项 TSDoc；内部逻辑克制注释 |
| 禁止 | `any`（除非有 `// eslint-disable` 且注明理由）、`@ts-ignore`、隐式 `any` 返回值 |
| 允许 | `unknown` + 运行时校验（zod） |

### 5.2 TypeScript 规范

**5.2.1 类型定义**

```ts
// ✅ 契约类型用 interface + 只读字段
export interface ComponentDefinition {
  readonly type: string;
  readonly label: string;
  readonly category: ComponentCategory;
  readonly supportedModes: readonly EditorMode[];
  readonly defaultProps: Readonly<Record<string, unknown>>;
  readonly propSchema: readonly PropSchemaItem[];
  readonly render: (
    props: Readonly<Record<string, unknown>>,
    ctx: RenderContext,
    children?: React.ReactNode,
  ) => React.ReactNode;
}

// ✅ 联合类型优先于枚举
export type EditorMode = 'document' | 'web' | 'ppt';

// ❌ 不要用 enum（影响 tree-shaking）
enum Mode { Document, Web, Ppt }  // 禁止

// ✅ 用 const 对象 + as const 替代
export const MODES = ['document', 'web', 'ppt'] as const;
export type EditorMode = typeof MODES[number];
```

**5.2.2 类型断言**

```ts
// ✅ 用类型守卫
function isComponentDefinition(v: unknown): v is ComponentDefinition {
  return (
    typeof v === 'object' && v !== null &&
    'type' in v && typeof (v as any).type === 'string' &&
    'render' in v && typeof (v as any).render === 'function'
  );
}

// ❌ 禁止 as any、双重断言
const x = value as any;                    // 禁止
const y = value as unknown as ComponentDefinition;  // 禁止
```

**5.2.3 泛型**

```ts
// ✅ 泛型约束明确
function groupBy<T, K extends keyof T>(items: T[], key: K): Map<T[K], T[]> { ... }

// ❌ 无意义的泛型
function identity<T>(x: T): T { return x; }  // 除非必要，否则不要
```

### 5.3 React 规范

**5.3.1 组件写法**

```tsx
// ✅ 函数组件 + 具名导出 + 显式 props 类型
interface PropertyRowProps {
  item: PropSchemaItem;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
}

export const PropertyRow = memo(function PropertyRow({
  item, value, onChange,
}: PropertyRowProps) {
  // ...
});

// ❌ 不要默认导出组件（除页面）
export default function Row() { ... }  // 避免
```

**5.3.2 Hooks**

```tsx
// ✅ 依赖数组完整、回调稳定
const handleChange = useCallback((v: unknown) => {
  onChange(item.key, v);
}, [item.key, onChange]);

// ❌ 依赖缺失、内联对象/函数
useEffect(() => { ... }, []);           // 若用了外部变量则错
<Child config={{ a: 1 }} />             // 每次新对象
```

**5.3.3 性能**

```tsx
// ✅ 只包裹需要的部分
const Memo = memo(Expensive);

// ✅ 大列表虚拟化
<VirtualList items={items} itemHeight={28} />

// ✅ useMemo 只用于昂贵计算
const groups = useMemo(() => groupBy(schema, 'group'), [schema]);
```

**5.3.4 状态管理**

- **单一数据源**：编辑器文档全在 `editorStore`，禁止局部复制。
- **不可变更新**：用 `immer` 或手写浅拷贝，禁止直接改 `state`。
- **派生状态用 selector**：`useEditorStore(selectSelectedIds)`，禁止在组件内 `useEffect` 同步。

### 5.4 Node/MCP 规范

```ts
// ✅ 显式返回类型
export async function withBridge<T>(
  method: string,
  args: unknown,
  headless: () => Promise<T>,
): Promise<T> { ... }

// ✅ 错误用 Result 类型而非 throw（工具边界处）
export type Result<T> =
  | { ok: true; data: T; degraded?: boolean }
  | { ok: false; error: { code: ErrorCode; message: string; hint?: string } };

// ✅ 输入用 zod 校验
const schema = z.object({ id: z.string(), props: z.record(z.unknown()) });
const parsed = schema.parse(input);
```

### 5.5 命名规范

| 项 | 规则 | 示例 |
|---|---|---|
| 变量/函数 | camelCase | `getComponent` `handleAdd` |
| 常量 | UPPER_SNAKE_CASE | `MAX_HISTORY` `ERROR_CODES` |
| 类型/接口 | PascalCase | `ComponentDefinition` |
| 文件（TS） | camelCase 或 kebab-case（包内统一） | `liveBridge.ts` `sync-contracts.mjs` |
| 文件（React 组件） | PascalCase | `PropertyPanel.tsx` |
| 组件文件（注册表） | 与 `type` 一致，小写 | `heading.tsx` |
| CSS class | Tailwind 优先，自定义 kebab-case | `.prop-row` |
| 环境变量 | `EDITOR_MCP_*` 前缀 | `EDITOR_MCP_TOKEN` |
| MCP 工具 | `<域>.<动作>` | `node.add` |
| IPC 通道 | `domain:action` | `desktop:restart-mcp` |
| 事件 | `domain.event` | `document.changed` |

### 5.6 注释规范

```ts
/**
 * 在文档或指定容器中添加一个组件节点。
 *
 * @param type     组件类型 key，如 heading / table / button
 * @param parentId 父容器 id；缺省为文档根或画布根
 * @param index    插入位置索引；缺省追加末尾
 * @param props    初始属性（会与组件 defaultProps 合并）
 * @returns        新节点 id 与最终 props
 * @throws         COMPONENT_NOT_FOUND 组件类型未注册
 */
export async function addNode(...): Promise<NodeAddResult> { ... }
```

**禁止**：
- `// TODO`（改为 `// FIXME(#issue)` 或 `// TODO(@owner, 2026-Q4)`）
- 注释掉的代码（git 有历史）
- 无信息量的注释（`// 设置变量`）

### 5.7 提交信息规范（Conventional Commits）

```
<type>(<scope>): <subject>

<body>

<footer>
```

| type | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | 修 bug |
| `refactor` | 重构（不改行为） |
| `perf` | 性能 |
| `docs` | 文档 |
| `test` | 测试 |
| `chore` | 构建/工具 |
| `security` | 安全修复（单独一类，便于审计） |
| `migrate` | 目录/数据迁移 |

**scope**：`web` `mcp` `desktop` `toolbox` `contracts` `tools` `ci` `deps`

**示例**：

```
security(mcp): 增加 Origin 白名单与 Bearer token 校验

- http.ts: POST /mcp 前校验 Origin 命中白名单，否则 403
- bridge/host.ts: hello 阶段校验 token，不一致拒绝握手
- config.ts: 新增 mcp.requireToken（默认 true）

BREAKING CHANGE: agent 侧配置需补 headers.Authorization
Refs: ARCHITECTURE §5.3 决策 #1
```

---

## 第 6 章 接口规范

### 6.1 MCP Tool 规范

**6.1.1 命名与分组**

- 命名：`<域>.<动作>`，全小写，点分隔。
- 域清单（固定 13 个）：`doc` `node` `table` `plugin` `component` `page` `canvas` `property` `history` `export` `selection` `mode` `asset`。
- 动作：动词原形（`add` `get` `set` `remove` `list` `find` `batchUpdate`）。

**6.1.2 输入 schema**

```ts
import { z } from 'zod';

export const nodeAddSchema = z.object({
  type: z.string().describe('组件类型 key'),
  parentId: z.string().optional().describe('父容器 id'),
  index: z.number().int().min(0).optional().describe('插入位置索引'),
  props: z.record(z.unknown()).optional().describe('初始属性'),
  clientId: z.string().optional().describe('幂等键，同一次调用重试不重复创建'),
});
```

规则：

| 项 | 规则 |
|---|---|
| 必填字段 | 用 `required` 数组显式列出 |
| 可选字段 | 必须有 `.optional()` 或默认值 |
| 参数描述 | 每个字段写 `.describe()`，中文 |
| 禁止 | `any`；`unknown` 必须有 runtime 校验 |
| 破坏性操作 | 必带 `confirm: z.literal(true)` |

**6.1.3 输出 schema（结构化返回）**

```ts
export interface ToolResult<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: ErrorCode;
    message: string;      // 用户可读的中文
    hint?: string;        // 恢复建议
    details?: unknown;    // 开发用
  };
  degraded?: boolean;     // 是否走了无头降级
  changed?: string[];     // 受影响的节点 id
  via?: 'live' | 'headless';
}
```

**6.1.4 错误码**

**现状 18 个**（`editor-mcp/src/errors.ts` 实测，只增不改语义）：

```ts
export const ErrorCodes = {
  // 传输 / 策略层
  BRIDGE_OFFLINE: "BRIDGE_OFFLINE",
  WRITE_DISABLED: "WRITE_DISABLED",
  RATE_LIMITED: "RATE_LIMITED",
  PATH_NOT_ALLOWED: "PATH_NOT_ALLOWED",   // 写路径越界（初稿漏了）
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",     // 该通道未实现（初稿漏了）
  CONFIRM_REQUIRED: "CONFIRM_REQUIRED",
  // 业务层
  DOC_NOT_FOUND: "DOC_NOT_FOUND",
  NODE_NOT_FOUND: "NODE_NOT_FOUND",
  COMPONENT_NOT_FOUND: "COMPONENT_NOT_FOUND",
  PROPERTY_NOT_IN_SCHEMA: "PROPERTY_NOT_IN_SCHEMA",
  INVALID_PROP_VALUE: "INVALID_PROP_VALUE",
  TABLE_RANGE_INVALID: "TABLE_RANGE_INVALID",
  // 插件层
  PLUGIN_NOT_FOUND: "PLUGIN_NOT_FOUND",
  PLUGIN_SYNTAX_ERROR: "PLUGIN_SYNTAX_ERROR",
  PLUGIN_CONTRACT_ERROR: "PLUGIN_CONTRACT_ERROR",
  PLUGIN_TYPE_PREFIX: "PLUGIN_TYPE_PREFIX",
  PLUGIN_DRYRUN_FAILED: "PLUGIN_DRYRUN_FAILED",
  // 系统层
  IO_ERROR: "IO_ERROR",
} as const;
```

**P0 / P6 新增**（尚未实现，落地时补进 `contracts/protocol.ts`）：`UNAUTHORIZED`、`ORIGIN_REJECTED`、
`PROTOCOL_MISMATCH`、`METHOD_NOT_FOUND`、`LICENSE_INVALID`、`LICENSE_EXPIRED`、
`LICENSE_MACHINE_MISMATCH`、`LICENSE_FEATURE_DENIED`、`CLOCK_ANOMALY`、`INTERNAL`。

规则：**错误码只增不改**；每次新增必须写进 `contracts/protocol.ts` 并加断言；客户端可依据错误码决定重试策略。
**6.1.5 幂等性**

- 读操作天然幂等。
- 写操作可传幂等键 `clientId`；**现状**：`tools/node.ts` 用**进程内 `Set<string>`** 去重（当前只有 `node.add` 支持），
  **没有过期窗口**，进程重启即清空。
- 目标（P1，非现状）：改成 `Map<clientId, Result>` 并加 5 分钟窗口与清理；届时其余写工具也接 `clientId`。
**6.1.6 速率限制**

- 默认 100 次/分钟。
- 超限返回 `RATE_LIMITED`（`errors.ts` 现状只给 `message` + `hint`，**没有 `retryAfter` 字段**；
  若要给重试秒数属新增字段，需先进 `contracts/protocol.ts`）。
- 可配置 `EDITOR_MCP_RATE_LIMIT`。

### 6.2 MCP Resource 规范

**6.2.1 URI scheme**

```
editor://<类别>/<标识>[/<子资源>]
```

| 类别 | 说明 |
|---|---|
| `document` | 文档 |
| `component` | 组件注册表 |
| `plugin` | 外部插件 |
| `spec` | 说明书 |
| `page` / `canvas` | 页面/画布配置 |
| `selection` / `history` / `bridge` | 状态 |

**6.2.2 订阅**

- 支持订阅的 URI 必须在 `SUBSCRIBABLE` 集合里声明。
- 变更时推 `notifications/resources/updated`，含 `uri` 字段。
- 订阅者断线重连后需重新订阅（协议不保证续订）。

### 6.3 桥接协议（WebSocket）

**6.3.1 消息格式**

```ts
// 请求
interface BridgeRequest {
  id: string;
  method: string;         // 'node.add' 等
  params?: unknown;
  token?: string;         // 强制（P0 后）
  origin?: string;        // 强制校验
}

// 成功响应
interface BridgeResponse {
  id: string;
  ok: true;
  result: unknown;
  degraded?: boolean;
}

// 失败响应
interface BridgeError {
  id: string;
  ok: false;
  error: { code: ErrorCode; message: string; hint?: string };
}

// 事件
interface BridgeEvent {
  event: 'bridge.editor' | 'document.changed' | 'selection.changed';
  payload: unknown;
}
```

**6.3.2 握手**

```ts
// editor → hub
{ id, method: 'bridge.hello', params: {
    role: 'editor' | 'mcp',
    version: '0.3.0',
    protocol: 2,
    features: { exportDocx: true, liveSelection: true, realtime: true },
    token: '<bearer>',
  }
}

// hub → editor
{ id, ok: true, result: {
    name: 'editor-mcp-hub',
    version: '0.3.0',
    protocol: 2,
    editors: 1, clients: 0,
    editorVersion: '0.3.0',
    tokenRequired: true,
  }
}
```

**6.3.3 闸门规则（替换"版本全等"）**

| 情况 | 行为 |
|---|---|
| `protocol` 相同 | 允许 Live（版本不同只记 info） |
| `protocol` 不同 | 尝试 Live，调用前先查 `features`，缺失能力走无头 |
| 拿不到 hello | 无头 + `degraded:true` |

**6.3.4 超时与重连**

- 单请求超时 15s。
- 编辑器侧重连退避（`bridgeClient.ts` 现状）：从 **1s 起、每次 ×2、封顶 30s**（1 / 2 / 4 / 8 / 16 / 30）。
- 启动时的探测档位（另一条链路）：`autoStartBridgeFromPrefs` 的 `delays = [300, 2000, 5000, 10000, 20000]`（毫秒）。
- 断线期间请求立即返回 `BRIDGE_OFFLINE`。

### 6.4 组件契约

**6.4.1 `ComponentDefinition`**（以 `web-editor/src/registry/types.ts` 为准）

```ts
export interface ComponentDefinition {
  type: string;
  label: string;
  category: string;              // 左侧分组名；7 个约定分类见 6.4.4
  supportedModes: EditorMode[];
  icon: ComponentIcon;           // = ComponentType<{ className?: string }>
  description?: string;
  isContainer?: boolean;
  hidden?: boolean;              // 只在左侧面板隐藏（仍注册、仍能渲染老文档、MCP 清单里还在）
  splittable?: "rows";           // 文档模式跨页续排：放不下当前页时按行拆到下一页（表格用）
  defaultProps: ComponentProps;
  defaultFrame?: Partial<Frame>; // Web 模式默认位置尺寸
  propSchema: PropSchemaItem[];
  render: (props: ComponentProps, ctx: RenderContext, children?: ReactNode) => ReactNode;
}
```

> 注：`hidden`（如被「图片」取代的「并排双图」）与 `splittable: "rows"`（跨页续表）是**现网在用**的字段，
> 初稿漏了；`category` 实际是自由字符串（约定 7 类），不是联合类型。
**6.4.2 `PropSchemaItem`**

```ts
export interface PropSchemaItem {
  key: string;
  label: string;
  control: PropControlType;      // 22 种，见 6.4.3
  group: string;                 // 属性面板分组
  defaultValue: unknown;
  options?: SelectOption[];
  min?: number; max?: number; step?: number;
  unit?: "mm" | "px" | "pt" | "%";
  placeholder?: string;
  visibleWhen?: (props: ComponentProps, ctx: RenderContext) => boolean;
  disabledWhen?: (props: ComponentProps, ctx: RenderContext) => boolean;
}
```

> 注：**没有 `hint` 字段**（初稿多写了）。悬停说明由属性面板的 `PropertyRow` + 自研 `Tooltip` 负责，
> 文案来自 `label` / `group` / `visibleWhen` 等既有信息。

**6.4.3 22 种控件清单**（现状实测：`registry/types.ts` 的 `PropControlType`；`?spec=1` 生成物同为"22 种"）

`text` `textarea` `richtext` `number` `slider` `color` `select` `switch` `align` `font` `spacing` `edge`
`image` `unit` `frame` `children` `cells` `tableSize` `tableHtml` `tableSort` `tableRowHeights` `imageRows`

> 与初稿的 18 种相比，实际多出 4 种**表格专项控件**：`tableHtml`（HTML 源）、`tableSort`（排序规则）、
> `tableRowHeights`（行高）、`imageRows`（并排图行）。
**6.4.4 7 个分类（固定，不可扩展）**

`通用` `布局分页` `Word 常用` `Excel 表格` `PPT 专用` `Web 控件` `Web 容器`

**6.4.5 `_manifest.json` 唯一形状**

```json
{ "files": ["提示条.js", "参数对比卡.js", "免责声明.js"] }
```

读取端**必须兼容**裸数组（过渡期），写入端**只能**写规范形状。

### 6.5 外部插件契约

**6.5.1 文件约束**

| 约束 | 原因 |
|---|---|
| 纯 JS（无 import/require/fs/fetch） | 直接 `<script>` 执行 |
| `type` 必须以 `live` 开头 | 与内置命名空间隔离 |
| 必须调 `window.EditorKit.register(def)` | 唯一入口 |
| 文件名写进 `_manifest.json` | 加载器据此枚举 |
| `api` 主版本声明 | Figma 式稳定性 |

**6.5.2 EditorKit API（对外暴露）**（以 `web-editor/src/registry/live.ts` 与 SKILL.md §2 为准）

```ts
interface EditorKit {
  React: typeof React;                                  // 渲染一律 React.createElement（无 jsx 自动运行时）
  reactJsxRuntime: { jsx; jsxs; Fragment };              // 兼容别名，但是**经典签名** createElement(type, props, ...children)
  register: (def: ComponentDefinition) => void;
  // 下面这两个是**属性 schema 片段生成器**（返回 PropSchemaItem[]，供插件 ...spread 进 propSchema），
  // 不是 CSS 样式助手 —— 初稿写成返回 CSSProperties 是错的
  fontProps: (size?: number) => PropSchemaItem[];
  boxProps: () => PropSchemaItem[];
  defaultsOf: (schema: PropSchemaItem[]) => Record<string, unknown>;   // 由 schema 的 defaultValue 推导
  defaultFrameOf: (w: number, h: number, x?: number, y?: number) => Partial<Frame>;
  boxStyle / typographyStyle / alignOf / spacingCss / edgeCss: Function;
  lines / rows: (text: string) => string[];
  asString / asNumber / asBool / asEnum: (v: unknown, fallback: unknown) => unknown;
  mmToPx / ptToPx: (n: number) => number;
  icon: (name?: string) => React.ReactNode;
  // 表格内核（与内置表格一致的单元格逻辑）
  renderTable / tableSchema / parseTableData / serializeTableData /
  escapeCell / parseCellStyles / parseColWidths: Function;
}
```
**6.5.3 稳定性承诺**

| 变更类型 | 版本 | 行为 |
|---|---|---|
| 新增可选字段 / 新增 API | minor | 老插件自动兼容 |
| 改已有字段语义 / 删除字段 | **major** | 老插件不自动升级，manifest 声明 `api` 主版本 |
| 未知 propSchema 控件 | — | 老插件忽略但保留取值 |

### 6.6 HTTP 端点

| 端点 | 方法 | 用途 | 校验 |
|---|---|---|---|
| `POST /mcp` | MCP | Streamable HTTP | Origin + token |
| `GET /mcp` | SSE | 服务端推送 | Origin + token |
| `DELETE /mcp` | 会话终止 | — | 未知会话回 405 |
| `GET /` `/assets/*` `/index.html` | 静态托管 | 页面 | 无 |
| `GET /组件/<name>` | 外部插件 | — | 文件名白名单 |
| `GET /__components` | 组件清单 | — | 无 |
| `POST /__log` | 前端日志上报 | — | 大小限制 512 KiB |
| `POST /__save` | 保存到 docsDir | — | 路径白名单 |
| `POST /__savePlugin` | 写回组件目录 | — | 文件名校验 |

### 6.7 IPC 通道

**6.7.1 命名**

`desktop:<动作>`（kebab-case）

**6.7.2 通道清单（14 条，只增不改语义）**

| 通道 | 参数 | 返回 |
|---|---|---|
| `desktop:status` | — | `DesktopStatus` |
| `desktop:set-titlebar` | `{ color: '#rrggbb' }` | `{ ok: true }` |
| `desktop:log` | `{ level, msg }` | `{ ok: true }` |
| `desktop:config` | — | 脱敏配置 |
| `desktop:mcp-url` | — | `string` |
| `desktop:copy-mcp-url` | — | `{ ok: true }` |
| `desktop:mcp-probe` | — | `{ ok, version }` |
| `desktop:restart-mcp` | — | `{ ok }` |
| `desktop:check-update` | — | `{ available, version? }` |
| `desktop:open-download` | — | `{ ok }` |
| `desktop:open-log-dir` | — | `{ ok }` |
| `desktop:open-data-dir` | — | `{ ok }` |
| `desktop:open-config-file` | — | `{ ok }`（打开配置目录；preload 方法名为 `openConfigDir`） |
| `desktop:open-external` | `{ url }` | `{ ok }` |

**6.7.3 安全约束**

- 只接受 `#rrggbb` 格式的颜色（防注入）。
- `open-external` 只允许 `https://` 与 `http://127.0.0.1`。
- 所有通道参数必须 zod 校验。

### 6.8 配置 schema

**6.8.1 加密配置文件（app-config.enc 明文形态）**

```jsonc
{
  "v": 1,
  "app": { "title": "可视化编辑器" },
  "server": { "port": 0, "host": "127.0.0.1", "openBrowser": false },
  "mcp": {
    "enabled": true, "transport": "http", "host": "127.0.0.1",
    "httpPort": 37651, "bridgePort": 37650,
    "autoRestart": true, "readyTimeoutMs": 20000,
    "allowWrite": false,
    "requireToken": true,
    "originAllow": ["http://127.0.0.1:*"]
  },
  "update": {
    "enabled": true,
    "baseUrl": "",
    "manifest": "latest.json",
    "channel": "stable", "allowPrerelease": false,
    "timeoutMs": 8000, "openMode": "external"
  }
}
```

**6.8.2 规则**

- 配置键**只增不改语义**；重命名须走迁移。
- 新增键必须有默认值。
- 每次新增键必须写进 `contracts/config.ts` + 断言。

**6.8.3 环境变量**

| 变量 | 默认 | 说明 |
|---|---|---|
| `EDITOR_MCP_BRIDGE_URL` | `ws://127.0.0.1:37650/bridge` | hub 地址 |
| `EDITOR_MCP_BRIDGE_HUB` | `true` | 是否起 hub |
| `EDITOR_MCP_WORKSPACE` | `<pkgRoot>/workspace` | 无头文档目录 |
| `EDITOR_MCP_PLUGIN_DIR` | `<repoRoot>/web-editor/public/组件` | 插件目录 |
| `EDITOR_MCP_ALLOW_WRITE` | `false`（P0 后） | 写开关 |
| `EDITOR_MCP_REQUIRE_TOKEN` | `true`（P0 后） | token 强制 |
| `EDITOR_MCP_TOKEN` | — | 桌面版注入 |
| `EDITOR_MCP_RATE_LIMIT` | `100` | 次/分钟 |
| `EDITOR_MCP_BACKUP_KEEP` | `5` | 插件备份保留数 |
| `EDITOR_MCP_ASSET_MAX_MB` | `20` | 资源上限 |

---

## 第 7 章 组件与属性体系

### 7.1 组件即插件：三层架构

```
┌── 注册表（src/registry/index.ts） ─────────────────┐
│  唯一真源：Map<type, ComponentDefinition>          │
│  写入者：loader（内置）+ external（外部）          │
│  读取者：面板、画布、属性编辑器、MCP                │
└─────────┬──────────────────────────────────────────┘
          │
   ┌──────┴──────┬──────────────────┐
   ▼             ▼                  ▼
内置组件      外部插件           通用属性注入
(import.meta  (window.EditorKit   (injectCommonProps)
 .glob 发现)   .register)
```

### 7.2 组件加载流程（构建期 + 运行期）

**构建期（Vite）**：

1. `import.meta.glob('./components/**/*.tsx')` 静态分析。
2. Vite 把每个组件打成独立 chunk。
3. 忽略以 `_` 开头的文件。

**运行期（启动）**：

```
main.tsx
  ├─ installDesktopChrome()
  ├─ autoStartBridgeFromPrefs()      [并行]
  ├─ loadBuiltinComponents()         [并行]
  │    └─ import.meta.glob eager:false → 逐个 load → validate → injectCommonProps → register
  ├─ loadRuntimeComponents()
  │    ├─ fetch('/__components') 或读取 _manifest.json
  │    ├─ 逐文件 import('/组件/<file>.js')
  │    └─ 插件调 EditorKit.register → 进注册表
  └─ render(<App />)
```

**要求**：

- 单组件加载失败不拖垮全局（catch + 警告）。
- 每个节点外套 `NodeErrorBoundary`，`render` 抛错只降级该节点。
- `EditorKit` 在 `loadRuntimeComponents` 之前挂载。

### 7.3 属性编辑器（Qt Designer 风格）

**7.3.1 结构**

```
┌─ 顶部固定区 ─────────────────┐
│ 组件名 + 类型徽标 + ID + 过滤框 │
├─ 通用属性抽屉 ────────────────┤
│  位置与尺寸（Web）/ 上下边距 / 显隐 / 锁定 │
├─ 专有属性抽屉 ────────────────┤
│  ▼ 内容（默认展开）           │
│  ▶ 排版 / 外观 / 尺寸 / 布局   │
├─ 状态抽屉（只读） ────────────┤
│  组件 ID / 父容器 / 顺序       │
└──────────────────────────────┘
```

**7.3.2 分组策略（按类别差异化）**

| 类别 | 分组顺序 | 默认展开 |
|---|---|---|
| Word 常用 | 内容 → 排版 → 外观 → 尺寸 → 布局 → 高级 | 内容 |
| PPT 专用 | 内容 → 排版 → 外观 → 尺寸 → 布局 | 内容 |
| Excel 表格 | **表格 → 单元格 → 尺寸** | 表格 |
| Web 控件 | 内容 → 外观 → 尺寸 → 高级 | 内容 |
| Web 容器 | 内容 → 外观 → 尺寸 → 布局 → 高级 | 内容/外观 |

**7.3.3 悬停气泡规范**

- 延迟 400ms。
- 结构：中文名（粗） + key（等宽小字） + 说明 + 默认值/取值范围/单位。
- 分组标题气泡写明"整表 / 选中的单元格"等范围。
- **禁止用原生 `title`**。

**7.3.4 表格专项（重点）**

- 「表格」组 18 项：数据 → 表题 → 线条 → 斑马纹 → 边框 → 表宽/列宽/行高 → 内边距 → 对齐 → 字号 → 表头底色。
- 「单元格」组 1 项：`cells` 控件（画布点选单元格后自动展开）。
- `cells` 控件行为：点选/拖选 → 面板显示 `B2:C3` → 改即改即生效 → 写入 `cellStyles: { "B2": {...} }`。
- `tableSize` 控件：行/列数量 + 增删行列 + 列宽自适应 + 清空表格。
- 五种表格组件（`table / checkTable / paramTable / detailTable / threeLineTable`）共享同一套属性面板。

### 7.4 通用属性统一注入

**必须注入**：

- `marginTop` / `marginBottom`：文档模式 mm。
- `visible` / `locked`：编辑器态。
- `frame`（Web 模式顶部固定区，不在 schema）。

**组件文件不重复声明**：由 `injectCommonProps(def)` 在注册时补。

### 7.5 注册表 API

```ts
export function registerComponent(def: ComponentDefinition): void;
export function unregisterComponent(type: string): void;
export function getComponent(type: string): ComponentDefinition | undefined;
export function getAllComponents(): ComponentDefinition[];
export function getComponentsByMode(mode: EditorMode): ComponentDefinition[];
export function getComponentsByCategory(mode: EditorMode): Map<string, ComponentDefinition[]>;
export function resetRegistry(): void;
```

**约束**：注册表**不做任何 UI 判断**，只做存取。

---

## 第 8 章 安全体系

### 8.1 威胁模型

| 威胁 | 对策 | 优先级 |
|---|---|---|
| T1 本地网页 CSRF | Origin 白名单 + Host 校验 + Bearer token + `allowWrite` 默认 false | P0 |
| T2 冒充编辑器 | hub Origin 校验 + hello 带 token | P0 |
| T3 密钥与配置 | `config.key` 出库 + 文档写明"防误看非防逆向" | P0 |
| T4 更新投毒 | manifest 强制 sha256 + 可选签名 + HTTPS | P1 |
| T5 组件即代码 | 明确"组件目录=可信用户数据"+ 文件名校验 | 保持 |
| T6 端口被占 | 版本不一致拒绝接管 + token 一致才认 | 保持 |

### 8.2 边界定义

```
┌─ 浏览器页面（编辑器自身） ─┐        ┌─ MCP 服务器 ─┐
│ Origin = 127.0.0.1:<随机>  │  WS    │ 37650 hub    │
│ 页面持 token（IPC 拿到）    │ ─────▶ │ 37651 HTTP   │
└────────────────────────────┘        │ Origin+token │
        ▲                              └──────┬───────┘
        │ 只由本应用窗口打开                    │ Bearer
┌───────┴──────────┐                         ▼
│ Electron 桌面壳   │                 ┌─ agent ─┐
│ userData 可写     │                 │ 手工配 token │
└──────────────────┘                 └─────────┘
```

### 8.3 token 传递机制

| 步骤 | 行为 |
|---|---|
| 1. 桌面版启动 | 生成/读取 `userData/bridge-token`（32 字节随机，权限仅当前用户） |
| 2. 注入 MCP | 拉起子进程时设 `EDITOR_MCP_TOKEN` 环境变量 |
| 3. 交给页面 | preload 通过 IPC 暴露 `getBridgeToken()` |
| 4. 页面 hello | 带上 token |
| 5. 其它客户端 | 「工具 → MCP 桥接」一键复制带 token 的配置，人工粘贴 |
| 6. 未配置 token | HTTP 401 / WS 拒绝握手（默认 `requireToken: true`） |

**升级影响**：agent 侧配置需补一次 `headers.Authorization`（写进发行说明）。

### 8.4 Origin 规则

- **有 `Origin`** → 必须命中白名单，否则 403。
- **无 `Origin`**（本地进程）→ 放行，交给 token 把关。
- 白名单默认 `http://127.0.0.1:*`，可配 `mcp.originAllow`。
- Host 头必须为 `127.0.0.1:<port>`（防 DNS rebinding）。

### 8.5 写开关与 autoBridge 联动（决策 #2）

| 状态 | 界面显示 | 行为 |
|---|---|---|
| MCP 未启用 | 未连接（未启用） | 不硬连 |
| token 不匹配 | 未连接（token 不匹配） | 不硬连 |
| 连上但写禁用 | 已连接 · 写已禁用 | 写工具给出明确提示 |
| 连上且写允许 | 已连接 | 全部工具可用 |

**首选项改动后立即重算状态**，不要求重启应用。

### 8.6 路径白名单

- 只允许读写 `EDITOR_MCP_WORKSPACE` 与 `EDITOR_MCP_PLUGIN_DIR` 下的文件。
- 拒绝 `../` 与绝对路径。
- 用 `path.resolve` + `startsWith` 校验。
- 组件文件名白名单：`/^[\w\u4e00-\u9fa5.-]+\.(js|json)$/`。

### 8.7 沙箱

- `plugin.validate` / `plugin.dryRun` 用 Node `vm` + 超时 3s。
- 禁用 `require` / `process` / `fs` / `fetch`。
- 沙箱中 mock `window.EditorKit`。

### 8.8 审计

- **现状**（`editor-mcp/src/log.ts`）：写操作追加到 `<workspace>/audit.log`，格式为
  `时间 | Tool | 参数摘要 | 结果 | 耗时(ms)`（**没有 `clientId` 字段**；也**没有 30 天轮转**，
  `appendFileSync` 持续追加；不存在 `audit.ts`）。
- **目标（P0 新增）**：格式补 `clientId`；按大小/天数轮转并保留 30 天；审计文件统一落 `var/logs/audit.log`
  （P3 目录重排后）。断言：写工具调用后审计行数 +1、字段数一致、轮转触发后旧文件被压缩或删除。
---

## 第 9 章 授权体系

### 9.1 密钥层级

```
主签名密钥对（Ed25519，长期）
  ├─ 私钥：只在工具箱/运营机（口令加密）；不进仓库、不进安装包
  └─ 公钥：内置到主应用与工具箱的"验证页"

配置加密密钥（AES-256-GCM）：与授权无关，只用于"防误看"配置
```

**硬约束**：**客户拿到的安装包里不存在任何签发路径**——由 `verify` 的"符号扫描断言"守住（主 bundle 里不得出现 `signLicense` / `privateKey` / `ed25519.sign`）。

### 9.2 文件契约

**请求文件** `.req.json`：

```jsonc
{
  "v": 1,
  "product": "visual-editor",
  "requestId": "uuid",
  "machine": { "fingerprint": "sha256:…", "os": "windows", "hostnameHash": "…" },
  "app": { "version": "0.3.0", "channel": "stable" },
  "customer": { "name": "…", "email": "…", "note": "…" }
}
```

**授权文件** `.lic.json`：

```jsonc
{
  "v": 1, "licenseId": "…", "edition": "pro",
  "features": ["export.docx", "export.pdf", "plugin.sign", "whiteLabel"],
  "machine": { "fingerprint": "sha256:…" },
  "issuedAt": "2026-09-28T02:00:00Z",
  "notBefore": "2026-09-28T02:00:00Z",
  "startsAt": "issue",
  "term": { "months": 3 },
  "expiresAt": "2026-12-28T02:00:00Z",
  "graceDays": 14,
  "remindDays": [30, 7, 1],
  "maintenanceUntil": "2026-12-28T02:00:00Z",
  "maxVersion": "0.5.x",
  "maxSeats": 1,
  "notes": "…",
  "sig": "base64-ed25519-signature"
}
```

**签名规则**：对**规范化 JSON**（键排序、无空白）签名。

### 9.3 时间设计（五个概念分开）

| # | 概念 | 字段 | 到期后果 |
|---|---|---|---|
| 1 | 起算点 | `startsAt` | — |
| 2 | 有效期 | `term` + `expiresAt` | 到期 → 宽限 |
| 3 | 宽限期 | `graceDays` | 宽限结束 → 只读 |
| 4 | 维护期 | `maintenanceUntil` | 老版本继续能用，只挡新版本 |
| 5 | 提醒 | `remindDays` | 仅提示 |

**默认档位**（决策 #11）：`startsAt: "issue"`、`term: {months: 3}`、`graceDays: 14`、`remindDays: [30,7,1]`、`maintenanceUntil = 签发日 + 3 个月`。

### 9.4 七态状态机

```
试用中 → 有效 → 宽限中 → 已到期（只读）
                ↘ 时钟异常（只读）
永久有效（独立）
维护期外（有效但不可升级）
```

界面「关于」与提示条按七态显示。

### 9.5 只读态矩阵

| 允许 | 禁止 |
|---|---|
| 打开/浏览/复制内容 | 保存到工作区 |
| **保存为 HTML 文件**（Ctrl+S，复用「导出 HTML」） | 导出 Word |
| **导出 PDF**（免费） | 组件包签名与分发 |
| MCP 只读工具 | 白标 / MCP 写工具 |

### 9.6 版本分级

| 档位 | 能力 |
|---|---|
| **免费（社区版）** | 编辑器全部编辑、导出 HTML/JSON/PDF、外部组件热加载、保存为 HTML 文件、MCP 只读 |
| **收费（专业版）** | 导出 Word、批量导出、组件包签名、白标、MCP 写工具批量操作 |

**为什么 Word 收费 PDF 免费**：PDF 是"交付给人看"的终端格式（也是打印路径），Word 是"拿去继续编辑"的生产格式。

### 9.7 时钟不可信处理

| 情况 | 做法 |
|---|---|
| 系统时间被调早 | `lastSeenAt = max(lastSeenAt, now)`（多副本）；`now < lastSeenAt - 48h` → 标记 `clockAnomaly` → 只读 |
| 时间调到大到期后 | 按已过期处理 |
| 长期离线 | 不做联网义务 |
| 时区/夏令时 | 全链路 UTC |
| 异常 UX | 不删数据、不静默；提示条写明并给续期指引 |

---

## 第 10 章 工具箱独立应用

### 10.1 定位

**独立 Electron 应用**，代码在 `apps/toolbox/`，产物是**第二个 exe**。

**不通过客户渠道分发、不进 release 客户包、不进更新通道。**

### 10.2 为什么必须独立

签发能力必须与分发物**物理分离**。只要签发代码或私钥出现在客户安装包里，任何客户都能给自己签一份永久授权——授权就只是仪式感。

### 10.3 三个标签页

**10.3.1 配置页**

- 列出当前配置（脱敏）。
- 生成/轮换密钥。
- 加密（明文 JSON → app-config.enc）。
- 解密查看。
- 校验（字段/地址/端口）。
- 备份与回滚（带时间戳）。

**10.3.2 授权页（唯一签发处）**

- 读请求文件 → 选版本/功能/有效期/维护期 → 生成签名授权文件。
- 本地台账（licenseId / 时间 / 客户 / 指纹 / 有效期，可导出 CSV）。
- 续期与吊销（吊销名单下发）。

**10.3.3 诊断页**

- 端口探测（37650 / 37651）。
- 版本与运行时。
- 日志打包导出。
- 一键自检（复用主应用 `--selftest`）。

### 10.4 安全铁律

| # | 铁律 | 断言 |
|---|---|---|
| 1 | 主应用不含签发路径 | 主 bundle grep 无 `signLicense`/`privateKey`/`ed25519.sign` |
| 2 | 私钥不进仓库、不进安装包 | `git ls-files` 与 `release/` 里没有私钥 |
| 3 | 工具箱不进客户分发 | `release/` 客户包里没有工具箱 |
| 4 | 主应用只有两件事 | 生成请求（只读指纹）+ 导入授权（只验签） |
| 5 | 工具箱默认不联外网 | 除"打开下载页"外无网络 |

---

## 第 11 章 MCP 服务器重构

### 11.1 三层能力

| 层 | 作用 | 触发 |
|---|---|---|
| Live Bridge | 与运行中编辑器实时通信 | 编辑器已启动并开启桥接 |
| Headless Engine | 读写磁盘文档 JSON | 无运行实例时自动降级 |
| Plugin Manager | 管理 `public/组件/` | 始终可用 |

### 11.2 双 transport

| Transport | 启动 | 用途 |
|---|---|---|
| stdio | `editor-mcp --stdio` | 本地 MCP 客户端 |
| Streamable HTTP | `editor-mcp --http --port 37651` | 远程/多客户端 |

### 11.3 十三域 108 工具（保留 + 扩展）

保留现状 108 工具，新增：

| 域 | 新增 |
|---|---|
| `license` | `license.status` / `license.request` / `license.import`（P6） |
| `bridge` | `bridge.status`（含 protocol/features/tokenRequired） |

### 11.4 桥接协议升级

| 项 | 现状 | P0/P1 后 |
|---|---|---|
| 版本闸门 | 全等比较 | protocol + features 协商 |
| 未知方法 | 硬报错 | 降级无头 + 提示 |
| Origin | 无校验 | 有 Origin 必须命中白名单 |
| token | 无 | Bearer 强制 |
| 会话 | 有状态 + 复活 | 保持 |

### 11.5 单一来源落地

| 事实 | 唯一写入者 | 断言 |
|---|---|---|
| 版本号 | 根 `package.json` | `tools/sync-contracts.mjs --check` |
| 桥接方法清单 | `contracts/protocol.ts` | 编辑器 switch 与 MCP 工具表都比对 |
| 组件清单形状 | `contracts/component.ts` | 四处读取一致 |
| 表格内核 | 编辑器源码 | MCP 侧由 sync 生成，同组用例结果相等 |

### 11.6 MCP Server 规范

**11.6.1 启动流程**

```ts
async function main() {
  parseArgs();
  setDebug(opts.debug);
  await setupEditorKit();          // 挂 window.EditorKit（无头沙箱用）
  const hub = await ensureHub();   // 先探再绑
  const live = await attachLive(); // 接 Live Bridge
  const server = buildServer({ hub, live });
  await startTransport(server, opts);
}
```

**11.6.2 生命周期**

- 启动时打印版本、协议版本、能力清单。
- SIGINT/SIGTERM 优雅退出（关 hub、断 Live、flush 日志）。
- 未捕获异常记日志 + 退出码 1。

**11.6.3 日志**

- stderr 输出，`--debug` 时打印每个 MCP 消息的请求/响应摘要。
- 不把 token 写进日志。

---

## 第 12 章 桌面外壳重构

### 12.1 boot() 八步（保留，P0 加 token）

```
setClientVersion(app.getVersion())
app.setName('webedit')             ← P3.5 新增，必须在 getPath('userData') 之前
① resolveLayout()
② createLogger()
③ loadAppConfig()
④ resolveComponentsDir()
⑤ startWebServer()
⑥ createUpdater()
⑦ createWindow()
⑧ createMcpSupervisor()            ← P0 注入 EDITOR_MCP_TOKEN
```

### 12.2 命名与标识（P3.5）

| 用途 | 改为 |
|---|---|
| npm 包名 | `webedit` |
| productName / exe | `webedit` |
| appId | `com.webedit.app` |
| userData | `%APPDATA%\webedit` |
| MCP 自报名 | `webedit` |
| **窗口标题/菜单/关于** | **不变**（「可视化编辑器」） |

### 12.3 userData 迁移（决策 #14：移动）

1. 移动前写清单（相对路径 + 字节数 + 关键文件 SHA-256）。
2. `rename`（同盘符原子操作）。
3. 移动后复核清单：文件数一致、关键哈希一致 → 写迁移标记。
4. 复核失败 → 移回去并报错，绝不留半迁移状态。
5. 跨卷失败 → 复制 + 复核 + 删除源。
6. 幂等：已迁移则什么都不做。
7. 断言：造假的旧目录，首启后新目录齐全、旧目录不再存在、标记存在；再启一次不重复；破坏清单能回退。

### 12.4 打包配置

| 项 | 值 |
|---|---|
| `appId` | `com.webedit.app` |
| `productName` | `webedit` |
| `directories.output` | `../../release` |
| 目标 | `nsis` + `portable` |
| `artifactName` | `${productName}-${version}-${arch}.${ext}` |
| `win.signAndEditExecutable` | `false`（评估用 rcedit 写版本资源） |
| `extraResources` | `web-editor/dist`、`web-editor/public/组件`、`dist/mcp/editor-mcp.bundle.mjs`、`tools/secure-config`、`config/*` |

### 12.5 exe 元数据（P3 评估）

- 用 `rcedit` 直接写图标与版本资源（不需要签名工具链）。
- Task Manager 显示产品名而非 "Electron"。
- 代码签名留到有证书时再说。

---

## 第 13 章 开发流程与协作规范

### 13.1 分支模型

采用 **GitHub Flow** 简化版：

```
main                ← 受保护，只接受 PR
  ├─ feature/<scope>-<desc>      功能
  ├─ fix/<scope>-<desc>          修复
  ├─ security/<desc>             安全修复（走 fast-track）
  ├─ migrate/<M号>               目录迁移（一次一个 M 号）
  └─ refactor/<P阶段>            大重构（P0/P1/P2...）
```

- `main` 必须可构建、可发布。
- 每个 PR 至少 1 人 Review（安全相关 2 人）。
- 大重构按 P 阶段拆 PR，**一次一个 M 号**。

### 13.2 PR 规范

**13.2.1 模板**

```markdown
## 目的
关联 ISSUE / ARCHITECTURE 章节

## 变更
- 文件 1：做了什么
- 文件 2：做了什么

## 验证
- [ ] `tsc -b` 0 错
- [ ] `npm run build` 成功
- [ ] `?check=1` 全绿
- [ ] `npm run verify` 全绿
- [ ] 相关端到端脚本

## 回滚
`git revert <sha>` 即可

## 影响面
- 对用户：
- 对开发者：
- 对 agent：
```

**13.2.2 Review 清单**

- [ ] 契约改动是否更新 `contracts/` 与生成物？
- [ ] 单一写入者原则是否被破坏？
- [ ] 是否新增 `any` 或 `@ts-ignore`？
- [ ] 是否新增未接线的代码/导出？
- [ ] 是否有硬编码路径/端口？
- [ ] 破坏性操作是否有 `confirm`？
- [ ] 是否影响 agent 链路（需在 CHANGELOG 提示）？
- [ ] 是否有断言覆盖？

### 13.3 CI/CD（`.github/workflows/`）

**13.3.1 PR 流水线**

```yaml
name: PR Check
on: [pull_request]
jobs:
  check:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24' }
      - run: npm run setup
      - run: npm run build
      - run: npm run verify
      - run: npm run e2e:smoke
```

**13.3.2 发布流水线**

```yaml
name: Release
on:
  push:
    tags: ['v*']
jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm run setup
      - run: npm run dist
      - run: ./release/webedit-*.exe --selftest
      - uses: actions/upload-artifact@v4
        with: { name: release, path: release/* }
```

### 13.4 提交规范

见 §5.7。追加规则：

- `security:` 类提交必须引用决策编号或 ISSUE。
- `migrate:` 类提交必须引用 M 号（M1-M9）。
- 破坏性变更在 footer 加 `BREAKING CHANGE:`。

### 13.5 版本策略（决策 #5）

- 本次大版本重构发 `0.3.0`。
- 之后 `0.3.x` 修 bug、`0.4.0` 加功能。
- **不再跳号、不回头补 0.2.x**。
- `1.0.0` 留给"契约与目录冻结、API 稳定"。

### 13.6 CHANGELOG 规范

Keep a Changelog 格式 + 语义化版本：

```markdown
## [0.3.0] - 2026-XX-XX
### Added
- 安全：Origin 白名单 + Bearer token（决策 #1）
### Changed
- BREAKING: agent 侧配置需补 headers.Authorization
- 目录：交付物移至 dist/，发行物移至 release/
### Fixed
- PDF 导出改为 printToPDF，消除空白页
### Security
- 密钥 config.key 移出版本库
```

### 13.7 三大流水线的完成定义

| 流水线 | 放哪 | 契约规则 | 必须过的闸门 |
|---|---|---|---|
| 编辑器内核 | `web-editor/src/{components,store,utils,registry}` | 只做 additive；破坏性 bump contract 主版本 | tsc + build + check + audit:dark |
| 组件/插件 | 内置 `src/registry/components/**`；外部 `public/组件/*.js` | 同一 ComponentDefinition；api 主版本声明 | plugin.validate + dryRun + 重载 + check |
| MCP 工具 | `editor-mcp/src/tools/*` | 名稳定；新增工具=additive；新增参数可选 | tsc + --list 数量断言 + e2e |
| 桌面外壳 | `apps/desktop/**` | IPC 只增不改语义；配置键只增不重命名 | verify + selftest |
| 工具箱/授权 | `apps/toolbox/**` + `tools/secure-config/**` | 签发只在工具箱；格式版本化；时间字段只增不改 | 独立构建 + 主应用无签发符号 |
| 导出契约 | `web-editor/src/utils/export/*` | 只降级不改语义；MD 有损单向 | docx 含 word/media、export.pdf 真产出、MD 提示条 |

---

## 第 14 章 测试与验收

### 14.1 测试金字塔

```
       E2E（少量、慢）
      ────────────────────
      集成（中量）
    ──────────────────────────
    单元（大量、快）
```

| 层 | 覆盖 | 工具 |
|---|---|---|
| 单元 | 纯函数（`escapeHtml` `ptToPx` `parseTableData` `term.mjs`） | node:test / vitest |
| 集成 | 桥接、MCP 工具、插件沙箱 | `editor-mcp/scripts/*.mjs` |
| E2E | Live 通道、多实例、会话自愈、导出 | `agent-live-check` 等 |
| 自检 | 页面全流程 | `?check=1`（295） |
| 发布断言 | 打包产物 | `--selftest`（9） |

### 14.2 现有闸门（P0 前基线）

| 闸门 | 命令 | 现状 |
|---|---|---|
| 类型检查 | `tsc -b` | 0 错 |
| 前端构建 | `npm run build` | 成功 |
| 页面自检 | `?check=1` | 295/295 |
| 暗色审计 | `npm run audit:dark` | 108 类全覆盖 |
| 桌面断言 | `npm run verify` | **78/78**（P0 新增 2 条：密钥不被跟踪 / 无老 buildKey.js 分支） |
| 打包自检 | `--selftest` | **10/10**（P0 新增"不带 token 的客户端被拒 401"） |
| 鉴权端到端 | `node scripts/auth-check.mjs` | **13/13**（P0 新增脚本：401/403 ×3/200/写禁用/WS 握手） |
| 单元测试 | `npm test`（editor-mcp，vitest） | **83/83**（守卫 18 + 表格内核一致性 65） |

### 14.3 P0 后新增断言

- **安全**：跨源被拒 / 无 token 回 401 / 有 token 通过 / 写禁用时写工具被拒且提示可读 / autoBridge 三态一致。
- **单一来源**：版本号跨包一致 / 契约一致 / 清单形状一致 / 表格内核同源。
- **路径**：`git check-ignore` 断言 / 相对路径解析断言。
- **userData**：目录名 = `webedit` / 迁移只发生一次且内容齐全。
- **导出契约**：docx 含 `word/media` 与 `<w:fldChar>` / `export.pdf` 真产出 `%PDF-` / MD 导出提示条。
- **授权**：主 bundle 无签发符号 / 无授权时导出 Word 被拒 / 到期/宽限/只读三态可复现 / 时钟回拨检测。
- **PDF 空白页**：PyMuPDF 检测固定样张（①普通多页 ②末尾分页符 ③连续分页符 ④跨页长表 ⑤末页只有一张图 ⑥正好填满一页），要求**实际页数 == 期望页数 且 空白页数 == 0**。

### 14.4 端到端脚本（保留 + 扩展）

| 脚本 | 现状 | P0 后 |
|---|---|---|
| `smoke.mjs` | ✅ | — |
| `bridge-status.mjs` | ✅ | 增加 protocol/features 展示 |
| `agent-live-check.mjs` | 5/5 | 加"token 模式"与"无 token 被拒"两条 + PDF 导出一条 |
| `multi-connection-check.mjs` | 10/10 | — |
| `session-revive-check.mjs` | 7/7 | — |
| `pdf-blank-check.mjs` | 新增 | 固定样张断言 |

### 14.5 验收标准（重构完成的定义）

- **干净克隆**：`git clone` → `npm run setup` → 三条命令内跑出可用的开发态；`npm run verify` 全绿；不需要手工把 `node_modules` 从别的包借过来。
- **干净机器**：只装我们发的 exe → 首启自动种子组件、生成 token、起 MCP、页面接上桥接 → `--selftest` **10/10**。
- **没有第二份**：单文件 MCP 只 1 份生成路径；表格内核/转义/清单/静态服务器各 1 处实现；版本号 1 处来源。
- **没有临时垃圾**：仓库内不存在 `.tmp-*`、`.asar-probe/`、包内 cache/报告；`git check-ignore` 断言全过。
- **安全闭环**：跨源被拒 / 无 token 回 401 / 密钥出库 / 分发版无签发符号。
- **用户体验**：菜单符合通行预期；PDF 导出可用；安装包名与界面名一致。

---

## 第 15 章 重构路线图

### 15.1 阶段总表

| 阶段 | 内容 | 人日 | 关键交付 |
|---|---|---|---|
| **P0 安全** | Origin + token + allowWrite 默认关 + autoBridge 联动 + 密钥出库 | 3.1（3–4） | 安全边界闭环 |
| **P1 单一来源** | 清单形状 + 协议协商 + sync-contracts + 表格内核同源 | 3.0（3–4） | 版本 1 处来源 |
| **P2 契约层 + 编排** | 根 package.json + contracts/ + bundle 自带 esbuild + 静态服务器归一 | 3.6（3.5–4.5） | 一条命令跑完 |
| **P3 目录重排** | M1–M9 逐条 | 4.0（4–5） | 五类分离 |
| **P3.5 改名 + 迁移** | webedit + userData 移动 | 2.1（2–2.5） | 标识与品牌分离 |
| **P4 菜单改版** | M-1…M-13 | 2.5（2.5–3） | 符合通行预期 |
| **P4.5 导出契约** | E1 docx + E2 printToPDF + 空白页 + E3 MD 提示 | 4.3（4–5.5） | agent 能真交付 PDF |
| **P5 工具箱** | 独立应用三页 | 2.8（2.5–3） | 第二个 exe |
| **P6 授权体系** | L1–L6 | 4.6（4–5） | 离线授权闭环 |
| **P7 冻结** | AGENTS.md + skill + README + CHANGELOG + E4 | 1.0（1–1.5） | 新人一页上手 |

**合计**：约 31 人日（31–38），含 15% 缓冲 ≈ **35–44 人日**。

### 15.2 依赖关系

```
P0 ─▶ P1 ─▶ P2 ─┬─▶ P3（目录）─▶ P3.5（改名 + userData 迁移）
                 ├─▶ P4（菜单）─▶ P4.5（导出契约）
                 ├─▶ P5（工具箱）─▶ P6（授权）
                 └─▶ P7（冻结）
```

- **P0 不能等**：这是当前唯一的"可被外部网页利用"的口子。
- **P1/P2 是 P3 的地基**：契约与版本先单一来源，再搬目录。
- **P3.5 紧跟 P3**：改名会同时影响 `release/` 产物名与 userData 路径。
- **P4.5 的 E2 是短板补强**：把 PDF 从"人工打印"变成"程序可产出"。
- **P5/P6 的硬约束**：签发只在工具箱，不能"先塞主应用以后再拆"。

### 15.3 每阶段的施工纪律

1. **一次只做一个 M 号或一个小步**，独立提交。
2. 动文件前：`git status` 干净 → 需要时先备份。
3. 活文档只允许"先复制 + 哈希比对 + 再切默认"。
4. 脚本里的相对深度改动必须一次改完并跑 `node --check`。
5. 每阶段结束跑**四件套** + 相关端到端脚本。
6. 回滚 = `git revert` + 删除新目录（产物/运行数据可重建）。

### 15.4 最小价值路径

**P0 → P4.5-E2 → P1** ≈ 8–11 人日，就能拿到三件用户可感知的事：

1. 本机端口不再可被网页利用。
2. agent 能真正交付 PDF（现在只能提示人工打印）且不再有空白页。
3. "编辑器升级、MCP 没升级"不再整体失去 Live。

---

### 15.5 P0 实际施工记录（2026-09-28，**进行中**）

按"一步一提交、每步跑闸门"推进；本节记录**已落地**与**偏差/决策**，后续每轮追加。

**已落地（P0.1 服务端 + P0.2 桌面端 token 闭环）**

| # | 计划项 | 落地位置 | 状态 |
|---|---|---|---|
| ① | HTTP `Origin` 白名单 + `Host` 校验 + 缺 token 401 | `editor-mcp/src/security/guard.ts`（纯函数）、`src/http.ts`（Host→Origin→token 顺序判定，401/403 + 可编程错误码） | ✅ |
| ② | WS hub `Origin` 校验 + hello 带 token | `src/bridge/host.ts`（升级期判 Origin，不过则 1008；hello 判 token，失败回错并关闭）、`src/bridge/liveBridge.ts`（MCP 侧 hello 带 token） | ✅ |
| ③ | 桌面版生成/注入 `userData/bridge-token` + 页面取 token | `apps/desktop/main.js`（`readOrCreateBridgeToken()` 持久化）、`src/mcpSupervisor.js`（子进程 env 注入 + 探测带 Authorization）、`preload.cjs`、`web-editor/src/mcp/bridgeClient.ts`（`?bridgeToken=` → 桌面 `getStatus().mcp.token`）、`src/utils/desktopChrome.ts`（类型补 `token?`） | ✅ |
| ④ | 一键复制带 token 的客户端配置 | `main.js` 新增 `desktop:copy-mcp-config`（只复制文本，**不替别的应用写配置、不自动发 token**）+ `preload.copyMcpConfig` | ✅（菜单入口待 P4 接） |
| ⑦ | 新增错误码 | `src/errors.ts`：`UNAUTHORIZED`、`ORIGIN_REJECTED`（现状 18 → 20） | ✅ |

**验证证据（本机实测，命令可复跑）**

| 闸门 | 结果 |
|---|---|
| `editor-mcp` `tsc -b` | 0 错 |
| `editor-mcp` `npm test` | **83/83**（新增 `tests/guard.test.ts` 18 例：跨源拒绝 / Origin=null / DNS rebinding Host / Bearer 解析 / 常量时间比较 / 组合顺序） |
| `node scripts/auth-check.mjs`（新） | **12/12**：缺 token→401、token 错→401、跨源→403、Origin=null→403、坏 Host→403、本机 Origin+token→200、跨源 WS→1008、hello 无/错 token→拒绝、hello 正确→ok、日志有拒绝记录 |
| `node scripts/session-revive-check.mjs` | 7/7（脚本改为自生成 token，覆盖带 token 路径） |
| `node scripts/multi-connection-check.mjs` | 10/10（同上，含编辑器侧 hello 带 token） |
| `apps/desktop` `npm run verify` | **76/76**（E/G 段现在真实走 token 路径） |
| `web-editor` `npm run build` | ✅（tsc + vite） |

**偏差与决策（写下来免得后人踩）**

1. **`requireToken` 默认 `true` 已生效**：为让既有回归脚本与新闸门都跑通，`session-revive-check` / `multi-connection-check` 改为**自己生成 token**并全程带上；`verify-desktop.mjs` 用固定测试 token 贯穿所有 `createMcpSupervisor` 与探测。缺 token 的行为由 `auth-check.mjs` 专门验证（这才是"默认拒绝"的证明）。
2. **token 持久化在文件而非每次随机**：`userData/bridge-token`，否则用户每次重启都要重新复制 agent 配置。
3. **删掉了手写类型垫片 `editor-mcp/src/types/ws.d.ts`**，改用 `@types/ws`：垫片里 `close()` 只声明 0 参，导致本轮回调带 `1008` 时 `tsc` 报错（垫片自己的注释就写着"装了 `@types/ws` 后删掉本文件即可"）。
4. **页面侧 token 取值优先级**：`?bridgeToken=…`（自检/开发）→ 桌面 `getStatus().mcp.token` → 不带。浏览器裸连且对方开了校验时**应当被拒**，这是设计而非缺陷。

---

### 15.6 P0 实际施工记录（第 2 轮：⑤ 写开关 + ⑥ 密钥出库收尾）

| # | 计划项 | 落地位置 | 状态 |
|---|---|---|---|
| ⑤·默认 | `allowWrite` **默认关**（决策 #2） | `editor-mcp/src/config.ts`（`envBool('EDITOR_MCP_ALLOW_WRITE', false)`）；`apps/desktop/config/app-config.example.json` 改 false 并**重新加密 app-config.enc**（旧文件备份 `app-config.enc.bak-20260928`） | ✅ 实测新起 MCP 日志：`写开关 ALLOW_WRITE=false` |
| ⑤·开关 | 首选项开关**真正作用到 MCP** | `main.js`：`userData/prefs.json` 读写 + `resolveAllowWrite()`（首选项优先，其次加密配置）+ IPC `desktop:set-allow-write`（写 prefs → `mcp.setAllowWrite()` → **重启 MCP**）；`mcpSupervisor.js` 新增 `allowWriteValue`/`setAllowWrite()`；`preload.cjs` 暴露 `setAllowWrite`；`desktopChrome.ts` 补类型 | ✅ |
| ⑤·三态 | autoBridge **三态如实显示**（未启用 / 写已禁用 / 掉线） | `bridgeClient.ts`：`desktopWrite` + `refreshDesktopWriteState()`，`bridgeSummary()` 在 connected 且写禁用时输出 **"已连接 · 写已禁用（只读）"**，并进订阅快照；`PreferencesDialog` 切完开关主动刷新 | ✅ |
| ⑤·界面 | 首选项里可切换 | `PreferencesDialog.tsx` 新增「允许 MCP 写操作」（桌面版才可操作；浏览器只读说明"由启动 MCP 的一方决定"） | ✅ |
| ⑥ | `config.key` 出库断言 + 删 `buildKey.js` 老分支 | `verify-desktop.mjs` 新增两条断言（`git ls-files` 必须失败 + `git check-ignore` 必须命中；`paths.js`/`secureConfig.js` 不得再有 `buildKeyLegacyPath`）；删除 `paths.js` 的 `buildKeyLegacyPath` 与 `secureConfig.js` 的回退候选、文案统一为 `buildKey.mjs` | ✅ |
| ④·入口 | 菜单入口接上 | `MenuBar.tsx`「工具」菜单新增 **「复制 MCP 客户端配置（含 token）」** → `copyMcpConfig`（并提示"token 等同密码"） | ✅ |
| 脚本 | 诊断脚本适配 token | 新增 `scripts/lib/bridge-token.mjs`（`EDITOR_MCP_TOKEN` → `%APPDATA%\可视化编辑器\bridge-token` → `EDITOR_MCP_TOKEN_FILE`）；`bridge-status.mjs` / `agent-live-check.mjs` 带票并打印来源，401 时直接给出"三步取票"提示 | ✅ |

**第 2 轮验证证据**

| 闸门 | 结果 |
|---|---|
| `editor-mcp` `tsc -b` / `npm test` | 0 错 / **83/83** |
| `node scripts/auth-check.mjs` | **12/12** |
| `session-revive-check` / `multi-connection-check` | **7/7** / **10/10** |
| `apps/desktop npm run verify` | **78/78**（新增 2 条密钥/老分支断言） |
| `web-editor npm run build` | ✅ |
| `bridge-status.mjs` 实测 | 无票 → 打印 401 + 三步取票提示；带票 → 正常读到 bridge status |
| 写开关实测 | 新起 MCP 日志 `ALLOW_WRITE=false`；`app-config.enc` 解密后 `allowWrite: false` |

**P0 剩余（第 3 轮）**：把 token 交给用户补 DSH 配置并重启 DSH（见 §15.5 的时点表）；`agent-live-check` 的 PDF 一条留到 P4.5-E2。

**P0 收尾实测（第 3 轮）**：真实桌面自检 `--selftest` **10/10**（新增"不带 token 的客户端被拒 401"一条，正好抓出旧自检没带票的 A 段问题）；`auth-check` 增补"写禁用时写工具被拒且提示可读" → **13/13**；三份文档的闸门数字已刷新（verify 78 / selftest 10 / unit 83 / auth 13）。

另外查清一处**用户侧配置事故**（不是产品缺陷）：DSH 的 `mcp-mcp-editor` 条目把 `headers` 写成了字符串（schema 要求"头名→值"对象）→ 配置校验失败、插件挂载不了、工具全无。正确写法见 §15.4 的配置片段；现已修正并验证（工具注册 + 真调用成功）。

---

### 15.7 P4 实际施工记录（进行中）

**D16（原生 `title` → 自研气泡）—— ✅ 已完成**

| 项 | 内容 |
|---|---|
| 口径更正 | 审计报的是 **24 处**（只扫 `panels/` 与 `property-controls/`、用窄正则）；**全仓实际 88 处 DOM 原生 `title`**，分布 **32 个文件**（Canvas 缩放条 / 翻页标签 / 表格浮层拖拽柄 / 富文本工具条 12 处 / 表格控件 9 处 / 工具栏共用按钮…）。原正则还把 `data-new-doc-title="1"` 这类**误算**进来。 |
| 方案选择 | **不逐个包 `<Tooltip>`**：它会多渲染一层 `<span>`，行内/弹性布局的宿主元素（按钮、色板、截断文本）会因此移位。改为给 Tooltip 加**事件委托层**（`TooltipLayer`）：元素只写 `data-tip-text="…"`，全局层在 `document` 上委托 `mouseover`/`focusin`，用与 Tooltip **完全相同**的气泡样式渲染（`position: fixed`、400ms 延迟、跟随鼠标、边缘翻转、多行首行加粗）→ **DOM 结构零变化**。 |
| 落地 | `ui/Tooltip.tsx`（+`TIP_ATTR`、+`TooltipLayer`）；`App.tsx` 挂载一次；32 个文件 88 处 `title={` → `data-tip-text={`。**组件 prop 一律不碰**：`<Modal title>`、`<Section title>`、`<ToolButton title>` 保持原样，其中 ToolButton 内部那一处转成 `data-tip-text={title}` → 工具栏 15 个按钮一次性受益。 |
| 防回潮断言 | `verify-desktop.mjs` +2 条：① JSX 感知扫描——`title` 的宿主标签若是**小写**（DOM 元素）即违规（按大括号深度跳过箭头函数里的 `>`）；② `TooltipLayer` 必须被 import 且渲染（否则 `data-tip-text` 是死属性）。 |
| 验证 | `web-editor npm run build` ✅；`apps/desktop npm run verify` **80/80**（原 78 + 新增 2）；复核扫描：**DOM 原生 title 剩余 0 处**（剩余 29 处全是组件 prop）。 |

**下一步（同一阶段）**：M-1…M-13 菜单改版（首选项归位、关于/更新归帮助、组件包归文件、补剪切/查找/全屏/Ctrl+Y/最近文档、模式入口），按 §7.3 目标结构分两次提交，并补"菜单结构断言"与"快捷键一致性断言"。

**M-1…M-5 / M-10 / M-12 / M-13 已落地（第 1 次提交，结构类）**

| 项 | 落地 |
|---|---|
| 菜单原语 | `ui/Menu.tsx` 新增**子菜单**支持（`MenuItem.submenu` + `SubMenu`：悬停/聚焦展开、右缘自动左翻、`data-menu-sub`/`data-menu-panel` 便于断言）——§7.3 的 `导出 ▸` / `组件包 ▸` / `模式 ▸` 依赖它 |
| M-1 | 首选项 → **编辑**末项 + `Ctrl+,`（并**真绑上**快捷键）；视图只管显示 |
| M-2 | 「图表按章编号」→ **页面**（它改的是输出内容） |
| M-3 | 「关于」**只留一处**在帮助（桌面版给全量运行环境 + 写入开关；网页版给一句话） |
| M-4 | 检查更新 / 下载页 → **帮助**（工具只留 MCP 运维与目录） |
| M-5 | 组件包 → **文件 → 组件包 ▸**；组件与属性说明清单 → **文件 → 导出 ▸** |
| M-10 | 「保存（导出 JSON）」拆成 **保存为 HTML 文件（Ctrl+S）** 与 **导出 JSON…（Ctrl+Shift+S）**；新增 `layout/fileActions.ts` 让**菜单与快捷键共用同一实现**（否则菜单标了 Ctrl+S 按下去没反应） |
| M-12 | **视图 → 模式 ▸**（标出当前模式）。★与 §7.3 的偏差：那里写「文档/Web/PPT」，但**编辑器实际只有两种模式**（`EditorMode='document'\|'web'`），PPT 是组件类别 → 菜单只列两个，免得给出点了没用的入口 |
| M-13 | 「页面」菜单首行标出当前是哪套（文档模式 / Web 模式） |

**新增的验证手段（这一轮的关键收获）**：`apps/desktop/scripts/check-page.mjs`（`npm run check:page`）——
用 **CDP** 无头跑页面自检，把 `document.title` 的结论与 FAIL 明细读回命令行。
自检原本会**发布两次**结论（同步段 17 条 + DOM/交互段全量），探针一度只读到中途的 `17/17`；
现在 `selfCheck.finish(final)` 会在全量那次打上 `data-selfcheck-done=1`，探针据此收尾。

**本轮实测**：页面自检 **305/307**；失败的 2 条都是**布局类且与本轮改动无关**（`git log -S` 证明其断言来自今天之前的提交）：
① 「窗口放不下整张纸时预览自动缩小」——把容器缩到 50px 仍要求"纸张始终放得下"，而预览缩放有下限；
② 「标尺脱离画布固定在视口顶部」——期望值与实际相差 `-0px` vs `0px`（字符串比较）。
两条记入待办，与 P4.5（画布/打印几何）一起处理。

**M-6/M-7/M-8 已落地（第 2 次提交，能力类）**

| 项 | 落地 |
|---|---|
| M-6 剪切 | store 新增 `cutSelection()`（复制首项进剪贴板 + **一步**删掉所有选中，可 Ctrl+Z 撤销）；菜单「编辑 → 剪切 `Ctrl+X`」；快捷键绑定 |
| M-7 全屏 + 缩放标注 | 新增 `utils/viewActions.ts#toggleFullscreen()`：**桌面版走窗口全屏 IPC**（`desktop:toggle-fullscreen`；网页 Fullscreen API 会把无边框窗口的标题栏覆盖层一起带走）、浏览器退回 DOM API；「视图 → 全屏 `F11`」；缩放收进 `缩放 ▸` 并标出 `Ctrl+= / Ctrl+- / Ctrl+0`；`desktop:status` 增加 `fullscreen` 字段（让"按了有没有反应"可被断言观测） |
| M-8 Ctrl+Y | 重做同时支持 `Ctrl+Y`（菜单显示这个）与 `Ctrl+Shift+Z`；快捷键表同步 |
| §7.4 静态兜底 | verify 新增：**菜单上标注的每一条快捷键都必须有实现**（`Ctrl+P` 由浏览器负责，豁免）——防"标了 Ctrl+S 按下去没反应" |
| 快捷键说明表 | `ui/Modal.tsx` 的 `SHORTCUTS` 补齐：打开/保存/导出 JSON/打印/剪切/Ctrl+Y/全屏/首选项 |

**本轮实测（第 2 次提交后）**

| 闸门 | 结果 |
|---|---|
| `web-editor npm run build` | ✅ |
| `apps/desktop npm run verify` | **81/81**（80 + 新增快捷键一致性 1 条） |
| `npm run check:page`（页面全量自检） | **308/310**（新增 3 条行为断言全过：Ctrl+X 剪切→剪贴板+可粘贴、Ctrl+Y 重做、**F11 真切换窗口全屏**） |
| 仍失败的 2 条 | 既有布局问题（见上一节），与 P4 无关，待与 P4.5 一起处理 |

**P4 剩余**：M-9 **查找/替换（Ctrl+F）** 与 M-11 **最近打开** —— 这两条是**新功能**（不是菜单搬家），各自单独提交。

---

## 第 16 章 数据迁移指南

### 16.1 userData 迁移（P3.5）

**触发**：首次启动新版，检测到旧目录 `%APPDATA%\可视化编辑器` 存在且新目录 `%APPDATA%\webedit` 不存在。

**步骤**：

1. 扫描旧目录，生成清单 `{ path, size, sha256 }[]`。
2. 写清单到 `%APPDATA%\webedit.migrate.json`。
3. `fs.rename(old, new)`（同盘符原子）。
4. 复核：文件数一致 + 关键文件哈希一致。
5. 成功 → 写迁移标记（时间/文件数/来源）→ 提示条说明。
6. 失败 → `rename(new, old)` 回退 → 报错。
7. 跨卷失败 → 复制 + 复核 + 删除源。

**幂等**：迁移标记存在且新目录齐全 → 什么都不做。

**负例断言**：破坏清单中一个哈希 → 迁移回退、两处都不丢。

### 16.2 组件目录迁移

- 分发版：随包种子 → 首启拷贝到 `userData/组件`（已存在不覆盖）。
- 开发版：直接用 `web-editor/public/组件`。
- 断言：编辑器与 MCP 指向同一目录。

### 16.3 活文档迁移（M5）

- `editor-mcp/workspace/` → `var/mcp-workspace/`。
- **先复制 → `Get-FileHash` 逐文件比对 → 切默认 → 保留旧目录一个版本周期**。
- 断言：`doc.list` 数量一致。

### 16.4 配置迁移

- `config.key` 出库：从 git 移除 + 加 `.gitignore` + 保留 `buildKey.mjs` 作为分发形态。
- 新增键：`mcp.requireToken`（默认 true）、`mcp.originAllow`（默认 `http://127.0.0.1:*`）、`mcp.allowWrite`（默认 false）。
- **不重命名已有键**。

### 16.5 agent 侧配置迁移

- 升级后 agent 侧需补一次 `headers.Authorization: Bearer <token>`。
- token 由桌面版「工具 → MCP 桥接」一键复制提供。
- 写进发行说明。

---

## 第 17 章 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| P4.5 空白页反复 | +1–2 人日 | PyMuPDF 自动检测 + 固定样张；样式修补容易，断言才是交付物 |
| P6 授权跨两应用 | +1 人日 | 分 6 小步，每步可停 |
| P3 的 M1/M2 相对路径改动最易漏 | +0.5–1 人日 | 一次改完 + `node --check` + verify 路径断言 |
| P2 静态服务器归一 | +0.5 人日 | Node 为唯一实现，Python 降级为调 node |
| `.gitignore` 放宽导致产物入库 | 仓库膨胀、密钥暴露 | `git check-ignore` 断言进 verify |
| 中文目录名在 NSIS/zip 下 | 打包或解压异常 | 新目录 ASCII；产品目录名保持不动 |
| M5 活文档 | 用户文档丢失 | 复制 + 哈希比对 + 旧目录保留 |
| 契约层生成物被手工改 | 两端再次漂移 | 生成物带"DO NOT EDIT"头 + `--check` 模式断言 |
| 升级打断 agent 链路 | 用户需手工补 token | 发行说明 + 一键复制配置 |
| 授权私钥泄露 | 授权体系失效 | 私钥只在运营机 + 口令加密 + 不进仓库不进安装包 |

---

## 第 18 章 附录

### 18.1 术语表

| 词 | 含义 |
|---|---|
| Live | 工具调用经 hub 转发给正在运行的编辑器页面执行，实时同步 |
| 无头（headless） | 没有编辑器在线时，MCP 直接读写 workspace 文档，返回 `degraded:true` |
| hub / 中转 | 位于某个 editor-mcp 进程内的 WS 服务（37650） |
| 种子拷贝 | 分发版首启把随包组件目录复制到 `userData/组件` |
| 单文件 MCP | esbuild 打成的一个 `.mjs`，不依赖仓库 `node_modules` |
| 四件套 | `tsc -b` / `npm run build` / `?check=1` / `npm run verify`（+ 打包阶段 `--selftest`） |
| 契约层 | `contracts/` 下的协议/组件/配置/授权定义，唯一真相 |
| 单一写入者 | 每个事实只有一个地方能写 |

### 18.2 决策记录（16 条，来自 ARCHITECTURE §14）

| # | 决定 |
|---|---|
| 1 | token 强制；桌面版自动发放；不给其它应用自动发 |
| 2 | `allowWrite` 默认关 + 首选项开关 + autoBridge 联动 |
| 3 | Origin：有则必须命中白名单；无 Origin 放行交 token |
| 4 | 编译产物留包内，只移交付物/发行物/运行数据 |
| 5 | 版本从 0.3.0 起，之后正常递增 |
| 6 | 菜单全改（分两次提交） |
| 7 | 工具箱用 Electron 独立应用 |
| 8 | 工具箱代码放 `apps/toolbox` |
| 9 | PDF 免费、Word 收费；白标/批量/签名/MCP 写批量收费 |
| 10 | 离线授权 |
| 11 | 签发日起算、默认 3 个月、宽限 14 天、维护期 3 个月 |
| 12 | 到期只读；"保存到浏览器"改"保存为 HTML 文件" |
| 13 | appId=com.webedit.app、产物 webedit-0.3.0-x64.exe |
| 14 | userData 迁移用移动（清单 + 哈希复核 + 失败回退 + 幂等） |
| 15 | Markdown 保持单向 + UI 明确有损 |
| 16 | PDF 用 `webContents.printToPDF` + 空白页专章 |

### 18.3 全量清单位置索引

| 清单 | 本文位置 | 权威来源（可复跑） |
|---|---|---|
| 108 工具 / 23 资源 / 12 提示词 | §11.3 | `node dist/mcp/editor-mcp.bundle.mjs --list` |
| 88 桥接方法 | §6.3 | `contracts/protocol.ts`（生成） |
| 14 IPC 通道 / 22 preload 成员 | §6.7 | `main.js` / `preload.cjs` |
| HTTP 端点 | §6.6 | `webServer.js` / `http.ts` |
| 环境变量 / 配置键 | §6.8 | `config.ts` / `app-config.example.json` |
| 18 种属性控件 | §7.3 | `property-controls/index.tsx` |
| 7 分类 / 47 组件（44 内置 + 3 外部） | §7.2 | 注册表 + `?spec=1` |
| 端到端脚本 | §14.4 | `editor-mcp/scripts/` |
| 验证数字 | §14.2 | 四件套命令 |

### 18.4 关键文件位置速查

| 目的 | 文件 |
|---|---|
| 组件契约类型 | `contracts/component.ts` |
| 桥接协议 | `contracts/protocol.ts` |
| 配置 schema | `contracts/config.ts` |
| 授权格式 | `contracts/license.ts` |
| 注册表 | `web-editor/src/registry/index.ts` |
| 属性面板 | `web-editor/src/components/panels/PropertyPanel.tsx` |
| 18 种控件 | `web-editor/src/components/property-controls/` |
| 表格内核 | `web-editor/src/registry/components/common/tableKit.tsx` |
| 桥接客户端 | `web-editor/src/mcp/bridgeClient.ts` |
| 桥接方法 | `web-editor/src/mcp/liveMethods.ts` |
| MCP 工具 | `editor-mcp/src/tools/` |
| 桥接 hub | `editor-mcp/src/bridge/host.ts` |
| 无头引擎 | `editor-mcp/src/bridge/headless.ts` |
| 桌面主进程 | `apps/desktop/main.js` |
| 静态服务器 | `apps/desktop/server/webServer.js` |
| 授权签发（唯一） | `apps/toolbox/src/license/` |
| 加密原语 | `tools/secure-config/` |

### 18.5 一页纸速查（将建立为 `AGENTS.md`）

```
┌─ 目录边界 ──────────────────────────────────┐
│ 源码     */src/ */scripts/                  │
│ 契约     contracts/                          │
│ 编译产物 */dist/（不入库）                    │
│ 交付物   dist/（不入库）                      │
│ 发行物   release/（不入库）                   │
│ 运行数据 var/ %APPDATA%\webedit\             │
└──────────────────────────────────────────────┘

┌─ 单一写入者 ────────────────────────────────┐
│ 版本号      根 package.json                  │
│ 桥接方法    contracts/protocol.ts            │
│ 组件清单    contracts/component.ts           │
│ 表格内核    web-editor 源码                  │
│ 静态服务器  apps/desktop/server/webServer.js │
│ 单文件 MCP  dist/mcp/                        │
│ 授权签发    apps/toolbox/（不进客户分发）      │
└──────────────────────────────────────────────┘

┌─ 改完必跑（四件套） ────────────────────────┐
│ tsc -b && npm run build && ?check=1         │
│ && npm run verify                            │
│ 打包阶段追加 --selftest                       │
└──────────────────────────────────────────────┘

┌─ 硬约束 ────────────────────────────────────┐
│ ① 签发能力不进客户分发物                     │
│ ② 业务错误不静默降级                         │
│ ③ 破坏性操作必须 confirm                     │
│ ④ 网络面默认拒绝非本机来源                   │
│ ⑤ 每一步都能回滚                             │
└──────────────────────────────────────────────┘
```

---

**文档结束**

> 本文是施工蓝图，与 [ARCHITECTURE.md](ARCHITECTURE.md)（设计意图）、[现状文档.md](现状文档.md)（As-Is 快照）配合使用。
> 每个 P 阶段开工时，应在本文对应章节追加"实际施工记录"（含偏差与决策），使本文保持"活的施工手册"属性。
> **P7 冻结后，本文与 ARCHITECTURE.md 应一同并入仓库根目录，并在 AGENTS.md 中建立索引。**
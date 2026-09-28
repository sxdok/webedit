import { defineConfig } from 'vitest/config';

/**
 * editor-mcp 的单元测试配置（D17）。
 *
 * 注意 `server.fs.allow: ['..']`：本仓库**没有 npm workspace**，测试要 import 兄弟包
 * `web-editor/src/registry/components/common/tableKit.tsx` 来做"两份实现一致性"断言，
 * 默认 Vite 只允许项目根内的文件，这里显式放开到仓库根。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: 'default',
  },
  server: { fs: { allow: ['..'] } },
});

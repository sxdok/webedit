/**
 * Vite 配置：React + Tailwind（postcss 管道），base 用相对路径，
 * 这样 `npm run build` 出来的 dist 既能挂 HTTP 也能直接 file:// 打开。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/** 开发态也提供 /__components（列 public/组件/*.js），让热加载在 dev 与静态托管下行为一致 */
function componentsManifest(): Plugin {
  return {
    name: 'editor-components-manifest',
    configureServer(server) {
      server.middlewares.use('/__components', (_req, res) => {
        let files: string[] = [];
        try {
          files = fs
            .readdirSync(path.join(ROOT, 'public', '组件'))
            .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
            .sort();
        } catch {
          files = [];
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ files }));
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), componentsManifest()],
  server: { host: '127.0.0.1', port: 5178 },
  preview: { host: '127.0.0.1', port: 5179 },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // 注意：public/ 仍会被复制进 dist（dist 保持"任何静态服务器都能直接用"的自包含性）。
    // 因此 dist/组件 与 public/组件 会同时存在两份：
    //   · 运行时（启动器 / dev）**只认 public/组件**（见 启动编辑器.py 的 components_dir() 与
    //     vite 的 /__components 中间件），dist/组件 不会被服务；
    //   · 改外部组件请改 public/组件，不要改 dist/组件（后者每次构建都会被覆盖）。
    copyPublicDir: true,
  },
});

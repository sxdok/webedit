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
  build: { outDir: 'dist', sourcemap: true },
});

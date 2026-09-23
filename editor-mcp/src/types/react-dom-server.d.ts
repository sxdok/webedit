/**
 * `react-dom/server` 的最小类型声明。
 *
 * 为什么自己写：MCP 服务器只用到 `renderToStaticMarkup` 一个函数（插件 dryRun 的 SSR），
 * 装 `@types/react-dom` 只为这一行不值得；这里把用到的签名写清楚，剩下的交给运行时的 react-dom。
 * （如果以后要用更多 API，装 `@types/react-dom` 并删掉本文件即可。）
 */
declare module 'react-dom/server' {
  import type { ReactElement } from 'react';
  export function renderToStaticMarkup(element: ReactElement | null | undefined): string;
  export function renderToString(element: ReactElement | null | undefined): string;
}

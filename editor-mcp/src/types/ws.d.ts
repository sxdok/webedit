/**
 * `ws` 的最小类型声明。
 *
 * 为什么自己写：本机 pnpm store 里没有 `@types/ws`，而桥接中转（`src/bridge/host.ts`）
 * 只用到 ws 的很小一部分 API（WebSocketServer + 连接/消息/关闭事件）。
 * 这里把用到的签名写清楚；装了 `@types/ws` 之后删掉本文件即可。
 */
declare module 'ws' {
  import type { IncomingMessage } from 'node:http';

  export interface WebSocket {
    readonly readyState: number;
    send(data: string): void;
    close(): void;
    on(event: 'message', cb: (raw: { toString(enc?: string): string }) => void): void;
    on(event: 'close', cb: () => void): void;
    on(event: 'error', cb: (e: Error) => void): void;
  }

  export interface WebSocketServerOptions {
    host?: string;
    port?: number;
    path?: string;
  }

  export class WebSocketServer {
    constructor(options: WebSocketServerOptions);
    on(event: 'connection', cb: (ws: WebSocket, req: IncomingMessage) => void): void;
    once(event: 'listening', cb: () => void): void;
    once(event: 'error', cb: (e: Error) => void): void;
    close(cb?: () => void): void;
  }
}

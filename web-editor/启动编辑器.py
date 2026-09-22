# -*- coding: utf-8 -*-
"""可视化编辑器 启动脚本 —— 用 Python 内置 http.server 托管已构建的 dist/（单页应用）。

为什么不用 `npm run preview`：vite 的命令行要 esbuild 启动子进程，在受限沙箱下会报 spawn EPERM；
本脚本只做静态文件服务，不需要任何子进程，受限环境也能直接跑。

用法：
    python 启动编辑器.py                 # 托管 dist/，默认端口 5179，自动开浏览器
    python 启动编辑器.py -p 8080         # 指定端口
    python 启动编辑器.py -b              # 先执行 npm run build，再托管
    python 启动编辑器.py -q              # 不自动打开浏览器
    python 启动编辑器.py -c              # 带自检参数打开（?check=1，跑数据层/渲染层自检）

参数：
    -p, --port N      端口（默认 5179，占用则自动往后找）
    -b, --build       启动前先构建（npm run build）
    -q, --no-browser  不自动打开浏览器
    -c, --check       打开 ?check=1（自检报告渲染在页面右下角）
"""
import argparse
import http.server
import io
import json
import mimetypes
import os
import shutil
import socket
import subprocess
import sys
import threading
import urllib.parse
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, "dist")
INDEX = os.path.join(DIST, "index.html")


def components_dir():
    """外部（热加载）组件的真实目录：优先 public/组件（源目录，改完立刻生效、无需构建），
    没有时才退回 dist/组件。"""
    src = os.path.join(ROOT, "public", "组件")
    if os.path.isdir(src):
        return src
    return os.path.join(DIST, "组件")


def find_npm():
    """优先用 PATH 里的 npm；否则回退到本机 node 安装目录。"""
    for name in ("npm.cmd", "npm"):
        p = shutil.which(name)
        if p:
            return p
    fallback = r"D:\node\versions\24.15.0\npm.cmd"
    return fallback if os.path.exists(fallback) else None


def build():
    npm = find_npm()
    if not npm:
        print("  [跳过构建] 找不到 npm，请手动执行：npm run build")
        return False
    print("  正在构建：%s run build" % npm)
    print("  （注意：构建要 esbuild 启动子进程，受限沙箱下会报 spawn EPERM；")
    print("    若失败请在普通终端里执行，或用已存在的 dist/ 直接启动）")
    r = subprocess.run([npm, "run", "build"], cwd=ROOT, shell=False)
    return r.returncode == 0


def free_port(preferred):
    for p in [preferred] + list(range(preferred + 1, preferred + 20)) + [0]:
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", p))
                return s.getsockname()[1]
            except OSError:
                continue
    return 0


class Handler(http.server.SimpleHTTPRequestHandler):
    """托管 dist/；未知路径回退到 index.html（单页应用）。"""

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=DIST, **kw)

    def do_GET(self):
        # 外部（热加载）组件清单：components_dir()/*.js（优先 public/组件，即源目录）
        if self.path.split("?", 1)[0] == "/__components":
            d = components_dir()
            try:
                files = sorted(f for f in os.listdir(d) if f.endswith(".js") and not f.startswith("_"))
            except OSError:
                files = []
            body = json.dumps({"files": files}, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def send_head(self):
        raw = urllib.parse.unquote(self.path.split("?", 1)[0])
        # 外部组件走源目录（热加载：改完即生效，不需要重新构建）
        if raw.startswith("/组件/"):
            f = os.path.basename(raw)
            target = os.path.join(components_dir(), f)
            if os.path.isfile(target):
                data = open(target, "rb").read()
                ctype = mimetypes.guess_type(target)[0] or "application/javascript"
                if not ctype.startswith("text/") and "javascript" not in ctype:
                    ctype = "application/javascript"
                self.send_response(200)
                self.send_header("Content-Type", ctype + "; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return io.BytesIO(data)
        path = raw
        target = os.path.normpath(os.path.join(DIST, path.lstrip("/")))
        # 目录或未知路径（无扩展名）→ index.html，交给前端路由
        if path in ("/", "") or os.path.isdir(target):
            self.path = "/index.html"
        elif not os.path.exists(target) and "." not in os.path.basename(path):
            self.path = "/index.html"
        return super().send_head()

    def end_headers(self):
        # 构建产物用哈希文件名，但 index.html 必须不缓存，否则重建后看不到新版
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 静默


def main():
    ap = argparse.ArgumentParser(description="可视化编辑器启动脚本（托管 dist/）", add_help=True)
    ap.add_argument("-p", "--port", type=int, default=5179, metavar="N", help="端口，默认 5179")
    ap.add_argument("-b", "--build", action="store_true", help="启动前先 npm run build")
    ap.add_argument("-q", "--no-browser", action="store_true", help="不自动打开浏览器")
    ap.add_argument("-c", "--check", action="store_true", help="打开 ?check=1（自检）")
    a = ap.parse_args()

    if a.build or not os.path.exists(INDEX):
        if not build() and not os.path.exists(INDEX):
            print("\n  dist/index.html 不存在，无法启动。请先成功执行一次：npm run build")
            return 2

    port = free_port(a.port)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    httpd.daemon_threads = True
    url = "http://127.0.0.1:%d/%s" % (port, "?check=1" if a.check else "")

    n = 0
    try:
        n = len([f for f in os.listdir(os.path.join(ROOT, "src", "registry", "components"))
                 if os.path.isdir(os.path.join(ROOT, "src", "registry", "components", f))])
    except OSError:
        pass

    print("-" * 64)
    print(" 可视化编辑器已启动")
    print("   地址    : %s" % url)
    print("   产物    : %s" % DIST)
    print("   组件目录: src/registry/components/（common / document / web 共 %d 组）" % n)
    print("   停止    : 本窗口 Ctrl+C")
    print("   提示    : 开发模式请用 npm run dev（需要 esbuild 子进程权限）")
    print("-" * 64)

    if not a.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

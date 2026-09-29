# -*- coding: utf-8 -*-
"""可视化编辑器 启动脚本 —— **降级备用**：用 Python 内置 http.server 托管已构建的 dist/（单页应用）。

★定位（P2④ 起明确写死）：**规范实现是 JS 那份** `apps/desktop/server/webServer.js`
（桌面版与 `npm run dev` 都走它）。本脚本只在"没装 Node / 不想开 Electron / 受限沙箱里只想看页面"时用，
所以刻意**不追求功能对齐**，但**端点集必须一致** —— 由 `apps/desktop/scripts/server-contract-check.mjs` 守着
（它同时比对两边的 `/__*` 端点集，并起真服务器验一遍形状与两条安全负例）。

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

日志/诊断：
    前端日志与诊断报告会 POST 到本服务的 **/__log**，按天追加到**运行目录**下的
    `logs/editor-YYYY-MM-DD.log`（诊断报告写到 `logs/diagnostic-*.log`，本服务自身的访问/错误
    日志写到 `logs/server-*.log`）。`GET /__loginfo` 可查当前目录与文件大小。
    直接双击 dist/index.html（file://）或换用别的静态服务器时没有这个接口，
    前端会自动退回"浏览器本地存储（localStorage visual-editor-log-v1）"并如实提示。
"""
import argparse
import datetime
import http.server
import io
import json
import mimetypes
import os
import re
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
# ★日志/诊断落盘目录：按常见软件的习惯放在**运行目录**下（这里是本脚本所在目录）
LOG_DIR = os.path.join(ROOT, "logs")
LOG_KINDS = ("editor", "diagnostic", "check", "server")
MAX_BODY = 512 * 1024  # 单次写入上限，防止异常客户端把磁盘写满


def log_path(kind: str) -> str:
    """按天分文件：logs/editor-2026-09-23.log"""
    day = datetime.date.today().isoformat()
    return os.path.join(LOG_DIR, "%s-%s.log" % (kind, day))


def append_log(kind: str, lines) -> dict:
    """把若干行追加到运行目录的日志文件，返回文件信息"""
    if kind not in LOG_KINDS:
        kind = "editor"
    os.makedirs(LOG_DIR, exist_ok=True)
    path = log_path(kind)
    with open(path, "a", encoding="utf-8") as f:
        for ln in lines:
            f.write(str(ln).rstrip("\r\n") + "\n")
    st = os.stat(path)
    return {"file": path, "bytes": st.st_size, "count": len(lines)}


def save_artifact(rel: str, text: str) -> dict:
    """把前端生成的产物（如「组件与属性说明清单.md」）写到运行目录。**只允许 docs/ 下**，防止路径越界。"""
    rel = (rel or "").replace("\\", "/").lstrip("/")
    if not rel.startswith("docs/") or ".." in rel.split("/"):
        return {"ok": False, "error": "只允许写到运行目录的 docs/ 下"}
    target = os.path.normpath(os.path.join(ROOT, rel))
    docs_root = os.path.normpath(os.path.join(ROOT, "docs"))
    if not target.startswith(docs_root + os.sep):
        return {"ok": False, "error": "路径越界"}
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    return {"ok": True, "file": target, "bytes": len(text.encode("utf-8")), "chars": len(text)}



def components_dir():
    """外部（热加载）组件的真实目录：优先 public/组件（源目录，改完立刻生效、无需构建），
    没有时才退回 dist/组件。"""
    src = os.path.join(ROOT, "public", "组件")
    if os.path.isdir(src):
        return src
    return os.path.join(DIST, "组件")


def save_plugin(name: str, text: str) -> dict:
    """把组件包里的一个文件写回**组件目录**（B14「导入组件包」）。

    只允许 `名字.js`（字母/数字/下划线/短横/中文），且不含路径分隔符、不以 `_` 开头
    （`_manifest.json` 之类是内部文件）—— 防目录穿越。
    """
    name = (name or "").strip()
    if not re.match(r"^[\w\u4e00-\u9fa5-]+\.js$", name) or name.startswith("_") or ".." in name:
        return {"ok": False, "error": "文件名不合法（只允许 xxx.js，不含路径）"}
    if not text:
        return {"ok": False, "error": "内容为空"}
    d = components_dir()
    os.makedirs(d, exist_ok=True)
    target = os.path.normpath(os.path.join(d, name))
    if os.path.dirname(target) != os.path.normpath(d):
        return {"ok": False, "error": "路径越界"}
    with open(target, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    return {"ok": True, "file": target, "bytes": len(text.encode("utf-8")), "chars": len(text)}


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
        # 日志落盘信息：前端启动时探测一次，诊断报告里会显示这个路径
        if self.path.split("?", 1)[0] == "/__loginfo":
            files = []
            try:
                for f in sorted(os.listdir(LOG_DIR)):
                    p = os.path.join(LOG_DIR, f)
                    st = os.stat(p)
                    files.append({"name": f, "bytes": st.st_size, "mtime": int(st.st_mtime)})
            except OSError:
                files = []
            body = json.dumps(
                {"enabled": True, "dir": LOG_DIR, "today": os.path.basename(log_path("editor")), "files": files},
                ensure_ascii=False,
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        """前端落盘接口：
             POST /__log          {"kind":"editor","lines":[...]}          → 追加到 运行目录/logs/
             POST /__save         {"path":"docs/xxx.md","text":"..."}       → 写到 运行目录 下的指定相对路径（只允许 docs/）
             POST /__savePlugin   {"name":"xxx.js","text":"..."}            → 写回**组件目录**（public/组件 或 dist/组件）
        """
        route = self.path.split("?", 1)[0]
        if route not in ("/__log", "/__save", "/__savePlugin"):
            self.send_error(404, "not found")
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n <= 0 or n > MAX_BODY:
            self.send_error(413, "bad length")
            return
        try:
            payload = json.loads(self.rfile.read(n).decode("utf-8"))
            if route == "/__log":
                kind = str(payload.get("kind") or "editor")
                lines = payload.get("lines") or []
                if isinstance(lines, str):
                    lines = lines.splitlines()
                lines = [str(x) for x in lines][:2000]
                info = append_log(kind, lines) if lines else {"file": log_path(kind), "bytes": 0, "count": 0}
                body = json.dumps({"ok": True, **info}, ensure_ascii=False).encode("utf-8")
            else:
                rel = str(payload.get("path") or "")
                text = str(payload.get("text") or "")
                if route == "/__savePlugin":
                    body = json.dumps(save_plugin(str(payload.get("name") or ""), text), ensure_ascii=False).encode("utf-8")
                else:
                    body = json.dumps(save_artifact(rel, text), ensure_ascii=False).encode("utf-8")
            self.send_response(200 if json.loads(body).get("ok") else 403)
        except Exception as e:  # 落盘失败要如实回错，前端会记一条 error
            body = json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False).encode("utf-8")
            self.send_response(500)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

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
        # 服务自身的访问/错误也落盘到运行目录（logs/server-*.log），同时保留控制台输出
        try:
            append_log("server", ["%s  %s  %s" % (datetime.datetime.now().strftime("%H:%M:%S"), self.address_string(), fmt % args)])
        except Exception:
            pass
        sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args))


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

    if port != a.port:
        # ★常见陷阱：上一次的启动器还开着（关窗口/Ctrl+C 之外的强杀不会带走它），
        #   本脚本会静默换端口，于是你打开的其实是**旧版本**。这里必须说清楚。
        print("   ⚠ 端口 %d 已被占用（很可能是上一次的启动器还开着），已改用 %d。" % (a.port, port))
        print("     请先关掉那个旧窗口/进程，否则你看到的可能是旧版本，且 /__log 等接口也不会有。")

    n = 0
    try:
        n = len([f for f in os.listdir(os.path.join(ROOT, "src", "registry", "components"))
                 if os.path.isdir(os.path.join(ROOT, "src", "registry", "components", f))])
    except OSError:
        pass

    print("-" * 64)
    print(" 可视化编辑器已启动（**降级备用启动器**）")
    print("   ★规范实现是 JS 那份：apps/desktop/server/webServer.js（桌面版 / npm run dev 都走它）。")
    print("     本脚本只在没装 Node 或不想开 Electron 时用；端点集由 server-contract-check.mjs 守着。")
    print("   地址    : %s" % url)
    print("   产物    : %s" % DIST)
    print("   组件目录: src/registry/components/（common / document / web 共 %d 组）" % n)
    print("   日志    : %s" % LOG_DIR)
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

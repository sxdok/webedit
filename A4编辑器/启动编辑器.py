# -*- coding: utf-8 -*-
"""A4 编辑器 启动器 —— 本地起一个 HTTP 服务：提供编辑器、组件目录，并可挂载其它本地 HTML。

用法（单字母参数）：
    python 启动编辑器.py -p 8080 -n "D:\\...\\方案文件"
    python 启动编辑器.py -n "D:\\a" -n "D:\\b\\x.html"      -n 可多次
    python 启动编辑器.py -q                                  不自动开浏览器
    python 启动编辑器.py                                    全部默认

参数：
    -p, --port N     端口（默认 8791，占用则自动往后找）
    -n, --mount PATH 要挂载到 /m/ 下的本地 HTML 文件或目录，可重复
    -q, --no-browser 不自动打开浏览器
    （位置参数也当挂载项，兼容老写法）

挂载后的地址统一为 /m/<名字>，例如：
    http://127.0.0.1:8080/m/方案文件/江苏誉创_金卫智慧舱_主方案_V5.0.html
挂载清单可在 http://127.0.0.1:8080/__mounts 查看。
"""
import argparse
import http.server
import json
import mimetypes
import os
import socket
import sys
import threading
import urllib.parse
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
COMP_DIR = os.path.join(ROOT, "组件")
MAIN = "a4_editor.html"
MOUNTS = []          # [{"name","path","is_dir"}]


def add_mount(p):
    p = os.path.abspath(os.path.expandvars(os.path.expanduser(p)))
    if not os.path.exists(p):
        print("  [跳过] 路径不存在：%s" % p)
        return
    is_dir = os.path.isdir(p)
    name = os.path.basename(p.rstrip("\\/")) or "root"
    base, i = name, 2
    while any(m["name"] == name for m in MOUNTS):       # 重名自动编号
        name = "%s(%d)" % (base, i)
        i += 1
    MOUNTS.append({"name": name, "path": p, "is_dir": is_dir})


def safe_join(base, rel):
    """把 URL 相对路径安全拼到 base 下，阻止 ../ 越界。"""
    rel = urllib.parse.unquote(rel).replace("\\", "/").lstrip("/")
    target = os.path.normpath(os.path.join(base, rel))
    if target != base and not target.startswith(base + os.sep):
        return None
    return target


def resolve(url_path):
    """URL → 本地绝对路径：/m/<名字>[/...] 走挂载点，其余走编辑器目录。"""
    path = urllib.parse.unquote(url_path.split("?", 1)[0])
    if path.startswith("/m/"):
        rest = path[3:]
        for m in MOUNTS:
            if rest == m["name"] or rest.startswith(m["name"] + "/"):
                if m["is_dir"]:
                    return safe_join(m["path"], rest[len(m["name"]):].lstrip("/"))
                return m["path"]
        return None
    if path in ("/", ""):
        return os.path.join(ROOT, MAIN)
    return safe_join(ROOT, path.lstrip("/"))


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "A4Editor/1.0"

    def _json(self, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        p = urllib.parse.unquote(self.path.split("?", 1)[0])
        if p == "/__components":                        # 组件目录清单（编辑器启动时读）
            try:
                names = sorted(f for f in os.listdir(COMP_DIR)
                               if f.lower().endswith((".js", ".json")) and not f.startswith("_"))
            except FileNotFoundError:
                names = []
            return self._json({"files": names})
        if p == "/__mounts":                            # 已挂载的本地文件 / 目录
            return self._json({"mounts": [
                {"name": m["name"], "path": m["path"], "is_dir": m["is_dir"],
                 "url": "/m/" + urllib.parse.quote(m["name"]) + ("/" if m["is_dir"] else "")}
                for m in MOUNTS]})

        target = resolve(self.path)
        if not target or not os.path.isfile(target):
            self.send_error(404, "Not Found")
            return
        ctype = mimetypes.guess_type(target)[0] or "application/octet-stream"
        if (ctype.startswith("text/")
                or target.lower().endswith((".js", ".json", ".html", ".htm", ".css", ".svg"))):
            ctype += "; charset=utf-8"
        try:
            data = open(target, "rb").read()
        except OSError as e:
            self.send_error(403, str(e))
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")   # 改完刷新即生效
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        pass                                            # 静默


def free_port(preferred):
    for p in [preferred] + list(range(preferred + 1, preferred + 20)) + [0]:
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", p))
                return s.getsockname()[1]
            except OSError:
                continue
    return 0


def main():
    ap = argparse.ArgumentParser(
        description="A4 编辑器启动器（-n 挂载本地文件或目录）",
        epilog='例：python 启动编辑器.py -p 8080 -n "D:\\...\\方案文件"')
    ap.add_argument("-p", "--port", type=int, default=8791, metavar="N",
                    help="端口，默认 8791（占用则自动往后找）")
    ap.add_argument("-n", "--mount", action="append", default=[], metavar="PATH",
                    help="挂载本地 HTML 文件或目录到 /m/，可重复")
    ap.add_argument("-q", "--no-browser", action="store_true", help="不自动打开浏览器")
    ap.add_argument("paths", nargs="*", help=argparse.SUPPRESS)   # 兼容位置参数写法
    a = ap.parse_args()
    for m in list(a.mount) + list(a.paths):
        add_mount(m)

    if not os.path.exists(os.path.join(ROOT, MAIN)):
        print("找不到 %s（应与本脚本同目录）" % MAIN)
        return 2
    try:
        nc = len([f for f in os.listdir(COMP_DIR)
                  if f.lower().endswith((".js", ".json")) and not f.startswith("_")])
    except FileNotFoundError:
        nc = 0

    port = free_port(a.port)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    httpd.daemon_threads = True
    url = "http://127.0.0.1:%d/%s" % (port, MAIN)

    print("-" * 62)
    print(" A4 编辑器已启动")
    print("   编辑器  : %s" % url)
    print("   组件目录: 发现 %d 个组件文件（%s）" % (nc, COMP_DIR))
    if MOUNTS:
        print("   已挂载  :")
        for m in MOUNTS:
            print("      /m/%s%s  ->  %s" % (urllib.parse.quote(m["name"]),
                                            "/" if m["is_dir"] else "", m["path"]))
    else:
        print("   已挂载  : （无）需要挂载本地文档时：")
        print('             python 启动编辑器.py -p 8080 -n "D:\\路径\\到\\方案目录"')
    print("   停止    : 本窗口 Ctrl+C")
    print("-" * 62)

    if not a.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

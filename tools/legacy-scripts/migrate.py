# -*- coding: utf-8 -*-
"""把本次开发的两个应用（A4编辑器 / web-editor）及其工具、测试、验证证据
   迁移到 E:\可视化编辑器\（单一父目录，便于在 DSH 里用一个工作区引入）。

   结构：
     E:\可视化编辑器\
       ├── A4编辑器\            （原 E:\HikRobot\A4编辑器，整目录移动）
       ├── web-editor\          （原 E:\HikRobot\web-editor，整目录移动，含 node_modules）
       ├── tools\               （针对两个应用写的脚本/测试）
       │   └── legacy-scripts\  （开发过程中用过的脚本与源材料缓存，一次性脚本已注记）
       └── docs\验证证据\        （自检/打印/界面截图与 PDF）

   安全约定：先建目标、再移动（同盘移动是改名，快且不复制）；每一步都打印计数便于核对。
"""
import io
import os
import shutil
import sys
import time

SRC_ROOT = r"E:\HikRobot"
DST_ROOT = r"E:\可视化编辑器"
NEWDOC = os.path.join(SRC_ROOT, "_萃取", "newdoc")

log = []


def say(msg):
    print(msg)
    log.append(msg)


def size_of(path):
    total = 0
    files = 0
    for base, _dirs, names in os.walk(path):
        for n in names:
            try:
                total += os.path.getsize(os.path.join(base, n))
                files += 1
            except OSError:
                pass
    return total, files


# ── 0) 前置检查 ──
if not os.path.isdir(os.path.join(SRC_ROOT, "A4编辑器")):
    sys.exit("源目录不存在：A4编辑器")
if not os.path.isdir(os.path.join(SRC_ROOT, "web-editor")):
    sys.exit("源目录不存在：web-editor")
if os.path.exists(DST_ROOT):
    sys.exit("目标已存在，先确认再迁：%s" % DST_ROOT)

# ── 1) 记录迁移前规模 ──
before = {}
for name in ("A4编辑器", "web-editor"):
    before[name] = size_of(os.path.join(SRC_ROOT, name))
    say("迁移前 %-10s %8.1f MB / %5d 文件" % (name, before[name][0] / 1048576, before[name][1]))

# ── 2) 建目标结构 ──
for sub in ("tools", os.path.join("tools", "legacy-scripts"), os.path.join("docs", "验证证据")):
    os.makedirs(os.path.join(DST_ROOT, sub), exist_ok=True)
say("已建目标结构：%s" % DST_ROOT)

# ── 3) 移动两个应用（同盘改名，秒级完成）──
for name in ("A4编辑器", "web-editor"):
    src = os.path.join(SRC_ROOT, name)
    dst = os.path.join(DST_ROOT, name)
    t0 = time.time()
    shutil.move(src, dst)
    after = size_of(dst)
    say(
        "已移动 %-10s → %s  (%.1fs)  迁移后 %8.1f MB / %5d 文件  一致=%s"
        % (
            name,
            dst,
            time.time() - t0,
            after[0] / 1048576,
            after[1],
            after[0] == before[name][0] and after[1] == before[name][1],
        )
    )

# ── 4) 收集工具 / 脚本 / 测试 / 证据 ──
tool_files = ["check_print.py"]
legacy_skipped = {"_ve_dom.html"}  # 0 字节的空 dump
copied_tools = copied_legacy = copied_docs = 0
if os.path.isdir(NEWDOC):
    for n in sorted(os.listdir(NEWDOC)):
        p = os.path.join(NEWDOC, n)
        if not os.path.isfile(p) or n in legacy_skipped:
            continue
        low = n.lower()
        if n in tool_files:
            shutil.copy2(p, os.path.join(DST_ROOT, "tools", n))
            copied_tools += 1
        elif low.endswith(".py") or low.endswith(".txt"):
            # 开发期间用过的脚本与源材料缓存（一次性补丁脚本已应用，保留备查）
            shutil.copy2(p, os.path.join(DST_ROOT, "tools", "legacy-scripts", n))
            copied_legacy += 1
        elif low.endswith((".png", ".pdf")):
            shutil.copy2(p, os.path.join(DST_ROOT, "docs", "验证证据", n))
            copied_docs += 1
say("工具/脚本/证据：tools %d 个、legacy-scripts %d 个、验证证据 %d 个" % (copied_tools, copied_legacy, copied_docs))

# ── 5) 汇总核对 ──
say("")
say("目标总规模：%.1f MB / %d 文件" % (size_of(DST_ROOT)[0] / 1048576, size_of(DST_ROOT)[1]))
say("源目录是否已清空：A4编辑器=%s web-editor=%s" % (
    not os.path.exists(os.path.join(SRC_ROOT, "A4编辑器")),
    not os.path.exists(os.path.join(SRC_ROOT, "web-editor")),
))

io.open(os.path.join(DST_ROOT, "迁移记录.txt"), "w", encoding="utf-8", newline="\n").write(
    "\n".join(log) + "\n"
)
print("\n迁移记录已写入：%s" % os.path.join(DST_ROOT, "迁移记录.txt"))

# -*- coding: utf-8 -*-
"""收尾：① 修 saveUserComps（排除来自文件的组件）；② 把编辑器搬到独立文件夹 A4编辑器/。"""
import io
import os
import shutil

SRC = r"E:\HikRobot\AGV\生成资料\工具脚本\a4_editor.html"
DSTDIR = r"E:\HikRobot\AGV\生成资料\A4编辑器"

s = io.open(SRC, encoding="utf-8").read()
OLD = "function saveUserComps(){\n  const user = {};\n  for(const k in COMPS) if(!BUILTIN[k]) user[k] = COMPS[k];"
NEW = "function saveUserComps(){\n  const user = {};\n  for(const k in COMPS) if(!BUILTIN[k] && !FROMFILE[k]) user[k] = COMPS[k];   // 文件组件不入本地库"
n = s.count(OLD)
if n == 1:
    io.open(SRC, "w", encoding="utf-8", newline="").write(s.replace(OLD, NEW))
    print("  [ok] saveUserComps 已排除文件组件")
else:
    print("  [!!] 锚点命中 %d 次" % n)

os.makedirs(DSTDIR, exist_ok=True)
shutil.copyfile(SRC, os.path.join(DSTDIR, "a4_editor.html"))
print("  [ok] 编辑器 → %s" % os.path.join(DSTDIR, "a4_editor.html"))
for root, dirs, files in os.walk(DSTDIR):
    lvl = root.replace(DSTDIR, "").count(os.sep)
    print("    " + "  " * lvl + os.path.basename(root) + "/")
    for f in sorted(files)[:5]:
        print("    " + "  " * (lvl + 1) + f)
    if len(files) > 5:
        print("    " + "  " * (lvl + 1) + "… 共 %d 个文件" % len(files))

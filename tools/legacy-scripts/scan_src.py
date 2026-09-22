# -*- coding: utf-8 -*-
"""整体读源码的辅助：统计每个顶层声明的被引用次数，找出死代码 / 重复实现。"""
import io
import os
import re

J = r"E:\HikRobot\A4编辑器\js"
files = sorted(f for f in os.listdir(J) if f.endswith(".js"))
src = {f: io.open(os.path.join(J, f), encoding="utf-8").read() for f in files}
ALL = "\n".join(src.values())

decl = {}
for f, s in src.items():
    names = set(re.findall(r"^function\s+([\w$]+)", s, re.M))
    for m in re.finditer(r"^(?:const|let|var)\s+([^;\n]+)", s, re.M):
        for part in m.group(1).split(","):
            mm = re.match(r"\s*([\w$]+)", part)
            if mm:
                names.add(mm.group(1))
    decl[f] = sorted(names)

print("== 顶层声明数 ==")
for f in files:
    print("   %-20s %2d" % (f, len(decl[f])))

print("\n== 疑似死代码（除声明外全文再无引用）==")
dead = []
for f in files:
    for n in decl[f]:
        if n in ("$", "doc", "prevStage", "measure", "root", "pageStyle"):
            continue
        hits = len(re.findall(r"\b%s\b" % re.escape(n), ALL))
        if hits <= 1:
            dead.append((f, n))
for f, n in dead:
    print("   %-20s %s" % (f, n))
print("   共 %d 个" % len(dead))

print("\n== 只被引用 2 次（声明 + 1 处）==")
for f in files:
    for n in decl[f]:
        hits = len(re.findall(r"\b%s\b" % re.escape(n), ALL))
        if hits == 2:
            print("   %-20s %s" % (f, n))

print("\n== 同名函数重复定义 ==")
seen = {}
for f in files:
    for n in re.findall(r"^function\s+([\w$]+)", src[f], re.M):
        seen.setdefault(n, []).append(f)
dup = {k: v for k, v in seen.items() if len(v) > 1}
print("   " + (str(dup) if dup else "无"))

print("\n== 可疑残留（TODO / 空 if / 恒真条件 / 注释掉的代码）==")
for f, s in src.items():
    for i, ln in enumerate(s.splitlines(), 1):
        if re.search(r"\|\|\s*true\)\{\}|TODO|FIXME|XXX", ln):
            print("   %-20s %4d  %s" % (f, i, ln.strip()[:96]))

print("\n== 插入路径入口（谁调用 insertComponent / insertBlock / execCommand insertHTML）==")
for f, s in src.items():
    for i, ln in enumerate(s.splitlines(), 1):
        if "insertComponent(" in ln or "insertBlock(" in ln or "execCommand('insertHTML'" in ln:
            print("   %-20s %4d  %s" % (f, i, ln.strip()[:96]))

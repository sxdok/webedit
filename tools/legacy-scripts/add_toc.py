# -*- coding: utf-8 -*-
"""补目录，让分节排布与参考版（AGV方案 V5.0）一致：
封面（无页码）→ 目录（罗马数字 I）→ 正文（阿拉伯数字从 1 起）。
管线规则：正文前若出现 `## 级` 小节即进入"目录/前言节"（罗马数字），
第一个 `# 章` 才进入正文节（阿拉伯重新起算）。"""
import io
import os
import re

MD = r"E:\HikRobot\_萃取\newdoc\doc\金卫智慧舱_总体方案_V1.0.md"
t = io.open(MD, encoding="utf-8").read()

if "## 目录" in t:
    print("  已存在目录，跳过")
else:
    TOC = """## 目录

1. 第一篇　项目调研 —— 项目背景 · 客户现状 · 对象与范围 · 搬运对象与载具 · 布局需求 · 作业需求 · 调研结论
2. 第二篇　方案介绍 —— 总体架构 · 导航方式 · 布局规划 · 业务流程 · 信息流程 · 载具设计 · 车辆选型 · 数量计算 · 设备清单 · 无线网络 · 配套硬件 · 安全防护
3. 第三篇　实施与服务 —— 实施过程 · 实施步骤 · 现场环境 · 技术支持与售后 · 用户培训 · 行业案例 · 价值落地

"""
    anchor = "# 1 第一篇 项目调研"
    assert anchor in t, "未找到第一篇锚点"
    t = t.replace(anchor, TOC + anchor, 1)
    io.open(MD, "w", encoding="utf-8", newline="").write(t)
    print("  已插入目录（含三篇导览）")

# 报告结构：确认分节触发点
lines = t.split("\n")
for i, s in enumerate(lines[:40], 1):
    if s.startswith("# ") or s.startswith("## "):
        print("    L%-3d %s" % (i, s[:60]))

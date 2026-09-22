# -*- coding: utf-8 -*-
"""为新方案建图库 doc/assets：从幻灯片导出图与各源抽取图中挑出图解，按语义命名。
幻灯片整页导出（1600×900）自带标注文字，适合做"图解"。"""
import io
import os
import shutil

SRC_SLIDES = r"E:\HikRobot\_萃取\newdoc\slides"
SRC_AST = r"E:\HikRobot\_萃取\newdoc\assets"
DOC = r"E:\HikRobot\_萃取\newdoc\doc"
AST = os.path.join(DOC, "assets")
os.makedirs(AST, exist_ok=True)

# 语义名 ← 来源（slide 整页导出 / 源内抽图）
MAP = [
    ("fig_cover_1.png",      "@agv/agv_img1.png"),      # 智慧舱产线（AGV方案封面图）
    ("fig_cover_2.png",      "@agv/agv_img2.png"),
    ("fig_cover_3.png",      "@agv/agv_img3.png"),
    ("fig_lmr_models.png",   "@slide/幻灯片7.PNG"),      # Q3/Q7/Q8 车型
    ("fig_nav.png",          "@slide/幻灯片11.PNG"),     # 导航介绍
    ("fig_safety_sensor.png", "@slide/幻灯片8.PNG"),     # 安全传感器
    ("fig_rack_req.png",     "@slide/幻灯片18.PNG"),     # 货架尺寸要求
    ("fig_rack_mark.png",    "@slide/幻灯片20.PNG"),     # 货架贴码高度
    ("fig_pallet.png",       "@slide/幻灯片21.PNG"),     # 川字底托盘评估
    ("fig_scene.png",        "@slide/幻灯片24.PNG"),     # 具体场景评估
    ("fig_req_basic.png",    "@slide/幻灯片35.PNG"),     # 基本情况（调研）
    ("fig_req_carry.png",    "@slide/幻灯片36.PNG"),     # 搬运对象（调研）
    ("fig_req_layout.png",   "@slide/幻灯片37.PNG"),     # 物流布局需求（调研）
    ("fig_req_job.png",      "@slide/幻灯片38.PNG"),     # 搬运作业需求（调研）
    ("fig_layout.png",       "@slide/幻灯片41.PNG"),     # 布局规划
    ("fig_flow.png",         "@slide/幻灯片42.PNG"),     # 业务流程
    ("fig_info_flow.png",    "@slide/幻灯片44.PNG"),     # 信息流程
    ("fig_rack_design.png",  "@slide/幻灯片55.PNG"),     # 载具设计
    ("fig_sys_arch.png",     "@slide/幻灯片58.PNG"),     # 物流系统架构
    ("fig_pda.png",          "@slide/幻灯片59.PNG"),     # PDA
    ("fig_rcs.png",          "@slide/幻灯片63.PNG"),     # RCS
    ("fig_deploy.png",       "@slide/幻灯片64.PNG"),     # 系统布置
    ("fig_power.png",        "@slide/幻灯片69.PNG"),     # 智能电量管理
    ("fig_monitor.png",      "@slide/幻灯片70.PNG"),     # 实时监控
    ("fig_twin.png",         "@slide/幻灯片71.PNG"),     # 数字孪生
    ("fig_select.png",       "@slide/幻灯片72.PNG"),     # 产品选型
    ("fig_battery.png",      "@slide/幻灯片85.PNG"),     # 电池管理系统
    ("fig_safety.png",       "@slide/幻灯片86.PNG"),     # 安全防护
    ("fig_calc.png",          "@slide/幻灯片91.PNG"),     # 机器人数量计算
    ("fig_env.png",          "@slide/幻灯片95.PNG"),     # 运行地面要求
    ("fig_wifi.png",         "@slide/幻灯片98.PNG"),     # Wi-Fi 网络要求
    ("fig_impl.png",         "@slide/幻灯片102.PNG"),    # 实施过程
    ("fig_service.png",      "@slide/幻灯片103.PNG"),    # 技术支持及售后服务
    ("fig_train.png",        "@slide/幻灯片104.PNG"),    # 用户培训
    ("fig_case.png",         "@slide/幻灯片105.PNG"),    # 行业案例
    ("fig_value.png",        "@slide/幻灯片106.PNG"),    # 价值落地
]


def resolve(spec):
    if spec.startswith("@slide/"):
        return os.path.join(SRC_SLIDES, spec[7:])
    if spec.startswith("@agv/"):
        return os.path.join(SRC_AST, spec[5:])
    return spec


ok = miss = 0
from PIL import Image
rows = []
for dst, spec in MAP:
    src = resolve(spec)
    if not os.path.exists(src):
        print("  [缺] %-22s ← %s" % (dst, spec))
        miss += 1
        continue
    shutil.copyfile(src, os.path.join(AST, dst))
    im = Image.open(src)
    rows.append((dst, im.size, os.path.getsize(os.path.join(AST, dst)) / 1024))
    ok += 1

io.open(os.path.join(DOC, "figure_map.txt"), "w", encoding="utf-8").write(
    "\n".join("%-24s %sx%s %.0fKB" % (a, b[0], b[1], c) for a, b, c in rows))
print("\n=== 图库 doc/assets：成功 %d，缺 %d ===" % (ok, miss))
for a, b, c in rows:
    print("  %-24s %4dx%-4d %6.0fKB  → 打印宽(300dpi) %.1fcm" % (a, b[0], b[1], c, b[0] * 2.54 / 300))

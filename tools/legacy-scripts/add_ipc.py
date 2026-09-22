# -*- coding: utf-8 -*-
"""把「配套硬件选型（工控机）」一节补进方案（内容全部取自工控机产品手册），
并从手册里取一张产品图。"""
import io
import os
import re

import pymupdf
from PIL import Image

DOC = r"E:\HikRobot\_萃取\newdoc\doc"
AST = os.path.join(DOC, "assets")
MD = os.path.join(DOC, "金卫智慧舱_总体方案_V1.0.md")
PDF = r"E:\HikRobot\Vision\文档资料\产品手册\机器视觉产品手册合集\机器视觉工控机产品手册-V.151.CN.25Q2.1(阅读版).pdf"

# ── ① 从手册找一张产品图（取指定页里像素面积最大的位图）──
d = pymupdf.open(PDF)
best = None
for pno in (9, 10, 11, 7):          # 0-based：壁挂式/上架式相关页
    if pno >= d.page_count:
        continue
    for im in d[pno].get_images(full=True):
        try:
            info = d.extract_image(im[0])
        except Exception:
            continue
        w, h = info["width"], info["height"]
        if min(w, h) < 300:          # 跳过图标/小图
            continue
        if best is None or w * h > best[0]:
            best = (w * h, pno + 1, info)
if best:
    area, pno, info = best
    raw = os.path.join(AST, "_ipc_raw." + info["ext"])
    open(raw, "wb").write(info["image"])
    im = Image.open(raw).convert("RGB")
    dst = os.path.join(AST, "fig_ipc.jpg")
    im.save(dst, "JPEG", quality=90, optimize=True, dpi=(300, 300))
    os.remove(raw)
    print("  工控机产品图：取自手册第 %d 页，%dx%d → fig_ipc.jpg（%.0f KB）" % (pno, info["width"], info["height"], os.path.getsize(dst) / 1024))
else:
    print("  !! 未找到合适的产品图")

# ── ② 插入新章节（放在「安全防护」之前，并把安全防护改为 2.13）──
SEC = """## 2.12 配套硬件选型（工控机）

RCS / WCS 服务端、看板与 PDA 服务需要一台工业级计算机作为承载平台。本项目按**单机部署在设备电气柜内**的形态选型，要求长期通电运行、具备多网口与串口、可在粉尘与温湿度波动的车间环境稳定工作。

[[表: 工控机系列与适用场景]]
| 系列 | 手册标注的定位 | 本项目适用性 |
| --- | --- | --- |
| 上架式工控机 | 整机抗震、抗腐蚀、防辐射；接口丰富，可容纳多块硬盘并支持 RAID | 若机房/电柜有 19″ 机架位，可选用 |
| **壁挂式工控机** | 紧凑 4U；壁挂/桌面安装、节省空间；7 槽位 PCIE/PCI 扩展 | **本项目推荐**：电气柜内壁挂或桌面放置，扩展余量足 |
| 视觉控制器（VC2000/3000/5000） | 结构紧凑、更高 IP 防护等级，面向 AI 边缘视觉计算 | 本项目无视觉检测业务，暂不需要；后续扩展读码/视觉时可选 |
| 平板一体机（VT） | 触摸屏与机箱一体，多点触控，体积小、支持多种安装方式 | 可选作现场操作/看板终端 |
| 服务器 | 集数据采集、存储、处理为一体 | 多产线集中部署时可选 |

[[表: 壁挂式工控机快速选型（手册示例机型）]]
| 型号 | 主板 | CPU | 内存 | 硬盘 | 网口 | USB(3.0+2.0) | 串口 | 电源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MV-IPC-H463H-8-256G-240 | ATX-H110 | i3-6100 | 8G | 256G | 2 | 4+4 | 3 | 300W |
| MV-IPC-H465H-8-256G-240 | ATX-H110 | i5-6500 | 8G | 256G | 2 | 4+4 | 3 | 300W |

上架式机型（如主板 ATX-H610 / ATX-W680D）可支持 Intel 第 12/13 代 i3 ~ i9、DDR4 最大 64GB、双千兆网口、多个 USB3.0/2.0 与 RS232/422/485 串口、PCIe ×16 与多路 PCI 扩展，并支持三显输出。

[[表: 工控机可靠性与接口能力（手册数据）]]
| 项目 | 手册数据 | 对本项目的意义 |
| --- | --- | --- |
| 可靠性 | MTTF（平均无故障时间）**10 万小时以上**（普通计算机约 1 ~ 1.5 万小时） | 满足长期通电、少人值守的运行要求 |
| 环境适应 | 可在粉尘、烟雾、高/低温、潮湿、震动、腐蚀环境下稳定运行 | 适配车间与电气柜内环境 |
| 实时性 | 支持 WatchDog Timer，对工况变化快速响应 | 保障服务进程异常时自动恢复 |
| 接口 | LAN、PCIe、USB3.0 等；多网口/多串口 | 分别接入 PLC（S7，以太网）、AGV 无线网络、看板与打印机 |

> **选型说明**：上表型号为手册**快速选型表**中的示例机型，用于说明配置档位；本项目按现场电气柜尺寸、并发规模与客户 IT 规范确定最终配置，**以海康/供货方确认为准**。

"""

t = io.open(MD, encoding="utf-8").read()
anchor = "## 2.12 安全防护"
assert anchor in t, "锚点未找到"
t = t.replace(anchor, SEC + "## 2.13 安全防护")
if best:
    t = t.replace("## 2.13 安全防护", "![工控机（手册产品图）](assets/fig_ipc.jpg)\n\n## 2.13 安全防护")
io.open(MD, "w", encoding="utf-8", newline="").write(t)
print("  已插入 2.12 配套硬件选型（工控机），原 2.12 安全防护 → 2.13；插图=%s" % bool(best))
print("  当前章节数：%d 个二级标题" % len(re.findall(r"^## ", t, re.M)))

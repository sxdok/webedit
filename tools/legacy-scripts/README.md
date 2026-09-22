# legacy-scripts —— 开发期间用过的脚本（历史记录）

这些是本次开发过程中**实际执行过**的脚本，保留用于追溯"某处代码是怎么改出来的"。
它们**不是可复用工具**，多数属于一次性补丁；其中一些已经把改动打进最终产物，重跑会重复应用。

## 分组（按用途）

| 组 | 脚本 | 用途 |
|---|---|---|
| A4 编辑器：生成与拆分 | `mk_comp_files.py`、`split_comps.py`、`components.py`、`finish_split.py`、`comp2.py` | 把单文件编辑器拆成 `js/` 模块 + `组件/` 运行时组件目录 |
| A4 编辑器：样式与资源 | `css_inject2.py`、`build_assets.py`、`opt_imgs.py`、`cover_style.py`、`revert_sheet.py` | 注入 CSS、打包资源、压缩图片、封面样式 |
| A4 编辑器：功能补丁 | `feat.py`、`feat2.py`、`add_ipc.py`、`add_toc.py`、`fix_merge.py`、`fix_cover_pn.py`、`fix_comptest.py`、`three_sec.py`、`wysiwyg.py`、`wys2.py` | 逐步加功能/修缺陷（图文混排、目录、封面页码等） |
| A4 编辑器：自检修补 | `selftest_patch.py`、`selftest_fix.py`、`selftest_fix2.py`、`selftest_fix3.py`、`read_selftest.py` | 给自检加断言、修自检断言 |
| 源材料抽取 | `extract_all.py`、`scan_src.py`、`outline.py`、`slide_map.py`、`slide_map2.py`、`probe_comp.py`、`probe_load.py`、`read_ui.py`、`diag1.py`、`inventory.txt` | 从 PDF/PPTX/方案文本里抽取素材，作为文档与编辑器示例的输入 |
| 源材料缓存 | `src_pdf.txt`、`src_pptx.txt`、`src_agv.txt`、`src_net.txt`、`src_v32.txt` | 抽取出来的纯文本缓存（供上面脚本复用） |
| 本次迁移 | `migrate.py` | 把两个应用与工具迁移到 `E:\可视化编辑器\` 的脚本（含规模核对） |

## 重要提醒

- **绝对路径已失效**：脚本里的 `E:\HikRobot\_萃取\newdoc\...`、`E:\HikRobot\AGV\...` 等路径是当时的位置，
  迁移后仅作记录；要重跑请先改路径。
- **不要盲目重跑**：这些脚本会直接改写 `a4_editor.html` 等产物，重复应用可能造成重复内容。
  需要改功能时，建议直接改源码（`A4编辑器/js/` 或 `web-editor/src/`），或写新脚本并先备份。
- 应用自带的**自检**才是当前有效的测试手段（见 `tools/README.md`）。

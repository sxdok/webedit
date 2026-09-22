/* 组件：封面（含分节）（版式）—— 可自由编辑本文件；改完刷新编辑器即生效
   封面（含分节）：决定封面页不显示页码 */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["cover"] = {
  "key": "cover",
  "name": "封面（含分节）",
  "group": "版式",
  "desc": "封面（含分节）：决定封面页不显示页码",
  "match": null,
  "html": "<h1>文档标题</h1>\n<p class=\"sub\"><b>编制单位</b>：江苏誉创智能科技有限公司　|　<b>版本</b>：V1.0　|　<b>日期</b>：2026 年 9 月</p>\n<hr class=\"top\">\n<div class=\"pgbreak\" data-num=\"roman\" contenteditable=\"false\"></div>",
  "props": [
    {
      "k": "text",
      "t": "area",
      "label": "标题 HTML"
    }
  ]
};

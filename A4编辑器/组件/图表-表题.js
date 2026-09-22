/* 组件：表题（图表）—— 可自由编辑本文件；改完刷新编辑器即生效
   表题：在表格上方，按章自动编号（表 X-Y） */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["tabcap"] = {
  "key": "tabcap",
  "name": "表题",
  "group": "图表",
  "desc": "表题：在表格上方，按章自动编号（表 X-Y）",
  "match": "div.tabcap",
  "html": "<div class=\"tabcap\">表 X-Y　说明文字</div>",
  "props": [
    {
      "k": "text",
      "t": "text",
      "label": "题注"
    }
  ]
};

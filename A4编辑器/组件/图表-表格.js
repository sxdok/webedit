/* 组件：表格（图表）—— 可自由编辑本文件；改完刷新编辑器即生效
   通用表格：行列、列宽、行高都可调 */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["table"] = {
  "key": "table",
  "name": "表格",
  "group": "图表",
  "desc": "通用表格：行列、列宽、行高都可调",
  "match": "table",
  "html": "",
  "props": [
    {
      "k": "colw",
      "t": "text",
      "label": "列宽(如 20%,50%,30%)"
    },
    {
      "k": "rowh",
      "t": "text",
      "label": "行高(如 8mm)"
    },
    {
      "k": "cols",
      "t": "number",
      "label": "列数"
    },
    {
      "k": "rows",
      "t": "number",
      "label": "数据行数"
    },
    {
      "k": "head",
      "t": "bool",
      "label": "首行为表头"
    },
    {
      "k": "width",
      "t": "text",
      "label": "表宽(如 100%)"
    }
  ]
};

/* 组件：三线表（图表）—— 可自由编辑本文件；改完刷新编辑器即生效
   三线表：学术/技术文档常用，只有顶线、表头线、底线 */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["t3"] = {
  "key": "t3",
  "name": "三线表",
  "group": "图表",
  "desc": "三线表：学术/技术文档常用，只有顶线、表头线、底线",
  "match": "table.t3",
  "html": "<table class=\"t3\"><colgroup><col style=\"width:33.3%\"><col style=\"width:33.3%\"><col style=\"width:33.3%\"></colgroup><thead><tr><th>项目</th><th>取值</th><th>说明</th></tr></thead><tbody><tr><td>　</td><td>　</td><td>　</td></tr></tbody></table>",
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

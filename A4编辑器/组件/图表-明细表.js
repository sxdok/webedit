/* 组件：明细表（图表）—— 可自由编辑本文件；改完刷新编辑器即生效
   明细表：序号 / 名称 / 规格 / 数量 / 备注 */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["tl"] = {
  "key": "tl",
  "name": "明细表",
  "group": "图表",
  "desc": "明细表：序号 / 名称 / 规格 / 数量 / 备注",
  "match": "table.tl",
  "html": "<table class=\"tl\"><colgroup><col style=\"width:20.0%\"><col style=\"width:20.0%\"><col style=\"width:20.0%\"><col style=\"width:20.0%\"><col style=\"width:20.0%\"></colgroup><thead><tr><th>序号</th><th>名称</th><th>规格</th><th>数量</th><th>备注</th></tr></thead><tbody><tr><td>1</td><td>　</td><td>　</td><td>　</td><td>　</td></tr></tbody></table>",
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

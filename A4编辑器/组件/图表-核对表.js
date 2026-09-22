/* 组件：核对表（图表）—— 可自由编辑本文件；改完刷新编辑器即生效
   核对表：序号 / 核对项 / 结果 / 备注 */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["tk"] = {
  "key": "tk",
  "name": "核对表",
  "group": "图表",
  "desc": "核对表：序号 / 核对项 / 结果 / 备注",
  "match": "table.tk",
  "html": "<table class=\"tk\"><colgroup><col style=\"width:25.0%\"><col style=\"width:25.0%\"><col style=\"width:25.0%\"><col style=\"width:25.0%\"></colgroup><thead><tr><th>序号</th><th>核对项</th><th>结果</th><th>备注</th></tr></thead><tbody><tr><td>1</td><td>　</td><td>□ 合格　□ 不合格</td><td>　</td></tr></tbody></table>",
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

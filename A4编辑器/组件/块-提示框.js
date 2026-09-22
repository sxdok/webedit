/* 组件：提示框（块）—— 可自由编辑本文件；改完刷新编辑器即生效
   提示框（绿色左边框）：放"待确认""以现场为准"这类提醒 */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["note"] = {
  "key": "note",
  "name": "提示框",
  "group": "块",
  "desc": "提示框（绿色左边框）：放\"待确认\"\"以现场为准\"这类提醒",
  "match": "div.note",
  "html": "<div class=\"note\">提示内容（待确认 / 以现场为准）</div>",
  "props": [
    {
      "k": "text",
      "t": "area",
      "label": "文字"
    }
  ]
};

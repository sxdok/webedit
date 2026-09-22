/* 组件：警示框（块）—— 可自由编辑本文件；改完刷新编辑器即生效
   警示框（橙色左边框）：风险、前提条件 */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["warn"] = {
  "key": "warn",
  "name": "警示框",
  "group": "块",
  "desc": "警示框（橙色左边框）：风险、前提条件",
  "match": "div.warn",
  "html": "<div class=\"warn\">注意：此处填写需要提醒的风险或前提条件。</div>",
  "props": [
    {
      "k": "text",
      "t": "area",
      "label": "文字"
    }
  ]
};

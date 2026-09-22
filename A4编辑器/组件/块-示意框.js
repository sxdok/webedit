/* 组件：示意框（块）—— 可自由编辑本文件；改完刷新编辑器即生效
   示意框（浅蓝左边框）：放流程、示意说明 */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["flow"] = {
  "key": "flow",
  "name": "示意框",
  "group": "块",
  "desc": "示意框（浅蓝左边框）：放流程、示意说明",
  "match": "div.flow",
  "html": "<div class=\"flow\">流程 / 要点说明</div>",
  "props": [
    {
      "k": "text",
      "t": "area",
      "label": "文字"
    }
  ]
};

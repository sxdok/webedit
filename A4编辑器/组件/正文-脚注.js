/* 组件：脚注（正文）—— 可自由编辑本文件；改完刷新编辑器即生效
   脚注/口径说明小字 */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["footnote"] = {
  "key": "footnote",
  "name": "脚注",
  "group": "正文",
  "desc": "脚注/口径说明小字",
  "match": "div.fn",
  "html": "<div class=\"fn\">注：此处填写数据口径或补充说明。</div>",
  "props": [
    {
      "k": "text",
      "t": "area",
      "label": "注释文字"
    }
  ]
};

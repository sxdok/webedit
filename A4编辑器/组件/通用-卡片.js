/* 组件：卡片（通用）—— 可自由编辑本文件；改完刷新编辑器即生效
   卡片容器（标题 + 内容） */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["card"] = {
  "key": "card",
  "name": "卡片",
  "group": "通用",
  "desc": "卡片容器（标题 + 内容）",
  "match": "div.pcard",
  "html": "<div class=\"pcard\"><div class=\"pch\">卡片标题</div><p>卡片内容……</p></div>",
  "props": [
    {
      "k": "title",
      "t": "text",
      "label": "卡片标题"
    },
    {
      "k": "html",
      "t": "area",
      "label": "卡片内容 HTML"
    }
  ]
};

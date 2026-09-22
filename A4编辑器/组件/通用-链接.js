/* 组件：链接（通用）—— 可自由编辑本文件；改完刷新编辑器即生效
   超链接（打印时带下划线） */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["link"] = {
  "key": "link",
  "name": "链接",
  "group": "通用",
  "desc": "超链接（打印时带下划线）",
  "match": "a",
  "html": "<a href=\"#\">链接文字</a>",
  "props": [
    {
      "k": "text",
      "t": "text",
      "label": "链接文字"
    },
    {
      "k": "attr:href",
      "t": "text",
      "label": "链接地址"
    }
  ]
};

/* 组件：一级标题（标题）—— 可自由编辑本文件；改完刷新编辑器即生效
   文档大标题（二号黑体居中），一般每份文档只用一次 */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["h1"] = {
  "key": "h1",
  "name": "一级标题",
  "group": "标题",
  "desc": "文档大标题（二号黑体居中），一般每份文档只用一次",
  "match": "h1",
  "html": "<h1>文档标题</h1>",
  "props": [
    {
      "k": "text",
      "t": "area",
      "label": "文字"
    },
    {
      "k": "css:text-align",
      "t": "select",
      "label": "对齐",
      "opts": [
        "center",
        "left",
        "right"
      ]
    }
  ]
};

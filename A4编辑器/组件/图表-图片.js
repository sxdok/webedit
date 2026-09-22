/* 组件：图片（图表）—— 可自由编辑本文件；改完刷新编辑器即生效
   单张图片（宽度可调） */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["img"] = {
  "key": "img",
  "name": "图片",
  "group": "图表",
  "desc": "单张图片（宽度可调）",
  "match": "img:not(.in-topo)",
  "html": "",
  "props": [
    {
      "k": "attr:src",
      "t": "text",
      "label": "图片地址"
    },
    {
      "k": "css:width",
      "t": "text",
      "label": "宽度"
    }
  ]
};

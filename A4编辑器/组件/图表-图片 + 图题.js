/* 组件：图片 + 图题（图表）—— 可自由编辑本文件；改完刷新编辑器即生效
   图片 + 图题（图题在图片下方，按章编号） */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["figure"] = {
  "key": "figure",
  "name": "图片 + 图题",
  "group": "图表",
  "desc": "图片 + 图题（图题在图片下方，按章编号）",
  "match": "div.topo",
  "html": "",
  "props": [
    {
      "k": "src",
      "t": "text",
      "label": "图片地址"
    },
    {
      "k": "cap",
      "t": "text",
      "label": "图题"
    },
    {
      "k": "imgw",
      "t": "text",
      "label": "图宽(如 120mm)"
    }
  ]
};

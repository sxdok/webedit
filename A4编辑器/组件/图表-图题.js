/* 组件：图题（图表）—— 可自由编辑本文件；改完刷新编辑器即生效
   图题：在图片下方，按章自动编号（图 X-Y）；「图题」按钮与层级下拉都会产出它 */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["figcap"] = {
  "key": "figcap",
  "name": "图题",
  "group": "图表",
  "desc": "图题：在图片下方，按章自动编号（图 X-Y）；「图题」按钮与层级下拉都会产出它",
  "match": "div.figcap",
  "html": "<div class=\"figcap\">图 X-Y　说明文字</div>",
  "props": [
    {
      "k": "text",
      "t": "text",
      "label": "题注"
    }
  ]
};

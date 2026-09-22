/* 组件：并排双图（图表）—— 可自由编辑本文件；改完刷新编辑器即生效
   并排双图 + 双图题 */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["fig2"] = {
  "key": "fig2",
  "name": "并排双图",
  "group": "图表",
  "desc": "并排双图 + 双图题",
  "match": "div.fig2",
  "html": "<div class=\"fig2\"><div class=\"cell\"><div class=\"cap\">图 X-1　左图说明</div></div><div class=\"cell\"><div class=\"cap\">图 X-2　右图说明</div></div></div>",
  "props": [
    {
      "k": "imgs",
      "t": "area",
      "label": "图片地址(每行一张)"
    }
  ]
};

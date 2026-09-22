/* 组件：目录（含分节）（版式）—— 可自由编辑本文件；改完刷新编辑器即生效
   目录（含分节）：目录页用罗马数字页码 */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["toc"] = {
  "key": "toc",
  "name": "目录（含分节）",
  "group": "版式",
  "desc": "目录（含分节）：目录页用罗马数字页码",
  "match": "ol.toc",
  "html": "<h3>目录</h3>\n<ol class=\"toc\"><li>1 第一章</li><li>2 第二章</li><li>3 第三章</li></ol>\n<div class=\"pgbreak\" data-num=\"arabic\" contenteditable=\"false\"></div>",
  "props": [
    {
      "k": "items",
      "t": "area",
      "label": "目录条目（每行一条）"
    }
  ]
};

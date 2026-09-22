/* 组件：封面结束标记（版式）—— 可自由编辑本文件；改完刷新编辑器即生效
   封面结束标记：结束封面节，其后按目录/正文节排页码 */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["coverend"] = {
  "key": "coverend",
  "name": "封面结束标记",
  "group": "版式",
  "desc": "封面结束标记：结束封面节，其后按目录/正文节排页码",
  "match": "div.pgbreak[data-num=\"none\"]",
  "html": "<div class=\"pgbreak\" data-num=\"none\" contenteditable=\"false\"></div>",
  "props": []
};

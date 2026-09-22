/* 组件：核对清单（正文）—— 可自由编辑本文件；改完刷新编辑器即生效
   核对清单（空心方框，适合待确认项） */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["checks"] = {
  "key": "checks",
  "name": "核对清单",
  "group": "正文",
  "desc": "核对清单（空心方框，适合待确认项）",
  "match": "ul.checks",
  "html": "<ul class=\"checks\"><li>核对项一</li><li>核对项二</li></ul>",
  "props": [
    {
      "k": "items",
      "t": "area",
      "label": "条目(每行一条)"
    }
  ]
};

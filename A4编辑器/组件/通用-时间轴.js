/* 组件：时间轴（通用）—— 可自由编辑本文件；改完刷新编辑器即生效
   时间轴（每行一条，建议"时间　事件"） */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["timeline"] = {
  "key": "timeline",
  "name": "时间轴",
  "group": "通用",
  "desc": "时间轴（每行一条，建议\"时间　事件\"）",
  "match": "ul.tline",
  "html": "<ul class=\"tline\"><li><b>2026-01</b>　项目启动</li><li><b>2026-03</b>　进场实施</li></ul>",
  "props": [
    {
      "k": "items",
      "t": "area",
      "label": "条目(每行一条)"
    }
  ]
};

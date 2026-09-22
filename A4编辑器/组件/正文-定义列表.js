/* 组件：定义列表（正文）—— 可自由编辑本文件；改完刷新编辑器即生效
   定义列表：术语 — 解释（每行"术语|解释"） */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["dl"] = {
  "key": "dl",
  "name": "定义列表",
  "group": "正文",
  "desc": "定义列表：术语 — 解释（每行\"术语|解释\"）",
  "match": "dl.def",
  "html": "<dl class=\"def\"><dt>术语</dt><dd>解释说明</dd><dt>术语二</dt><dd>解释说明二</dd></dl>",
  "props": [
    {
      "k": "pairs",
      "t": "area",
      "label": "条目(每行 术语|解释)"
    }
  ]
};

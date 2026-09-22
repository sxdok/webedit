/* 组件：摘要（正文）—— 可自由编辑本文件；改完刷新编辑器即生效
   摘要/导语框，用于文档开头概述 */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["abstract"] = {
  "key": "abstract",
  "name": "摘要",
  "group": "正文",
  "desc": "摘要/导语框，用于文档开头概述",
  "match": "div.abs",
  "html": "<div class=\"abs\"><b>摘要</b>　此处填写摘要：说明背景、目标与结论。</div>",
  "props": [
    {
      "k": "text",
      "t": "area",
      "label": "文字"
    }
  ]
};

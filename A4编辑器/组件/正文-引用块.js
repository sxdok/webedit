/* 组件：引用块（正文）—— 可自由编辑本文件；改完刷新编辑器即生效
   引用块（标准条文、原文引用） */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["quote"] = {
  "key": "quote",
  "name": "引用块",
  "group": "正文",
  "desc": "引用块（标准条文、原文引用）",
  "match": "blockquote",
  "html": "<blockquote>引用的原文或标准条文，可在句末注明出处。</blockquote>",
  "props": [
    {
      "k": "text",
      "t": "area",
      "label": "引用文字"
    }
  ]
};

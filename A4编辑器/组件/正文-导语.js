/* 组件：导语（正文）—— 可自由编辑本文件；改完刷新编辑器即生效
   导语/提要：段首无缩进、字号略大，用于章节开头点题 */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["lead"] = {
  "key": "lead",
  "name": "导语",
  "group": "正文",
  "desc": "导语/提要：段首无缩进、字号略大，用于章节开头点题",
  "match": "p.lead",
  "html": "<p class=\"lead\">本章提要：此处填写一到两句话的点题内容。</p>",
  "props": [
    {
      "k": "text",
      "t": "area",
      "label": "文字"
    },
    {
      "k": "css:text-align",
      "t": "select",
      "label": "对齐",
      "opts": [
        "left",
        "center",
        "right",
        "justify"
      ]
    }
  ]
};

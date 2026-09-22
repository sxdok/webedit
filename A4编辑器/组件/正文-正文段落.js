/* 组件：正文段落（正文）—— 可自由编辑本文件；改完刷新编辑器即生效
   正文段落：宋体小四、1.5 倍行距、首行缩进 2 字符 */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["p"] = {
  "key": "p",
  "name": "正文段落",
  "group": "正文",
  "desc": "正文段落：宋体小四、1.5 倍行距、首行缩进 2 字符",
  "match": "p:not(.sub):not(.lead):not(.tabcap):not(.figcap)",
  "html": "<p>正文段落内容。</p>",
  "props": [
    {
      "k": "text",
      "t": "area",
      "label": "文字"
    },
    {
      "k": "css:font-size",
      "t": "text",
      "label": "字号"
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
    },
    {
      "k": "css:line-height",
      "t": "text",
      "label": "行距"
    },
    {
      "k": "css:text-indent",
      "t": "text",
      "label": "首行缩进"
    },
    {
      "k": "css:color",
      "t": "color",
      "label": "颜色"
    }
  ]
};

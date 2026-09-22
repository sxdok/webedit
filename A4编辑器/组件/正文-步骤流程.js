/* 组件：步骤流程（正文）—— 可自由编辑本文件；改完刷新编辑器即生效
   步骤流程（带序号圆点） */
window.A4_COMPONENTS = window.A4_COMPONENTS || {};
window.A4_COMPONENTS["steps"] = {
  "key": "steps",
  "name": "步骤流程",
  "group": "正文",
  "desc": "步骤流程（带序号圆点）",
  "match": "ol.steps",
  "html": "<ol class=\"steps\"><li>第一步：准备</li><li>第二步：执行</li><li>第三步：验证</li></ol>",
  "props": [
    {
      "k": "items",
      "t": "area",
      "label": "步骤(每行一步)"
    }
  ]
};

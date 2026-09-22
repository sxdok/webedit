/**
 * 组件：代码/命令块（code，文档常用）——等宽字体 + 浅底 + 可换行。
 */
import { Code2 } from 'lucide-react';
import type { ComponentDefinition, PropSchemaItem } from '../../types';
import { asBool, asNumber, asString } from '../../../utils/id';
import { defaultsOf, fontSizeProp, marginProp, widthProp } from '../shared';

const schema: PropSchemaItem[] = [
  { key: 'text', label: '代码/命令', control: 'textarea', group: '内容', defaultValue: 'adb connect 192.168.10.20:5555\nadb shell am start -n com.example/.MainActivity' },
  { key: 'language', label: '语言标签', control: 'text', group: '内容', defaultValue: '' },
  { key: 'wrap', label: '自动换行', control: 'switch', group: '外观', defaultValue: true },
  fontSizeProp(10.5),
  { key: 'background', label: '背景', control: 'color', group: '外观', defaultValue: '#f6f8fa' },
  { key: 'borderColor', label: '边框色', control: 'color', group: '外观', defaultValue: '#e3eaf2' },
  widthProp(),
  marginProp(),
];

export const codeComponent: ComponentDefinition = {
  type: 'code',
  label: '代码块',
  category: 'Word 常用',
  supportedModes: ['document', 'web'],
  icon: Code2,
  description: '文档代码块：等宽字体、浅底、可标语言',
  defaultFrame: { x: 50, y: 140, w: 560, h: 90 },
  defaultProps: defaultsOf(schema),
  propSchema: schema,
  render: (props, ctx) => {
    const size = ctx.mode === 'document' ? ctx.ptToPx(asNumber(props.fontSize, 10.5)) : asNumber(props.fontSize, 10.5);
    return (
      <div style={{ width: `${asNumber(props.width, 100)}%` }}>
        {asString(props.language) && (
          <div style={{ fontSize: size * 0.9, color: '#8a94a6', marginBottom: 2 }}>{asString(props.language)}</div>
        )}
        <pre
          style={{
            margin: 0,
            padding: '8px 10px',
            background: asString(props.background, '#f6f8fa'),
            border: `1px solid ${asString(props.borderColor, '#e3eaf2')}`,
            borderRadius: 4,
            fontFamily: '"Consolas","Courier New",monospace',
            fontSize: size,
            lineHeight: 1.5,
            whiteSpace: asBool(props.wrap, true) ? 'pre-wrap' : 'pre',
            overflowX: 'auto',
            color: '#24292f',
          }}
        >
          {asString(props.text)}
        </pre>
      </div>
    );
  },
};

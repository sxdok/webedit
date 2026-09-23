/**
 * 组件：卡片（card，Web 专用，isContainer）。标题 + 右上角额外内容 + 内容区，可嵌套子组件。
 */
import { CreditCard } from 'lucide-react';
import type { ComponentDefinition } from '../../types';
import { asBool, asNumber, asString } from '../../../utils/id';

export const cardComponent: ComponentDefinition = {
  type: 'card',
  label: '卡片',
  category: 'Web 容器',
  supportedModes: ['web'],
  icon: CreditCard,
  isContainer: true,
  description: '带标题的卡片容器，可嵌套子组件',
  defaultFrame: { x: 60, y: 60, w: 320, h: 200 },
  defaultProps: {
    title: '卡片标题',
    extra: '',
    bordered: true,
    padding: 16,
    shadow: true,
  },
  propSchema: [
    { key: 'title', label: '标题', control: 'text', group: '内容', defaultValue: '卡片标题' },
    { key: 'extra', label: '右上角内容', control: 'text', group: '内容', defaultValue: '' },
    { key: 'padding', label: '内边距', control: 'number', group: '尺寸', defaultValue: 16, min: 0, max: 48 },
    { key: 'bordered', label: '显示边框', control: 'switch', group: '外观', defaultValue: true },
    { key: 'shadow', label: '阴影', control: 'switch', group: '外观', defaultValue: true },
    { key: 'children', label: '子组件', control: 'children', group: '高级', defaultValue: null },
  ],
  // 子组件由画布作为**第三个参数**传入（规格 §3.1/§8.1），放进卡片的内容区。
  // ★越界裁剪：同「容器」组件 —— 单独一层 `inset:0 + overflow:hidden`（与卡片边框盒重合），
  //   这样"子组件拖出卡片"的部分不可见，且子组件坐标仍相对卡片边框盒（不会整体下移）。
  render: (props, _ctx, children) => {
    const pad = asNumber(props.padding, 16);
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          background: '#fff',
          borderRadius: 8,
          border: asBool(props.bordered, true) ? '1px solid #e5e7eb' : 'none',
          boxShadow: asBool(props.shadow, true) ? '0 2px 10px rgba(0,0,0,.08)' : undefined,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: `${pad * 0.7}px ${pad}px`,
            borderBottom: '1px solid #f0f0f0',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          <span style={{ flex: 1 }}>{asString(props.title, '卡片标题')}</span>
          {asString(props.extra) && <span style={{ fontSize: 12, color: '#6b7280' }}>{asString(props.extra)}</span>}
        </div>
        <div style={{ flex: 1, padding: pad, minHeight: 0 }} />
        <div data-container-clip="1" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
          {children}
        </div>
      </div>
    );
  },
};

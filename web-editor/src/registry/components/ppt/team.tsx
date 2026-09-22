/**
 * 组件：团队/人物卡（team，PPT 常用）——每行「姓名|角色」，圆/方形头像占位 + 姓名 + 角色。
 */
import { Users } from 'lucide-react';
import type { ComponentDefinition, PropSchemaItem } from '../../types';
import { asEnum, asNumber, asString } from '../../../utils/id';
import { defaultsOf, fontSizeProp, marginProp, rows, widthProp } from '../shared';

const schema: PropSchemaItem[] = [
  { key: 'items', label: '成员（每行：姓名|角色）', control: 'textarea', group: '内容', defaultValue: '张三|项目经理\n李四|方案工程师\n王五|现场实施\n赵六|售后支持' },
  { key: 'columns', label: '每行列数', control: 'number', group: '布局', defaultValue: 4, min: 1, max: 6 },
  { key: 'gap', label: '间距', control: 'number', group: '布局', defaultValue: 12, min: 0, max: 48 },
  { key: 'avatarSize', label: '头像尺寸', control: 'number', group: '布局', defaultValue: 56, min: 24, max: 160 },
  {
    key: 'shape',
    label: '头像形状',
    control: 'select',
    group: '外观',
    defaultValue: 'circle',
    options: [
      { label: '圆形', value: 'circle' },
      { label: '方形', value: 'square' },
    ],
  },
  fontSizeProp(12),
  { key: 'accent', label: '头像底色', control: 'color', group: '外观', defaultValue: '#e8f1f9' },
  widthProp(),
  marginProp(),
];

export const teamComponent: ComponentDefinition = {
  type: 'team',
  label: '团队卡片',
  category: 'PPT 专用',
  supportedModes: ['document', 'web'],
  icon: Users,
  description: 'PPT 团队页：姓名|角色 逐行，头像占位可取首字',
  defaultFrame: { x: 40, y: 140, w: 640, h: 160 },
  defaultProps: defaultsOf(schema),
  propSchema: schema,
  render: (props, ctx) => {
    const size = ctx.mode === 'document' ? ctx.ptToPx(asNumber(props.fontSize, 12)) : asNumber(props.fontSize, 12);
    const av = asNumber(props.avatarSize, 56);
    const circle = asEnum(props.shape, ['circle', 'square'] as const, 'circle') === 'circle';
    const accent = asString(props.accent, '#e8f1f9');
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.max(1, asNumber(props.columns, 4))}, minmax(0,1fr))`,
          gap: asNumber(props.gap, 12),
          width: `${asNumber(props.width, 100)}%`,
          fontSize: size,
          textAlign: 'center',
        }}
      >
        {rows(props.items).map((r, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div
              style={{
                width: av,
                height: av,
                borderRadius: circle ? '50%' : 8,
                background: accent,
                color: '#1f4e79',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: av * 0.4,
                fontWeight: 600,
              }}
            >
              {(r[0] ?? '·').slice(0, 1)}
            </div>
            <div style={{ fontWeight: 600 }}>{r[0] ?? ''}</div>
            {r[1] && <div style={{ color: '#8a94a6', fontSize: size * 0.92 }}>{r[1]}</div>}
          </div>
        ))}
      </div>
    );
  },
};

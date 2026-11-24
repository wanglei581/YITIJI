// utils/resume-style-presets.js
// 简历 PDF 高定排版预设：严格映射后端 ResumeLayoutDto 的 5 个真实字段，零伪造参数。
// columns 恒为整数 1 | 2（后端 @IsIn([1, 2]) 严格校验数字类型）。

const PRESETS = [
  {
    key: 'business',
    title: '极简商务',
    tag: '社招推荐',
    sub: '单栏 · 远山灰',
    swatch: '#3B4D61',
    columns: 1,
    layout: {
      fontScale: 'standard',
      lineSpacing: 'standard',
      margin: 'normal',
      columns: 1,
      accent: 'slate',
    },
  },
  {
    key: 'campus',
    title: '校招清新',
    tag: '应届精选',
    sub: '双栏 · 墨翠绿',
    swatch: '#0F6A57',
    columns: 2,
    layout: {
      fontScale: 'compact',
      lineSpacing: 'standard',
      margin: 'narrow',
      columns: 2,
      accent: 'green',
    },
  },
  {
    key: 'state',
    title: '国企稳重',
    tag: '正式稳重',
    sub: '单栏 · 经典蓝',
    swatch: '#26538D',
    columns: 1,
    layout: {
      fontScale: 'large',
      lineSpacing: 'relaxed',
      margin: 'wide',
      columns: 1,
      accent: 'blue',
    },
  },
]

const ALLOWED_FONT_SCALES = ['compact', 'standard', 'large']
const ALLOWED_LINE_SPACINGS = ['compact', 'standard', 'relaxed']
const ALLOWED_MARGINS = ['narrow', 'normal', 'wide']
const ALLOWED_ACCENTS = ['blue', 'green', 'slate']

function cloneLayout(layout) {
  const src = layout || {}
  const cols = Number(src.columns) === 2 ? 2 : 1
  return {
    fontScale: ALLOWED_FONT_SCALES.indexOf(src.fontScale) >= 0 ? src.fontScale : 'standard',
    lineSpacing: ALLOWED_LINE_SPACINGS.indexOf(src.lineSpacing) >= 0 ? src.lineSpacing : 'standard',
    margin: ALLOWED_MARGINS.indexOf(src.margin) >= 0 ? src.margin : 'normal',
    columns: cols,
    accent: ALLOWED_ACCENTS.indexOf(src.accent) >= 0 ? src.accent : 'blue',
  }
}

function listPresets(activeKey) {
  return PRESETS.map((p) => ({
    key: p.key,
    title: p.title,
    tag: p.tag,
    sub: p.sub,
    swatch: p.swatch,
    columns: p.columns,
    on: p.key === activeKey,
  }))
}

function presetByKey(key) {
  return PRESETS.find((p) => p.key === key) || null
}

function applyPreset(key) {
  const hit = presetByKey(key) || PRESETS[0]
  return cloneLayout(hit.layout)
}

function matchPresetKey(layout) {
  const cur = cloneLayout(layout)
  const hit = PRESETS.find((p) => (
    p.layout.fontScale === cur.fontScale
    && p.layout.lineSpacing === cur.lineSpacing
    && p.layout.margin === cur.margin
    && p.layout.columns === cur.columns
    && p.layout.accent === cur.accent
  ))
  return hit ? hit.key : ''
}

function defaultLayout() {
  return applyPreset('business')
}

module.exports = {
  PRESETS,
  listPresets,
  presetByKey,
  applyPreset,
  matchPresetKey,
  cloneLayout,
  defaultLayout,
}

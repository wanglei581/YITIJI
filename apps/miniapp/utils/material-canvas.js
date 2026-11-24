// utils/material-canvas.js
// 求职材料轻工具箱纯几何与参数计算模块（无 wx 依赖，可直接单测）。
// 画布在手机本地合成 JPG，仅在用户主动点击「上传并去终端打印」后才上传为 print_doc。

const A4_WIDTH = 1240
const A4_HEIGHT = 1754
const MAX_WATERMARK_LEN = 32
const MAX_SINGLE_SIDE = 1600

const WATERMARK_PRESETS = [
  '仅供入职审核使用',
  '仅供报名资格复审使用',
  '仅供租房备案使用',
]

const OPACITY_LEVELS = [
  { key: 'light',  label: '轻柔', alpha: 0.22 },
  { key: 'std',    label: '标准', alpha: 0.34 },
  { key: 'strong', label: '清晰', alpha: 0.46 },
]

const PHOTO_MODES = [
  {
    key: 'one_inch',
    label: '一寸参考拼版',
    sub: '8 张 · 约 25×35mm 比例',
    cols: 4,
    rows: 2,
    widthMm: 25,
    heightMm: 35,
  },
  {
    key: 'two_inch',
    label: '二寸参考拼版',
    sub: '4 张 · 约 35×49mm 比例',
    cols: 2,
    rows: 2,
    widthMm: 35,
    heightMm: 49,
  },
]

function sanitizeWatermarkText(raw) {
  return String(raw || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_WATERMARK_LEN)
}

function alphaForOpacityKey(key) {
  const hit = OPACITY_LEVELS.find((o) => o.key === key)
  return hit ? hit.alpha : OPACITY_LEVELS[1].alpha
}

function photoModeByKey(key) {
  return PHOTO_MODES.find((m) => m.key === key) || PHOTO_MODES[0]
}

/** 单图水印目标画布尺寸：限制最大边长防低端机 OOM，同时保留原图长宽比。 */
function computeSingleCanvasSize(srcW, srcH) {
  const w = Math.max(1, Number(srcW) || 1200)
  const h = Math.max(1, Number(srcH) || 900)
  const maxDim = Math.max(w, h)
  if (maxDim <= MAX_SINGLE_SIDE) return { width: Math.round(w), height: Math.round(h) }
  const scale = MAX_SINGLE_SIDE / maxDim
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  }
}

/** aspect-fit：把原图完整居中放进目标矩形内，绝不裁切证件边缘。 */
function computeContainRect(srcW, srcH, boxX, boxY, boxW, boxH) {
  const sw = Math.max(1, Number(srcW) || 1)
  const sh = Math.max(1, Number(srcH) || 1)
  const scale = Math.min(boxW / sw, boxH / sh)
  const w = Math.round(sw * scale)
  const h = Math.round(sh * scale)
  return {
    x: Math.round(boxX + (boxW - w) / 2),
    y: Math.round(boxY + (boxH - h) / 2),
    w,
    h,
  }
}

/** aspect-fill：居中裁切源图以填满证件照格，避免拉伸变形。 */
function computeCoverCrop(srcW, srcH, dstW, dstH) {
  const sw = Math.max(1, Number(srcW) || 1)
  const sh = Math.max(1, Number(srcH) || 1)
  const targetRatio = dstW / dstH
  const srcRatio = sw / sh
  if (srcRatio > targetRatio) {
    const cropW = Math.round(sh * targetRatio)
    return { sx: Math.round((sw - cropW) / 2), sy: 0, sw: cropW, sh }
  }
  const cropH = Math.round(sw / targetRatio)
  return { sx: 0, sy: Math.round((sh - cropH) / 2), sw, sh: cropH }
}

/** A4 正反面上下居中槽位（预留充足页边距，避免打印裁边）。 */
function computeDuplexSlots() {
  const padX = 120
  const padTop = 140
  const gapY = 120
  const slotW = A4_WIDTH - padX * 2
  const slotH = Math.floor((A4_HEIGHT - padTop * 2 - gapY) / 2)
  return {
    width: A4_WIDTH,
    height: A4_HEIGHT,
    front: { x: padX, y: padTop, w: slotW, h: slotH },
    back:  { x: padX, y: padTop + slotH + gapY, w: slotW, h: slotH },
  }
}

/** A4 证件照参考拼版格（按 210×297mm 比例换算像素格，并居中排布）。 */
function computePhotoGrid(modeKey) {
  const mode = photoModeByKey(modeKey)
  const cellW = Math.round(A4_WIDTH * (mode.widthMm / 210))
  const cellH = Math.round(A4_HEIGHT * (mode.heightMm / 297))
  const gap = 36
  const totalW = mode.cols * cellW + (mode.cols - 1) * gap
  const totalH = mode.rows * cellH + (mode.rows - 1) * gap
  const startX = Math.round((A4_WIDTH - totalW) / 2)
  const startY = Math.round((A4_HEIGHT - totalH) / 3)
  const cells = []
  for (let r = 0; r < mode.rows; r += 1) {
    for (let c = 0; c < mode.cols; c += 1) {
      cells.push({
        x: startX + c * (cellW + gap),
        y: startY + r * (cellH + gap),
        w: cellW,
        h: cellH,
      })
    }
  }
  return { width: A4_WIDTH, height: A4_HEIGHT, mode, cells }
}

/** 生成斜向铺满水印的网格绘制坐标与字号。 */
function computeWatermarkSpec(canvasW, canvasH, rawText) {
  const text = sanitizeWatermarkText(rawText)
  if (!text) return { text: '', fontSize: 0, points: [] }
  const shortSide = Math.min(canvasW, canvasH)
  const fontSize = Math.max(22, Math.min(44, Math.round(shortSide * 0.032)))
  const stepX = Math.max(240, Math.round(fontSize * Math.max(8, text.length * 0.95)))
  const stepY = Math.max(180, Math.round(fontSize * 5.2))
  const points = []
  for (let y = -canvasH * 0.25; y <= canvasH * 1.25; y += stepY) {
    for (let x = -canvasW * 0.25; x <= canvasW * 1.25; x += stepX) {
      points.push({ x: Math.round(x), y: Math.round(y) })
    }
  }
  return { text, fontSize, angleRad: (-28 * Math.PI) / 180, points }
}

function safeExportFilename(toolKey, photoModeKey, now = new Date()) {
  const d = now instanceof Date ? now : new Date(now)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const stamp = `${y}${m}${day}`
  if (toolKey === 'duplex') return `正反合一A4_${stamp}.jpg`
  if (toolKey === 'photo') {
    const label = photoModeKey === 'two_inch' ? '二寸照A4拼版' : '一寸照A4拼版'
    return `${label}_${stamp}.jpg`
  }
  return `用途水印材料_${stamp}.jpg`
}

module.exports = {
  A4_WIDTH,
  A4_HEIGHT,
  MAX_WATERMARK_LEN,
  WATERMARK_PRESETS,
  OPACITY_LEVELS,
  PHOTO_MODES,
  sanitizeWatermarkText,
  alphaForOpacityKey,
  photoModeByKey,
  computeSingleCanvasSize,
  computeContainRect,
  computeCoverCrop,
  computeDuplexSlots,
  computePhotoGrid,
  computeWatermarkSpec,
  safeExportFilename,
}

/**
 * 九宫格 → pdf-lib drawImage 参数换算。
 *
 * 关键概念："视觉空间" = 用户在预览/打印纸上看到的方向。PDF 页可带 /Rotate
 * 90/180/270（扫描件常见），此时 page.getSize()/getCropBox() 的用户空间坐标
 * 与视觉方向不一致，必须先在视觉空间算好位置，再逆映射回用户空间，并让
 * drawImage 以同角度 rotate，使图片在视觉上是正的。
 *
 * /Rotate 语义：显示时顺时针旋转页面；pdf-lib 的 rotate: degrees(n) 是把
 * 图片绕锚点逆时针转 n 度 —— 两者同角度值恰好抵消。
 *
 * 映射推导（X0/Y0/W/H = CropBox；vx/vy = 视觉空间中图片左下角目标点）：
 *   rot 0  : 用户(x,y) = (X0+vx,        Y0+vy)
 *   rot 90 : 视觉宽=H 高=W；user(x,y)→visual(y-Y0, X0+W-x)；
 *            锚点 x = X0+W-vy, y = Y0+vx（rotate 90 后图片占 x∈[x-h,x], y∈[y,y+w]）
 *   rot 180: 锚点 x = X0+W-vx, y = Y0+H-vy
 *   rot 270: 视觉宽=H 高=W；锚点 x = X0+vy, y = Y0+H-vx
 */
import type { SignStampPosition, SignStampSize } from './print-sign.types'

const SIZE_FACTOR: Record<SignStampSize, number> = { small: 0.15, medium: 0.25, large: 0.35 }
const MARGIN_RATIO = 0.04

const POSITION_GRID: Record<SignStampPosition, { col: 'left' | 'center' | 'right'; row: 'top' | 'middle' | 'bottom' }> = {
  'top-left': { col: 'left', row: 'top' },
  'top-center': { col: 'center', row: 'top' },
  'top-right': { col: 'right', row: 'top' },
  'middle-left': { col: 'left', row: 'middle' },
  center: { col: 'center', row: 'middle' },
  'middle-right': { col: 'right', row: 'middle' },
  'bottom-left': { col: 'left', row: 'bottom' },
  'bottom-center': { col: 'center', row: 'bottom' },
  'bottom-right': { col: 'right', row: 'bottom' },
}

export interface StampDrawParams {
  x: number
  y: number
  width: number
  height: number
  rotateDegrees: 0 | 90 | 180 | 270
}

export function normalizeRotation(rawAngle: number): 0 | 90 | 180 | 270 {
  const a = ((Math.round(rawAngle) % 360) + 360) % 360
  return a === 90 || a === 180 || a === 270 ? a : 0
}

export function computeStampDrawParams(args: {
  cropX: number
  cropY: number
  cropWidth: number
  cropHeight: number
  rotation: 0 | 90 | 180 | 270
  imageWidth: number
  imageHeight: number
  position: SignStampPosition
  size: SignStampSize
}): StampDrawParams {
  const { cropX: X0, cropY: Y0, cropWidth: W, cropHeight: H, rotation, position, size } = args
  const rotated = rotation === 90 || rotation === 270
  const visualW = rotated ? H : W
  const visualH = rotated ? W : H

  const factor = SIZE_FACTOR[size]
  let w = visualW * factor
  let h = (w * args.imageHeight) / args.imageWidth
  if (h > visualH * factor) {
    // 细长/竖长图：改用高度约束反算宽度，保证不越出档位框
    h = visualH * factor
    w = (h * args.imageWidth) / args.imageHeight
  }

  const mX = visualW * MARGIN_RATIO
  const mY = visualH * MARGIN_RATIO
  const { col, row } = POSITION_GRID[position]
  const vx = col === 'left' ? mX : col === 'right' ? visualW - mX - w : (visualW - w) / 2
  const vy = row === 'bottom' ? mY : row === 'top' ? visualH - mY - h : (visualH - h) / 2

  let x: number
  let y: number
  switch (rotation) {
    case 0:
      x = X0 + vx
      y = Y0 + vy
      break
    case 90:
      x = X0 + W - vy
      y = Y0 + vx
      break
    case 180:
      x = X0 + W - vx
      y = Y0 + H - vy
      break
    case 270:
      x = X0 + vy
      y = Y0 + H - vx
      break
  }
  return { x, y, width: w, height: h, rotateDegrees: rotation }
}

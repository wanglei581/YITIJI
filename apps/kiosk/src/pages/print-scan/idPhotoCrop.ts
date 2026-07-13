// ============================================================
// 证件照浏览器内裁剪（设计 §一核心架构：服务端零原生解码，裁剪在浏览器沙箱完成；
// createImageBitmap 解码时现代 Chromium 自动应用 EXIF Orientation，canvas 重编码产物无 EXIF）。
// ============================================================

import type { IdPhotoSpec } from '@ai-job-print/shared'

export interface CoverCrop {
  sx: number
  sy: number
  sw: number
  sh: number
}

/** 居中 cover 裁剪区域（与目标等比、取源图最大内接区域、居中）。 */
export function computeCoverCrop(srcW: number, srcH: number, targetW: number, targetH: number): CoverCrop {
  const targetRatio = targetW / targetH
  const srcRatio = srcW / srcH
  let sw: number
  let sh: number
  if (srcRatio > targetRatio) {
    sh = srcH
    sw = Math.round(srcH * targetRatio)
  } else {
    sw = srcW
    sh = Math.round(srcW / targetRatio)
  }
  return { sx: Math.round((srcW - sw) / 2), sy: Math.round((srcH - sh) / 2), sw, sh }
}

export type CropFailure = 'decode_failed' | 'resolution_too_low'

export interface CropSuccess {
  ok: true
  blob: Blob
  /** 裁剪区域相对目标像素的倍率；<2 时页面提示"打印可能不够清晰"（设计 §二.5） */
  scaleRatio: number
}

export interface CropError {
  ok: false
  reason: CropFailure
}

export async function cropToSpec(source: Blob, spec: IdPhotoSpec): Promise<CropSuccess | CropError> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(source)
  } catch {
    return { ok: false, reason: 'decode_failed' }
  }
  try {
    const crop = computeCoverCrop(bitmap.width, bitmap.height, spec.widthPx, spec.heightPx)
    // 设计 §二.5：cropWidth ≥ targetWidth && cropHeight ≥ targetHeight，不足直接拒绝（放大必糊）。
    if (crop.sw < spec.widthPx || crop.sh < spec.heightPx) {
      return { ok: false, reason: 'resolution_too_low' }
    }
    const canvas = document.createElement('canvas')
    canvas.width = spec.widthPx
    canvas.height = spec.heightPx
    const ctx = canvas.getContext('2d')
    if (!ctx) return { ok: false, reason: 'decode_failed' }
    ctx.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, spec.widthPx, spec.heightPx)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    if (!blob) return { ok: false, reason: 'decode_failed' }
    return { ok: true, blob, scaleRatio: crop.sw / spec.widthPx }
  } finally {
    bitmap.close()
  }
}

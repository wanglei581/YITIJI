// ============================================================
// SignatureCanvasPad — 触屏手写签名画布
//
// 原生 <canvas> + Pointer Events，全仓无 signature_pad / react-signature-canvas /
// fabric 等库依赖，手写笔画渲染为黑色描边；触屏优先（touch-action: none 防止
// 画线时触发页面滚动）。「清除」重置画布；「确认签名」导出 PNG Blob 交给父组件
// （父组件负责上传，本组件不做任何网络请求）。
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { Button } from '@ai-job-print/ui'
import { EraserIcon } from 'lucide-react'

interface SignatureCanvasPadProps {
  /** 用户点击「确认签名」且画布非空时回调，携带导出的 PNG Blob。 */
  onConfirm: (blob: Blob) => void
  disabled?: boolean
}

const STROKE_COLOR = '#171717'
const STROKE_WIDTH = 3

export function SignatureCanvasPad({ onConfirm, disabled }: SignatureCanvasPadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const [hasDrawn, setHasDrawn] = useState(false)

  // 按设备像素比重建画布分辨率，避免高分屏下笔画模糊；容器尺寸变化（如竖屏旋转）
  // 时重新适配，但会清空已画内容——首次挂载时执行一次即可，运行期一体机不会变分辨率。
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = STROKE_COLOR
    ctx.lineWidth = STROKE_WIDTH
  }, [])

  const getRelativePoint = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawingRef.current = true
    lastPointRef.current = getRelativePoint(e)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || !drawingRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const last = lastPointRef.current
    if (!canvas || !ctx || !last) return
    const point = getRelativePoint(e)
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
    lastPointRef.current = point
    if (!hasDrawn) setHasDrawn(true)
  }

  const handlePointerUp = () => {
    drawingRef.current = false
    lastPointRef.current = null
  }

  const handleClear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasDrawn(false)
  }

  const handleConfirm = () => {
    const canvas = canvasRef.current
    if (!canvas || !hasDrawn) return
    canvas.toBlob((blob) => {
      if (blob) onConfirm(blob)
    }, 'image/png')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative h-48 w-full overflow-hidden rounded-xl border-2 border-dashed border-neutral-200 bg-white">
        <canvas
          ref={canvasRef}
          className="h-full w-full touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          aria-label="手写签名画布"
        />
        {!hasDrawn && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-neutral-300">
            请在此手写签名
          </p>
        )}
      </div>
      <div className="flex gap-3">
        <Button size="lg" variant="secondary" disabled={!hasDrawn || disabled} onClick={handleClear}>
          <EraserIcon className="mr-1.5 h-5 w-5" />
          清除
        </Button>
        <Button size="lg" className="flex-1" disabled={!hasDrawn || disabled} onClick={handleConfirm}>
          确认签名
        </Button>
      </div>
    </div>
  )
}

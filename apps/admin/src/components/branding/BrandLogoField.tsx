import { useState } from 'react'
import { BRAND_LOGO_MAX_BYTES, BRAND_LOGO_MIME_TYPES, BRAND_LOGO_MAX_PIXELS, formatCount } from '@ai-job-print/shared'
import { brandingAdmin, brandingError, logoPreviewUrl } from '../../services/api/brandingAdmin'

const names: Record<string, string> = { 'image/png': 'PNG' }
const types = BRAND_LOGO_MIME_TYPES.map((type) => names[type] ?? type).join(' 或 ')
function matchesHeader(bytes: Uint8Array): boolean {
  return BRAND_LOGO_MIME_TYPES.some((type: string) => {
    if (type === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
    return false
  })
}
export function BrandLogoField({ url, onChange, clearLabel = '不用 Logo' }: { url: string | null; onChange: (id: string | null, url: string | null) => void; clearLabel?: string }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [size, setSize] = useState<string | null>(null)
  async function choose(file: File) {
    setError(null); setSize(null)
    if (file.size > BRAND_LOGO_MAX_BYTES) { setError(`图片不能超过 ${formatCount(BRAND_LOGO_MAX_BYTES / 1024)}KB`); return }
    if (!matchesHeader(new Uint8Array(await file.slice(0, 12).arrayBuffer()))) { setError(`请选择 ${types} 图片`); return }
    setBusy(true)
    try {
      const result = await brandingAdmin.upload(file)
      onChange(result.assetId, result.logoUrl)
      setSize(`${formatCount(result.width)} × ${formatCount(result.height)}`)
    } catch (e) { setError(brandingError(e, '图片上传失败，请稍后重试')) } finally { setBusy(false) }
  }
  return <div className="space-y-2 text-sm">
    <p className="font-medium text-neutral-800">Logo</p>
    {/* 浏览器自带的选择文件控件会显示英文「Choose File」，藏起来换成中文按钮 */}
    <label className={`inline-flex min-h-11 items-center rounded-lg border border-neutral-300 px-3 ${busy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-neutral-50'}`}>
      {busy ? '正在上传…' : '选择图片'}
      <input aria-label="选择 Logo" type="file" accept={BRAND_LOGO_MIME_TYPES.join(',')} disabled={busy} className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void choose(file) }} />
    </label>
    <p className="text-xs text-neutral-500">支持 {types}，不超过 {formatCount(BRAND_LOGO_MAX_BYTES / 1024)}KB，宽高不超过 {formatCount(BRAND_LOGO_MAX_PIXELS)} 像素，接近正方形；只支持静态图片。</p>
    {url && <div><img src={logoPreviewUrl(url) ?? undefined} alt="Logo 预览" className="h-20 w-20 object-contain" onLoad={(e) => { if (!size) setSize(`${formatCount(e.currentTarget.naturalWidth)} × ${formatCount(e.currentTarget.naturalHeight)}`) }} />{size && <p>尺寸：{size}</p>}</div>}
    {url && <button type="button" className="min-h-11 rounded-lg border border-neutral-300 px-3" onClick={() => { onChange(null, null); setSize(null); setError(null) }}>{clearLabel}</button>}
    {error && <p role="alert" className="text-red-600">{error}</p>}
  </div>
}

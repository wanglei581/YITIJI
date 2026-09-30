import { useState } from 'react'
import { Button } from '@ai-job-print/ui'
import { XIcon } from 'lucide-react'
import type { AdAssetView } from '../../services/api/screensaver'
import { formatBytes, resolvePreviewUrl } from './utils'

export function AssetPreviewModal({ asset, onClose }: { asset: AdAssetView; onClose: () => void }) {
  const previewUrl = resolvePreviewUrl(asset.previewUrl)
  const isExternal = asset.source === 'external_url'
  const [videoError, setVideoError] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-6" role="dialog" aria-modal="true">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-neutral-900">{asset.title}</p>
            <p className="text-xs text-neutral-500">
              {asset.type === 'video' ? '视频' : '图片'} ·{' '}
              {isExternal ? '外链' : formatBytes(asset.sizeBytes)} · {asset.durationSec}s
            </p>
            {isExternal && asset.externalUrl && (
              <p className="mt-0.5 truncate text-xs text-neutral-400" title={asset.externalUrl}>
                {asset.externalUrl}
              </p>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="关闭预览">
            <XIcon className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-neutral-950 p-4">
          {asset.type === 'video' ? (
            videoError ? (
              <p className="max-w-md px-6 text-center text-sm text-neutral-300">
                {isExternal
                  ? '外部视频源不允许当前浏览器预览（可能因 CORS 或视频源限制）。请在终端或原始链接验证播放效果。'
                  : '视频无法预览，请检查素材文件。'}
              </p>
            ) : (
              <video
                src={previewUrl}
                controls
                className="max-h-[72vh] max-w-full rounded bg-black"
                onError={() => setVideoError(true)}
              />
            )
          ) : (
            <img src={previewUrl} alt={asset.title} className="max-h-[72vh] max-w-full rounded object-contain" />
          )}
        </div>
      </div>
    </div>
  )
}


import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Card, EmptyState, StatusBadge } from '@ai-job-print/ui'
import { EyeIcon, ImageIcon, LinkIcon, Trash2Icon, VideoIcon } from 'lucide-react'
import type { AdAssetView } from '../../services/api/screensaver'
import { screensaverService } from '../../services/api/screensaver'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { formatBytes, resolvePreviewUrl } from './utils'
import { AssetPreviewModal } from './AssetPreviewModal'
import { useRecruitmentHosting } from '../components/recruitment/useRecruitmentHosting'
import { AssetUploadNotice } from './AssetUploadNotice'

export function AssetsTab() {
  const hosting = useRecruitmentHosting()
  const [assets, setAssets] = useState<AdAssetView[]>([])
  const [loading, setLoading] = useState(true)
  const [file, setFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [duration, setDuration] = useState('')
  const [uploading, setUploading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [previewAsset, setPreviewAsset] = useState<AdAssetView | null>(null)

  // 外部视频直链
  const [extUrl, setExtUrl] = useState('')
  const [extTitle, setExtTitle] = useState('')
  const [extDuration, setExtDuration] = useState('')
  const [extSubmitting, setExtSubmitting] = useState(false)
  const [extError, setExtError] = useState<string | null>(null)

  const reload = useCallback(() => {
    setListError(null)
    setLoading(true)
    screensaverService
      .listAssets()
      .then(setAssets)
      .catch((e) => setListError(userMessageOf(e, '加载失败，请稍后重试')))
      .finally(() => setLoading(false))
  }, [])

  useEffect(reload, [reload])

  const handleUpload = useCallback(async () => {
    if (!file || !title.trim()) {
      setUploadError('请选择文件并填写标题')
      return
    }
    setUploading(true)
    setUploadError(null)
    try {
      const dur = duration.trim() ? Number(duration) : undefined
      await screensaverService.uploadAsset(file, title.trim(), Number.isFinite(dur) ? dur : undefined)
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setTitle('')
      setDuration('')
      reload()
    } catch (e) {
      setUploadError(userMessageOf(e, '上传失败，请稍后重试'))
    } finally {
      setUploading(false)
    }
  }, [file, title, duration, reload])

  const handleAddExternal = useCallback(async () => {
    if (!extUrl.trim() || !extTitle.trim()) {
      setExtError('请填写视频链接和标题')
      return
    }
    setExtSubmitting(true)
    setExtError(null)
    try {
      const dur = extDuration.trim() ? Number(extDuration) : undefined
      await screensaverService.createExternalVideo(
        extUrl.trim(),
        extTitle.trim(),
        Number.isFinite(dur) ? dur : undefined,
      )
      setExtUrl('')
      setExtTitle('')
      setExtDuration('')
      reload()
    } catch (e) {
      setExtError(userMessageOf(e, '添加失败，请稍后重试'))
    } finally {
      setExtSubmitting(false)
    }
  }, [extUrl, extTitle, extDuration, reload])

  const toggleStatus = useCallback(
    async (a: AdAssetView) => {
      try {
        await screensaverService.updateAsset(a.id, { status: a.status === 'active' ? 'disabled' : 'active' })
        reload()
      } catch (e) {
        setListError(userMessageOf(e, '启停失败，请稍后重试'))
      }
    },
    [reload],
  )

  const remove = useCallback(
    async (a: AdAssetView) => {
      if (!window.confirm(`确认删除素材「${a.title}」？删除后绑定它的播放方案将不再播放此素材。`)) return
      try {
        await screensaverService.deleteAsset(a.id)
        reload()
      } catch (e) {
        setListError(userMessageOf(e, '删除失败，请稍后重试'))
      }
    },
    [reload],
  )

  return (
    <div className="space-y-6">
      <AssetUploadNotice hosting={hosting} />
      {/* 上传区 */}
      <Card className="p-5">
        <h3 className="mb-3 text-sm font-semibold text-neutral-800">上传素材</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-neutral-500">文件（JPG/PNG/WebP / MP4/WebM）</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="sr-only"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>选择文件</Button>
              <span className="max-w-64 truncate text-xs text-neutral-500" title={file?.name}>{file?.name ?? '未选择文件'}</span>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">标题</label>
            <input
              type="text"
              value={title}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例：就业服务宣传海报"
              className="h-10 w-56 rounded-md border border-neutral-300 px-3 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">停留/时长（秒，选填）</label>
            <input
              type="number"
              min={3}
              max={1800}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="图片默认 8"
              className="h-10 w-32 rounded-md border border-neutral-300 px-3 text-sm"
            />
          </div>
          <Button onClick={handleUpload} disabled={uploading || !file}>
            {uploading ? '上传中…' : '上传'}
          </Button>
        </div>
        {uploadError && <p className="mt-2 text-sm text-error">{uploadError}</p>}
      </Card>

      {/* 外部视频直链 */}
      <Card className="p-5">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-neutral-800">
          <LinkIcon className="h-4 w-4 text-neutral-400" aria-hidden="true" /> 添加外部视频链接
        </h3>
        <p className="mb-3 text-xs text-neutral-500">
          仅支持 HTTPS 的 .mp4 / .webm 视频直链；不支持 iframe、B站 / 抖音 / YouTube 等网页链接。链接过期由管理员重新配置，系统不保存第三方账号密钥。
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-neutral-500">视频直链（https://…/xxx.mp4）</label>
            <input
              type="url"
              value={extUrl}
              maxLength={2048}
              onChange={(e) => setExtUrl(e.target.value)}
              placeholder="https://cdn.example.com/promo.mp4"
              className="h-10 w-96 max-w-full rounded-md border border-neutral-300 px-3 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">标题</label>
            <input
              type="text"
              value={extTitle}
              maxLength={80}
              onChange={(e) => setExtTitle(e.target.value)}
              placeholder="例：园区宣传片"
              className="h-10 w-56 rounded-md border border-neutral-300 px-3 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">时长（秒，选填）</label>
            <input
              type="number"
              min={3}
              max={1800}
              value={extDuration}
              onChange={(e) => setExtDuration(e.target.value)}
              placeholder="默认 15"
              className="h-10 w-32 rounded-md border border-neutral-300 px-3 text-sm"
            />
          </div>
          <Button onClick={handleAddExternal} disabled={extSubmitting || !extUrl.trim()}>
            {extSubmitting ? '添加中…' : '添加链接'}
          </Button>
        </div>
        {extError && <p className="mt-2 text-sm text-error">{extError}</p>}
      </Card>

      {/* 素材网格 */}
      {loading ? (
        <p className="text-sm text-neutral-400">加载中…</p>
      ) : listError ? (
        <p className="text-sm text-error">{listError}</p>
      ) : assets.length === 0 ? (
        <EmptyState title="暂无素材" description="先上传图片或视频，再到「播放方案」组合排期。" />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((a) => (
            <Card key={a.id} className="overflow-hidden">
              <button
                type="button"
                onClick={() => setPreviewAsset(a)}
                className="group relative flex h-40 w-full items-center justify-center bg-neutral-100 text-left"
                aria-label={`查看素材：${a.title}`}
              >
                {a.type === 'video' ? (
                  <VideoIcon className="h-10 w-10 text-neutral-400" aria-hidden="true" />
                ) : (
                  <img src={resolvePreviewUrl(a.previewUrl)} alt={a.title} className="h-full w-full object-cover" />
                )}
                <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/55 px-2 py-1.5 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  <EyeIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  查看效果
                </span>
                <span className="absolute left-2 top-2">
                  <StatusBadge
                    dot
                    status={a.status === 'active' ? 'success' : 'default'}
                    label={a.status === 'active' ? '启用' : '停用'}
                  />
                </span>
                {a.source === 'external_url' && (
                  <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-violet-600/90 px-2 py-0.5 text-xs font-medium text-white">
                    <LinkIcon className="h-3 w-3" aria-hidden="true" /> 外链
                  </span>
                )}
              </button>
              <div className="space-y-1 p-3">
                <p className="truncate text-sm font-medium text-neutral-800" title={a.title}>
                  {a.title}
                </p>
                <p className="flex items-center gap-2 text-xs text-neutral-500">
                  {a.type === 'video' ? <VideoIcon className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
                  {a.type === 'video' ? '视频' : '图片'} ·{' '}
                  {a.source === 'external_url' ? '外链' : formatBytes(a.sizeBytes)} · {a.durationSec}s
                </p>
                {a.source === 'external_url' && a.externalUrl && (
                  <p className="truncate text-xs text-neutral-400" title={a.externalUrl}>
                    {a.externalUrl}
                  </p>
                )}
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => toggleStatus(a)}>
                    {a.status === 'active' ? '停用' : '启用'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(a)}>
                    <Trash2Icon className="h-4 w-4 text-error" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {previewAsset && (
        <AssetPreviewModal asset={previewAsset} onClose={() => setPreviewAsset(null)} />
      )}
    </div>
  )
}

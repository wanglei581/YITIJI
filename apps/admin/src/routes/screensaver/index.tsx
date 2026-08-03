import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, ComplianceBanner, EmptyState, StatusBadge } from '@ai-job-print/ui'
import {
  EyeIcon,
  ImageIcon,
  VideoIcon,
  Trash2Icon,
  ArrowUpIcon,
  ArrowDownIcon,
  PlusIcon,
  MonitorIcon,
  SparklesIcon,
  LinkIcon,
  XIcon,
} from 'lucide-react'
import { Page } from '../Page'
import {
  screensaverService,
  type AdAssetView,
  type AdPlaylistView,
  type AiPosterStatusView,
  type ScreensaverTerminalView,
} from '../../services/api/screensaver'
import { API_BASE_URL } from '../../services/api/client'

type Tab = 'assets' | 'playlists' | 'terminals'

const TABS: { key: Tab; label: string }[] = [
  { key: 'assets', label: '素材库' },
  { key: 'playlists', label: '播放方案' },
  { key: 'terminals', label: '终端配置' },
]

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 后端返回的 previewUrl 是 /api/v1/... 相对签名地址，Admin dev server 需拼到 API 源。 */
function resolvePreviewUrl(previewUrl: string): string {
  if (/^(https?:|data:|blob:)/.test(previewUrl)) return previewUrl
  const origin = API_BASE_URL.replace(/\/api\/v1\/?$/, '')
  return previewUrl.startsWith('/') ? `${origin}${previewUrl}` : previewUrl
}

export default function ScreensaverPage() {
  const [tab, setTab] = useState<Tab>('assets')
  const [aiStatus, setAiStatus] = useState<AiPosterStatusView | null>(null)

  useEffect(() => {
    screensaverService.aiPosterStatus().then(setAiStatus).catch(() => setAiStatus(null))
  }, [])

  return (
    <Page
      title="宣传屏"
      subtitle="一体机待机时轮播宣传海报 / 视频；无操作进入，触摸唤醒"
    >
      <ComplianceBanner tone="info" title="合规提示">
        待机宣传屏属线下一体机运营广告位，非招聘闭环。素材文案禁止出现「一键投递 / 立即投递 / 平台投递」等违规用语。
      </ComplianceBanner>

      {/* AI 文生图：二期能力提示 */}
      <div className="mt-4 flex items-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
        <SparklesIcon className="h-4 w-4 text-neutral-400" aria-hidden="true" />
        <span>
          AI 文生图海报：{aiStatus?.enabled ? `已启用（${aiStatus.provider}）` : '二期能力，暂未启用'}
          {!aiStatus?.enabled && '（一期请上传自制海报 / 视频）'}
        </span>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex gap-1 border-b border-neutral-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-neutral-500 hover:text-neutral-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === 'assets' && <AssetsTab />}
        {tab === 'playlists' && <PlaylistsTab />}
        {tab === 'terminals' && <TerminalsTab />}
      </div>
    </Page>
  )
}

// ─── 素材库 ──────────────────────────────────────────────────────────────────

function AssetsTab() {
  const [assets, setAssets] = useState<AdAssetView[]>([])
  const [loading, setLoading] = useState(true)
  const [file, setFile] = useState<File | null>(null)
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
    setLoading(true)
    screensaverService
      .listAssets()
      .then(setAssets)
      .catch((e) => setListError(e?.message ?? '加载失败'))
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
      setTitle('')
      setDuration('')
      reload()
    } catch (e) {
      setUploadError((e as Error)?.message ?? '上传失败')
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
      setExtError((e as Error)?.message ?? '添加失败')
    } finally {
      setExtSubmitting(false)
    }
  }, [extUrl, extTitle, extDuration, reload])

  const toggleStatus = useCallback(
    async (a: AdAssetView) => {
      await screensaverService.updateAsset(a.id, { status: a.status === 'active' ? 'disabled' : 'active' })
      reload()
    },
    [reload],
  )

  const remove = useCallback(
    async (a: AdAssetView) => {
      if (!window.confirm(`确认删除素材「${a.title}」？删除后绑定它的播放方案将不再播放此素材。`)) return
      await screensaverService.deleteAsset(a.id)
      reload()
    },
    [reload],
  )

  return (
    <div className="space-y-6">
      {/* 上传区 */}
      <Card className="p-5">
        <h3 className="mb-3 text-sm font-semibold text-neutral-800">上传素材</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-neutral-500">文件（JPG/PNG/WebP / MP4/WebM）</label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
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

function AssetPreviewModal({ asset, onClose }: { asset: AdAssetView; onClose: () => void }) {
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

// ─── 播放方案 ────────────────────────────────────────────────────────────────

interface EditorState {
  id: string | null
  name: string
  itemAssetIds: string[]
}

function PlaylistsTab() {
  const [playlists, setPlaylists] = useState<AdPlaylistView[]>([])
  const [assets, setAssets] = useState<AdAssetView[]>([])
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    Promise.all([screensaverService.listPlaylists(), screensaverService.listAssets()])
      .then(([pl, as]) => {
        setPlaylists(pl)
        setAssets(as.filter((a) => a.status === 'active'))
      })
      .catch((e) => setError((e as Error)?.message ?? '加载失败'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(reload, [reload])

  const startNew = () => setEditor({ id: null, name: '', itemAssetIds: [] })
  const startEdit = (p: AdPlaylistView) =>
    setEditor({ id: p.id, name: p.name, itemAssetIds: p.items.map((it) => it.assetId) })

  const save = useCallback(async () => {
    if (!editor) return
    if (!editor.name.trim()) {
      setError('请填写方案名称')
      return
    }
    if (editor.itemAssetIds.length === 0) {
      setError('请至少加入一个素材')
      return
    }
    setError(null)
    const input = {
      name: editor.name.trim(),
      status: 'active' as const,
      items: editor.itemAssetIds.map((assetId, i) => ({ assetId, order: i, enabled: true })),
    }
    try {
      if (editor.id) await screensaverService.updatePlaylist(editor.id, input)
      else await screensaverService.createPlaylist(input)
      setEditor(null)
      reload()
    } catch (e) {
      setError((e as Error)?.message ?? '保存失败')
    }
  }, [editor, reload])

  const remove = useCallback(
    async (p: AdPlaylistView) => {
      if (!window.confirm(`确认删除播放方案「${p.name}」？绑定它的终端将自动停用屏保。`)) return
      await screensaverService.deletePlaylist(p.id)
      reload()
    },
    [reload],
  )

  if (loading) return <p className="text-sm text-neutral-400">加载中…</p>

  if (editor) {
    return (
      <PlaylistEditor
        editor={editor}
        assets={assets}
        error={error}
        onChange={setEditor}
        onSave={save}
        onCancel={() => {
          setEditor(null)
          setError(null)
        }}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={startNew}>
          <PlusIcon className="mr-1 h-4 w-4" /> 新建方案
        </Button>
      </div>
      {playlists.length === 0 ? (
        <EmptyState title="暂无播放方案" description="新建一个方案，把素材按顺序组合后绑定到终端。" />
      ) : (
        <div className="space-y-3">
          {playlists.map((p) => (
            <Card key={p.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium text-neutral-800">{p.name}</p>
                <p className="text-xs text-neutral-500">
                  {p.itemCount} 个素材 ·{' '}
                  <StatusBadge
                    dot
                    status={p.status === 'active' ? 'success' : 'default'}
                    label={p.status === 'active' ? '启用' : '停用'}
                  />
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => startEdit(p)}>
                  编辑
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(p)}>
                  <Trash2Icon className="h-4 w-4 text-error" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function PlaylistEditor({
  editor,
  assets,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  editor: EditorState
  assets: AdAssetView[]
  error: string | null
  onChange: (e: EditorState) => void
  onSave: () => void
  onCancel: () => void
}) {
  const selected = editor.itemAssetIds
  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets])
  const available = assets.filter((a) => !selected.includes(a.id))

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= selected.length) return
    const next = [...selected]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    onChange({ ...editor, itemAssetIds: next })
  }

  return (
    <Card className="space-y-5 p-5">
      <div>
        <label className="mb-1 block text-xs text-neutral-500">方案名称</label>
        <input
          type="text"
          value={editor.name}
          maxLength={60}
          onChange={(e) => onChange({ ...editor, name: e.target.value })}
          placeholder="例：大厅常规轮播"
          className="h-10 w-72 rounded-md border border-neutral-300 px-3 text-sm"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* 已选（排序） */}
        <div>
          <h4 className="mb-2 text-sm font-semibold text-neutral-800">已选素材（播放顺序）</h4>
          {selected.length === 0 ? (
            <p className="rounded-md border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-400">
              从右侧加入素材
            </p>
          ) : (
            <ul className="space-y-2">
              {selected.map((id, i) => {
                const a = assetById.get(id)
                return (
                  <li key={id} className="flex items-center gap-2 rounded-md border border-neutral-200 p-2">
                    <span className="w-5 text-center text-xs text-neutral-400">{i + 1}</span>
                    <span className="flex-1 truncate text-sm">{a?.title ?? id}</span>
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="p-1 disabled:opacity-30">
                      <ArrowUpIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === selected.length - 1}
                      className="p-1 disabled:opacity-30"
                    >
                      <ArrowDownIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onChange({ ...editor, itemAssetIds: selected.filter((x) => x !== id) })}
                      className="p-1"
                    >
                      <Trash2Icon className="h-4 w-4 text-error" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* 可选 */}
        <div>
          <h4 className="mb-2 text-sm font-semibold text-neutral-800">可加入素材</h4>
          {available.length === 0 ? (
            <p className="rounded-md border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-400">
              没有更多可用素材
            </p>
          ) : (
            <ul className="space-y-2">
              {available.map((a) => (
                <li key={a.id} className="flex items-center gap-2 rounded-md border border-neutral-200 p-2">
                  {a.type === 'video' ? <VideoIcon className="h-4 w-4 text-neutral-400" /> : <ImageIcon className="h-4 w-4 text-neutral-400" />}
                  <span className="flex-1 truncate text-sm">{a.title}</span>
                  <Button size="sm" variant="outline" onClick={() => onChange({ ...editor, itemAssetIds: [...selected, a.id] })}>
                    加入
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      <div className="flex gap-2">
        <Button onClick={onSave}>保存方案</Button>
        <Button variant="ghost" onClick={onCancel}>
          取消
        </Button>
      </div>
    </Card>
  )
}

// ─── 终端配置 ────────────────────────────────────────────────────────────────

function TerminalsTab() {
  const [terminals, setTerminals] = useState<ScreensaverTerminalView[]>([])
  const [playlists, setPlaylists] = useState<AdPlaylistView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    Promise.all([screensaverService.listTerminals(), screensaverService.listPlaylists()])
      .then(([ts, pl]) => {
        setTerminals(ts)
        setPlaylists(pl)
      })
      .catch((e) => setError((e as Error)?.message ?? '加载失败'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(reload, [reload])

  if (loading) return <p className="text-sm text-neutral-400">加载中…</p>
  if (error) return <p className="text-sm text-error">{error}</p>
  if (terminals.length === 0) {
    return <EmptyState title="暂无终端" description="终端注册后会出现在这里，可单独配置待机宣传屏。" />
  }

  return (
    <div className="space-y-3">
      {terminals.map((t) => (
        <TerminalConfigRow key={t.terminalId} terminal={t} playlists={playlists} onSaved={reload} />
      ))}
    </div>
  )
}

function TerminalConfigRow({
  terminal,
  playlists,
  onSaved,
}: {
  terminal: ScreensaverTerminalView
  playlists: AdPlaylistView[]
  onSaved: () => void
}) {
  const cfg = terminal.config
  const [enabled, setEnabled] = useState(cfg?.enabled ?? false)
  const [timeout, setTimeoutSec] = useState(String(cfg?.idleTimeoutSec ?? 180))
  const [playlistId, setPlaylistId] = useState(cfg?.playlistId ?? '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const save = useCallback(async () => {
    setSaving(true)
    setMsg(null)
    try {
      const sec = Math.max(30, Math.min(1800, Number(timeout) || 180))
      await screensaverService.saveConfig(terminal.terminalId, {
        enabled,
        idleTimeoutSec: sec,
        playlistId: playlistId || null,
      })
      setMsg('已保存')
      onSaved()
    } catch (e) {
      setMsg((e as Error)?.message ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }, [enabled, timeout, playlistId, terminal.terminalId, onSaved])

  return (
    <Card className="flex flex-wrap items-end gap-4 p-4">
      <div className="flex items-center gap-2">
        <MonitorIcon className="h-5 w-5 text-neutral-400" aria-hidden="true" />
        <div>
          <p className="font-medium text-neutral-800">{terminal.terminalCode ?? terminal.terminalId}</p>
          <StatusBadge dot status={terminal.isOnline ? 'success' : 'default'} label={terminal.isOnline ? '在线' : '离线'} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        启用待机宣传屏
      </label>

      <div>
        <label className="mb-1 block text-xs text-neutral-500">无操作时长（秒）</label>
        <input
          type="number"
          min={30}
          max={1800}
          value={timeout}
          onChange={(e) => setTimeoutSec(e.target.value)}
          className="h-10 w-28 rounded-md border border-neutral-300 px-3 text-sm"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs text-neutral-500">播放方案</label>
        <select
          value={playlistId}
          onChange={(e) => setPlaylistId(e.target.value)}
          className="h-10 w-52 rounded-md border border-neutral-300 px-3 text-sm"
        >
          <option value="">未绑定</option>
          {playlists.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}（{p.itemCount}）
            </option>
          ))}
        </select>
      </div>

      <Button onClick={save} disabled={saving}>
        {saving ? '保存中…' : '保存'}
      </Button>
      {msg && <span className="text-sm text-neutral-500">{msg}</span>}
    </Card>
  )
}

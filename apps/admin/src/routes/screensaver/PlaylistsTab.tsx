import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, EmptyState, StatusBadge } from '@ai-job-print/ui'
import { ArrowDownIcon, ArrowUpIcon, ImageIcon, PlusIcon, Trash2Icon, VideoIcon } from 'lucide-react'
import type { AdAssetView, AdPlaylistStatus, AdPlaylistView, SaveAdPlaylistInput } from '../../services/api/screensaver'
import { screensaverService } from '../../services/api/screensaver'
import { userMessageOf } from '../../services/api/userErrorMessage'

interface EditorState {
  id: string | null
  name: string
  itemAssetIds: string[]
  /** 编辑时带上原方案状态；更新请求不下发 status，避免把已停用方案静默重新激活。 */
  originalStatus?: AdPlaylistStatus
  originalItemEnabled?: Record<string, boolean>
}

export function PlaylistsTab() {
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
      .catch((e) => setError(userMessageOf(e, '加载失败，请稍后重试')))
      .finally(() => setLoading(false))
  }, [])

  useEffect(reload, [reload])

  const startNew = () => setEditor({ id: null, name: '', itemAssetIds: [] })
  const startEdit = (p: AdPlaylistView) =>
    setEditor({
      id: p.id,
      name: p.name,
      itemAssetIds: p.items.map((it) => it.assetId),
      originalStatus: p.status,
      originalItemEnabled: Object.fromEntries(p.items.map((it) => [it.assetId, it.enabled])),
    })

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
    const input: SaveAdPlaylistInput = {
      name: editor.name.trim(),
      items: editor.itemAssetIds.map((assetId, i) => ({
        assetId,
        order: i,
        enabled: editor.originalItemEnabled?.[assetId] ?? true,
      })),
    }
    if (!editor.id) input.status = 'active'
    try {
      if (editor.id) await screensaverService.updatePlaylist(editor.id, input)
      else await screensaverService.createPlaylist(input)
      setEditor(null)
      reload()
    } catch (e) {
      setError(userMessageOf(e, '保存失败，请稍后重试'))
    }
  }, [editor, reload])

  const remove = useCallback(
    async (p: AdPlaylistView) => {
      if (!window.confirm(`确认删除播放方案「${p.name}」？绑定它的终端将自动停用屏保。`)) return
      try {
        await screensaverService.deletePlaylist(p.id)
        reload()
      } catch (e) {
        setError(userMessageOf(e, '删除失败，请稍后重试'))
      }
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


import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Card, EmptyState, StatusBadge } from '@ai-job-print/ui'
import { MonitorIcon } from 'lucide-react'
import type { AdPlaylistView, ScreensaverTerminalView } from '../../services/api/screensaver'
import { screensaverService } from '../../services/api/screensaver'
import { getTerminals } from '../../services/api/devices'
import { indexScreensaverTerminalPlaces, saveScreensaverTerminalForm, screensaverTerminalFormState, screensaverTerminalHeading, type ScreensaverTerminalPlace } from './terminalConfigState'
import { dwellLimitHint, idleTimeoutError, SCREENSAVER_IDLE_MAX_SEC, SCREENSAVER_IDLE_MIN_SEC } from './assetUploadRules'
import { userMessageOf } from '../../services/api/userErrorMessage'

export function TerminalsTab() {
  const [terminals, setTerminals] = useState<ScreensaverTerminalView[]>([])
  const [playlists, setPlaylists] = useState<AdPlaylistView[]>([])
  const [places, setPlaces] = useState<Map<string, ScreensaverTerminalPlace>>(new Map())
  const [generation, setGeneration] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback((silent = false) => {
    if (!silent) setLoading(true)
    Promise.all([
      screensaverService.listTerminals(),
      screensaverService.listPlaylists(),
      getTerminals().then((res) => res.terminals).catch(() => []),
    ])
      .then(([ts, pl, devices]) => {
        setTerminals(ts)
        setPlaylists(pl)
        setPlaces(indexScreensaverTerminalPlaces(devices))
        setError(null)
        setGeneration((current) => current + 1)
      })
      .catch((e) => {
        if (!silent) setError(userMessageOf(e, '加载失败，请稍后重试'))
      })
      .finally(() => {
        if (!silent) setLoading(false)
      })
  }, [])

  useEffect(() => { reload() }, [reload])

  if (loading && terminals.length === 0) return <p className="text-sm text-neutral-400">加载中…</p>
  if (error && terminals.length === 0) return <p className="text-sm text-error">{error}</p>
  if (terminals.length === 0) {
    return <EmptyState title="暂无终端" description="终端注册后会出现在这里，可单独配置待机宣传屏。" />
  }

  return (
    <div className="space-y-3">
      {terminals.map((t) => (
        <TerminalConfigRow
          key={t.terminalId}
          terminal={t}
          playlists={playlists}
          place={places.get(t.terminalCode ?? '') ?? places.get(t.terminalId)}
          reloadGeneration={generation}
          onSaved={() => reload(true)}
        />
      ))}
    </div>
  )
}

function TerminalConfigRow({
  terminal,
  playlists,
  place,
  reloadGeneration,
  onSaved,
}: {
  terminal: ScreensaverTerminalView
  playlists: AdPlaylistView[]
  place: ScreensaverTerminalPlace | undefined
  reloadGeneration: number
  onSaved: () => void
}) {
  const cfg = terminal.config
  const initialState = screensaverTerminalFormState(cfg)
  const [enabled, setEnabled] = useState(initialState.enabled)
  const [timeout, setTimeoutSec] = useState(initialState.timeout)
  const [playlistId, setPlaylistId] = useState(initialState.playlistId)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const seenGeneration = useRef(reloadGeneration)
  const heading = screensaverTerminalHeading(terminal, place)

  useEffect(() => {
    if (reloadGeneration === seenGeneration.current) return
    seenGeneration.current = reloadGeneration
    if (msg !== '已保存') return
    const server = screensaverTerminalFormState(terminal.config)
    const same = server.enabled === enabled && server.timeout === timeout && server.playlistId === playlistId
    if (same) return
    setEnabled(server.enabled)
    setTimeoutSec(server.timeout)
    setPlaylistId(server.playlistId)
    setMsg(null)
  }, [reloadGeneration, terminal.config, msg, enabled, timeout, playlistId])

  const save = useCallback(async () => {
    const problem = idleTimeoutError(timeout)
    if (problem) {
      setMsg(problem)
      return
    }
    setSaving(true)
    setMsg(null)
    try {
      const nextState = await saveScreensaverTerminalForm(
        screensaverService.saveConfig,
        terminal.terminalId,
        enabled,
        timeout,
        playlistId,
      )
      setEnabled(nextState.enabled)
      setTimeoutSec(nextState.timeout)
      setPlaylistId(nextState.playlistId)
      setMsg('已保存')
      onSaved()
    } catch (e) {
      setMsg(userMessageOf(e, '保存失败，请稍后重试'))
    } finally {
      setSaving(false)
    }
  }, [enabled, timeout, playlistId, terminal.terminalId, onSaved])

  return (
    <Card className="flex flex-wrap items-start gap-4 p-4">
      <div className="flex items-center gap-2">
        <MonitorIcon className="h-5 w-5 text-neutral-400" aria-hidden="true" />
        <div>
          <p className="font-medium text-neutral-800">{heading.title}</p>
          {heading.subtitle && <p className="text-xs text-neutral-500">{heading.subtitle}</p>}
          <StatusBadge dot status={terminal.isOnline ? 'success' : 'default'} label={terminal.isOnline ? '在线' : '离线'} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          disabled={!playlistId}
          title={!playlistId ? '请先选择播放方案' : undefined}
        />
        启用待机宣传屏
      </label>

      <div>
        <label className="mb-1 block text-xs text-neutral-500">无人操作多久后播放（秒）</label>
        <input
          type="number"
          min={SCREENSAVER_IDLE_MIN_SEC}
          max={SCREENSAVER_IDLE_MAX_SEC}
          value={timeout}
          onChange={(e) => {
            const value = e.target.value
            setTimeoutSec(value)
            setMsg(idleTimeoutError(value))
          }}
          className="h-10 w-28 rounded-md border border-neutral-300 px-3 text-sm"
        />
        <p className="mt-1 w-64 text-xs leading-5 text-neutral-500">{dwellLimitHint('idle')}</p>
      </div>

      <div>
        <label className="mb-1 block text-xs text-neutral-500">播放方案</label>
        <select
          value={playlistId}
          onChange={(e) => {
            const value = e.target.value
            setPlaylistId(value)
            if (!value) setEnabled(false)
          }}
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

      <div className="pt-5">
        <Button onClick={save} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </Button>
      </div>
      {msg && (
        <span role={msg === '已保存' ? 'status' : 'alert'} className={`text-sm ${msg === '已保存' ? 'text-neutral-500' : 'text-error'}`}>
          {msg}
        </span>
      )}
    </Card>
  )
}

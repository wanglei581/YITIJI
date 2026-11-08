import { useEffect, useState } from 'react'
import { Card } from '@ai-job-print/ui'
import { supportContactService } from '../../services/api/supportContact'

const LOAD_FAILED = '读取失败，开关显示为关闭，已禁止保存，避免把未知状态写成关闭。'

export function SelfNoteTabCard() {
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    supportContactService
      .get()
      .then((data) => {
        if (cancelled) return
        setEnabled(data.selfNoteTab === true)
        setLoadFailed(false)
        setError(null)
      })
      .catch((reason: Error) => {
        if (cancelled) return
        setEnabled(false)
        setLoadFailed(true)
        setError(reason.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const onSave = async () => {
    if (loadFailed || saving) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const saved = await supportContactService.saveSelfNoteTab(enabled)
      setEnabled(saved === true)
      setNotice('已保存。开关已更新。')
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="mb-4 p-4">
      <p id="self-note-tab-title" className="text-sm font-semibold text-neutral-900">
        一体机显示『求职进度』页签
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        默认关闭。打开后，一体机『浏览与跳转记录』会多出这个页签，只读显示用户本人自己填写的记事，不对机构或企业开放。手填入口上线前请保持关闭。改完约 5 分钟内生效。
      </p>
      {loading ? (
        <p className="mt-3 text-sm text-neutral-500">正在加载…</p>
      ) : (
        <div className="mt-3 grid gap-3">
          <label className="flex items-center gap-2 text-sm text-neutral-800" htmlFor="self-note-tab-switch">
            <input
              id="self-note-tab-switch"
              type="checkbox"
              checked={enabled}
              disabled={loadFailed || saving}
              onChange={(event) => {
                setNotice(null)
                setError(null)
                setEnabled(event.target.checked)
              }}
              aria-labelledby="self-note-tab-title"
              className="h-4 w-4 disabled:cursor-not-allowed"
            />
            打开后显示该页签
          </label>
          {loadFailed && (
            <p className="text-sm text-red-600" role="alert">
              {LOAD_FAILED}
              {error ? ` ${error}` : ''}
            </p>
          )}
          {!loadFailed && error && (
            <p className="text-sm text-red-600" role="alert">
              保存失败：{error}
            </p>
          )}
          {notice && (
            <p className="text-sm text-neutral-700" role="status">
              {notice}
            </p>
          )}
          <div>
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={loadFailed || saving}
              className="inline-flex items-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}

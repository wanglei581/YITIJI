import { useEffect, useState } from 'react'
import { Card } from '@ai-job-print/ui'
import { supportContactService } from '../../services/api/supportContact'
import { userMessageOf } from '../../services/api/userErrorMessage'

/** 与服务端公开接口没配时的默认服务时间一致。 */
const DEFAULT_SERVICE_HOURS = '工作日 9:00–18:00'

export function SupportContactCard() {
  const [phone, setPhone] = useState('')
  const [hours, setHours] = useState('')
  const [published, setPublished] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    supportContactService
      .get()
      .then((data) => {
        if (cancelled) return
        setPhone(data.servicePhone ?? '')
        setHours(data.serviceHours ?? '')
        setPublished(data.miniappPublished)
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(userMessageOf(reason, '读取服务联系方式失败，请稍后重试'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const onSave = async () => {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const data = await supportContactService.save({
        servicePhone: phone,
        serviceHours: hours,
        miniappPublished: published,
      })
      setPhone(data.servicePhone ?? '')
      setHours(data.serviceHours ?? '')
      setPublished(data.miniappPublished)
      setNotice('已保存。一体机和小程序最迟 5 分钟内按新的配置显示。')
    } catch (reason) {
      setError(userMessageOf(reason, '保存服务联系方式失败，请检查后重试'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="mb-4 p-4">
      <p className="text-sm font-semibold text-neutral-900">服务联系</p>
      <p className="mt-1 text-xs text-neutral-500">
        一体机出错时用来决定要不要显示服务电话、换一台机器、用手机继续。电话会和服务时间一起显示。
      </p>
      {loading ? (
        <p className="mt-3 text-sm text-neutral-500">正在加载…</p>
      ) : (
        <div className="mt-3 grid gap-3">
          <label className="block text-sm text-neutral-800" htmlFor="support-service-phone">
            服务电话
            <input
              id="support-service-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="留空表示不显示"
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm text-neutral-800" htmlFor="support-service-hours">
            服务时间
            <input
              id="support-service-hours"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
              placeholder={DEFAULT_SERVICE_HOURS}
              maxLength={40}
              className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
            />
          </label>
          <p className="text-xs text-neutral-500">留空时，对外显示「{DEFAULT_SERVICE_HOURS}」。</p>
          <label className="flex items-center gap-2 text-sm text-neutral-800" htmlFor="support-miniapp-published">
            <input
              id="support-miniapp-published"
              type="checkbox"
              checked={published}
              onChange={(event) => setPublished(event.target.checked)}
              className="h-4 w-4"
            />
            小程序已发布
          </label>
          <p className="text-xs text-neutral-500">未勾选时，一体机不提示用手机继续。</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {notice && <p className="text-sm text-neutral-700">{notice}</p>}
          <div>
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={saving}
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

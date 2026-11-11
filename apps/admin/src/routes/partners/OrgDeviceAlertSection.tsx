import { useEffect, useState } from 'react'
import {
  getOrgDeviceAlertNotify,
  saveOrgDeviceAlertNotify,
  testOrgDeviceAlertNotify,
  type OrgDeviceAlertNotifyView,
} from '../../services/api/orgDeviceAlert'

export function OrgDeviceAlertSection({ orgId }: { orgId: string }) {
  const [view, setView] = useState<OrgDeviceAlertNotifyView | null>(null)
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const demo = view?.dataMode === 'demo'

  useEffect(() => {
    let cancelled = false
    setView(null)
    setUrl('')
    setError(null)
    setNotice(null)
    getOrgDeviceAlertNotify(orgId)
      .then((next) => { if (!cancelled) setView(next) })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : '通知设置加载失败') })
    return () => { cancelled = true }
  }, [orgId])

  async function save() {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const next = await saveOrgDeviceAlertNotify(orgId, url)
      setView(next)
      setUrl('')
      setNotice(next.configured ? '通知地址已保存' : '已清除通知地址')
    } catch (err) {
      setError(err instanceof Error ? err.message : '通知地址没有保存')
    } finally {
      setSaving(false)
    }
  }

  async function sendTest() {
    setTesting(true)
    setError(null)
    setNotice(null)
    try {
      await testOrgDeviceAlertNotify(orgId)
      setNotice('测试消息已发出，请到群里查看')
    } catch (err) {
      setError(err instanceof Error ? err.message : '测试消息没有发出去，请核对地址后重试')
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className="rounded-xl border border-neutral-200 p-4">
      <h3 className="text-sm font-semibold text-neutral-800">设备告警通知</h3>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        代本机构填写。该机构名下终端出问题或恢复时，发到这个群；平台总通知照旧接收全部。只接受以 https 开头的企业微信、钉钉或飞书群机器人地址。
      </p>
      {demo && <p className="mt-3 text-sm text-warning-fg">当前是本地演示，不能保存或发送通知。</p>}
      {!demo && view && (
        <p className="mt-3 break-all text-sm text-neutral-700">
          {view.configured
            ? (view.maskedUrl ? `已配置：${view.maskedUrl}` : '已配置，但暂时读不出来。请重新填写并保存。')
            : '未配置。该机构收不到设备告警。'}
        </p>
      )}
      <label className="mt-3 block text-xs text-neutral-500" htmlFor={`device-alert-${orgId}`}>通知地址</label>
      <input
        id={`device-alert-${orgId}`}
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        disabled={demo || saving}
        placeholder="粘贴群机器人地址，留空保存即清除"
        autoComplete="off"
        spellCheck={false}
        className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
      />
      {error && <p className="mt-2 text-sm text-error-fg" role="alert">{error}</p>}
      {notice && <p className="mt-2 text-sm text-success-fg" role="status">{notice}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={demo || saving || testing}
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {saving ? '正在保存' : '保存'}
        </button>
        <button
          type="button"
          onClick={() => void sendTest()}
          disabled={demo || saving || testing || !view?.configured}
          className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          {testing ? '正在发送' : '发一条测试消息'}
        </button>
      </div>
    </section>
  )
}

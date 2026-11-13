import { useEffect, useState } from 'react'
import { Button, Card } from '@ai-job-print/ui'
import {
  getDeviceAlertNotify,
  saveDeviceAlertNotify,
  testDeviceAlertNotify,
  type DeviceAlertNotifyView,
} from '../../services/api/deviceAlertNotify'

export function DeviceAlertNotifySection() {
  const [view, setView] = useState<DeviceAlertNotifyView | null>(null)
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const demo = view?.dataMode === 'demo'

  useEffect(() => {
    let cancelled = false
    getDeviceAlertNotify()
      .then((next) => { if (!cancelled) setView(next) })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : '通知设置加载失败') })
    return () => { cancelled = true }
  }, [])

  // 清除只走「清除通知地址」按钮：保存成功后输入框会清空，空着再点保存不能悄悄关掉通知。
  async function save(nextUrl: string) {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const next = await saveDeviceAlertNotify(nextUrl)
      setView(next)
      setUrl('')
      setNotice(next.configured ? '通知地址已保存。可以发一条测试消息确认群里收得到。' : '已清除通知地址。设备出问题时不再发到群里。')
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
      await testDeviceAlertNotify()
      setNotice('测试消息已发出，请到群里查看')
    } catch (err) {
      setError(err instanceof Error ? err.message : '测试消息没有发出去，请核对地址后重试')
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card className="mt-6 p-6">
      <h3 className="text-sm font-medium text-neutral-700">设备告警通知</h3>
      <p className="mt-2 text-xs leading-relaxed text-neutral-500">
        本机构终端缺纸、离线、卡纸或打印机故障时，发一条消息到这个群。恢复后再发一条。消息里只有终端名称、位置和设备问题，不含使用者个人信息。
        只接受以 https 开头的企业微信、钉钉或飞书群机器人地址。
      </p>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">钉钉、飞书的机器人如果设了关键词，请用「设备告警」：每条消息都以「【设备告警】」开头。不要开启加签或签名校验：本系统发消息不带签名，开了会发不出去。</p>
      {demo && <p className="mt-3 text-sm text-warning-fg">当前是本地演示，不能保存或发送通知。</p>}
      {!demo && view && (
        <p className="mt-3 break-all text-sm text-neutral-700">
          {view.configured
            ? (view.maskedUrl ? `当前地址：${view.maskedUrl}` : '地址已保存，但暂时读不出来。请重新填写并保存。')
            : '还没有通知地址。设备出问题时不会发到群里。'}
        </p>
      )}
      <label className="mt-4 block text-xs text-neutral-500" htmlFor="device-alert-notify-url">通知地址</label>
      <input
        id="device-alert-notify-url"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        disabled={demo || saving}
        placeholder="粘贴群机器人地址"
        autoComplete="off"
        spellCheck={false}
        className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
      />
      {error && <p className="mt-2 text-sm text-error-fg" role="alert">{error}</p>}
      {notice && <p className="mt-2 text-sm text-success-fg" role="status">{notice}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void save(url)} disabled={demo || saving || testing || !url.trim()}>
          {saving ? '正在保存' : '保存'}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void sendTest()} disabled={demo || saving || testing || !view?.configured}>
          {testing ? '正在发送' : '发一条测试消息'}
        </Button>
        {view?.configured && (
          <Button size="sm" variant="secondary" onClick={() => void save('')} disabled={demo || saving || testing}>
            清除通知地址
          </Button>
        )}
      </div>
    </Card>
  )
}

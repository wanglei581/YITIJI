import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Clock3Icon, HeadphonesIcon, InfoIcon, RefreshCwIcon, WifiOffIcon } from 'lucide-react'
import { isSafeInternalPath } from '../../auth/returnPath'
import './system-pages-batch8.css'

export default function ErrorOfflinePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [attempts, setAttempts] = useState(0)
  const [checking, setChecking] = useState(false)
  const checkingRef = useRef(false)
  const [lastChecked, setLastChecked] = useState(() => new Date())
  const returnTo = useMemo(() => {
    const candidate = (location.state as { from?: unknown } | null)?.from
    return typeof candidate === 'string' && candidate !== '/error-offline' && isSafeInternalPath(candidate)
      ? candidate
      : '/'
  }, [location.state])

  const retry = useCallback(async () => {
    if (checkingRef.current) return
    checkingRef.current = true
    setChecking(true)
    setAttempts((value) => value + 1)
    setLastChecked(new Date())
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 5000)
    try {
      if (!navigator.onLine) throw new Error('offline')
      const response = await fetch('/api/v1/health', { cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw new Error('unhealthy')
      navigate(returnTo, { replace: true })
    } catch {
      return
    } finally {
      window.clearTimeout(timeout)
      checkingRef.current = false
      setChecking(false)
    }
  }, [navigate, returnTo])

  useEffect(() => {
    const interval = window.setInterval(() => void retry(), 10_000)
    const handleOnline = () => void retry()
    window.addEventListener('online', handleOnline)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('online', handleOnline)
    }
  }, [retry])

  const timeLabel = `${String(lastChecked.getHours()).padStart(2, '0')}:${String(lastChecked.getMinutes()).padStart(2, '0')}`

  return (
    <main className="k8-system-page k8-offline-page">
      <header className="k8-offline-topbar">
        <div><strong>就业服务大厅</strong><span>AI求职打印服务终端</span></div>
        <p><span />网络中断 · 部分功能受限</p>
      </header>

      <div className="k8-offline-wrap">
        <section className="k8-offline-card">
          <span className="k8-offline-icon"><WifiOffIcon /></span>
          <h1>网络连接中断</h1>
          <p className="k8-offline-description">本机与服务器的连接暂时断开，系统正在自动重试。<br />打印机本机功能不受影响，恢复后将返回原页面继续。</p>
          <p className="k8-offline-check"><Clock3Icon />最近检测 {timeLabel} · 每 10 秒自动重试，已重试 {attempts} 次</p>

          <div className="k8-offline-impact">
            <h2>当前功能状态</h2>
            <ul>
              <li><b>岗位 / 招聘会信息同步</b><span>需要网络获取来源数据</span><em className="is-warn">暂不可用</em></li>
              <li><b>AI 简历诊断 / 优化 / 助手</b><span>需要连接 AI 服务</span><em className="is-warn">暂不可用</em></li>
              <li><b>U盘直插打印</b><span>打印机自带能力，U盘插打印机即可</span><em className="is-ok">仍可使用</em></li>
              <li><b>扫描原件保存到 U盘</b><span>设备本地完成，恢复后可再上传</span><em className="is-ok">仍可使用</em></li>
              <li><b>上传文件打印 / 订单与状态上报</b><span>需经服务器，恢复后自动继续</span><em className="is-warn">排队等待</em></li>
            </ul>
          </div>

          <div className="k8-offline-actions">
            <button type="button" className="is-primary" disabled={checking} onClick={() => void retry()}><RefreshCwIcon className={checking ? 'is-spinning' : ''} />{checking ? '正在重试' : '重试连接'}</button>
            <button type="button" onClick={() => navigate('/help', { replace: true })}><HeadphonesIcon />联系工作人员</button>
          </div>
        </section>

        <p className="k8-system-notice is-warning"><InfoIcon />如长时间未恢复，请前往大厅服务台联系现场工作人员；U盘打印、扫描到 U盘为打印机自带功能，以现场设备实际提示为准。</p>
      </div>
    </main>
  )
}

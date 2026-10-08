import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { HomeIcon, SparklesIcon, UserIcon } from 'lucide-react'
import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import { useAuth } from '../../../auth/useAuth'
import { KIOSK_DEVICE_ORIGINAL_NOTICE } from '../../../utils/kioskLocalPrivacy'
import { ResumeScanReady } from './ResumeScanReady'

/** 来源页顶栏三枚导航。底栏切屏仍留在页面里，供静态门禁核对。 */
export function ResumeSourceNavbar(): ReactNode {
  const navigate = useNavigate()
  return (
    <>
      <button type="button" className="qx-nav-item" onClick={() => navigate('/')}><HomeIcon size={32} aria-hidden="true" />首页</button>
      <button type="button" className="qx-nav-item" onClick={() => navigate('/assistant')}><SparklesIcon size={32} aria-hidden="true" />AI 顾问</button>
      <button type="button" className="qx-nav-item" onClick={() => navigate('/profile')}><UserIcon size={32} aria-hidden="true" />我的</button>
    </>
  )
}

export function ResumeGuestNote(): ReactNode {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  if (getToken()) return null
  return (
    <p className="qx-rt-note" data-tone="warn">
      <b>当前未登录 · 这次按临时上传处理</b>
      简历属高度敏感文件，这台机器默认 1 小时清理，不进账号、不归档。登录后：U 盘 / 本机上传当场绑定账号存 90 天，手机扫码要在这台机器确认之后才绑定。
      <button type="button" onClick={() => navigate('/login', { state: { from: `${location.pathname}${location.search}` } })}>去登录 →</button>
    </p>
  )
}

export function ResumeSourcePrivacy({ intent }: { intent: 'diagnose' | 'optimize' }): ReactNode {
  return (
    <footer className="qx-rt-truth">
      <p className="resume-source-privacy"><b>用途 · 隐私</b>{intent === 'optimize' ? '简历原文仅用于本次解析、诊断与优化，不作为平台简历库沉淀。' : '简历原文仅用于本次解析和诊断，不作为平台简历库沉淀。'}{COMPLIANCE_COPY.KIOSK_RESUME_UPLOAD_PRIVACY}</p>
      <p><b>留存</b>{KIOSK_DEVICE_ORIGINAL_NOTICE}</p>
    </footer>
  )
}

export function ResumeSummaryFileCard(props: {
  scanReady: boolean
  name: string
  size: string
  format: string
  channel: string
  onDrop: () => void
  onRescan: () => void
}): ReactNode {
  return (
    <>
      <h2 className="qx-rt-sec-h">这次要用的文件 <small>来自{props.channel}</small></h2>
      {props.scanReady ? <ResumeScanReady name={props.name} size={props.size} format={props.format} onDrop={props.onDrop} onRescan={props.onRescan} /> : (
        <div className="qx-rt-filecard">
          <span className="fx"><b>{props.name}</b><small>{props.format.toUpperCase()} · {props.size} · 页数未返回 · {props.channel}</small></span>
          <span className="fb">待你确认</span>
        </div>
      )}
    </>
  )
}

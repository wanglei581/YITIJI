import './phone-upload-service-desk.css'
import './kiosk-code-entry.css'
import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { BanIcon, CircleAlertIcon, HourglassIcon, type LucideIcon } from 'lucide-react'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { buildPhoneUploadUrl, isUploadSceneToken, resolveUploadScene } from '../../services/api/uploadSessions'
import { isQrLoginTicketId } from '../../services/auth/memberQrLoginApi'

/* 一体机手机码的网页中转：/k/u/:scene（上传）与 /k/l/:ticketId（登录）。
 * 一体机屏上的手机码编的是 https://<公网域名>/k/u/<场景码>、/k/l/<登录票据>。微信后台两条
 * 「扫普通链接二维码打开小程序」规则生效后，微信扫一扫直接进小程序，不会打开本页；规则没生效、
 * 或用别的软件扫时，同一张码打开的是这里：上传码先兑换场景码，再转到 /upload/phone#…；登录码只校验格式，
 * 再转到 /member/qr-login?ticketId=…。真正的上传与确认仍由那两页完成，本页不改它们。
 * 转走一律 replace，带凭据的短链不留在浏览器历史里。样式照用手机上传页的类与令牌，不新增颜色值。 */

type SceneFailure = 'unusable' | 'retryable'

const SCENE_UNUSABLE = '二维码已失效或已使用，请回到一体机刷新二维码。'
const SCENE_RETRYABLE = '网络连接失败，请稍后重试'
const TICKET_INVALID = '这不是一体机上的登录二维码，请回到一体机刷新后重新扫码。'

/**
 * 兑换失败只分两类。断网、超时、限流、5xx 可以再试：兑换在会话有效期内可重复，同一张码每次拿到同一把令牌。
 * 其余一律按失效：服务端对格式错、查无此码、已过期、已收到文件只回同一个 UPLOAD_SCENE_UNUSABLE，本页也不分原因。
 */
function sceneFailureOf(error: unknown): SceneFailure {
  if (!(error instanceof ApiHttpError)) return 'unusable'
  const { status } = error
  return status === 0 || status === 408 || status === 429 || status >= 500 ? 'retryable' : 'unusable'
}

/** 根节点之内的接力条与单一纵向流；根节点（含 data-kiosk-screen）由两个页面各自写，门禁按根查。 */
function EntryBody({ sub, children }: { sub: string; children: ReactNode }) {
  return (
    <section className="k1-phone-upload-content">
      <header className="ph-up-relaybar">
        <span className="ph-up-seal" aria-hidden="true">职</span>
        <div className="ph-up-brand">
          <strong>职易达</strong>
          <small>{sub}</small>
        </div>
      </header>
      <div className="ph-up-wave" aria-hidden="true" />
      <div className="ph-up-flow">
        <section className="ph-up-takeover">
          <div className="ph-up-grow" />
          {children}
          <div className="ph-up-grow" />
        </section>
      </div>
    </section>
  )
}

function EntryCard({ icon: Glyph, text, alert, children }: { icon: LucideIcon; text: string; alert?: boolean; children?: ReactNode }) {
  return (
    <section className="ph-up-statecard" role={alert ? 'alert' : 'status'}>
      <span className="ph-up-glyph"><Glyph aria-hidden="true" /></span>
      <h1>{text}</h1>
      {children}
    </section>
  )
}

/** /k/u/:scene —— 兑换场景码，成功即转到手机上传页；失效不给重试，断网给「重试」。 */
export function UploadSceneEntry() {
  const { scene = '' } = useParams()
  const navigate = useNavigate()
  const wellFormed = isUploadSceneToken(scene)
  const [attempt, setAttempt] = useState(0)
  // 失败结论只认发出它的那一次兑换：换了码或点了重试，旧结论自动作废，回到「正在打开」。
  const [failure, setFailure] = useState<{ key: string; kind: SceneFailure } | null>(null)
  const key = `${scene}\n${attempt}`

  useEffect(() => {
    if (!wellFormed) return undefined
    let live = true
    resolveUploadScene(scene).then(
      (resolved) => {
        if (!live) return
        if (!resolved.sessionId || !resolved.uploadToken) {
          setFailure({ key, kind: 'unusable' })
          return
        }
        // fragment 只在 buildPhoneUploadUrl 一处拼：与一体机长链、手机上传页的读法是同一份。
        const target = new URL(buildPhoneUploadUrl('/upload/phone', resolved.sessionId, resolved.uploadToken, resolved.purpose))
        navigate(`${target.pathname}${target.hash}`, { replace: true })
      },
      (error: unknown) => {
        if (live) setFailure({ key, kind: sceneFailureOf(error) })
      },
    )
    return () => { live = false }
  }, [key, navigate, scene, wellFormed])

  const state = !wellFormed ? 'unusable' : failure?.key === key ? failure.kind : 'resolving'
  return (
    <main className="fusion-w5 fusion-w5--auth k1-phone-upload service-desk" data-kiosk-screen="upload-scene-entry" data-visual-theme="service-desk" data-ux-density="touch" data-kiosk-presentation="fusion-youth" data-kiosk-viewport="mobile" data-kiosk-code-entry={state}>
      <EntryBody sub="手机上传">
        {state === 'resolving' && <EntryCard icon={HourglassIcon} text="正在打开上传页…" />}
        {state === 'unusable' && <EntryCard icon={BanIcon} text={SCENE_UNUSABLE} alert />}
        {state === 'retryable' && (
          <EntryCard icon={CircleAlertIcon} text={SCENE_RETRYABLE} alert>
            <button type="button" className="ph-entry-retry" onClick={() => setAttempt((value) => value + 1)}>重试</button>
          </EntryCard>
        )}
      </EntryBody>
    </main>
  )
}

/** /k/l/:ticketId —— 票据格式对就转到手机确认登录页（票据真伪由那一页查），不对就说明这不是一体机登录码。 */
export function LoginTicketEntry() {
  const { ticketId = '' } = useParams()
  if (isQrLoginTicketId(ticketId)) {
    return <Navigate to={`/member/qr-login?ticketId=${encodeURIComponent(ticketId)}`} replace />
  }
  return (
    <main className="fusion-w5 fusion-w5--auth k1-phone-upload service-desk" data-kiosk-screen="login-ticket-entry" data-visual-theme="service-desk" data-ux-density="touch" data-kiosk-presentation="fusion-youth" data-kiosk-viewport="mobile" data-kiosk-code-entry="invalid">
      <EntryBody sub="手机确认登录">
        <EntryCard icon={BanIcon} text={TICKET_INVALID} alert />
      </EntryBody>
    </main>
  )
}

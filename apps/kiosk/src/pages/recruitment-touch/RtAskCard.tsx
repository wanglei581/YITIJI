import { MessageSquareIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { AI_LABEL_COPY } from '@ai-job-print/shared'
import { rememberAssistantDraft } from '../../services/assistantDraft'
import '../../components/qingxu/directory/directory-qx.css'

/**
 * 本包「问小青」卡：直达顾问页的真入口，用在线下机构三页和参展企业详情。
 *
 * 点「问小青」只做两件事：把一句话放进顾问页的输入框（rememberAssistantDraft），再去 /assistant。
 * 不自动发送，发不发由用户在顾问页决定，和底栏「问小青」同一条路。
 * 这张卡自己不调任何接口，所以也不下任何没有真实探测的结论：登录、AI 不可用都由顾问页自己处理。
 * 卡底常显一句不靠 AI 的做法，AI 挂掉时这条路照样走得通（AI 是加速器，不是前置条件）。
 * 样式复用 directory-qx.css 的 .dw-ai 一族，不另写 CSS。
 *
 * 取代旧件在这四页上的用法：旧件的「整理」键一次接口都不调，一律写失败结论，那是没有探测就下的判断。
 */
export function RtAskCard({
  testId,
  title,
  desc,
  draft,
  fallback,
}: {
  testId: string
  title: string
  desc: string
  /** 带到顾问页输入框里的话；可以在固定问句后面追加本屏已显示的对象名（机构、岗位、企业）。 */
  draft: string
  /** 不靠 AI 也能做的办法，常显在卡底。 */
  fallback: string
}) {
  const navigate = useNavigate()
  return (
    <div className="dw-ai" data-testid={testId}>
      <span className="dw-ai-ic"><MessageSquareIcon size={26} aria-hidden /></span>
      <div className="dw-ai-main">
        <div className="dw-ai-line">
          <b className="dw-ai-t">{title}</b>
          <span className="dw-ai-ops">
            <button
              type="button"
              className="dw-ai-run"
              onClick={() => {
                rememberAssistantDraft(draft)
                navigate('/assistant')
              }}
            >
              问小青
            </button>
          </span>
        </div>
        <span className="dw-ai-d">{desc}{' '}<b data-testid={`${testId}-ai-label`}>{AI_LABEL_COPY.BASE}</b></span>
        <span className="dw-ai-note" data-testid={`${testId}-fallback`}>{fallback}</span>
      </div>
    </div>
  )
}

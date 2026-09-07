import { useNavigate } from 'react-router-dom'
import { FileTextIcon, FolderIcon, ImageIcon, InfoIcon } from 'lucide-react'
import type { StatusCopy } from './signStampModel'
import { SignStampStatus } from './SignStampStatus'

const ALTS = [
  {
    key: 'hub',
    title: '文档打印',
    d: '传文件、选参数、去打印。',
    f: '要打印机就绪',
    to: '/print/upload',
    tone: 'teal' as const,
    Icon: FileTextIcon,
  },
  {
    key: 'scan',
    title: '材料扫描',
    d: '把纸质材料扫成电子件。',
    f: '要扫描仪就绪',
    to: '/scan/start',
    tone: 'clay' as const,
    Icon: ImageIcon,
  },
  {
    key: 'convert',
    title: '图片转 PDF',
    d: '几张照片拼成一份 PDF。',
    f: '不经过打印机',
    to: '/print-scan/convert',
    tone: 'muted' as const,
    Icon: FolderIcon,
  },
  {
    key: 'ask',
    title: 'AI 顾问',
    d: '说不清就直接问她。',
    f: '随时可以问',
    to: '/assistant',
    tone: 'slate' as const,
    Icon: InfoIcon,
  },
]

export function SignStampGateView({
  copy,
  why,
}: {
  copy: StatusCopy
  why: string[]
}) {
  const navigate = useNavigate()
  return (
    <>
      <div className="ss-status">
        <SignStampStatus copy={copy} />
      </div>
      <div className="ss-work">
        <div className="ss-gatecol">
          <h3>
            这一步过不去，这些还能用
            <span className="r">每个入口自己再检查一次</span>
          </h3>
          <div className="ss-gaterow">
            {ALTS.map((alt) => (
              <button
                key={alt.key}
                type="button"
                className="ss-pickcard"
                data-testid={`sign-stamp-alt-${alt.key}`}
                onClick={() => navigate(alt.to)}
              >
                <span className="pi" data-tone={alt.tone}>
                  <alt.Icon size={26} />
                </span>
                <span className="pt">
                  <b>{alt.title}</b>
                  <span className="d">{alt.d}</span>
                  <span className="f">{alt.f}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="note" style={{ margin: 0, fontSize: 17, color: 'var(--qx-ink-3)' }}>
            这里只是导航；能不能用由那一页自己判断。
          </p>
        </div>
      </div>
      <div className="ss-aside">
        <div className="ss-acol">
          <h4>为什么这么处理</h4>
          <ul className="ss-plan">
            {why.map((item) => (
              <li key={item}>
                <span className="sq" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="ss-acol" data-disclaimer="true">
          <h4>这一页现在不做什么</h4>
          <ul className="ss-plan">
            <li>
              <span className="sq" aria-hidden />
              <span>不显示任何文件名或页数。</span>
            </li>
            <li>
              <span className="sq" aria-hidden />
              <span>不上传、不合成、不保存。</span>
            </li>
          </ul>
        </div>
      </div>
    </>
  )
}

export function gateWhy(state: string): string[] {
  if (state === 'login-required' || state === 'auth-unknown') {
    return ['没有拿到登录状态就不放行，而不是先放行再补检查。', '普通打印、扫描、格式转换不受影响。']
  }
  if (state === 'login-expired') {
    return ['签名图不做跨会话保留，过期即不可复用。', '这一步不会替你自动重传，也不会替你自动合成。']
  }
  if (state === 'terminal-missing') {
    return ['不假设「读不到就是可用」。', '请联系现场工作人员登记这台机器。']
  }
  if (state.startsWith('capability-')) {
    return ['读取中不等于可用，也不等于不可用。', '读不到就不放行，不把失败当成已关闭。']
  }
  return ['不猜上一步是什么，也不放示例文件。', '外部地址一律不作为返回落点。']
}

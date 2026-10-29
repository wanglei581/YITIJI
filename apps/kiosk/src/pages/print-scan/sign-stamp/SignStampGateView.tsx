import { useNavigate } from 'react-router-dom'
import { FileTextIcon, InfoIcon } from 'lucide-react'
import { FsRow } from '../FsRow'
import { PhoneHelpLine } from '../phoneHelp'
import type { StatusCopy } from './signStampModel'
import { SignStampStatus } from './SignStampStatus'
import { Fact, Sample } from './SignStampBits'

const ALTS = [
  { key: 'hub', title: '文档打印', desc: '传文件、选参数、去打印。要打印机就绪', to: '/print/upload' },
  { key: 'scan', title: '材料扫描', desc: '把纸质材料扫成电子件。要扫描仪就绪', to: '/scan' },
  { key: 'convert', title: '图片转 PDF', desc: '几张照片拼成一份 PDF。不经过打印机', to: '/print-scan/convert' },
  { key: 'ask', title: 'AI 顾问', desc: '说不清就直接问她。随时可以问', to: '/assistant' },
] as const

/** 默认关闭：三步都停用，出口只有打印扫描和查政策。卡片文案不含「上传」，避免被当成上传入口。 */
export function SignClosedBody({ copy }: { copy: StatusCopy }) {
  const navigate = useNavigate()
  const hold = (title: string, detail: string) => (
    <div className="fs-hold" role="group" aria-disabled="true" aria-label={`${title}，本机暂未开通`}>
      <b>{title}</b>
      <span>{detail}</span>
      <span className="sx-chip">本机暂未开通</span>
    </div>
  )
  return (
    <>
      <SignStampStatus copy={copy} />
      <p className="fs-h">签名的三步</p>
      <div className="fs-lock">
        {hold('选 PDF', '选一份要签名的 PDF')}
        {hold('传签名图', '上传本人手写签名')}
        {hold('放置', '把签名放到某一页')}
      </div>
      <p className="fs-h">这些还能办</p>
      <div className="fs-pair">
        <button type="button" className="fs-act" onClick={() => navigate('/print-scan')}>
          <span className="vis" aria-hidden="true"><FileTextIcon size={48} /></span>
          <span className="tx">
            <h3>打印扫描</h3>
            <p>打印文件、扫描纸质材料、看复印步骤，都不靠签名。</p>
          </span>
          <span className="go" aria-hidden="true">›</span>
        </button>
        <button type="button" className="fs-act" onClick={() => navigate('/policy-service')}>
          <span className="vis" aria-hidden="true"><InfoIcon size={48} /></span>
          <span className="tx">
            <h3>查政策</h3>
            <p>看本机构发布的政策和要带的材料。</p>
          </span>
          <span className="go" aria-hidden="true">›</span>
        </button>
      </div>
      <PhoneHelpLine />
    </>
  )
}

/** 还没放行（读取中、没登录、登录过期、没登记、维护、读取失败……）：状态卡 + 为什么 + 这一步过不去时还能去哪。 */
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
      <SignStampStatus copy={copy} />
      <div className="fs-facts">
        <div className="fs-pairgrid">
          <Fact title="为什么这么处理">{why.join('')}</Fact>
          <Fact title="这一页现在不做什么">不显示任何文件名或页数。不上传、不合成、不保存。</Fact>
        </div>
      </div>
      <PhoneHelpLine />
      <p className="fs-h">这一步过不去，这些还能用<small>每个入口自己再检查一次</small></p>
      {ALTS.map((alt) => (
        <FsRow
          key={alt.key}
          title={alt.title}
          desc={alt.desc}
          testId={`sign-stamp-alt-${alt.key}`}
          onClick={() => navigate(alt.to)}
        />
      ))}
      <p className="fs-p">这里只是导航；能不能用由那一页自己判断。</p>
      <Sample />
    </>
  )
}

export function gateWhy(state: string): string[] {
  if (state === 'login-required' || state === 'auth-unknown') {
    return ['没有拿到登录状态就不放行，而不是先放行再补检查。', '普通打印、扫描、格式转换不受影响。']
  }
  if (state === 'login-expired') {
    return ['签名图不留到下一次使用，过期即不可复用。', '这一步不会替你自动重传，也不会替你自动合成。']
  }
  if (state === 'terminal-missing') {
    return ['不假设「读不到就是可用」。', '这台机器还没登记，签名不能开始。请安全返回打印扫描。']
  }
  if (state.startsWith('capability-')) {
    return ['读取中不等于可用，也不等于不可用。', '读不到就不放行，不把失败当成已关闭。']
  }
  return ['不猜上一步是什么，也不放示例文件。', '外部地址一律不作为返回落点。']
}

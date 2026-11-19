// 付款屏（稿 pay-1113.js 的 pay-service）：AI 简历优化、AI 模拟面试、扫描共用，样子照打印收银台。
// 三条路由 /pay/resume、/pay/interview、/pay/scan 各管一种服务，服务种类由路由定，不读查询串；
// 查询串只认 next / back 两个名字（白名单见 payServiceModel）。「手机上买过」这一态后端还没有核销接口，不接。
import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { QxTouchArtReport, QxTouchArtResume } from '../../components/qingxu/touch/QxTouchArt'
import { QxTouchBand } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock } from '../../components/qingxu/touch/QxTouchDock'
import { QxTouchNav } from '../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../components/qingxu/touch/QxTouchScreen'
import { useSupportContact } from '../../hooks/useSupportContact'
import { PrintArt } from '../print/art/PrintArt'
import { PayServiceQr } from './PayServiceQr'
import {
  PAY_SERVICE_NAME,
  PAY_TIMEOUT_LINE,
  PAY_TRIP,
  formatRemain,
  formatYuan,
  payChannelHead,
  payChrome,
  payCreateErrorLine,
  payFailLine,
  payLookupErrorLine,
  payMissLine,
  payRefundLine,
  resolvePayTargets,
  type PayWhat,
} from './payServiceModel'
import { usePayServiceFlow } from './usePayServiceFlow'
import './pay-service.css'

/** 空处放这一次要办的事的小样（稿 sampleOf）：简历是原稿加批注稿，面试是两张报告，扫描是三张纸。 */
function PaySample({ what }: { what: PayWhat }) {
  if (what === 'scan') {
    return (
      <div className="pys-sample pys-sample-scan" aria-hidden="true">
        <PrintArt name="scan-paper" size={420} />
        <PrintArt name="scan-paper" size={420} />
        <PrintArt name="scan-paper" size={420} />
      </div>
    )
  }
  return (
    <div className="pys-sample" aria-hidden="true">
      {what === 'interview' ? <QxTouchArtReport width={420} /> : <PrintArt name="resume" size={420} />}
      {what === 'interview' ? <QxTouchArtReport width={420} /> : <QxTouchArtResume width={420} />}
    </div>
  )
}

function PaySum({ name, amount }: { name: string; amount: string }) {
  return (
    <div className="qxt-sum pys-sum" data-testid="pay-service-sum">
      <div className="qxt-sum-r"><span>这一次</span><b>{name}</b><span /></div>
      <div className="qxt-sum-r"><span>金额</span><b data-testid="pay-service-amount">{amount}</b><span /></div>
      <div className="qxt-sum-r"><span>换来</span><b>这一趟</b><span /></div>
    </div>
  )
}

export function PayServicePage({ what }: { what: PayWhat }) {
  const navigate = useNavigate()
  const { search } = useLocation()
  // 标准句里的服务电话晚到时跟着重画。
  useSupportContact()
  const targets = useMemo(() => resolvePayTargets(what, search), [what, search])
  const flow = usePayServiceFlow(what, targets)
  const name = flow.order?.serviceName || PAY_SERVICE_NAME[what]
  const amount = flow.order ? formatYuan(flow.order.amountCents) : ''
  const chrome = payChrome(flow.view, name, flow.phase)
  const leave = () => {
    if (!chrome.left) {
      navigate(targets.back, { replace: true })
      return
    }
    flow.onLeave(chrome.left.close)
  }
  const primary = flow.view === 'ok'
    ? flow.onStart
    : flow.view === 'wait' || flow.view === 'check' || flow.view === 'loading'
      ? flow.onRefresh
      : flow.view === 'free'
        ? leave
        : flow.onRetry
  const sum = flow.order ? <PaySum name={name} amount={amount} /> : null

  let body
  switch (flow.view) {
    case 'wait':
    case 'check':
      body = (
        <>
          <p className="pys-chline" data-testid="pay-service-channel">
            <b>{payChannelHead(flow.order?.provider)}</b>这一次 {amount}。{PAY_TRIP[what]}
          </p>
          {sum}
          <PayServiceQr
            value={flow.order?.qrCodeContent ?? null}
            name={name}
            amount={amount}
            remain={formatRemain(flow.remainMs ?? 0)}
            checking={flow.view === 'check'}
          />
        </>
      )
      break
    case 'ok':
      body = <>{sum}<p className="qxt-fine">{PAY_TRIP[what]}</p><p className="qxt-fine">{payMissLine(what)}</p></>
      break
    case 'fail':
      body = <>{sum}<p className="qxt-fine" data-testid="pay-service-line">{payFailLine(name)}</p></>
      break
    case 'timeout':
      body = <>{sum}<p className="qxt-fine" data-testid="pay-service-line">{PAY_TIMEOUT_LINE}</p></>
      break
    case 'refund':
      body = <>{sum}<p className="qxt-fine" data-testid="pay-service-line">{payRefundLine(flow.phase)}</p></>
      break
    case 'error':
    case 'lookup':
      body = (
        <p className="pys-chline" role="alert" data-testid="pay-service-line">
          {flow.view === 'error' ? payCreateErrorLine(flow.error) : payLookupErrorLine(flow.error)}
        </p>
      )
      break
    case 'loading':
      body = <p className="pys-chline" role="status"><b>正在出这一次的付款码</b>出好以后请扫码支付，付好了才会开始。</p>
      break
    default:
      body = null
  }

  return (
    <QxTouchScreen
      page="pay-service"
      legacyFrame
      motion="none"
      testId="pay-service"
      stateId={flow.view}
      dataAttrs={{ 'pay-what': what }}
      bodyClassName="pys-body"
      band={
        <QxTouchBand
          kind="compact"
          eyebrow={chrome.eyebrow}
          title={chrome.title}
          sub={chrome.sub}
          seal={null}
          status={chrome.status}
          onBack={leave}
          backDisabled={flow.busy}
        />
      }
      dock={
        <QxTouchDock
          back={Boolean(chrome.left)}
          backLabel={chrome.left?.label ?? '返回'}
          backDisabled={flow.busy}
          onBack={leave}
          ask={chrome.ask ? { label: '问小青：这一次怎么付', draft: '这一次怎么付？', voice: import.meta.env.VITE_USE_TRTC_CALL === 'true' } : undefined}
          primary={{
            label: chrome.primary,
            onClick: primary,
            disabled: flow.busy || flow.view === 'loading',
            testId: 'pay-service-primary',
          }}
        />
      }
      nav={<QxTouchNav current="home" onHome={() => navigate('/')} onAdvisor={() => navigate('/assistant')} onProfile={() => navigate('/profile')} />}
    >
      {body}
      <PaySample what={what} />
    </QxTouchScreen>
  )
}

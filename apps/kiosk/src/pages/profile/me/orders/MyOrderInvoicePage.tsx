// ============================================================
// 一体机自助开发票扫码屏（/me/orders/invoice，对照 pay-1113.js:476-569）。
//
// 隐私红线：
// - 本页绝不出现抬头/税号/邮箱输入框；所有开票信息由求职者在手机上填写提交。
// - controlToken 只留内存 ref（见 useOrderInvoiceSession），绝不写进任何 storage 或 URL。
// ============================================================

import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { useAuth } from '../../../../auth/useAuth'
import { QxTouchArtResume } from '../../../../components/qingxu/touch/QxTouchArt'
import { QxTouchBand, type QxTouchStatus } from '../../../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock } from '../../../../components/qingxu/touch/QxTouchDock'
import { QxTouchNav } from '../../../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../../../components/qingxu/touch/QxTouchScreen'
import { PrintArt } from '../../../print/art/PrintArt'
import {
  INVOICE_ASK_DRAFT,
  INVOICE_CHECKLIST_ITEMS,
  INVOICE_FINE_PRINT,
  INVOICE_FREE_TITLE,
  INVOICE_LIST_TITLE,
  INVOICE_QR_TITLE,
  INVOICE_RATE_LIMIT_NOTE,
  INVOICE_SCREEN_EYEBROW,
  INVOICE_SUBMITTED_CONFIRM,
  invoiceQrSubtitle,
} from './orderInvoiceCopy'
import { parseInvoiceTarget, useOrderInvoiceSession, type InvoiceScreenPhase } from './useOrderInvoiceSession'
import './order-invoice.css'

interface InvoiceRouteState {
  amountCents?: number
  serviceName?: string
}

const INVOICE_STEPS = ['手机扫码', '填写开票信息', '发票发到邮箱'] as const

function InvoiceSample() {
  return (
    <div className="oinv-sample" aria-hidden="true">
      <PrintArt name="resume" size={420} />
      <QxTouchArtResume width={420} />
    </div>
  )
}

function InvoiceQrSeal({ phase, codeUrl }: { phase: InvoiceScreenPhase; codeUrl: string | null }) {
  if (phase === 'waiting' && codeUrl) {
    return (
      <div className="oinv-bqr" data-testid="invoice-qr-box">
        <div role="img" aria-label="开票二维码" data-testid="invoice-qr-code" data-code-url={codeUrl}>
          <QRCodeSVG value={codeUrl} size={280} level="M" marginSize={1} />
        </div>
      </div>
    )
  }
  if (phase === 'submitted') {
    return (
      <div className="oinv-bqr oinv-dim" data-testid="invoice-qr-box">
        <span className="oinv-qrx oinv-qrx-ok">已提交</span>
      </div>
    )
  }
  if (phase === 'expired') {
    return (
      <div className="oinv-bqr oinv-dim" data-testid="invoice-qr-box">
        <span className="oinv-qrx">已过期</span>
      </div>
    )
  }
  return (
    <div className="oinv-bqr oinv-loading" data-testid="invoice-qr-box">
      <span className="oinv-qrx-muted">正在生成…</span>
    </div>
  )
}

function qrStatusOf(phase: InvoiceScreenPhase): QxTouchStatus {
  if (phase === 'submitted') return { text: '已提交', tone: 'ok' }
  if (phase === 'expired') return { text: '已过期', tone: 'warn' }
  return { text: '等手机填写' }
}

export function MyOrderInvoicePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isLoggedIn, getToken } = useAuth()
  const token = isLoggedIn ? getToken() : null
  const routeState = (location.state as InvoiceRouteState | null) ?? null
  const target = useMemo(() => parseInvoiceTarget(location.search), [location.search])
  const session = useOrderInvoiceSession(target, isLoggedIn, token)

  const goOrders = () => navigate('/me/print-orders')
  const goLogin = () => navigate('/login', { state: { from: '/me/print-orders' } })
  const nav = (
    <QxTouchNav
      current="profile"
      onHome={() => navigate('/')}
      onAdvisor={() => navigate('/assistant')}
      onProfile={() => navigate('/profile')}
    />
  )

  if (session.phase === 'free') {
    return (
      <QxTouchScreen
        page="my-orders-invoice"
        legacyFrame
        motion="none"
        testId="my-orders-invoice"
        stateId="free"
        bodyClassName="oinv-body oinv-body-free"
        band={
          <QxTouchBand
            kind="compact"
            back
            backLabel="返回订单"
            onBack={goOrders}
            eyebrow={INVOICE_SCREEN_EYEBROW}
            title={INVOICE_FREE_TITLE}
            seal={null}
            status={{ text: '不收费' }}
          />
        }
        dock={
          <QxTouchDock
            back={false}
            primary={{ label: '返回', onClick: goOrders, testId: 'invoice-primary-btn' }}
          />
        }
        nav={nav}
      >
        <InvoiceSample />
      </QxTouchScreen>
    )
  }

  if (session.phase === 'blocked' || session.phase === 'no_target' || session.phase === 'login' || session.phase === 'error') {
    const title = session.phase === 'blocked'
      ? '这一单开不了发票'
      : session.phase === 'login'
        ? '登录后才能开发票'
        : session.phase === 'error'
          ? '开票码这次没生成出来'
          : '请先选择要开票的订单'
    const sub = session.phase === 'blocked' || session.phase === 'error'
      ? session.reason
      : session.phase === 'login'
        ? '请先登录本人账号，再从订单列表选择要开票的订单。'
        : '返回订单列表，找到已付款的订单再点「开发票」。'
    const status: QxTouchStatus = session.phase === 'blocked'
      ? { text: '无法开票', tone: 'warn' }
      : session.phase === 'error'
        ? { text: '暂未连上', tone: 'warn' }
        : session.phase === 'login'
          ? { text: '未登录' }
          : { text: '请先选单' }
    const primary = session.phase === 'login'
      ? { label: '去登录', onClick: goLogin, testId: 'invoice-primary-btn' }
      : session.phase === 'error'
        ? { label: '重新生成开票码', onClick: session.regenerate, disabled: session.busy, testId: 'invoice-primary-btn' }
        : { label: '返回订单', onClick: goOrders, testId: 'invoice-primary-btn' }

    return (
      <QxTouchScreen
        page="my-orders-invoice"
        legacyFrame
        motion="none"
        testId="my-orders-invoice"
        stateId={session.phase}
        bodyClassName="oinv-body"
        band={
          <QxTouchBand
            kind="compact"
            back
            backLabel="返回订单"
            onBack={goOrders}
            eyebrow={INVOICE_SCREEN_EYEBROW}
            title={title}
            sub={sub}
            seal={null}
            status={status}
          />
        }
        dock={
          <QxTouchDock
            back={session.phase === 'login' || session.phase === 'error'}
            backLabel="返回订单"
            onBack={goOrders}
            primary={primary}
          />
        }
        nav={nav}
      >
        {session.reason ? (
          <p className="oinv-alert" role="alert" data-testid="invoice-blocked-reason">{session.reason}</p>
        ) : null}
        <InvoiceSample />
      </QxTouchScreen>
    )
  }

  // 出码态：loading / waiting / submitted / expired
  const isExpired = session.phase === 'expired'
  return (
    <QxTouchScreen
      page="my-orders-invoice"
      legacyFrame
      motion="none"
      testId="my-orders-invoice"
      stateId={session.phase}
      bodyClassName="oinv-body"
      band={
        <QxTouchBand
          kind="compact"
          back
          backLabel="返回订单"
          onBack={goOrders}
          eyebrow={INVOICE_SCREEN_EYEBROW}
          title={INVOICE_QR_TITLE}
          sub={invoiceQrSubtitle(routeState?.amountCents)}
          sealNode={<InvoiceQrSeal phase={session.phase} codeUrl={session.codeUrl} />}
          status={qrStatusOf(session.phase)}
          path={INVOICE_STEPS}
          pathLabel="三步"
        />
      }
      dock={
        <QxTouchDock
          back
          backLabel="返回订单"
          onBack={goOrders}
          ask={{
            label: INVOICE_ASK_DRAFT.label,
            draft: INVOICE_ASK_DRAFT.draft,
            voice: import.meta.env.VITE_USE_TRTC_CALL === 'true',
          }}
          primary={isExpired
            ? { label: '重新生成开票码', onClick: session.regenerate, disabled: session.busy, testId: 'invoice-primary-btn' }
            : { label: '填好了，返回订单', onClick: goOrders, testId: 'invoice-primary-btn' }}
        />
      }
      nav={nav}
    >
      {session.phase === 'submitted' ? (
        <div className="oinv-submitted" role="status" data-testid="invoice-submitted-banner">
          {INVOICE_SUBMITTED_CONFIRM}
        </div>
      ) : null}
      {session.rateLimited ? (
        <p className="qxt-fine" role="status" data-testid="invoice-rate-limit">{INVOICE_RATE_LIMIT_NOTE}</p>
      ) : null}
      <section className="qxt-olist" aria-label={INVOICE_LIST_TITLE}>
        <div className="qxt-olist-t">{INVOICE_LIST_TITLE}</div>
        {INVOICE_CHECKLIST_ITEMS.map((text, index) => (
          <div className="qxt-check" key={text}>
            <i aria-hidden="true">{index + 1}</i>
            <span>{text}</span>
          </div>
        ))}
      </section>
      <p className="qxt-fine">{INVOICE_FINE_PRINT}</p>
      <InvoiceSample />
    </QxTouchScreen>
  )
}

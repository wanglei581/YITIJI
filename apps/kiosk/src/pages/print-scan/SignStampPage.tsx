// 签名（图形排版），/print-scan/sign。青序流光 20-sign-stamp.html。
// 四步：选文档 → 传签名图 → 选位置 → 合成结果。业务调用仍走
// signInspect / signCompose，本文件只换外壳并补状态覆盖。

import { useState } from 'react'
import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import { HomeIcon, SparklesIcon, UserRoundIcon } from 'lucide-react'
import { QxAiHelp, QxStepActions } from '../../components/qingxu/QxAiHelp'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { getTerminalCode, getTerminalId } from '../../services/api/screensaver'
import { signCompose, signInspect } from '../../services/api/printSign'
import { UploadSessionQrPanel } from '../upload/components/UploadSessionQrPanel'
import { SignStampGateView } from './sign-stamp/SignStampGateView'
import { SignStampPickView, pickAsk } from './sign-stamp/SignStampPickView'
import { SignStampWorkbench } from './sign-stamp/SignStampWorkbench'
import { AUTHORIZATION_LABEL, useSignStampFlow } from './sign-stamp/useSignStampFlow'
import './styles/sign-stamp-qx.css'

const SIGN_ENDPOINTS = { signInspect, signCompose, AUTHORIZATION_LABEL } as const
void SIGN_ENDPOINTS

export function SignStampPage() {
  const flow = useSignStampFlow()
  const terminalLabel = getTerminalCode() || getTerminalId() || '终端未登记'
  const [noticeOpen, setNoticeOpen] = useState(false)


  const onPrimary = () => {
    if (flow.cta.action === 'login') flow.goLogin()
    else if (flow.cta.action === 'help') flow.goHelp()
    else if (flow.cta.action === 'back') flow.goBack()
    else if (flow.cta.action === 'retry-cap') flow.retryCap()
    else if (flow.cta.action === 'material') flow.goMaterialCheck()
    else if (flow.cta.action === 'compose') void flow.handleCompose(false)
    else if (flow.cta.action === 'retry') void flow.handleCompose(true)
  }

  return (
    <QxPageFrame
      back={{ label: '返回打印扫描', onBack: () => flow.navigate('/print-scan') }}
      title="签名"
      terminalLabel={terminalLabel}
      status={flow.pill}
      ctabar={
        <>
        <div className="ss-cta-wrap">
          {flow.cta.reason ? (
            <p className="ss-cta-reason" id="sign-stamp-disabled-reason" data-testid="sign-stamp-disabled-reason">
              {flow.cta.reason}
            </p>
          ) : null}
          <div className="ss-cta-row">
            <button type="button" className="qx-btn" data-variant="ghost" data-testid="sign-stamp-exit" onClick={flow.goBack}>
              {flow.back.label}
            </button>
            {flow.viewState === 'completed' || flow.viewState === 'recovered-completed' || flow.viewState.startsWith('output-preview') || flow.viewState === 'output-expired' || flow.viewState === 'output-preview-failed' ? (
              <button
                type="button"
                className="qx-btn"
                data-variant="ghost"
                data-testid="sign-stamp-add-another"
                onClick={flow.addAnother}
              >
                再加一处签名
              </button>
            ) : null}
            <button
              type="button"
              className="qx-btn"
              data-variant="primary"
              data-testid="sign-stamp-primary"
              disabled={flow.cta.primaryDisabled}
              aria-describedby={flow.cta.reason ? 'sign-stamp-disabled-reason' : undefined}
              onClick={onPrimary}
            >
              {flow.cta.primary}
            </button>
          </div>
        </div>
        <QxStepActions onPrev={() => flow.navigate('/print-scan')} prevLabel="返回打印扫描">
          <QxAiHelp
            label="问小青：签名放在哪一页 →"
            draft="我要在自己的 PDF 上放本人手写签名。请告诉我放在哪一页、哪个位置。不要使用公章。"
            testId="sign-stamp-ask"
          />
        </QxStepActions>
        </>
      }
      navbar={
        <>
          <button type="button" className="qx-nav-item" onClick={() => flow.navigate('/')}>
            <HomeIcon size={30} />
            <span>首页</span>
          </button>
          <button type="button" className="qx-nav-item" onClick={() => flow.navigate('/assistant')}>
            <SparklesIcon size={30} />
            <span>AI 顾问</span>
          </button>
          <button type="button" className="qx-nav-item" onClick={() => flow.navigate('/profile')}>
            <UserRoundIcon size={30} />
            <span>我的</span>
          </button>
        </>
      }
    >
      <div
        className="ss-page qx-grow w2-print-scan-preview"
        data-w2-page="print-scan-sign"
        data-state={flow.viewState}
        data-shape={flow.shape}
        data-testid={`sign-stamp-state-${flow.viewState}`}
      >
        <div className="ss-ctxbar" id="ctxbar">
          <span className="ss-tag" data-tone={flow.displayLive.loggedIn ? 'ok' : 'warn'} data-testid="sign-stamp-auth">
            {flow.displayLive.sessionExpired
              ? '登录已过期'
              : flow.displayLive.loggedIn
                ? '已登录会员'
                : flow.displayLive.authReady
                  ? '未登录'
                  : '身份未确认'}
          </span>
          <span
            className="ss-tag"
            data-tone={flow.displayLive.cap === 'ready' ? 'ok' : flow.displayLive.cap === 'loading' ? undefined : 'bad'}
            data-testid="sign-stamp-cap"
          >
            {flow.displayLive.terminalId === ''
              ? '这台还没登记'
              : flow.displayLive.cap === 'ready'
                ? '可以签名'
                : flow.displayLive.cap === 'loading'
                  ? '正在确认'
                  : flow.displayLive.cap === 'maintenance'
                    ? '签名暂停'
                    : flow.displayLive.cap === 'disabled'
                      ? '暂不能签名'
                      : '还没确认'}
          </span>
          {flow.document ? (
            <span className="ss-tag" data-testid="sign-stamp-doc-tag">
              <b>{flow.document.name}</b>
              {flow.pages !== null ? ` · ${flow.pages} 页` : ''}
            </span>
          ) : null}
          {flow.stamp ? (
            <span className="ss-tag" data-testid="sign-stamp-stamp-tag">
              <b>{flow.stamp.name}</b>
            </span>
          ) : null}
          <span className="sp" />
        </div>

        {flow.shape === 'block' ? (
          <SignStampGateView copy={flow.status} state={flow.viewState} />
        ) : flow.shape === 'pick' && flow.pickPhase ? (
          <SignStampPickView
            phase={flow.pickPhase}
            ask={pickAsk(flow.pickPhase, flow.viewState, flow.derived)}
            status={flow.status}
            localDisabled={flow.localDisabled}
            localDisabledReason={flow.localDisabledReason}
            onLocal={() => flow.openLocal(flow.pickPhase === 'stamp' ? 'stamp' : 'document')}
            onPhone={() => {
              if (flow.pickPhase === 'doc') flow.setShowQr(true)
            }}
            onDocs={flow.goDocs}
            document={flow.document}
            pages={flow.pages}
          />
        ) : (
          <SignStampWorkbench
            status={flow.status}
            document={flow.document}
            pages={flow.pages}
            stamp={flow.stamp}
            result={flow.result}
            page={flow.page}
            position={flow.position}
            size={flow.size}
            placeErr={flow.placeErr}
            authorized={flow.authorized}
            phase={flow.phase}
            viewPage={flow.viewPage}
            viewMode={flow.viewMode}
            zoom={flow.zoom}
            pan={flow.pan}
            outErr={flow.outErr}
            locked={flow.locked}
            onPage={(n) => {
              flow.setPage(n)
              flow.setPlaceErr(null)
              flow.setDocJustRead(false)
              flow.setStampJustAdded(false)
            }}
            onPosition={(pos) => {
              flow.setPosition(pos)
              flow.setDocJustRead(false)
              flow.setStampJustAdded(false)
            }}
            onSize={(next) => {
              flow.setSize(next)
              flow.setDocJustRead(false)
              flow.setStampJustAdded(false)
            }}
            onAuthorize={() => {
              flow.setAuthorized(!flow.authorized)
              if (!flow.authorized) flow.setAuthReset(false)
            }}
            onViewPage={flow.setViewPage}
            onViewMode={flow.setViewMode}
            onZoom={flow.setZoom}
            onPreviewError={() => flow.setOutErr('render')}
          />
        )}

        {!flow.localDisabled && (
          <input ref={flow.docInputRef} type="file" accept="application/pdf" className="ss-hidden-file" onChange={(e) => void flow.handleLocalDoc(e)} />
        )}
        {!flow.localDisabled && (
          <input ref={flow.stampInputRef} type="file" accept="image/jpeg,image/png" className="ss-hidden-file" onChange={(e) => void flow.handleLocalStamp(e)} />
        )}

        {flow.showQr ? (
          <div className="ss-qr">
            <UploadSessionQrPanel
              purpose="print_doc"
              title="手机扫码上传 PDF 文档"
              description="手机扫码上传一份 PDF，确认后自动进入下一步。"
              confirmLabel="确认使用该文档"
              onUploaded={flow.handlePhoneUploaded}
              onBusyChange={flow.setQrBusy}
            />
          </div>
        ) : null}

        <div className="ss-truth" data-testid="sign-stamp-truth">
          <div className="ss-truth-row">
            {flow.synthetic ? (
              <span className="ss-fx" data-testid="sign-stamp-fixture-bar">
                <b>示例</b>示例文件，不是哪位用户的文件
              </span>
            ) : null}
            <span data-disclaimer="true">
              <b>只接受本人手写签名，不接受单位公章或圆形章；这不是可靠电子签名。</b>
            </span>
            <button
              type="button"
              className="ss-truth-toggle"
              data-testid="sign-stamp-notice-toggle"
              aria-expanded={noticeOpen}
              onClick={() => setNoticeOpen((open) => !open)}
            >
              {noticeOpen ? '收起完整说明' : '展开完整说明'}
            </button>
          </div>
          {noticeOpen ? (
            <p className="ss-truth-full" data-testid="sign-stamp-notice-full">
              <b>这不是电子签名服务：</b>
              {COMPLIANCE_COPY.KIOSK_PRINT_SCAN_ESIGN_NOTICE}
            </p>
          ) : null}
        </div>
      </div>
    </QxPageFrame>
  )
}

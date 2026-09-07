// 签名盖章（图形排版），/print-scan/sign。青序流光 20-sign-stamp.html。
// 四步：选文档 → 传签名/印章图 → 选位置 → 合成结果。业务调用仍走
// signInspect / signCompose，本文件只换外壳并补状态覆盖。

import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import { HomeIcon, SparklesIcon, UserRoundIcon } from 'lucide-react'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { getTerminalCode, getTerminalId } from '../../services/api/screensaver'
import { signCompose, signInspect } from '../../services/api/printSign'
import { UploadSessionQrPanel } from '../upload/components/UploadSessionQrPanel'
import { SignStampGateView, gateWhy } from './sign-stamp/SignStampGateView'
import { SignStampPickView, pickAsk } from './sign-stamp/SignStampPickView'
import { SignStampWorkbench } from './sign-stamp/SignStampWorkbench'
import { AUTHORIZATION_LABEL, useSignStampFlow } from './sign-stamp/useSignStampFlow'
import './styles/sign-stamp-qx.css'

const SIGN_ENDPOINTS = { signInspect, signCompose, AUTHORIZATION_LABEL } as const
void SIGN_ENDPOINTS

export function SignStampPage() {
  const flow = useSignStampFlow()
  const terminalLabel = getTerminalCode() || getTerminalId() || '终端未登记'


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
      title="签名盖章"
      subtitle="把签名 / 印章图片叠到 PDF 上，生成一份新文件。这不是电子签名。"
      terminalLabel={terminalLabel}
      status={flow.pill}
      ctabar={
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
                再加一处签名 / 印章
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
            {flow.displayLive.sessionExpired ? '登录已过期' : flow.displayLive.loggedIn ? '已登录会员' : '未登录'}
          </span>
          <span
            className="ss-tag"
            data-tone={flow.displayLive.cap === 'ready' ? 'ok' : flow.displayLive.cap === 'loading' ? undefined : 'bad'}
            data-testid="sign-stamp-cap"
          >
            {flow.displayLive.terminalId === ''
              ? '终端未登记'
              : flow.displayLive.cap === 'ready'
                ? '能力已开放'
                : flow.displayLive.cap === 'loading'
                  ? '能力读取中'
                  : flow.displayLive.cap === 'maintenance'
                    ? '能力维护中'
                    : flow.displayLive.cap === 'disabled'
                      ? '能力未开放'
                      : '能力读取失败'}
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
          {flow.synthetic ? (
            <span className="ss-fx" data-testid="sign-stamp-fixture-bar">
              <b>演示</b>固定原型数据，不是真实用户文件
            </span>
          ) : null}
        </div>

        {flow.shape === 'block' ? (
          <SignStampGateView copy={flow.status} why={gateWhy(flow.viewState)} />
        ) : flow.shape === 'pick' && flow.pickPhase ? (
          <SignStampPickView
            phase={flow.pickPhase}
            ask={pickAsk(flow.pickPhase, flow.viewState, flow.derived)}
            status={flow.status}
            localDisabled={flow.localDisabled}
            localDisabledReason={flow.localDisabledReason}
            onLocal={() => flow.openLocal(flow.pickPhase === 'stamp' ? 'stamp' : 'document')}
            onPhone={() => flow.setShowQr(flow.pickPhase === 'stamp' ? 'stamp' : 'document')}
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

        <input ref={flow.docInputRef} type="file" accept="application/pdf" className="ss-hidden-file" onChange={(e) => void flow.handleLocalDoc(e)} />
        <input ref={flow.stampInputRef} type="file" accept="image/jpeg,image/png" className="ss-hidden-file" onChange={(e) => void flow.handleLocalStamp(e)} />

        {flow.showQr ? (
          <div className="ss-qr">
            {flow.showQr === 'document' ? (
              <UploadSessionQrPanel
                purpose="print_doc"
                title="手机扫码上传 PDF 文档"
                description="手机扫码上传一份 PDF，确认后自动进入下一步。"
                confirmLabel="确认使用该文档"
                onUploaded={flow.handlePhoneUploaded('document')}
                onBusyChange={flow.setQrBusy}
              />
            ) : (
              <UploadSessionQrPanel
                purpose="signature_image"
                title="手机扫码上传签名/印章图片"
                description="手机拍摄或选择签名/印章图片（JPG/PNG），确认后自动进入下一步。"
                confirmLabel="确认使用该图片"
                onUploaded={flow.handlePhoneUploaded('stamp')}
                onBusyChange={flow.setQrBusy}
              />
            )}
          </div>
        ) : null}

        <div className="ss-truth" data-testid="sign-stamp-truth">
          <span data-disclaimer="true">
            <b>这不是电子签名服务：</b>
            {COMPLIANCE_COPY.KIOSK_PRINT_SCAN_ESIGN_NOTICE}
          </span>
        </div>
      </div>
    </QxPageFrame>
  )
}

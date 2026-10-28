// 签名（图形排版），/print-scan/sign。触屏版第 5 版稿 20「签名」。
// 四步：选文档 → 传本人手写签名图 → 选位置 → 合成结果。业务调用仍走
// signInspect / signCompose，本文件只换外壳并补状态覆盖。
// 页面是一列竖排的块（步骤条、状态卡、内容、说明），每一屏只有一个主操作在底栏。

import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import { QxTouchOverlay } from '../../components/qingxu/touch/QxTouchOverlay'
import { FsRow } from './FsRow'
import { TouchToolScreen } from './TouchToolScreen'
import { toolBandStatus } from './toolBand'
import { signCompose, signInspect } from '../../services/api/printSign'
import { UploadSessionQrPanel, type PhoneUploadedFile } from '../upload/components/UploadSessionQrPanel'
import { SignClosedBody, SignStampGateView, gateWhy } from './sign-stamp/SignStampGateView'
import { SignStampPickView } from './sign-stamp/SignStampPickView'
import { SignStampWorkbench, type SignWorkLayout } from './sign-stamp/SignStampWorkbench'
import { Pips } from './sign-stamp/SignStampBits'
import type { SignStampStateId } from './sign-stamp/constants'
import { AUTHORIZATION_LABEL, useSignStampFlow } from './sign-stamp/useSignStampFlow'
import './styles/sign-stamp-qx.css'

const SIGN_ENDPOINTS = { signInspect, signCompose, AUTHORIZATION_LABEL } as const
void SIGN_ENDPOINTS

/**
 * 底栏「问小青」的本屏问句，逐态照稿 20（label 与带去顾问页的 draft 是同一句）。
 * 稿里没有画的登录、能力读取这几道闸，保留原来那句「这个签名有法律效力吗」。
 */
function signAskLabel(state: SignStampStateId, pickPhase: 'doc' | 'stamp' | null): string {
  if (state === 'capability-disabled') return '问小青：签名没开怎么办'
  if (pickPhase === 'doc') return '问小青：签名用哪份 PDF'
  if (pickPhase === 'stamp') return '问小青：签名图是什么'
  if (state === 'result-unknown' || state === 'retrying-same-request' || state === 'conversion-in-progress') {
    return '问小青：签名结果没回来'
  }
  if (
    state === 'composing' || state === 'completed' || state === 'recovered-completed' || state === 'add-another-ready'
    || state.startsWith('output-')
  ) {
    return '问小青：合成完怎么打印'
  }
  if (
    state.startsWith('placement-') || state.startsWith('preview-') || state === 'authorization-required'
    || state === 'ready-to-compose' || state === 'stamp-ready'
  ) {
    return '问小青：签名放在哪一页'
  }
  return '问小青：这个签名有法律效力吗'
}

/** 放置屏上这些状态只是「换了个放法 / 换了个看法」，不值得再画一张状态卡；其余（收到签名图、出错、结果）都画。 */
const QUIET_PLACEMENT = new Set<SignStampStateId>([
  'placement-default', 'placement-page2', 'placement-last-page', 'placement-top-left-small',
  'placement-center-medium', 'placement-bottom-right-large', 'preview-fit-page', 'preview-fit-width',
  'preview-zoomed', 'preview-panned-corner', 'preview-rotated-source-page', 'ready-to-compose',
])

/** 意图带标题与副标题，逐态照稿 20「签名」。稿里没画的闸（读取失败、来路不明……）用状态卡自己的标题。 */
function signBand(
  state: SignStampStateId,
  layout: SignWorkLayout,
  docLine: string,
  fallbackTitle: string,
): { title: string; sub?: string } {
  switch (state) {
    case 'capability-disabled':
      return { title: '签名：本机暂未开通', sub: '选 PDF、传签名图和放置，现在都还不能用' }
    case 'auth-unknown':
    case 'capability-loading':
      return { title: '正在读取签名是否开通', sub: '确认前不放文件' }
    case 'capability-maintenance':
      return { title: '签名暂停维护', sub: '这一会儿做不了' }
    case 'terminal-missing':
      return { title: '这台终端还没有登记', sub: '没登记就不能签名' }
    case 'login-expired':
      return { title: '登录已经过期', sub: '请重新登录后再签名。不展示文件' }
    case 'login-required':
      return { title: '先登录才能签名', sub: '没登录不展示文件，也不能放置' }
    case 'capability-error':
    case 'context-missing':
    case 'return-source-unknown':
      return { title: fallbackTitle }
    default:
      break
  }
  if (state === 'pick-document' || (state.startsWith('document-') && state !== 'document-ready')) {
    return { title: '选一份要签名的 PDF', sub: '还没有选中的 PDF。不放示例文件' }
  }
  if (state === 'pick-stamp' || state === 'document-ready' || state.startsWith('stamp-') || state === 'add-another-ready') {
    return { title: '上传本人手写签名', sub: docLine }
  }
  if (layout === 'outcome') {
    return {
      title: state === 'retrying-same-request' ? '正在用同一个标记查询' : '这一次的结果没有确认',
      sub: '不另起一次合成',
    }
  }
  if (layout === 'result') return { title: '新的 PDF 已生成', sub: '原 PDF 一个字节没改' }
  return { title: '放在这一页的哪里？', sub: docLine }
}

/** 手机扫码的层（稿 20：二维码是层，不是正文里的内联小卡）。手机传上来之后仍要在这里点确认才进下一步。 */
function SignQrLayer({
  kind,
  onClose,
  onUploaded,
  onBusyChange,
}: {
  kind: 'document' | 'stamp'
  onClose: () => void
  onUploaded: (file: PhoneUploadedFile) => void
  onBusyChange: (busy: boolean) => void
}) {
  const doc = kind === 'document'
  return (
    <div className="ss-qr-layer" data-testid="sign-stamp-qr-layer">
      <QxTouchOverlay
        kind="dialog"
        title={doc ? '用手机上传 PDF' : '用手机上传签名图'}
        onClose={onClose}
        actions={<button type="button" className="qxt-btn qxt-btn-sec" data-testid="sign-stamp-qr-close" onClick={onClose}>关闭</button>}
      >
        {doc ? (
          <UploadSessionQrPanel
            purpose="print_doc"
            title="手机扫码上传 PDF 文档"
            description="手机扫码上传一份 PDF（不超过 15MB、1 到 30 页），确认后自动进入下一步。"
            confirmLabel="确认使用该文档"
            onUploaded={onUploaded}
            onBusyChange={onBusyChange}
          />
        ) : (
          <UploadSessionQrPanel
            purpose="signature_image"
            title="手机扫码上传本人手写签名图片"
            description="手机拍摄或选择本人手写签名图片（JPG/PNG），确认后自动进入下一步。"
            confirmLabel="确认使用该图片"
            onUploaded={onUploaded}
            onBusyChange={onBusyChange}
          />
        )}
      </QxTouchOverlay>
    </div>
  )
}

export function SignStampPage() {
  const flow = useSignStampFlow()

  const state = flow.viewState
  const closed = state === 'capability-disabled'
  const outcome = state === 'result-unknown' || state === 'retrying-same-request'
  const finished = (flow.phase === 'completed' || flow.phase === 'recovered') && Boolean(flow.result)
  const layout: SignWorkLayout = outcome ? 'outcome' : finished ? 'result' : 'place'
  const showStepper = flow.shape !== 'block' && layout === 'place'
  const docLine = flow.document ? `${flow.document.name}${flow.pages !== null ? ` · ${flow.pages} 页` : ''}` : ''
  const band = signBand(state, layout, docLine, flow.status.title)

  const onPrimary = () => {
    if (flow.cta.action === 'login') flow.goLogin()
    else if (flow.cta.action === 'back') flow.goBack()
    else if (flow.cta.action === 'retry-cap') flow.retryCap()
    else if (flow.cta.action === 'material') flow.goMaterialCheck()
    else if (flow.cta.action === 'compose') void flow.handleCompose(false)
    else if (flow.cta.action === 'retry') void flow.handleCompose(true)
  }

  return (
    <TouchToolScreen
      eyebrow="签名"
      title={band.title}
      sub={band.sub}
      status={toolBandStatus(flow.pill)}
      onBack={() => flow.navigate('/print-scan')}
      askLabel={signAskLabel(state, flow.pickPhase)}
      left={{ label: flow.back.label, onClick: flow.goBack, testId: 'sign-stamp-exit' }}
      primary={{
        label: flow.cta.primary,
        onClick: onPrimary,
        disabled: flow.cta.primaryDisabled,
        testId: 'sign-stamp-primary',
      }}
      overlay={flow.showQr ? (
        <SignQrLayer
          kind={flow.showQr}
          onClose={() => flow.setShowQr(null)}
          onUploaded={flow.handlePhoneUploaded(flow.showQr)}
          onBusyChange={flow.setQrBusy}
        />
      ) : undefined}
    >
      <div
        className="ss-page qx-grow w2-print-scan-preview"
        data-w2-page="print-scan-sign"
        data-qx-page="sign"
        data-state={state}
        data-shape={flow.shape}
        data-layout={layout}
        data-testid={`sign-stamp-state-${state}`}
      >
        {closed ? null : (
          <div className="ss-ctx" id="ctxbar">
            <span className="ss-tag" data-tone={flow.displayLive.loggedIn ? 'ok' : 'warn'} data-testid="sign-stamp-auth">
              {flow.displayLive.sessionExpired ? '登录已过期' : flow.displayLive.loggedIn ? '已登录会员' : '未登录'}
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
            {flow.synthetic ? (
              <span className="ss-fx" data-testid="sign-stamp-fixture-bar">
                <b>示例</b>示例文件，不是哪位用户的文件
              </span>
            ) : null}
          </div>
        )}

        {showStepper ? <Pips current={flow.shape === 'pick' ? (flow.pickPhase === 'doc' ? 0 : 1) : 2} /> : null}

        {flow.shape === 'block' ? (
          closed ? <SignClosedBody copy={flow.status} /> : <SignStampGateView copy={flow.status} why={gateWhy(state)} />
        ) : flow.shape === 'pick' && flow.pickPhase ? (
          <SignStampPickView
            phase={flow.pickPhase}
            status={flow.status}
            showCard={state !== 'pick-document' && state !== 'pick-stamp'}
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
            layout={layout}
            showCard={layout !== 'place' || !QUIET_PLACEMENT.has(state)}
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

        {flow.cta.reason ? (
          <p className="fs-help" id="sign-stamp-disabled-reason" data-testid="sign-stamp-disabled-reason">
            {flow.cta.reason}
          </p>
        ) : null}
        {flow.viewState === 'completed' || flow.viewState === 'recovered-completed' || flow.viewState.startsWith('output-preview') || flow.viewState === 'output-expired' || flow.viewState === 'output-preview-failed' ? (
          <FsRow title="再加一处本人手写签名" desc="在同一份 PDF 上继续放一处" testId="sign-stamp-add-another" onClick={flow.addAnother} />
        ) : null}

        <div className="ss-truth" data-testid="sign-stamp-truth">
          <span data-disclaimer="true">
            <b>这不是电子签名服务：</b>
            {COMPLIANCE_COPY.KIOSK_PRINT_SCAN_ESIGN_NOTICE}
          </span>
        </div>
      </div>
    </TouchToolScreen>
  )
}

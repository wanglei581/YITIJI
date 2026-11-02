// 隐私与数据请求 — /me/privacy-requests
// 与 main 后端对齐：仅开放撤回授权；导出需再次验证本人（一体机无提交）；账号注销暂未开放。
// 撤回的是 job_ai 授权，用户可见名写「AI 使用授权」（稿 41、账号设置页同名）。托管 a 下它仍被
// /resume/job-fit 手填岗位要求那条路使用，所以撤回项保留，只改说法（2026-09-30 A 批）。

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MEMBER_DATA_REQUEST_SCOPE,
  MEMBER_DATA_REQUEST_STATUS_LABEL,
  MEMBER_DATA_REQUEST_TYPE_HINT,
  MEMBER_DATA_REQUEST_TYPE_LABEL,
  formatDateTime,
  type MemberDataRequestItem,
} from '@ai-job-print/shared'
import { useAuth } from '../../../auth/useAuth'
import { createMyDataRequest, listMyDataRequests } from '../../../services/api/memberPrivacy'
import { userMessageOf } from '../../../services/api/userErrorMessage'
import { QxTouchOverlay } from '../../../components/qingxu/touch/QxTouchOverlay'
import { MeBtn, MeFine, MeHero, MeP } from '../touch/MeKit'
import { MeErrorPack, MeLoadingPack, MeLoginGate } from '../touch/MeStatePacks'
import { MeTouchShell, type MeBandStatus } from '../touch/MeTouchShell'
import './styles/privacy-qx.css'

function fmt(iso: string): string {
  return formatDateTime(iso)
}

type PrivacyUiState = 'login' | 'loading' | 'error' | 'empty' | 'history-ready' | 'revoke-confirm' | 'submitting'

export function MyPrivacyRequestsPage() {
  const navigate = useNavigate()
  const { isLoggedIn, getToken } = useAuth()
  const [items, setItems] = useState<MemberDataRequestItem[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [message, setMessage] = useState<string | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const token = getToken()
    if (!token) {
      setLoadState('ready')
      setItems([])
      return
    }
    setLoadState('loading')
    setMessage(null)
    try {
      setItems(await listMyDataRequests(token))
      setLoadState('ready')
    } catch (error) {
      setLoadState('error')
      setMessage(userMessageOf(error, '加载失败，请稍后重试'))
    }
  }

  useEffect(() => {
    if (!isLoggedIn) {
      setLoadState('ready')
      setItems([])
      return
    }
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 登录态变化时拉列表
  }, [isLoggedIn, getToken])

  const submitRevoke = async () => {
    const token = getToken()
    if (!token) return
    setBusy(true)
    try {
      const created = await createMyDataRequest(token, 'revoke_consent')
      setItems((prev) => [created, ...prev])
      setConfirmRevoke(false)
      setMessage('已撤回 AI 使用授权，请求已记录')
    } catch (error) {
      setMessage(userMessageOf(error, '提交失败，请稍后重试'))
    } finally {
      setBusy(false)
    }
  }

  const uiState: PrivacyUiState = !isLoggedIn
    ? 'login'
    : loadState === 'loading'
      ? 'loading'
      : loadState === 'error'
        ? 'error'
        : busy
          ? 'submitting'
          : confirmRevoke
            ? 'revoke-confirm'
            : items.length === 0
              ? 'empty'
              : 'history-ready'

  const status: MeBandStatus = uiState === 'error'
    ? { tone: 'warn', label: '这次没读到' }
    : uiState === 'loading' || uiState === 'submitting'
      ? { tone: 'reading', label: '正在处理隐私请求' }
      : uiState === 'login'
        ? { tone: 'unknown', label: '未登录' }
        : { tone: 'ok', label: items.length > 0 ? '有申请记录' : '已登录' }

  return (
    <div
      className="fusion-w5 fusion-w5--profile pr-root"
      data-kiosk-screen="member-privacy-requests"
      data-state={uiState}
      data-testid={`member-privacy-state-${uiState}`}
    >
      <MeTouchShell
        eyebrow="我的 · 隐私与数据请求"
        title="你的信息由你决定"
        sub="撤回可以在这里办；导出和注销不在这台机器上提交"
        status={status}
        backLabel="返回我的"
        onBack={() => navigate('/profile')}
        ask={{ label: '问小青：撤回授权会怎样？', draft: '撤回授权会怎样？' }}
        primaryNode={(
          <PrivacyCta
            uiState={uiState}
            onLogin={() => navigate('/login', { state: { from: '/me/privacy-requests' } })}
            onRetry={() => void load()}
          />
        )}
        overlay={confirmRevoke ? (
          <QxTouchOverlay
            kind="dialog"
            title={busy ? '提交中…' : '确认撤回 AI 使用授权'}
            onClose={() => { if (!busy) setConfirmRevoke(false) }}
            actions={(
              <>
                <button type="button" className="qxt-btn qxt-btn-sec" disabled={busy} onClick={() => setConfirmRevoke(false)}>取消</button>
                <button type="button" className="qxt-btn qxt-btn-danger" disabled={busy} onClick={() => void submitRevoke()}>{busy ? '提交中…' : '确认撤回'}</button>
              </>
            )}
          >
            <p>{MEMBER_DATA_REQUEST_TYPE_HINT.revoke_consent}</p>
            <p>撤回不会删除简历、文档、打印订单或收藏；也不等于账号注销。</p>
            <p>点「确认撤回」后会提交一次请求并等待返回：成功即完成撤回，失败会提示稍后重试；本页不会提前显示成功。</p>
          </QxTouchOverlay>
        ) : undefined}
      >
        <div className="qx-scroll qx-grow pr-page me-page">
          {message ? (
            <div role="status" className="me-toast" data-tone={message.includes('失败') ? 'bad' : undefined}>
              {message}
            </div>
          ) : null}

          {uiState === 'login' ? (
            <div data-testid="member-privacy-fallback" className="me-state">
              <MeLoginGate page="privacy" />
            </div>
          ) : null}

          {uiState === 'loading' ? <MeLoadingPack rows={6} /> : null}

          {uiState === 'error' ? (
            <div className="me-state"><MeErrorPack onRetry={() => void load()} /></div>
          ) : null}

          {isLoggedIn && uiState !== 'loading' && uiState !== 'error' ? (
            <div className="me-split" data-testid="member-privacy-capabilities" aria-label="可提交与暂未开放的请求">
              <MeHero art="resume" artWidth={150} title={MEMBER_DATA_REQUEST_TYPE_LABEL.revoke_consent} testId="member-privacy-revoke">
                <MeP>{MEMBER_DATA_REQUEST_TYPE_HINT.revoke_consent}</MeP>
                <MeP>撤回不会删除简历、文档、打印订单或收藏，也不等于注销。</MeP>
                {confirmRevoke || busy ? (
                  <MeP><span data-testid="member-privacy-revoke-entry">{busy ? '正在提交撤回。' : '确认弹层已打开'}</span></MeP>
                ) : (
                  <MeBtn v="danger" data-testid="member-privacy-revoke-entry" onClick={() => setConfirmRevoke(true)}>撤回授权</MeBtn>
                )}
              </MeHero>

              <MeHero art="checklist" artWidth={150} title="导出、注销和申请记录">
                <MeBtn v="sec" disabled data-capability="export">{MEMBER_DATA_REQUEST_TYPE_LABEL.export}</MeBtn>
                <MeP>一体机未开放。按《隐私政策》里的联系方式申请。</MeP>
                <MeBtn v="sec" disabled data-capability="delete">{MEMBER_DATA_REQUEST_TYPE_LABEL.delete}</MeBtn>
                <MeP>暂未开放。一体机上不能直接注销。</MeP>
                {items.length === 0 ? (
                  <MeP>还没有申请记录。提交撤回授权后，进度会出现在这里。</MeP>
                ) : (
                  <div aria-label="我的请求记录" className="me-block">
                    {items.map((item) => (
                      <MeP key={item.id}>
                        <span data-request-type={item.requestType} data-request-status={item.status}>
                          {MEMBER_DATA_REQUEST_TYPE_LABEL[item.requestType]} · {fmt(item.requestedAt)} · {MEMBER_DATA_REQUEST_STATUS_LABEL[item.status]}
                        </span>
                      </MeP>
                    ))}
                  </div>
                )}
                <button type="button" className="me-line" onClick={() => navigate('/legal/privacy')}>
                  <b>查看《隐私政策》</b>
                  <small>电话和邮箱写在政策里</small>
                </button>
              </MeHero>
            </div>
          ) : null}

          {isLoggedIn ? <MeFine>{MEMBER_DATA_REQUEST_SCOPE}离开 3 分钟没操作会自动退出。</MeFine> : null}
        </div>
      </MeTouchShell>
    </div>
  )
}

function PrivacyCta({
  uiState,
  onLogin,
  onRetry,
}: {
  uiState: PrivacyUiState
  onLogin: () => void
  onRetry: () => void
}) {
  if (uiState === 'login') {
    return (
      <button type="button" className="qx-btn" data-variant="primary" data-testid="member-privacy-primary" onClick={onLogin}>
        去登录
      </button>
    )
  }
  if (uiState === 'error') {
    return (
      <button type="button" className="qx-btn" data-variant="primary" data-testid="member-privacy-primary" onClick={onRetry}>
        重新加载
      </button>
    )
  }
  return null
}

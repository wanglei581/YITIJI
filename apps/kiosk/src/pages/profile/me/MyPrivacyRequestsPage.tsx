// 隐私与数据请求 — /me/privacy-requests
// 与 main 后端对齐：仅开放撤回授权；导出需 step-up（一体机无提交）；账号注销暂未开放。

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
import { FileDownIcon, ShieldOffIcon, Trash2Icon } from 'lucide-react'
import { useAuth } from '../../../auth/useAuth'
import { QxPageFrame } from '../../../components/qingxu/QxPageFrame'
import { createMyDataRequest, listMyDataRequests } from '../../../services/api/memberPrivacy'
import { getTerminalCode } from '../../../services/api/screensaver'
import { userMessageOf } from '../../../services/api/userErrorMessage'
import { QxMemberNavbar } from '../components/QxMemberNavbar'
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
      setMessage('已撤回岗位 AI 授权，请求已记录')
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

  const status = uiState === 'error'
    ? { tone: 'bad' as const, label: '请求记录这次没有加载出来' }
    : uiState === 'loading' || uiState === 'submitting'
      ? { tone: 'unknown' as const, label: '正在处理隐私请求' }
      : { tone: 'unknown' as const, label: '一体机只开放撤回岗位 AI 授权' }

  return (
    <div
      className="fusion-w5 fusion-w5--profile pr-root"
      data-kiosk-screen="member-privacy-requests"
      data-state={uiState}
      data-testid={`member-privacy-state-${uiState}`}
    >
      <QxPageFrame
        title="隐私与数据请求"
        subtitle="撤回授权可用；导出与注销暂未在一体机开放"
        status={status}
        terminalLabel={getTerminalCode() || '就业服务大厅'}
        ctabar={
          <PrivacyCta
            uiState={uiState}
            busy={busy}
            onLogin={() => navigate('/login', { state: { from: '/me/privacy-requests' } })}
            onSettings={() => navigate('/me/settings')}
            onRetry={() => void load()}
            onHelp={() => navigate('/help')}
            onRevoke={() => setConfirmRevoke(true)}
          />
        }
        navbar={<QxMemberNavbar current="profile" />}
      >
        <div className="qx-scroll qx-grow pr-page">
          {message ? (
            <div role="status" className="pr-toast" data-tone={message.includes('失败') ? 'bad' : undefined}>
              {message}
            </div>
          ) : null}

          <p className="pr-legal">{MEMBER_DATA_REQUEST_SCOPE}</p>

          {uiState === 'login' ? (
            <div className="qx-state" data-tone="info" data-testid="member-privacy-fallback">
              <span className="qx-state-ic" />
              <span>
                <div className="qx-state-t">请先登录</div>
                <p className="qx-state-d">登录后可提交撤回岗位 AI 授权，或查看本人相关请求记录。</p>
              </span>
            </div>
          ) : null}

          {uiState === 'loading' ? (
            <div className="qx-state" data-tone="info">
              <span className="qx-state-ic" />
              <span>
                <div className="qx-state-t">正在加载请求记录</div>
                <p className="qx-state-d">返回前一律显示「—」，不会闪回上一位用户的记录。</p>
              </span>
            </div>
          ) : null}

          {uiState === 'error' ? (
            <div className="qx-state" data-tone="error">
              <span className="qx-state-ic" />
              <span>
                <div className="qx-state-t">请求记录这次没有加载出来</div>
                <p className="qx-state-d">{message ?? '请稍后重试'}。本次加载失败不会撤回或恢复任何授权。</p>
              </span>
            </div>
          ) : null}

          {isLoggedIn && uiState !== 'loading' ? (
            <section data-testid="member-privacy-capabilities" aria-label="可提交与暂未开放的请求">
              <div className="pr-cap" data-capability="revoke_consent">
                <span className="qx-row-ic"><ShieldOffIcon size={28} aria-hidden /></span>
                <span className="pr-cap-main">
                  <span className="pr-cap-t">{MEMBER_DATA_REQUEST_TYPE_LABEL.revoke_consent}</span>
                  <span className="pr-cap-p">{MEMBER_DATA_REQUEST_TYPE_HINT.revoke_consent}</span>
                </span>
                {confirmRevoke || busy ? (
                  <span className="pr-flag" data-testid="member-privacy-revoke-entry">确认弹层已打开</span>
                ) : (
                  <button
                    type="button"
                    className="qx-btn"
                    data-variant="primary"
                    data-testid="member-privacy-revoke-entry"
                    onClick={() => setConfirmRevoke(true)}
                  >
                    撤回授权
                  </button>
                )}
              </div>
              <div className="pr-cap" data-off="true" data-capability="export">
                <span className="qx-row-ic"><FileDownIcon size={28} aria-hidden /></span>
                <span className="pr-cap-main">
                  <span className="pr-cap-t">{MEMBER_DATA_REQUEST_TYPE_LABEL.export}</span>
                  <span className="pr-cap-p">{MEMBER_DATA_REQUEST_TYPE_HINT.export}</span>
                </span>
                <span className="pr-flag">一体机未开放</span>
              </div>
              <div className="pr-cap" data-off="true" data-capability="delete">
                <span className="qx-row-ic"><Trash2Icon size={28} aria-hidden /></span>
                <span className="pr-cap-main">
                  <span className="pr-cap-t">{MEMBER_DATA_REQUEST_TYPE_LABEL.delete}</span>
                  <span className="pr-cap-p">{MEMBER_DATA_REQUEST_TYPE_HINT.delete}</span>
                </span>
                <span className="pr-flag">暂未开放</span>
              </div>
            </section>
          ) : null}

          {isLoggedIn && uiState !== 'loading' && uiState !== 'error' ? (
            <section aria-label="我的请求记录">
              <div className="qx-sec-h">
                <span className="t">我的请求记录</span>
              </div>
              {items.length === 0 ? (
                <div className="qx-state" data-tone="empty">
                  <span className="qx-state-ic" />
                  <span>
                    <div className="qx-state-t">暂无请求记录</div>
                    <p className="qx-state-d">提交撤回授权后，记录会出现在这里。空就是空，本页不会造记录让页面好看。</p>
                  </span>
                </div>
              ) : (
                <div className="qx-rows">
                  {items.map((item) => (
                    <div key={item.id} className="qx-row" data-request-type={item.requestType} data-request-status={item.status}>
                      <span className="qx-row-ic"><ShieldOffIcon size={24} aria-hidden /></span>
                      <span className="qx-row-tx">
                        <span className="qx-row-t">{MEMBER_DATA_REQUEST_TYPE_LABEL[item.requestType]}</span>
                        <span className="qx-row-d">{fmt(item.requestedAt)}</span>
                      </span>
                      <span className="pr-flag">{MEMBER_DATA_REQUEST_STATUS_LABEL[item.status]}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          <div className="pr-guide" aria-label="说明">
            <div className="pr-guide-item">
              <div className="pr-guide-k">撤回范围</div>
              <div className="pr-guide-t">只影响岗位 AI 授权</div>
              <p className="pr-guide-p">不影响简历诊断、打印、收藏或已保存文件</p>
            </div>
            <div className="pr-guide-item">
              <div className="pr-guide-k">再次使用</div>
              <div className="pr-guide-t">需要重新确认</div>
              <p className="pr-guide-p">下次用岗位 AI 时会再次请求授权</p>
            </div>
            <div className="pr-guide-item">
              <div className="pr-guide-k">记录</div>
              <div className="pr-guide-t">只留处理记录</div>
              <p className="pr-guide-p">不会因此删除任何已有资产</p>
            </div>
          </div>
        </div>
      </QxPageFrame>

      {confirmRevoke ? (
        <div className="pr-overlay" data-testid="member-privacy-dialog" onClick={() => !busy && setConfirmRevoke(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="privacy-revoke-title"
            className="pr-dlg"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="privacy-revoke-title">{busy ? '提交中…' : '确认撤回岗位 AI 授权'}</h2>
            <p>{MEMBER_DATA_REQUEST_TYPE_HINT.revoke_consent}</p>
            <p>撤回不会删除简历、文档、打印订单或收藏；也不等于账号注销。</p>
            <p>点「确认撤回」后会提交一次请求并等待返回：<b>成功即完成撤回</b>，失败会提示稍后重试；本页不会提前显示成功。</p>
            <div className="pr-dlg-acts">
              <button type="button" className="qx-btn" data-variant="ghost" disabled={busy} onClick={() => setConfirmRevoke(false)}>
                取消
              </button>
              <button type="button" className="qx-btn" data-variant="danger" disabled={busy} onClick={() => void submitRevoke()}>
                {busy ? '提交中…' : '确认撤回'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function PrivacyCta({
  uiState,
  busy,
  onLogin,
  onSettings,
  onRetry,
  onHelp,
  onRevoke,
}: {
  uiState: PrivacyUiState
  busy: boolean
  onLogin: () => void
  onSettings: () => void
  onRetry: () => void
  onHelp: () => void
  onRevoke: () => void
}) {
  if (uiState === 'login') {
    return (
      <>
        <button type="button" className="qx-btn" data-variant="ghost" onClick={onSettings}>返回账号设置</button>
        <button type="button" className="qx-btn" data-variant="primary" data-testid="member-privacy-primary" onClick={onLogin}>
          手机号登录
        </button>
      </>
    )
  }
  if (uiState === 'error') {
    return (
      <>
        <button type="button" className="qx-btn" data-variant="ghost" onClick={onHelp}>联系工作人员</button>
        <button type="button" className="qx-btn" data-variant="primary" data-testid="member-privacy-primary" onClick={onRetry}>
          重新加载
        </button>
      </>
    )
  }
  return (
    <>
      <button type="button" className="qx-btn" data-variant="ghost" onClick={onSettings}>返回设置</button>
      <button
        type="button"
        className="qx-btn"
        data-variant="primary"
        data-testid="member-privacy-primary"
        disabled={busy || uiState === 'revoke-confirm' || uiState === 'submitting' || uiState === 'loading'}
        onClick={onRevoke}
      >
        撤回岗位 AI 授权
      </button>
    </>
  )
}

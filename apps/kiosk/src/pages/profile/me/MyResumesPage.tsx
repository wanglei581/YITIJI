import { clearResumeReferences } from '../../resume/clearResumeReferences'
import { recordUnavailableReason, resumeLabel } from './aiRecordNavigation'
import { useMemberCursorPage } from './useMemberCursorPage'
import { MemberLoadMore } from './MemberLoadMore'
// 我的简历 — /me/resumes（本人，仅元数据）。
// 不展示简历原文 / payload / 诊断正文。

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { MemberResumeItem } from '@ai-job-print/shared'
import { deleteMyResume, getMyResumes } from '../../../services/api/memberAssets'
import { useAuth } from '../../../auth/useAuth'
import { formatTime } from '../assets/format'
import { QxMePage, recordsCtabar } from './qx/QxMeChrome'
import { QxMeErrorBlock, QxMeLoadingBlock, QxMeLoginBlock } from './qx/QxMeStateBits'
import { MeActs, MeBtn, MeP, MeRow, MeRows } from '../touch/MeKit'
import { MeEmptyPack, MeExitCard } from '../touch/MeStatePacks'
import './styles/member-records-qx.css'

const STATUS_META: Record<MemberResumeItem['status'], { label: string; tone?: 'wait' | 'run' | 'bad' }> = {
  pending: { label: '待处理', tone: 'wait' },
  processing: { label: '处理中', tone: 'run' },
  completed: { label: '已完成' },
  failed: { label: '失败', tone: 'bad' },
}

/**
 * 行内第一行：处理状态、有没有优化版、保留到哪天（稿 pageResumes）。
 * 不写模型名和任务编号：那是工程信息（2026-09-30 A 批，稿 39 只显示名称和状态）。
 */
function metaLine(item: MemberResumeItem, status: string): string {
  const opt = item.kind === 'parse' ? ` · ${item.optimized ? '已生成优化版' : '未优化'}` : ''
  const expires = item.expiresAt ? ` · 保留至 ${formatTime(item.expiresAt)}` : ''
  return `${status}${opt}${expires}`
}

function isActionable(item: MemberResumeItem): boolean {
  return recordUnavailableReason(item) === null
}

function taskPath(path: string, taskId: string): string {
  return `${path}?taskId=${encodeURIComponent(taskId)}`
}


export function MyResumesPage() {
  // loginFrom="/me/resumes"
  const navigate = useNavigate()
  const { isLoggedIn, getToken } = useAuth()
  const [reloadKey, setReloadKey] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState<(MemberResumeItem & { ownerToken: string | null }) | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const token = getToken()
  useEffect(() => { setConfirmDelete(null); setDeleteError(null) }, [token])
  const fetchPage = useCallback((cursor?: string) => getMyResumes(token, { pageSize: 50, cursor }), [token])
  const pagination = useMemberCursorPage<MemberResumeItem>({ enabled: isLoggedIn, identityKey: token, reloadKey, fetchPage })
  const { items, state, total } = pagination

  const openReport = (taskId: string) => navigate(taskPath('/resume/report', taskId), { state: { taskId } })
  const openOptimize = (taskId: string, saved: boolean) => navigate(`${taskPath('/resume/optimize', taskId)}${saved ? '&saved=1' : ''}`, { state: { taskId } })
  const openJobFit = (item: MemberResumeItem) => {
    if (item.kind !== 'parse' || !isActionable(item)) return
    navigate(`/resume/job-fit?${new URLSearchParams({ taskId: item.taskId, resumeName: resumeLabel(item) })}`)
  }
  const remove = async () => {
    if (!confirmDelete || !token || confirmDelete.ownerToken !== token || deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteMyResume(token, confirmDelete.id)
      clearResumeReferences(confirmDelete.taskId)
      setConfirmDelete(null)
      setReloadKey((key) => key + 1)
    } catch { setDeleteError('删除没有完成，记录可能已被删除，或网络暂时不可用。请刷新后重试。') }
    finally { setDeleting(false) }
  }
  const openGenerate = (taskId: string) => navigate(taskPath('/resume/generate/preview', taskId), { state: { taskId } })

  const uiState = !isLoggedIn ? 'login' : state === 'loading' ? 'loading' : state === 'error' ? 'error' : items.length === 0 ? 'empty' : 'ready'
  const [openId, setOpenId] = useState<string | null>(null)

  let body: ReactNode
  if (!isLoggedIn) {
    body = <QxMeLoginBlock title="登录后查看我的简历" />
  } else if (state === 'loading') {
    body = <QxMeLoadingBlock title="正在加载我的简历" />
  } else if (state === 'error') {
    body = <QxMeErrorBlock onRetry={() => setReloadKey((k) => k + 1)} />
  } else if (items.length === 0) {
    body = (
      <div className="me-state" data-testid="qx-me-fallback">
        <MeEmptyPack
          sentence="这个账号还没有简历记录。"
          note={<p className="me-p">公共一体机上的游客上传不会自动绑定到账号；登录后上传、诊断或生成的简历会显示在这里。</p>}
        >
          <MeExitCard art="resume" artWidth={120} title="上传一份简历" desc="从手机或 U 盘选一份，接着做诊断" onClick={() => navigate('/resume/source')} />
          <MeExitCard art="scan" artWidth={120} title="扫描纸质简历" desc="把纸质简历扫进来" onClick={() => navigate('/scan/start')} />
          <MeExitCard art="checklist" artWidth={110} title="从零生成" desc="没有旧简历也可以做" onClick={() => navigate('/resume/generate')} />
        </MeEmptyPack>
      </div>
    )
  } else {
    body = (
      <>
      <MeRows few={items.length < 7 && openId === null} testId="member-records-list" label="我的简历">
        {items.map((item) => {
          const status = STATUS_META[item.status] ?? { label: '未知状态', tone: 'run' as const }
          const actionable = isActionable(item)
          const disabledReason = recordUnavailableReason(item) ?? ''
          const isParse = item.kind === 'parse'
          const taskLabel = formatTime(item.createdAt)
          const open = openId === item.id
          const confirming = confirmDelete?.id === item.id && confirmDelete.ownerToken === token
          return (
            <MeRow
              key={item.id}
              open={open}
              onToggle={() => { setOpenId(open ? null : item.id); if (confirmDelete?.id === item.id) setConfirmDelete(null) }}
              data-record-status={item.status}
              data-record-kind={item.kind}
              data-flag={item.status === 'failed' ? 'true' : undefined}
              title={resumeLabel(item)}
              lines={[metaLine(item, status.label), isParse ? '上传简历后生成的诊断记录' : 'AI 引导生成的简历版本']}
              actions={(
                <MeActs>
                  {isParse ? (
                    <>
                      <SmallAct label="查看报告" disabled={!actionable} reason={disabledReason} aria={`查看 ${taskLabel} 这份简历的诊断报告`} onClick={() => openReport(item.taskId)} primary />
                      <SmallAct label={item.optimized ? '查看优化版' : '继续优化'} disabled={!actionable} reason={disabledReason} aria={`${item.optimized ? '查看' : '继续生成'} ${taskLabel} 这份简历的优化版`} onClick={() => openOptimize(item.taskId, item.optimized)} />
                      <SmallAct label="简历对照" disabled={!actionable} reason={disabledReason} aria="用这份简历做简历对照" onClick={() => openJobFit(item)} />
                    </>
                  ) : (
                    <>
                      <SmallAct label="查看并打印" disabled={!actionable} reason={disabledReason} aria={`查看并打印 ${taskLabel} 这份 AI 生成简历`} onClick={() => openGenerate(item.taskId)} primary />
                      <SmallAct label="简历对照" disabled reason="生成简历请先导出再上传诊断" aria="用这份简历做简历对照" onClick={() => {}} />
                    </>
                  )}
                  {confirming ? null : (
                    <SmallAct label="删除" disabled={deleting} reason="正在删除" aria="删除这份简历" onClick={() => { setConfirmDelete({ ...item, ownerToken: token }); setDeleteError(null) }} />
                  )}
                </MeActs>
              )}
              extra={(
                <>
                  {!isParse ? <MeP tone="reason">生成简历暂不能直接对照；请先导出，再上传诊断。</MeP> : null}
                  {!actionable ? <MeP tone="reason">{isParse ? '报告与优化：' : ''}{disabledReason}</MeP> : null}
                  {confirming && confirmDelete ? (
                    <div role="group" aria-labelledby="resume-delete-title" className="me-confirm">
                      <b id="resume-delete-title">删除 {resumeLabel(confirmDelete)}？</b>
                      <MeP>{confirmDelete.kind === 'parse' ? '会一并删除这份简历的诊断、优化稿、编辑草稿、确认版本、简历对照、职业规划及相关 AI 分析记录。' : '会删除这份 AI 生成简历记录。'}删除后不可恢复。已上传和导出的文件仍在「我的文档」，可在那里单独删除。</MeP>
                      {deleteError ? <MeP tone="reason"><span role="alert">{deleteError}</span></MeP> : null}
                      <MeActs>
                        <MeBtn v="danger" disabled={deleting} onClick={() => void remove()}>{deleting ? '正在删除…' : '确认删除'}</MeBtn>
                        <MeBtn v="sec" disabled={deleting} onClick={() => setConfirmDelete(null)}>取消</MeBtn>
                      </MeActs>
                    </div>
                  ) : null}
                </>
              )}
            />
          )
        })}
        </MeRows>
        {items.length < 7 && openId === null ? (
          <div className="me-stack">
            <MeExitCard art="scan" artWidth={110} title="扫描纸质简历" desc="把纸质简历扫进来" onClick={() => navigate('/scan/start')} />
            <MeExitCard art="checklist" artWidth={100} title="从零生成" desc="没有旧简历也可以做" onClick={() => navigate('/resume/generate')} />
          </div>
        ) : null}
      </>
    )
  }

  const ctabar = recordsCtabar(uiState, navigate, () => setReloadKey((k) => k + 1), '/me/resumes', '去上传简历', () => navigate('/resume/source'))

  return (
    <QxMePage
      title="我的简历"
      view="resumes"
      screen="member-list"
      screenState={`resumes-${uiState}`}
      eyebrow="我的 · 简历"
      sub={items.length > 0 ? `共 ${total} 条 · 不显示简历原文` : uiState === 'empty' ? '这个账号还没有简历记录' : undefined}
      fine={`到期日写在每一份上。原始简历短留存，到期后无法恢复，不向企业提供或投递。${total > items.length ? `当前显示最近 ${items.length} / ${total} 条。` : ''}离开 3 分钟没操作会自动退出。`}
      ctabar={ctabar}
    >
      {body}
      {isLoggedIn && state === 'ready' ? <MemberLoadMore {...pagination} /> : null}
    </QxMePage>
  )
}

function SmallAct({
  label, disabled, reason, aria, onClick, primary,
}: {
  label: string
  disabled: boolean
  reason: string
  aria: string
  onClick: () => void
  primary?: boolean
}) {
  return (
    <MeBtn
      v={primary ? 'pri' : 'sec'}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      onClick={disabled ? (event) => event.preventDefault() : onClick}
      aria-label={disabled ? `${aria}（${reason}）` : aria}
    >
      {label}
    </MeBtn>
  )
}

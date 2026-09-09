// 我的简历 — /me/resumes（本人，仅元数据）。
// 不展示简历原文 / payload / 诊断正文。

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { MemberResumeItem } from '@ai-job-print/shared'
import {
  ClockIcon,
  FileCheckIcon,
  FileTextIcon,
  ScanLineIcon,
  SparklesIcon,
  UploadIcon,
} from 'lucide-react'
import { getMyResumes } from '../../../services/api/memberAssets'
import { useAuth } from '../../../auth/useAuth'
import { formatTime } from '../assets/format'
import { QxMeGuide, QxMePage, QxMeSummary, recordsCtabar } from './qx/QxMeChrome'
import { QxMeErrorBlock, QxMeLoadingBlock, QxMeLoginBlock, QxMeStartRow, QxMeStructRow } from './qx/QxMeStateBits'
import './styles/member-records-qx.css'

const STATUS_META: Record<MemberResumeItem['status'], { label: string; tone?: 'wait' | 'run' | 'bad' }> = {
  pending: { label: '待处理', tone: 'wait' },
  processing: { label: '处理中', tone: 'run' },
  completed: { label: '已完成' },
  failed: { label: '失败', tone: 'bad' },
}

function shortTaskId(taskId: string | null | undefined): string {
  if (!taskId) return '未知任务'
  return taskId.length > 10 ? `${taskId.slice(0, 6)}...${taskId.slice(-4)}` : taskId
}

function metaLine(item: MemberResumeItem): string {
  const expires = item.expiresAt ? ` · 留存至 ${formatTime(item.expiresAt)}` : ''
  return `${item.provider} · 任务 ${shortTaskId(item.taskId)} · ${formatTime(item.createdAt)}${expires}`
}

function isActionable(item: MemberResumeItem): boolean {
  return item.status === 'completed'
}

function taskPath(path: string, taskId: string): string {
  return `${path}?taskId=${encodeURIComponent(taskId)}`
}

type LoadState = 'loading' | 'error' | 'ready'

export function MyResumesPage() {
  // loginFrom="/me/resumes"
  const navigate = useNavigate()
  const { isLoggedIn, getToken } = useAuth()
  const [items, setItems] = useState<MemberResumeItem[]>([])
  const [total, setTotal] = useState(0)
  const [state, setState] = useState<LoadState>('loading')
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(() => {
    if (!isLoggedIn) {
      setItems([])
      setTotal(0)
      setState('ready')
      return
    }
    setState('loading')
    getMyResumes(getToken(), { pageSize: 50 })
      .then((page) => {
        setItems(page.items)
        setTotal(page.total)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [getToken, isLoggedIn])

  useEffect(() => { load() }, [load, reloadKey])

  const openReport = (taskId: string) => navigate(taskPath('/resume/report', taskId), { state: { taskId } })
  const openOptimize = (taskId: string) => navigate(taskPath('/resume/optimize', taskId), { state: { taskId } })
  const openJobFit = () => navigate('/resume/job-fit')
  const openGenerate = (taskId: string) => navigate(taskPath('/resume/generate/preview', taskId), { state: { taskId } })

  const completedCount = items.filter((item) => item.status === 'completed').length
  const parseCount = items.filter((item) => item.kind === 'parse').length
  const generateCount = items.filter((item) => item.kind === 'generate').length
  const uiState = !isLoggedIn ? 'login' : state === 'loading' ? 'loading' : state === 'error' ? 'error' : items.length === 0 ? 'empty' : 'ready'

  const struct = (
    <>
      <QxMeStructRow icon={FileCheckIcon} title="上传诊断简历" desc="诊断报告、优化版与打印出口" mode={!isLoggedIn ? 'lock' : 'error'} testid="member-records-struct-resumes-0" />
      <QxMeStructRow icon={SparklesIcon} title="AI 生成简历" desc="生成的版本与打印出口" mode={!isLoggedIn ? 'lock' : 'error'} testid="member-records-struct-resumes-1" />
      <QxMeStructRow icon={ClockIcon} title="每条记录的处理状态" desc="待处理 / 处理中 / 已完成 / 失败" mode={!isLoggedIn ? 'lock' : 'error'} testid="member-records-struct-resumes-2" />
    </>
  )

  let body: ReactNode
  if (!isLoggedIn) {
    body = <QxMeLoginBlock title="登录后查看我的简历" desc="公共一体机不会在未登录时展示简历文件名、任务或诊断记录；游客上传不会自动绑定到账号。" struct={struct} onJobs={() => navigate('/jobs')} onPrint={() => navigate('/print-scan')} />
  } else if (state === 'loading') {
    body = <QxMeLoadingBlock title="正在加载我的简历" />
  } else if (state === 'error') {
    body = <QxMeErrorBlock title="简历记录这次没有加载出来" desc="当前列表没有更新。请检查网络后重试；已保存的简历不会因为这次失败而消失。" struct={struct} />
  } else if (items.length === 0) {
    body = (
      <>
        <QxMeSummary
          icon={<FileTextIcon size={32} />}
          label="简历记录"
          big={total}
          desc="仅展示本人简历服务元数据，不展示原文或诊断正文"
          minis={[`诊断 ${parseCount}`, `生成 ${generateCount}`, `完成 ${completedCount}`]}
        />
        <QxMeBannerEmpty />
        <section className="qx-me-list qx-me-grow" aria-label="从这里开始">
          <QxMeStartRow icon={UploadIcon} title="上传一份现有简历" desc="上传后可以做诊断、优化，并生成可打印的版本" label="去上传" route="/resume/source" testid="member-records-start-upload" onClick={() => navigate('/resume/source')} />
          <QxMeStartRow icon={ScanLineIcon} tone="slate" title="扫描纸质简历" desc="把纸质简历扫成 PDF，再走同一条诊断流程" label="去扫描" route="/scan/start" testid="member-records-start-scan" onClick={() => navigate('/scan/start')} />
          <QxMeStartRow icon={SparklesIcon} tone="plum" title="让 AI 生成一份新简历" desc="按引导逐段生成，可直接打印" label="去生成" route="/resume/generate" testid="member-records-start-generate" onClick={() => navigate('/resume/generate')} />
          <div className="qx-me-legal">公共一体机上的游客上传不会自动绑定到账号；登录后上传、诊断或生成的简历会显示在这里。<b>空就是空</b>，本页不会造几条记录让页面好看。</div>
        </section>
        <QxMeGuide items={[['怎么产生', '登录后上传或生成', '游客上传不会自动绑定到账号'], ['这里显示什么', '只有元数据', '不展示简历原文或诊断正文'], ['留存', '原始简历短留存', '到期后无法恢复']]} />
      </>
    )
  } else {
    body = (
      <>
        <QxMeSummary
          icon={<FileTextIcon size={32} />}
          label="简历记录"
          big={total}
          desc="仅展示本人简历服务元数据，不展示原文或诊断正文"
          minis={[`诊断 ${parseCount}`, `生成 ${generateCount}`, `完成 ${completedCount}`]}
        />
        <section className="qx-me-list qx-me-grow" data-testid="member-records-list" aria-label="我的简历">
          {items.map((item) => {
            const status = STATUS_META[item.status] ?? { label: '未知状态', tone: 'run' as const }
            const actionable = isActionable(item)
            const disabledReason = item.status === 'failed' ? '任务已失败，不可继续操作' : '任务完成后可用'
            const isParse = item.kind === 'parse'
            const taskLabel = shortTaskId(item.taskId)
            return (
              <div key={item.id} className="qx-me-row" data-flag={item.status === 'failed' ? 'true' : undefined} data-record-status={item.status} data-record-kind={item.kind}>
                <span className="qx-me-row-ico" data-tone={isParse ? undefined : 'plum'} aria-hidden="true">
                  {isParse ? <FileCheckIcon size={28} /> : <SparklesIcon size={28} />}
                </span>
                <span className="qx-me-row-main">
                  <span className="qx-me-row-head">
                    <span className="qx-me-row-title">{isParse ? '上传诊断简历' : 'AI 生成简历'}</span>
                    <span className="qx-me-st" data-tone={status.tone}>{status.label}</span>
                    {isParse ? <span className="qx-me-chip">{item.optimized ? '已生成优化版' : '未优化'}</span> : null}
                  </span>
                  <span className="qx-me-row-sub">{isParse ? '上传简历后生成的诊断记录' : 'AI 引导生成的简历版本'}</span>
                  <span className="qx-me-row-sub">{metaLine(item)}</span>
                  {!actionable ? <span className="qx-me-reason">{isParse ? '报告与优化：' : ''}{disabledReason}</span> : null}
                </span>
                <span className="qx-me-acts">
                  {isParse ? (
                    <>
                      <SmallAct label="查看报告" disabled={!actionable} reason={disabledReason} aria={`查看简历任务 ${taskLabel} 的诊断报告`} onClick={() => openReport(item.taskId)} primary />
                      <SmallAct label={item.optimized ? '查看优化版' : '继续优化'} disabled={!actionable} reason={disabledReason} aria={`${item.optimized ? '查看' : '继续生成'}简历任务 ${taskLabel} 的优化版`} onClick={() => openOptimize(item.taskId)} />
                      <SmallAct label="岗位匹配" disabled={false} reason="" aria={`去岗位匹配，在那里选择目标岗位`} onClick={openJobFit} />
                    </>
                  ) : (
                    <SmallAct label="查看并打印" disabled={!actionable} reason={disabledReason} aria={`查看并打印 AI 生成简历任务 ${taskLabel}`} onClick={() => openGenerate(item.taskId)} primary />
                  )}
                </span>
              </div>
            )
          })}
          <div className="qx-me-legal">
            仅展示本人简历元数据；原始简历短留存，到期后无法恢复，<b>不向企业提供或投递</b>。
            <b>「岗位匹配」不依赖这条诊断结果</b>：点进去是重新挑一次目标岗位，任务失败的那行也能用。
            {total > items.length ? `当前显示最近 ${items.length} / ${total} 条` : ''}
          </div>
        </section>
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
      eyebrow="MY RESUMES"
      ask={<>你的简历，<em>都在这里</em>。</>}
      doing={<>只显示<b>本人简历服务记录</b>，不展示简历原文或诊断正文。</>}
      truth="只展示本人简历元数据；原始简历短留存，到期后无法恢复，不向企业提供或投递。"
      ctabar={ctabar}
    >
      {body}
    </QxMePage>
  )
}

function QxMeBannerEmpty() {
  return (
    <section className="qx-me-banner" data-testid="qx-me-fallback" data-kind="empty">
      <span className="qx-me-banner-ico" aria-hidden="true"><FileTextIcon size={34} /></span>
      <span className="qx-me-banner-main">
        <h2 className="qx-me-banner-t">还没有登录后保存的简历</h2>
        <span className="qx-me-banner-p">公共一体机上的游客上传不会自动绑定到账号；登录后上传、诊断或生成的简历才会出现在这里。<b>空就是空</b>，本页不会造几条记录让页面好看。</span>
      </span>
      <span className="qx-me-banner-mini"><i>共 0</i></span>
    </section>
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
    <button
      type="button"
      className="qx-me-small"
      data-variant={primary ? 'primary' : undefined}
      aria-disabled={disabled || undefined}
      onClick={disabled ? (event) => event.preventDefault() : onClick}
      aria-label={disabled ? `${aria}（${reason}）` : aria}
    >
      {label}
    </button>
  )
}

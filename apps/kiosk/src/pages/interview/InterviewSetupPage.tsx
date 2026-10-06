// ============================================================
// 模拟面试 — 场景设置（2C）。
//
// 触控优先：纵向编排岗位行业、面试官难度与其他配置，底部固定主操作。
// 合规：仅供本人练习参考，不代表任何招聘结果承诺。
// ============================================================

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { isTerminalKiosk, useTerminalKiosk } from '../../services/api/screensaver'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { useNavigate } from 'react-router-dom'
import { QxAiHelp } from '../../components/qingxu/QxAiHelp'
import { KioskFilterPickerModal } from '../../components/KioskFilterPickerModal'
import { Button } from '@ai-job-print/ui'
import {
  EMPLOYMENT_INDUSTRY_SECTORS,
  type InterviewDifficulty,
  type InterviewDuration,
  type InterviewExperience,
  type InterviewerType,
} from '@ai-job-print/shared'
import {
  FileTextIcon,
  Loader2Icon,
  MonitorSmartphoneIcon,
  NotebookPenIcon,
  QrCodeIcon,
  UsbIcon,
  XIcon,
} from 'lucide-react'
import {
  AiTaskRegion,
  useAiTask,
  aiErrorMessageOf,
  isAiOutage,
  type AiAvailability,
  type AiTaskFallback,
} from '../../ai'
import { AiDeclarationNote } from '../../ai/AiDeclarationNote'
import { aiDeclarationDeclineMessage } from '../../ai/aiDeclarationErrors'
import { createInterview, getVoiceCapability, printInterviewPracticeSheet, startInterview } from '../../services/api/interview'
import { FileContentPreview } from '../../components/FileContentPreview'
import { kioskUploadFile } from '../../services/api/files'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { UploadSessionQrPanel } from '../upload/components/UploadSessionQrPanel'
import { ResumeUsbImportPanel } from '../resume/components/ResumeUsbImportPanel'
import { InterviewAiDownScreen } from './InterviewAiDownScreen'
import { InterviewShell } from './InterviewShell'
import { InterviewCardHead, InterviewNotice, InterviewRail, InterviewStatus, InterviewSteps } from './interviewQxParts'
import { INTERVIEW_STAGE_COPY, emphasizedTitle, type InterviewStage } from './interviewWorkbenchModel'
import {
  patchInterviewWorkbenchSession,
  readInterviewWorkbenchSession,
  type InterviewInteractionMode,
  type InterviewResumeFile,
} from './interviewWorkbenchSession'
import { useStartPrintHandoff } from '../print/usePrintHandoff'

type ResumeChannel = 'phone' | 'usb' | 'desktop'
import './interview-service-desk.css'
import './styles/interview-workbench-qx.css'
import './styles/interview-qx2.css'

const SETUP_AI_DRAFT = '我想开始一场模拟面试。请先问我的目标岗位，再说明岗位、面试官和时长怎么选。不要替我创建练习。'

const INTERVIEWERS: Array<{ key: InterviewerType; label: string; desc: string }> = [
  { key: 'hr', label: 'HR 面试', desc: '自我介绍 · 求职动机 · 稳定性 · 薪资沟通' },
  { key: 'manager', label: '业务主管', desc: '过往经历 · 岗位理解 · 协作与执行' },
  { key: 'tech', label: '技术面试官', desc: '专业技能 · 项目细节 · 问题解决' },
  { key: 'campus', label: '校招面试官', desc: '校园经历 · 学习能力 · 职业规划' },
  { key: 'final', label: '终面负责人', desc: '价值观 · 长期发展 · 综合判断' },
]

const EXPERIENCES: Array<{ key: InterviewExperience; label: string }> = [
  { key: 'fresh', label: '应届生' },
  { key: 'lt1', label: '1 年以内' },
  { key: 'y1_3', label: '1-3 年' },
  { key: 'y3_5', label: '3-5 年' },
  { key: 'gt5', label: '5 年以上' },
  { key: 'switch', label: '转行求职' },
]

const DIFFICULTIES: Array<{ key: InterviewDifficulty; label: string; desc: string }> = [
  { key: 'easy', label: '轻松练习', desc: '适合第一次练习，问题更基础' },
  { key: 'standard', label: '标准面试', desc: '接近真实面试节奏' },
  { key: 'pressure', label: '压力面试', desc: '更多追问与细节验证' },
]

const DURATIONS: Array<{ key: InterviewDuration; label: string; desc: string }> = [
  { key: 3, label: '3 分钟', desc: '快速练习 · 约 3-4 题' },
  { key: 5, label: '5 分钟', desc: '标准练习 · 约 4-6 题' },
  { key: 8, label: '8 分钟', desc: '深度练习 · 约 6-8 题' },
]

const POSITION_EXAMPLES = ['前端开发工程师', '行政专员', '市场运营', '机械工程师', '会计', '销售代表']

const PREVIEWABLE_EXT = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'doc', 'docx'])

function resumePreviewable(file: InterviewResumeFile): boolean {
  const ext = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  const format = (file.format ?? '').replace(/^\./, '').toLowerCase()
  const mime = (file.mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  if (PREVIEWABLE_EXT.has(ext) || PREVIEWABLE_EXT.has(format)) return true
  if (mime === 'application/pdf' || mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp') return true
  if (mime === 'application/msword' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return true
  return false
}

function OptionButton({
  active,
  onClick,
  children,
  className = '',
  disabled = false,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  className?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => { if (!disabled) onClick() }}
      aria-pressed={disabled ? false : active}
      aria-disabled={disabled || undefined}
      className={[
        'interview-option min-h-[52px] rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors',
        active ? 'border-primary-500 bg-primary-50 text-primary-700 shadow-sm' : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  )
}

export function InterviewSetupPage({ onGoStage }: { onGoStage?: (stage: InterviewStage) => void } = {}) {
  const navigate = useNavigate()
  const startPrint = useStartPrintHandoff()
  const { getToken } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const kiosk = useTerminalKiosk()
  const setupDraft = readInterviewWorkbenchSession()?.setup

  const [interviewerType, setInterviewerType] = useState<InterviewerType>(setupDraft?.interviewerType ?? 'hr')
  const [industry, setIndustry] = useState(setupDraft?.industry ?? '')
  const [showIndustryPicker, setShowIndustryPicker] = useState(false)
  const [position, setPosition] = useState(setupDraft?.position ?? '')
  const [experience, setExperience] = useState<InterviewExperience | ''>(setupDraft?.experience ?? '')
  const [difficulty, setDifficulty] = useState<InterviewDifficulty>(setupDraft?.difficulty ?? 'standard')
  const [duration, setDuration] = useState<InterviewDuration>(setupDraft?.duration ?? 5)
  const [interactionMode, setInteractionMode] = useState<InterviewInteractionMode>(setupDraft?.interactionMode === 'voice' ? 'voice' : 'text')
  const [voiceAsr, setVoiceAsr] = useState<'unknown' | 'on' | 'off'>('unknown')
  const [resumeFile, setResumeFile] = useState<InterviewResumeFile | null>(setupDraft?.resumeFile ?? null)
  const [resumePreviewOpen, setResumePreviewOpen] = useState(false)
  const [resumeChannel, setResumeChannel] = useState<ResumeChannel | null>(null)
  const [uploading, setUploading] = useState(false)
  const [qrBusy, setQrBusy] = useState(false)
  const [usbBusy, setUsbBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * `POST /mock-interviews` 建会话时**不调模型**（写一行配置就返回），
   * 真正调 LLM 的是紧随其后的 `/start`。所以 start 503 之后这个 sessionId 仍然有效 ——
   * 它是通用题目单唯一的落点（题目单端点要凭它做归属校验并取本场配置）。
   */
  const [pendingSession, setPendingSession] = useState<{ sessionId: string; accessToken?: string } | null>(setupDraft?.pendingSession ?? null)
  /** AI 能力级不可用的真实原因；null 表示未观测到不可用。 */
  const [aiOutage, setAiOutage] = useState<string | null>(setupDraft?.aiOutage ?? null)
  /** 停用整屏上「查看练习说明」才回到表单；默认先看整屏，不把降级条挂在表单下面。 */
  const [showSetupForm, setShowSetupForm] = useState(false)
  /** 已完成过一次真实往返 —— 没探到之前一律 fail-closed（aiOutage.ts 口径）。 */
  const [probed, setProbed] = useState(setupDraft?.probed ?? false)
  /** 通用题目单生成中（不经过模型，只是服务端排版 + 上传）。 */
  const [printingSheet, setPrintingSheet] = useState(false)
  /**
   * 「进面试间」这一步真的失败过。
   *
   * 不能直接用 `error` 判：本页的 `error` 也承载「请先填写目标岗位」这类**表单校验**提示，
   * 拿它去点亮 ai-down 降级区，等于把用户少填一个字说成 AI 挂了 —— 那是另一种伪造。
   */
  const [startFailed, setStartFailed] = useState(setupDraft?.startFailed ?? false)

  useBusyLock(creating || uploading || printingSheet || qrBusy || usbBusy)

  useEffect(() => {
    let cancelled = false
    getVoiceCapability()
      .then((cap) => {
        if (cancelled) return
        if (cap.asrEnabled === true) {
          setVoiceAsr('on')
          return
        }
        if (cap.asrEnabled === false) {
          setVoiceAsr('off')
          setInteractionMode('text')
          return
        }
        setVoiceAsr('unknown')
      })
      .catch(() => { if (!cancelled) setVoiceAsr('unknown') })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    patchInterviewWorkbenchSession({
      setup: {
        directionSelectionVersion: 1,
        interviewerType,
        industry,
        position,
        experience,
        difficulty,
        duration,
        interactionMode,
        resumeFile,
        pendingSession,
        aiOutage,
        startFailed,
        probed,
      },
    })
  }, [interviewerType, industry, position, experience, difficulty, duration, interactionMode, resumeFile, pendingSession, aiOutage, startFailed, probed])

  const handleFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    if (isTerminalKiosk()) return
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const uploaded = await kioskUploadFile(file, 'resume_upload', getToken())
      setResumePreviewOpen(false)
      setResumeFile({
        fileId: uploaded.fileId,
        name: uploaded.filename,
        mimeType: uploaded.mimeType,
        fileUrl: uploaded.signedUrl,
      })
    } catch (err) {
      setError(userMessageOf(err, '简历上传失败，请重试'))
    } finally {
      setUploading(false)
    }
  }

  const handleStart = async () => {
    const pos = position.trim()
    if (!pos) {
      setError('请先填写目标岗位，例如：前端开发工程师、行政专员')
      return
    }
    if (!industry.trim()) {
      setError('请先选择本次练习的行业，不会替你预选')
      return
    }
    if (!experience) {
      setError('请先选择你的经验情况，不会替你预选')
      return
    }
    setCreating(true)
    setError(null)
    setAiOutage(null)
    setStartFailed(false)
    // 门禁会把 handleStart 单独抽出去跑，那时没有这个 setter。组件里有，就开始前收回整屏说明。
    if (typeof setShowSetupForm === 'function') setShowSetupForm(false)
    try {
      const mode: 'text' | 'voice' = interactionMode === 'voice' ? 'voice' : 'text'
      const input = {
        interviewerType,
        industry,
        position: pos,
        experience,
        difficulty,
        durationMin: duration,
        interactionMode: mode,
        ...(resumeFile ? { resumeFileId: resumeFile.fileId } : {}),
      }
      const token = getToken()
      const created = await createInterview(input, { token })
      // 先记下来再 start：start 一旦 503，这个 sessionId 就是通用题目单的落点。
      setPendingSession({ sessionId: created.sessionId, accessToken: created.accessToken })
      const first = await startInterview(created.sessionId, { token, accessToken: created.accessToken })
      setProbed(true)
      patchInterviewWorkbenchSession({
        stage: 'session',
        live: {
          sessionId: created.sessionId,
          accessToken: created.accessToken,
          questionTarget: created.questionTarget,
          durationMin: duration,
          interviewerType,
          position: pos,
          firstQuestion: first.question ?? '',
          messages: [{ role: 'interviewer', content: first.question ?? '' }],
          questionIndex: 1,
          remainingSec: duration * 60,
          omitPrintAnswers: false,
          interactionMode: mode,
        },
      })
      if (onGoStage) {
        onGoStage('session')
      } else {
        navigate('/interview/session', {
          replace: true,
          state: {
            sessionId: created.sessionId,
            accessToken: created.accessToken,
            questionTarget: created.questionTarget,
            durationMin: duration,
            interviewerType,
            position: pos,
            firstQuestion: first.question ?? '',
            // 不传 firstQType：会话页读的是 firstQuestion / questionTarget 等键，
            // 从未读过 qType。类型里声明过不等于有人消费。
          },
        })
      }
    } catch (err) {
      const declined = aiDeclarationDeclineMessage(err)
      if (declined) {
        setError(declined)
        return
      }
      const message = aiErrorMessageOf(err, '创建练习失败，请稍后重试')
      setError(message)
      setStartFailed(true)
      // 只有能力级故障才判成「AI 不可用」；限流 / 参数错误只是本次失败，保留重试入口。
      if (isAiOutage(err)) setAiOutage(message)
      else setProbed(true)
    } finally {
      setCreating(false)
    }
  }

  /**
   * 通用题目与答案单：AI 挂掉时唯一不经过模型的出纸路径。
   *
   * 为什么不是「重试 start」：`/start` 第一步就调 LLM 出题
   * （`mock-interview.service.ts` 的 `start` → `llm.nextQuestion`），模型不可用时
   * 会话永远停在 configured，既没有 turn 也没有报告 —— `/report/print` 只会 404。
   *
   * 口径来源：docs/design/kiosk-ai-os-v3-2026-08/20-interview-pod.html 的 ai-down 支线
   * （:497「AI 不可用 · 只能用通用题库」/ :1137「生成题目与答案单」/ :1894「本单不含点评」）。
   */
  const handlePracticeSheet = async () => {
    if (!pendingSession || printingSheet) return
    setPrintingSheet(true)
    setError(null)
    try {
      const file = await printInterviewPracticeSheet(pendingSession.sessionId, {
        token: getToken(),
        accessToken: pendingSession.accessToken,
      })
      if (!file.printFileUrl) throw new Error('打印链接未就绪，请稍后重试')
      startPrint({
        origin: 'interview_practice',
        returnPath: window.location.pathname,
        file: {
          name: file.filename,
          size: file.sizeBytes >= 1024 * 1024
            ? `${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB`
            : `${Math.max(1, Math.round(file.sizeBytes / 1024))} KB`,
          pages: file.pageCount,
          fileId: file.fileId,
          fileUrl: file.printFileUrl,
          mimeType: 'application/pdf',
        },
      })
    } catch (err) {
      setError(aiErrorMessageOf(err, '题目单生成失败，请稍后重试'))
    } finally {
      setPrintingSheet(false)
    }
  }

  /**
   * 降级处置用 `blocked`：AI 面试官是这条能力的唯一产出源，页面上有明确的入口按钮。
   * 刻意**不用** `manual` —— 通用题目单不是模拟面试的等价替代（没有追问、没有点评），
   * 套 manual 等于宣称有一条等价手动路径，那是伪造能力（CLAUDE.md §9）。
   * 它作为 `stillAvailable` 如实写明，并挂成真正可点的动作。
   */
  const availability: AiAvailability = aiOutage ? 'unavailable' : probed ? 'available' : 'unknown'
  const aiTask = useAiTask({
    availability,
    pending: creating,
    failed: startFailed || Boolean(aiOutage),
    hasResult: false,
  })
  const STILL_AVAILABLE = pendingSession
    ? '题目本身不依赖 AI：本机有一份通用题库，可以按你选的面试官身份印一张「题目与答案单」带走，用笔作答。'
      + '这张单子不含任何点评、评分或通过率 —— 点评依赖 AI，本次没有，也不会拿通用建议冒充。'
    : '这次还没建立起这场练习，因此印不出按本场配置取题的题目单。面试准备要点是本机固定内容，不依赖 AI，现在照常可看。'
  const sheetAction = pendingSession
    ? {
        action: {
          label: printingSheet ? '正在生成题目单…' : '打印通用题目与答案单',
          onClick: () => void handlePracticeSheet(),
        },
      }
    : {}
  const fallback: AiTaskFallback = aiOutage
    ? {
        // 能力级不可用：底部「开始模拟面试」这次按了也没用，置灰它并写清原因。
        mode: 'blocked',
        reason: aiOutage,
        blockedActionLabel: '创建并开始练习（AI 面试官）',
        stillAvailable: STILL_AVAILABLE,
        ...sheetAction,
      }
    : {
        // 这一次失败但服务是通的（限流 / 参数等）：**不是**能力不可用。
        // 用 blocked 会和底部仍可点的「开始模拟面试」自相矛盾。
        mode: 'result-unavailable',
        reason: (startFailed ? error : null) ?? '本次没能进入 AI 面试间。',
        retryHint: `这不是你的操作问题，AI 服务本身是通的。可以直接再点一次「创建并开始练习」；不想等的话，${STILL_AVAILABLE}`,
        ...sheetAction,
      }

  const copy = INTERVIEW_STAGE_COPY.setup
  const titleParts = emphasizedTitle(copy)
  const goTips = () => (onGoStage ? onGoStage('tips') : navigate('/interview/tips'))
  const interviewerDesc = INTERVIEWERS.find((it) => it.key === interviewerType)?.desc
  const voiceDownReason = voiceAsr === 'off'
    ? '语音识别没有开启，这一场先用文字。AI 面试官暂时不能出题，语音回合先不开放。'
    : 'AI 面试官暂时不能出题，语音回合先不开放。'

  if (aiOutage && !showSetupForm) {
    return (
      <InterviewAiDownScreen
        voiceReason={voiceDownReason}
        error={error}
        onOpenTips={goTips}
        onHome={() => navigate('/')}
        onReviewSetup={() => setShowSetupForm(true)}
        fallback={(
          <AiTaskRegion
            className="interview-setup-fallback"
            task={aiTask}
            label="AI 面试官出题与点评"
            fallback={fallback}
          />
        )}
      />
    )
  }

  return (
    <InterviewShell
      title={<>{titleParts.before}<em>{titleParts.em}</em>{titleParts.after}</>}
      subtitle={copy.subtitle}
      status={{ tone: aiOutage ? 'bad' : 'ok', label: aiOutage ? 'AI 暂时不能出题' : 'AI 模拟面试' }}
      ctabar={
        <div className="interview-qx-cta">
          <QxAiHelp label="问小青：这场练习怎么设" draft={SETUP_AI_DRAFT} />
          {error && <p className="iv-alert" role="alert" data-testid="interview-setup-error">{error}</p>}
          <div className="iv-setup-declaration">
            <AiDeclarationNote />
          </div>
          <div className="iv-cta-row iv-setup-cta">
            <button type="button" className="qx-btn" data-variant="ghost" onClick={goTips}>
              先看面试技巧
            </button>
            <button
              type="button"
              className="qx-btn"
              data-variant="primary"
              data-testid="interview-primary"
              disabled={creating || uploading}
              onClick={() => void handleStart()}
            >
              {creating ? '正在为你准备面试官…' : <>创建并开始练习<em>→</em></>}
            </button>
          </div>
        </div>
      }
    >
    <KioskFilterPickerModal
      open={showIndustryPicker}
      title="选择面试行业"
      description="从就业行业清单里选一个，用来调整这套练习题的方向。"
      sections={[{
        id: 'industry',
        label: '行业门类',
        value: industry,
        allLabel: '尚未选择',
        allowEmpty: false,
        options: EMPLOYMENT_INDUSTRY_SECTORS.map((item) => ({ value: item.label, label: item.label })),
      }]}
      onChange={(_, value) => setIndustry(value)}
      onClear={() => setIndustry('')}
      onClose={() => setShowIndustryPicker(false)}
    />
    <div data-kiosk-domain="interview" data-kiosk-screen="interview-setup" data-qx-interview="" data-interview-state={resumePreviewOpen && resumeFile ? 'setup-resume-preview' : 'setup'} className="interview-flow interview-setup" data-visual-theme="service-desk" data-ux-density="touch">
      <div className="interview-flow__scroll">
        <InterviewStatus
          label="本场练习条件"
          items={[
            { k: '文字回答', v: '可用', tone: 'ok' },
            { k: '语音回答', v: '进入后检测' },
            { k: '练习报告', v: '完成后生成' },
          ]}
        />

        <section className="iv-card interview-setup__stack">
          <InterviewCardHead title="本场练习设置" hint="请本人填写目标岗位、选择行业和经验后再开始" />
          <div className="iv-fields">
            <label className="iv-field">
              <small>目标岗位（必填，最多 50 字）</small>
              <input
                value={position}
                onChange={(e) => {
                  setPosition(e.target.value)
                  if (error?.includes('目标岗位')) setError(null)
                }}
                maxLength={50}
                placeholder="输入目标岗位，例：前端开发工程师"
              />
            </label>
            <div className="iv-field">
              <small>行业（必填，从就业行业清单选择）</small>
              <b>{industry || '尚未选择'}</b>
              <button type="button" className="iv-mini-btn" aria-haspopup="dialog" onClick={() => setShowIndustryPicker(true)}>
                选择行业 ({EMPLOYMENT_INDUSTRY_SECTORS.length})
              </button>
            </div>
          </div>
          <div className="iv-choice">
            <p>岗位快捷项</p>
            <div className="iv-chips">
              {POSITION_EXAMPLES.map((example) => (
                <OptionButton key={example} active={position === example} onClick={() => { setPosition(example); setError(null) }}>{example}</OptionButton>
              ))}
            </div>
          </div>
          <div className="iv-choice interview-setup__interviewer">
            <p>面试官类型</p>
            <div className="iv-chips">
              {INTERVIEWERS.map((it) => (
                <OptionButton key={it.key} active={interviewerType === it.key} onClick={() => setInterviewerType(it.key)}>{it.label}</OptionButton>
              ))}
            </div>
            <p className="iv-hint">{interviewerDesc}</p>
          </div>
          <div className="iv-choice">
            <p>经验（必选）</p>
            <div className="iv-chips">
              {EXPERIENCES.map((item) => (
                <OptionButton key={item.key} active={experience === item.key} onClick={() => setExperience(experience === item.key ? '' : item.key)}>{item.label}</OptionButton>
              ))}
            </div>
            {!experience && <p className="iv-hint">尚未选择，请按自己的实际情况选择。</p>}
          </div>
          <div className="iv-choice-row">
            <div className="iv-choice">
              <p>难度</p>
              <div className="iv-chips">
                {DIFFICULTIES.map((item) => (
                  <OptionButton key={item.key} active={difficulty === item.key} onClick={() => setDifficulty(item.key)}>{item.label}</OptionButton>
                ))}
              </div>
            </div>
            <div className="iv-choice">
              <p>时长</p>
              <div className="iv-chips">
                {DURATIONS.map((item) => (
                  <OptionButton key={item.key} active={duration === item.key} onClick={() => setDuration(item.key)}>{item.label}</OptionButton>
                ))}
              </div>
            </div>
          </div>
          <div className="iv-choice" data-testid="interview-interaction-mode">
            <p>交互方式</p>
            <div className="iv-chips">
              <OptionButton active={interactionMode === 'text'} onClick={() => setInteractionMode('text')}>纯文字</OptionButton>
              <OptionButton
                active={interactionMode === 'voice'}
                disabled={voiceAsr === 'off'}
                onClick={() => setInteractionMode('voice')}
              >
                语音回合（文字兜底）
              </OptionButton>
            </div>
            {voiceAsr === 'off' && (
              <p className="iv-hint" role="status" data-testid="interview-mode-voice-reason">
                语音识别没有开启，这一场先用文字。
              </p>
            )}
          </div>
        </section>

        <section className="iv-card">
          <InterviewCardHead title="简历（可选）" hint={resumeFile ? '已选用 1 份' : '不上传也能开始'} />
          {resumeFile ? (
            <div className="iv-panel">
              <div className="iv-head"><b>{resumeFile.name}</b><span>这场练习会用这份简历出题</span></div>
              <p className="iv-copy">移除后按通用问题练习，不会因此少一道题。</p>
              <button
                type="button"
                className="iv-mini-btn"
                aria-expanded={resumePreviewOpen}
                onClick={() => setResumePreviewOpen((open) => !open)}
              >
                {resumePreviewOpen ? '收起预览' : '预览这份简历'}
              </button>
              {resumePreviewOpen && (
                resumePreviewable(resumeFile) ? (
                  <div className="iv-resume-preview">
                    <FileContentPreview
                      fileUrl={resumeFile.fileUrl}
                      fileName={resumeFile.name}
                      mimeType={resumeFile.mimeType}
                      format={resumeFile.format}
                      fileId={resumeFile.fileId}
                      token={getToken()}
                    />
                  </div>
                ) : (
                  <p className="iv-copy" data-testid="interview-resume-preview-unsupported">这种格式不能在这里预览</p>
                )
              )}
              <button
                type="button"
                onClick={() => { setResumeFile(null); setResumePreviewOpen(false) }}
                aria-label="移除简历"
                className="flex h-12 w-12 items-center justify-center rounded-xl"
              >
                <XIcon className="h-4 w-4" aria-hidden="true" />
                移除，不用简历
              </button>
            </div>
          ) : (
            <>
              <div className="iv-tabs" role="group" aria-label="简历来源">
                {([
                  { key: 'phone' as const, label: '手机扫码上传', hint: '把简历传到这台机器', icon: QrCodeIcon },
                  { key: 'usb' as const, label: 'U 盘导入', hint: '只读取你插入的这只盘', icon: UsbIcon },
                  { key: 'desktop' as const, label: '本机文件', hint: '从这台设备里选一份', icon: MonitorSmartphoneIcon },
                ]).filter((channel) => channel.key !== 'desktop' || !isTerminalKiosk()).map((channel) => (
                  <button
                    key={channel.key}
                    type="button"
                    aria-pressed={resumeChannel === channel.key}
                    onClick={() => setResumeChannel(resumeChannel === channel.key ? null : channel.key)}
                  >
                    <channel.icon className="h-4 w-4" aria-hidden="true" />
                    <b>{channel.label}</b>
                    <small>{channel.hint}</small>
                  </button>
                ))}
              </div>
              <div className="iv-panel">
                {resumeChannel === 'phone' ? (
                  <UploadSessionQrPanel
                    purpose="resume_upload"
                    title="手机扫码上传简历"
                    description="手机只负责上传；这台机器确认后才会带进本次练习。不上传也可以开始。"
                    confirmLabel="确认使用这份简历"
                    onUploaded={(file) => {
                      setResumePreviewOpen(false)
                      setResumeFile({
                        fileId: file.fileId,
                        name: file.name,
                        mimeType: file.mimeType,
                        fileUrl: file.fileUrl,
                        format: file.format,
                      })
                    }}
                    onBusyChange={setQrBusy}
                  />
                ) : resumeChannel === 'usb' ? (
                  <ResumeUsbImportPanel
                    onUploaded={(file) => {
                      setResumePreviewOpen(false)
                      setResumeFile({
                        fileId: file.fileId,
                        name: file.name,
                        mimeType: file.mimeType,
                        fileUrl: file.fileUrl,
                        format: file.format,
                      })
                    }}
                    onBusyChange={setUsbBusy}
                  />
                ) : resumeChannel === 'desktop' && !kiosk ? (
                  <Button variant="secondary" className="min-h-[56px] w-full text-base" disabled={uploading} onClick={() => { if (!isTerminalKiosk()) fileInputRef.current?.click() }}>
                    {uploading ? <Loader2Icon className="mr-2 h-4 w-4 animate-spin" /> : <FileTextIcon className="mr-2 h-4 w-4" aria-hidden="true" />}
                    选择本设备上的文件
                  </Button>
                ) : uploading ? (
                  <p className="iv-copy">正在上传。完成前不把这份文件算进本场练习。</p>
                ) : (
                  <p className="iv-copy">选一条来源，本机才会去取文件。没有简历时按通用问题练习，不会因此少一道题。</p>
                )}
              </div>
            </>
          )}
          {!kiosk && (
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={handleFileChosen}
            />
          )}
        </section>

        <section className="iv-card">
          <InterviewCardHead title="练习会经历三步" hint="按实际状态推进" />
          <InterviewSteps rows={[
            ['第 1 步', '创建配置', '记录岗位、难度和时长，不等于已经生成题目。'],
            ['第 2 步', '逐题作答', '文字始终可以作答；语音要转写后由你确认。'],
            ['第 3 步', '生成练习报告', '报告只在这场练习真正完成后生成。'],
          ]} />
        </section>

        <InterviewNotice>
          <b>模拟面试不是企业面试。</b>不代表任何招聘结果承诺，不会发出面试邀请，也不用于候选人筛选或录用判断。
        </InterviewNotice>

        <AiTaskRegion
          className="interview-setup-fallback"
          task={aiTask}
          label="AI 面试官出题与点评"
          fallback={fallback}
        />

        {aiTask.isFailed && (
          <Button
            variant="secondary"
            className="min-h-[56px] w-full text-base"
            onClick={() => onGoStage ? onGoStage('tips') : navigate('/interview/tips')}
          >
            <NotebookPenIcon className="mr-2 h-5 w-5" aria-hidden="true" />
            查看面试准备要点（本机固定内容，不依赖 AI）
          </Button>
        )}
        <InterviewRail />
      </div>
    </div>
    </InterviewShell>
  )
}

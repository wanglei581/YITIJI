// ============================================================
// 模拟面试 — 场景设置（2C）。
//
// 触控优先：纵向编排岗位行业、面试官难度与其他配置，底部固定主操作。
// 合规：仅供本人练习参考，不代表任何招聘结果承诺。
// ============================================================

import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react'
import { isTerminalKiosk, useTerminalKiosk } from '../../services/api/screensaver'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { useNavigate } from 'react-router-dom'
import { KioskFilterPickerModal } from '../../components/KioskFilterPickerModal'
import { QxTouchDock } from '../../components/qingxu/touch/QxTouchDock'
import { useSupportContact } from '../../hooks/useSupportContact'
import {
  EMPLOYMENT_INDUSTRY_SECTORS,
  type CreateInterviewInput,
  type InterviewDifficulty,
  type InterviewDuration,
  type InterviewExperience,
  type InterviewerType,
} from '@ai-job-print/shared'
import { InterviewSetupPersonas, InterviewSetupResume } from './InterviewSetupExtras'
import { interviewUserLine } from './interviewMicCopy'
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
import { createInterview, printInterviewPracticeSheet, startInterview } from '../../services/api/interview'
import { kioskUploadFile } from '../../services/api/files'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { InterviewShell } from './InterviewShell'
import { InterviewNote, InterviewStatus } from './interviewQxParts'
import { scrollInterviewToTop } from './interviewScroll'
import type { InterviewStage } from './interviewWorkbenchModel'
import {
  patchInterviewWorkbenchSession,
  readInterviewWorkbenchSession,
} from './interviewWorkbenchSession'
import { useStartPrintHandoff } from '../print/usePrintHandoff'

type ResumeChannel = 'phone' | 'usb' | 'desktop'
import './interview-service-desk.css'
import './styles/interview-workbench-qx.css'
import './styles/interview-qx2.css'
import './styles/interview-touch-setup.css'

const SETUP_AI_DRAFT = '我想开始一场模拟面试。请先问我的目标岗位，再说明岗位、面试官和时长怎么选。不要替我创建练习。'

const INTERVIEWERS: Array<{ key: InterviewerType; label: string; desc: string; mark: string }> = [
  { key: 'hr', label: 'HR 面试', desc: '自我介绍 · 求职动机 · 稳定性 · 薪资沟通', mark: 'HR' },
  { key: 'manager', label: '业务主管', desc: '过往经历 · 岗位理解 · 协作与执行', mark: '主' },
  { key: 'tech', label: '技术面试官', desc: '专业技能 · 项目细节 · 问题解决', mark: '技' },
  { key: 'campus', label: '校招面试官', desc: '校园经历 · 学习能力 · 职业规划', mark: '校' },
  { key: 'final', label: '终面负责人', desc: '价值观 · 长期发展 · 综合判断', mark: '终' },
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
  { key: 3, label: '3 分钟 / 4 题', desc: '到点不自动交卷，回答完当前题后再结束' },
  { key: 5, label: '5 分钟 / 6 题', desc: '到点不自动交卷，回答完当前题后再结束' },
  { key: 8, label: '8 分钟 / 8 题', desc: '到点不自动交卷，回答完当前题后再结束' },
]

const POSITION_EXAMPLES = ['前端开发工程师', '行政专员', '市场运营', '机械工程师', '会计', '销售代表']

export function InterviewSetupPage({ onGoStage }: { onGoStage?: (stage: InterviewStage) => void } = {}) {
  const navigate = useNavigate()
  const startPrint = useStartPrintHandoff()
  const { getToken } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const kiosk = useTerminalKiosk()
  const contact = useSupportContact()
  const setupDraft = readInterviewWorkbenchSession()?.setup

  const [interviewerType, setInterviewerType] = useState<InterviewerType>(setupDraft?.interviewerType ?? 'hr')
  const [industry, setIndustry] = useState(setupDraft?.industry ?? '')
  const [showIndustryPicker, setShowIndustryPicker] = useState(false)
  const [position, setPosition] = useState(setupDraft?.position ?? '')
  const [experience, setExperience] = useState<InterviewExperience | ''>(setupDraft?.experience ?? '')
  const [difficulty, setDifficulty] = useState<InterviewDifficulty>(setupDraft?.difficulty ?? 'standard')
  const [duration, setDuration] = useState<InterviewDuration>(setupDraft?.duration ?? 5)
  const [resumeFile, setResumeFile] = useState<{ fileId: string; name: string } | null>(setupDraft?.resumeFile ?? null)
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
  const [step, setStep] = useState<1 | 2 | 3>(1)

  useBusyLock(creating || uploading || printingSheet || qrBusy || usbBusy)

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
        resumeFile,
        pendingSession,
        aiOutage,
        startFailed,
        probed,
      },
    })
  }, [interviewerType, industry, position, experience, difficulty, duration, resumeFile, pendingSession, aiOutage, startFailed, probed])

  const handleFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    if (isTerminalKiosk()) return
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const uploaded = await kioskUploadFile(file, 'resume_upload', getToken())
      setResumeFile({ fileId: uploaded.fileId, name: uploaded.filename })
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
    try {
      const input: CreateInterviewInput = {
        interviewerType,
        industry,
        position: pos,
        experience,
        difficulty,
        durationMin: duration,
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
  const say = (text: string | null) => interviewUserLine(text, contact) ?? text
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
        reason: say(aiOutage) ?? aiOutage,
        blockedActionLabel: '创建并开始练习（AI 面试官）',
        stillAvailable: STILL_AVAILABLE,
        ...sheetAction,
      }
    : {
        // 这一次失败但服务是通的（限流 / 参数等）：**不是**能力不可用。
        // 用 blocked 会和底部仍可点的「开始模拟面试」自相矛盾。
        mode: 'result-unavailable',
        reason: say((startFailed ? error : null) ?? '本次没能进入 AI 面试间。') ?? '本次没能进入 AI 面试间。',
        retryHint: `这不是你的操作问题，AI 服务本身是通的。可以直接再点一次「创建并开始练习」；不想等的话，${STILL_AVAILABLE}`,
        ...sheetAction,
      }

  const goTips = () => (onGoStage ? onGoStage('tips') : navigate('/interview/tips'))
  const shownError = interviewUserLine(error, contact)
  // 换步后点下去的按钮被卸载，焦点会掉回 body。把焦点放到意图带的标题上，并回到顶。第一次进来不抢焦点。
  const seenStep = useRef<number | null>(null)
  useLayoutEffect(() => {
    const changed = seenStep.current !== null && seenStep.current !== step
    seenStep.current = step
    if (!changed) return
    const heading = document.querySelector<HTMLElement>('.qxt-band h1')
    if (heading) {
      heading.tabIndex = -1
      heading.focus({ preventScroll: true })
    }
    scrollInterviewToTop()
  }, [step])
  const interviewer = INTERVIEWERS.find((it) => it.key === interviewerType)
  const difficultyItem = DIFFICULTIES.find((item) => item.key === difficulty)
  const durationItem = DURATIONS.find((item) => item.key === duration)
  const validateBasics = (): string | null => {
    if (!position.trim()) return '请先填写目标岗位，例如：前端开发工程师、行政专员'
    if (!industry.trim()) return '请先选择本次练习的行业，不会替你预选'
    if (!experience) return '请先选择你的经验情况，不会替你预选'
    return null
  }
  const goNext = () => {
    if (step === 1) {
      const message = validateBasics()
      if (message) {
        setError(message)
        return
      }
    }
    setError(null)
    setStep((current) => (current === 1 ? 2 : 3))
  }
  const defaults = interviewerType === 'hr' && difficulty === 'standard' && duration === 5
  const echo = defaults
    ? `默认已填：${interviewer?.label}、${difficultyItem?.label}、${durationItem?.label}、文字回答。`
    : `已选：${interviewer?.label}、${difficultyItem?.label}、${durationItem?.label}、文字回答。`
  const stepCopy = step === 1
    ? { eyebrow: '练面试 · 岗位与经验', title: '这次练哪个岗位？', sub: '选定岗位、面试官和时长后才开始这场练习；语音能否使用，进入后按麦克风实际情况确认。' }
    : step === 2
      ? { eyebrow: '练面试 · 面试官与时长', title: '选一位面试官', sub: '难度和时长有默认值。到点不自动交卷。' }
      : { eyebrow: '练面试 · 核对开始', title: '核对一下，就开始', sub: '面试前，先设置一场练习。' }

  return (
    <InterviewShell
      eyebrow={stepCopy.eyebrow}
      title={stepCopy.title}
      subtitle={stepCopy.sub}
      onBack={step > 1 ? () => { setError(null); setStep((current) => (current === 3 ? 2 : 1)) } : undefined}
      rail={{ labels: ['岗位与经验', '面试官与时长', '核对开始'], now: step - 1 }}
      status={{ tone: aiOutage ? 'bad' : 'ok', label: aiOutage ? 'AI 暂时不能出题' : 'AI 模拟面试' }}
      ctabar={
        <QxTouchDock
          onBack={step > 1 ? () => { setError(null); setStep((current) => (current === 3 ? 2 : 1)) } : () => navigate('/interview-service')}
          backLabel={step > 1 ? '上一步' : '返回'}
          ask={{ label: '问小青：这场练习怎么设', draft: SETUP_AI_DRAFT }}
          alert={shownError ? <p className="qxt-iv-alert" role="alert" data-testid="interview-setup-error">{shownError}</p> : undefined}
          primary={{
            label: step < 3
              ? '下一步'
              : creating
                ? '正在为你准备面试官…'
                : aiOutage && pendingSession
                  ? '打印通用题目与答案单'
                  : '创建并开始练习',
            testId: step === 3 ? 'interview-primary' : undefined,
            disabled: step === 3 && (creating || uploading || printingSheet),
            onClick: () => {
              if (step < 3) goNext()
              else if (aiOutage && pendingSession) void handlePracticeSheet()
              else void handleStart()
            },
          }}
        />
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
    <div data-kiosk-domain="interview" data-kiosk-screen="interview-setup" data-qx-interview="" data-setup-step={step} className="interview-flow interview-setup" data-visual-theme="service-desk" data-ux-density="touch">
      <div className="interview-flow__scroll">
        {step === 1 && (
          <section className="interview-setup__stack qxt-iv-stack">
            <label className="qxt-iv-field">
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
            <div className="qxt-iv-choices" role="group" aria-label="岗位快捷项">
              {POSITION_EXAMPLES.map((example) => (
                <button key={example} type="button" className="qxt-iv-opt" aria-pressed={position === example} onClick={() => { setPosition(example); setError(null) }}>{example}</button>
              ))}
            </div>
            <div className="iv-field qxt-iv-group">
              <div className="qxt-iv-sec">行业（必填，从就业行业清单选择）</div>
              <button type="button" className="qxt-iv-field" aria-haspopup="dialog" onClick={() => setShowIndustryPicker(true)}>
                <small>选择行业 ({EMPLOYMENT_INDUSTRY_SECTORS.length})</small>
                <b>{industry || '尚未选择'}</b>
              </button>
            </div>
            <div className="iv-choice qxt-iv-group is-grow">
              <div className="qxt-iv-sec">
                你的经验（必选）
                {!experience && <> · <span className="iv-hint">尚未选择，请按自己的实际情况选择。</span></>}
              </div>
              <div className="qxt-iv-choices">
                {EXPERIENCES.map((item) => (
                  <button key={item.key} type="button" className="qxt-iv-opt" aria-pressed={experience === item.key} onClick={() => setExperience(experience === item.key ? '' : item.key)}>{item.label}</button>
                ))}
              </div>
            </div>
            <button type="button" className="qxt-iv-wide" onClick={goTips}>
              <b>先看面试技巧</b>
              <small>公开的准备方法，不依赖这场配置</small>
            </button>
            <InterviewStatus
              label="本场练习条件"
              items={[
                { k: '文字回答', v: '可用', tone: 'ok' },
                { k: '语音回答', v: '进入后检测' },
                { k: '练习报告', v: '完成后生成' },
              ]}
            />
            <InterviewNote lead="后面不改的话">
              <span>{interviewer?.label} · {difficultyItem?.label} · {durationItem?.label} · 文字回答。</span>
              <span>行业和经验都不预选。经验再点一次可以取消。</span>
            </InterviewNote>
          </section>
        )}

        {step === 2 && (
          <section className="interview-setup__stack qxt-iv-stack">
            <div className="interview-setup__interviewer qxt-iv-group is-grow">
              <InterviewSetupPersonas
                interviewers={INTERVIEWERS}
                interviewerType={interviewerType}
                onInterviewer={setInterviewerType}
                difficulties={DIFFICULTIES}
                difficulty={difficulty}
                onDifficulty={setDifficulty}
                durations={DURATIONS}
                duration={duration}
                onDuration={setDuration}
              />
            </div>
            <button type="button" className="qxt-iv-wide" onClick={goTips}>
              <b>先看面试技巧</b>
              <small>公开的准备方法，不依赖这场配置</small>
            </button>
            <InterviewNote lead={echo}>
              <span>这一场：{interviewer?.label}。{interviewer?.desc}</span>
              <span>难度：{difficultyItem?.label}。{difficultyItem?.desc}</span>
              <span>时长：{durationItem?.label}。练习时长到了，只提示你点结束，不自动出报告。</span>
            </InterviewNote>
          </section>
        )}

        {step === 3 && (
          <section className="qxt-iv-stack is-spread">
            <div className="qxt-iv-sum">
              <div className="qxt-iv-sum-r">
                <span>岗位</span>
                <b>{position.trim() || '尚未选择'} · {industry || '尚未选择'} · {EXPERIENCES.find((item) => item.key === experience)?.label || '尚未选择'}</b>
                <button type="button" className="qxt-iv-edit" aria-label="改岗位与经验" onClick={() => setStep(1)}>改</button>
              </div>
              <div className="qxt-iv-sum-r">
                <span>面试官</span>
                <b>{interviewer?.label} · {difficultyItem?.label}</b>
                <button type="button" className="qxt-iv-edit" aria-label="改面试官与难度" onClick={() => setStep(2)}>改</button>
              </div>
              <div className="qxt-iv-sum-r">
                <span>时长</span>
                <b>{durationItem?.label}</b>
                <button type="button" className="qxt-iv-edit" aria-label="改时长" onClick={() => setStep(2)}>改</button>
              </div>
            </div>
            <InterviewStatus
              label="本场练习条件"
              items={[
                { k: '文字回答', v: '可用', tone: 'ok' },
                { k: '语音回答', v: '进入后检测' },
                { k: '练习报告', v: '完成后生成' },
              ]}
            />
            {aiTask.isFailed && (
              <AiTaskRegion
                className="interview-setup-fallback"
                task={aiTask}
                label="AI 面试官出题与点评"
                fallback={fallback}
              />
            )}
            <div className="qxt-iv-group">
              <div className="qxt-iv-sec">简历（可选） · {resumeFile ? '已选用 1 份' : '不上传也能开始'}</div>
              <InterviewSetupResume
                resumeFile={resumeFile}
                onClearResume={() => setResumeFile(null)}
                resumeChannel={resumeChannel}
                onResumeChannel={setResumeChannel}
                kiosk={kiosk}
                uploading={uploading}
                onPickFile={() => { if (!isTerminalKiosk()) fileInputRef.current?.click() }}
                onUploaded={(file) => setResumeFile({ fileId: file.fileId, name: file.name })}
                onQrBusy={setQrBusy}
                onUsbBusy={setUsbBusy}
              />
              {!kiosk && (
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={handleFileChosen}
                />
              )}
            </div>
            <button type="button" className="qxt-iv-wide" onClick={goTips}>
              <b>先看面试技巧</b>
              <small>公开的准备方法，不依赖 AI</small>
            </button>
            <AiDeclarationNote />
            <InterviewNote lead="三步都在这一场里">
              <span>第 1 步 创建配置：记录岗位、难度和时长，不等于已经生成题目。</span>
              <span>第 2 步 逐题作答：文字始终可以作答；语音要转写后由你确认。</span>
              <span>第 3 步 生成练习报告：报告只在这场练习真正完成后生成。</span>
              <span><b>模拟面试不是企业面试。</b>不代表任何招聘结果承诺，不会发出面试邀请，也不用于候选人筛选或录用判断。</span>
            </InterviewNote>
          </section>
        )}
      </div>
    </div>
    </InterviewShell>
  )
}

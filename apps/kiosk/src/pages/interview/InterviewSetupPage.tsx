// ============================================================
// 模拟面试 — 场景设置（2C）。
//
// 触控优先：纵向编排岗位行业、面试官难度与其他配置，底部固定主操作。
// 合规：仅供本人练习参考，不代表任何招聘结果承诺。
// ============================================================

import { useCallback, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  EMPLOYMENT_INDUSTRY_SECTORS,
  type CreateInterviewInput,
  type CreateInterviewResponse,
  type InterviewDifficulty,
  type InterviewDuration,
  type InterviewExperience,
  type InterviewerType,
} from '@ai-job-print/shared'
import { AiTaskRegion, useAiTask, aiErrorMessageOf, isAiOutage, type AiAvailability, type AiTaskFallback } from '../../ai'
import { AiDeclarationNote } from '../../ai/AiDeclarationNote'
import { aiDeclarationDeclineMessage } from '../../ai/aiDeclarationErrors'
import { useAuth } from '../../auth/useAuth'
import { QxTouchDock } from '../../components/qingxu/touch/QxTouchDock'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { useSupportContact } from '../../hooks/useSupportContact'
import { kioskUploadFile } from '../../services/api/files'
import { createInterview, printInterviewPracticeSheet, startInterview } from '../../services/api/interview'
import { isTerminalKiosk, useTerminalKiosk } from '../../services/api/screensaver'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { useStartPrintHandoff } from '../print/usePrintHandoff'
import { RESUME_AI_CONSENT_NEEDED_COPY } from '../resume/resumeAiConsentPrompt'
import { useInlineResumeAiConsent } from '../resume/useInlineResumeAiConsent'
import { interviewUserLine } from './interviewMicCopy'
import { InterviewNote } from './interviewQxParts'
import { InterviewSetupChargeBar } from './InterviewSetupChargeBar'
import { InterviewSetupPersonas, InterviewSetupResume } from './InterviewSetupExtras'
import {
  InterviewIndustryModal,
  InterviewSetupCapabilityNote,
  InterviewSetupConditions,
  InterviewSetupStep2Note,
  InterviewSetupStep3Guide,
  InterviewSetupSummaryCard,
  InterviewSetupTipsButton,
} from './InterviewSetupBlocks'
import {
  INTERVIEWER_AI_DRAFT,
  INTERVIEW_DIFFICULTIES,
  INTERVIEW_DURATIONS,
  INTERVIEW_EXPERIENCES,
  INTERVIEW_POSITION_EXAMPLES,
  SETUP_AI_DRAFT,
  continueInterviewWithResume,
  interviewSetupEcho,
  interviewSetupStepCopy,
  interviewStartMessage,
  openPracticeSheetSession,
  practiceSheetFileMeta,
  validateInterviewBasics,
  type InterviewStartTrip,
} from './interviewSetupModel'
import { InterviewShell } from './InterviewShell'
import { INTERVIEW_DOWN_NOTE, interviewStartControl } from './interviewStartControl'
import type { InterviewStage } from './interviewWorkbenchModel'
import { patchInterviewWorkbenchSession, readInterviewWorkbenchSession } from './interviewWorkbenchSession'
import { openedInterviewDeadline } from './session/interviewDeadline'
import { assistantOffAsk, interviewAiPill, isAiGateDown, useInterviewAiCapabilities, type InterviewAiState } from './useInterviewAiCapabilities'
import { useInterviewCharge } from './useInterviewCharge'
import { useInterviewSetupPersist, useInterviewStepFocus } from './useInterviewSetupEffects'
import { useMockInterviewAvailability } from './useMockInterviewAvailability'
import './interview-service-desk.css'
import './styles/interview-workbench-qx.css'
import './styles/interview-qx2.css'
import './styles/interview-touch-setup.css'

type ResumeChannel = 'phone' | 'usb' | 'desktop'

const INTERVIEWERS: Array<{ key: InterviewerType; label: string; desc: string; mark: string }> = [
  { key: 'hr', label: 'HR 面试', desc: '自我介绍 · 求职动机 · 稳定性 · 薪资沟通', mark: 'HR' },
  { key: 'manager', label: '业务主管', desc: '过往经历 · 岗位理解 · 协作与执行', mark: '主' },
  { key: 'tech', label: '技术面试官', desc: '专业技能 · 项目细节 · 问题解决', mark: '技' },
  { key: 'campus', label: '校招面试官', desc: '校园经历 · 学习能力 · 职业规划', mark: '校' },
  { key: 'final', label: '终面负责人', desc: '价值观 · 长期发展 · 综合判断', mark: '终' },
]

export function InterviewSetupPage({ onGoStage }: { onGoStage?: (stage: InterviewStage) => void } = {}) {
  const navigate = useNavigate()
  const startPrint = useStartPrintHandoff()
  const { getToken, user } = useAuth()
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
  const [resumeFile, setResumeFile] = useState<{ fileId: string; name: string; fileUrl?: string } | null>(setupDraft?.resumeFile ?? null)
  const [resumeChannel, setResumeChannel] = useState<ResumeChannel | null>(null)
  const [uploading, setUploading] = useState(false)
  const [usbBusy, setUsbBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 小青底栏仍读能力表。开场能不能用读 mock_interview 探针，不把能力表当成开场开关。 */
  const capabilities = useInterviewAiCapabilities()
  const opening = useMockInterviewAvailability()
  const control = interviewStartControl(opening)
  const [assistantDown, setAssistantDown] = useState(false)
  const [pendingSession, setPendingSession] = useState<{ sessionId: string; accessToken?: string } | null>(setupDraft?.pendingSession ?? null)
  const [aiOutage, setAiOutage] = useState<string | null>(setupDraft?.aiOutage ?? null)
  const [probed, setProbed] = useState(setupDraft?.probed ?? false)
  const [printingSheet, setPrintingSheet] = useState(false)
  const [startFailed, setStartFailed] = useState(setupDraft?.startFailed ?? false)
  const [step, setStep] = useState<1 | 2 | 3>(setupDraft?.step ?? 1)
  const [autoStartAfterPay, setAutoStartAfterPay] = useState(setupDraft?.autoStartAfterPay === true)
  const [offerStartWithoutResume, setOfferStartWithoutResume] = useState(false)
  const resumeAiConsent = useInlineResumeAiConsent(() => {
    setStartFailed(false)
    setError(RESUME_AI_CONSENT_NEEDED_COPY)
    setOfferStartWithoutResume(true)
  })

  useBusyLock(creating || uploading || printingSheet || usbBusy)
  useInterviewSetupPersist({
    directionSelectionVersion: 1, interviewerType, industry, position, experience,
    difficulty, duration, resumeFile, pendingSession, aiOutage, startFailed, probed,
    step, autoStartAfterPay,
  })
  useInterviewStepFocus(step)

  const handleStartRef = useRef<(omitResume?: boolean, trip?: InterviewStartTrip) => Promise<void>>(async () => undefined)
  const onBeforeNavigatePay = useCallback((autoStart: boolean) => {
    patchInterviewWorkbenchSession({
      setup: {
        directionSelectionVersion: 1, interviewerType, industry, position, experience,
        difficulty, duration, resumeFile, pendingSession, aiOutage, startFailed, probed,
        step: 3, ...(autoStart ? { autoStartAfterPay: true } : {}),
      },
    })
  }, [aiOutage, difficulty, duration, experience, industry, interviewerType, pendingSession, position, probed, resumeFile, startFailed])
  const onClearAutoStart = useCallback(() => setAutoStartAfterPay(false), [])
  const onAutoStart = useCallback((trip: InterviewStartTrip) => { void handleStartRef.current(false, trip) }, [])
  const validateBasicsNow = useCallback(() => validateInterviewBasics({ position, industry, experience }), [experience, industry, position])
  const charge = useInterviewCharge({
    step, creating, controlMode: control.mode, aiOutage, hasPendingSession: Boolean(pendingSession),
    autoStartAfterPay, endUserId: user?.id ?? null, getToken, navigate,
    validateBasics: validateBasicsNow, setError, onBeforeNavigatePay, onClearAutoStart, onAutoStart,
  })

  const handleFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    if (isTerminalKiosk()) return
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const uploaded = await kioskUploadFile(file, 'resume_upload', getToken())
      setResumeFile({ fileId: uploaded.fileId, name: uploaded.filename, fileUrl: uploaded.signedUrl })
    } catch (err) {
      setError(userMessageOf(err, '简历上传失败，请重试'))
    } finally {
      setUploading(false)
    }
  }

  const handleStart = async (omitResume = false, trip?: InterviewStartTrip) => {
    const pos = position.trim()
    if (!pos) { setError('请先填写目标岗位，例如：前端开发工程师、行政专员'); return }
    if (!industry.trim()) { setError('请先选择本次练习的行业，不会替你预选'); return }
    if (!experience) { setError('请先选择你的经验情况，不会替你预选'); return }
    setCreating(true)
    setError(null)
    setAiOutage(null)
    setAssistantDown(false)
    setStartFailed(false)
    let created: CreateInterviewResponse | undefined
    try {
      const input: CreateInterviewInput & { fileAccessUrl?: string } = {
        interviewerType, industry, position: pos, experience, difficulty, durationMin: duration,
        ...(!omitResume && resumeFile ? { resumeFileId: resumeFile.fileId, fileAccessUrl: resumeFile.fileUrl } : {}),
      }
      const token = getToken()
      created = await createInterview(input, { token })
      // 先记下来再 start：start 一旦 503，这个 sessionId 就是通用题目单的落点。
      setPendingSession({ sessionId: created.sessionId, accessToken: created.accessToken })
      const first = await startInterview(
        created.sessionId,
        { token, accessToken: created.accessToken },
        trip ? { headers: trip.headers } : undefined,
      )
      const opened = openedInterviewDeadline(first, duration)
      setProbed(true)
      const live = {
        sessionId: created.sessionId,
        accessToken: created.accessToken,
        questionTarget: created.questionTarget,
        durationMin: duration,
        interviewerType,
        position: pos,
        firstQuestion: first.question ?? '',
        messages: [{ role: 'interviewer' as const, content: first.question ?? '' }],
        questionIndex: 1,
        remainingSec: opened.remainingSec,
        deadlineAtLocalMs: opened.deadlineAtLocalMs,
        deadlineSource: opened.deadlineSource,
        omitPrintAnswers: false,
        ...(trip ? { paidOrderId: trip.orderId, paidKioskSessionId: trip.kioskSessionId } : {}),
      }
      patchInterviewWorkbenchSession({ stage: 'session', live })
      if (onGoStage) onGoStage('session')
      else navigate('/interview/session', { replace: true, state: live })
    } catch (err) {
      const declined = aiDeclarationDeclineMessage(err)
      if (declined) { setError(declined); return }
      if (await charge.handleStartError(err, trip)) return
      if (!omitResume && created && resumeFile) {
        const started = created
        setOfferStartWithoutResume(false)
        if (resumeAiConsent.promptIfNeeded(err, Boolean(getToken()), () => {
          void continueInterviewWithResume({
            created: started, pos, duration, interviewerType, trip, onStartError: charge.handleStartError,
            getToken, onGoStage, navigate,
            promptConsent: resumeAiConsent.promptIfNeeded, setCreating, setError, setAiOutage,
            setAssistantDown, setStartFailed, setOfferStartWithoutResume, setProbed,
          })
        })) return
      }
      const message = interviewStartMessage(err)
      setError(message)
      setStartFailed(true)
      setAssistantDown(isAiGateDown(err))
      if (isAiOutage(err)) setAiOutage(message)
      else setProbed(true)
    } finally {
      setCreating(false)
    }
  }
  handleStartRef.current = handleStart

  /** 通用题目与答案单：AI 挂掉时唯一不经过模型的出纸路径。 */
  const handlePracticeSheet = async (session?: { sessionId: string; accessToken?: string }) => {
    const target = session ?? pendingSession
    if (!target || printingSheet) return
    setPrintingSheet(true)
    setError(null)
    try {
      const file = await printInterviewPracticeSheet(target.sessionId, { token: getToken(), accessToken: target.accessToken })
      if (!file.printFileUrl) throw new Error('打印链接未就绪，请稍后重试')
      startPrint({
        origin: 'interview_practice',
        returnPath: window.location.pathname,
        file: { ...practiceSheetFileMeta(file), fileUrl: file.printFileUrl },
      })
    } catch (err) {
      setError(aiErrorMessageOf(err, '题目单生成失败，请稍后重试'))
    } finally {
      setPrintingSheet(false)
    }
  }

  const say = (text: string | null) => interviewUserLine(text, contact) ?? text
  const availability: AiAvailability = aiOutage ? 'unavailable' : creating || probed ? 'available' : 'unknown'
  const aiTask = useAiTask({ availability, pending: creating, failed: startFailed || Boolean(aiOutage), hasResult: false })
  const STILL_AVAILABLE = pendingSession
    ? '题目本身不依赖 AI：本机有一份通用题库，可以按你选的面试官身份印一张「题目与答案单」带走，用笔作答。'
      + '这张单子不含任何点评、评分或通过率 —— 点评依赖 AI，本次没有，也不会拿通用建议冒充。'
    : '这次还没建立起这场练习，因此印不出按本场配置取题的题目单。面试准备要点是本机固定内容，不依赖 AI，现在照常可看。'
  const sheetAction = pendingSession
    ? { action: { label: printingSheet ? '正在生成题目单…' : '打印通用题目与答案单', onClick: () => void handlePracticeSheet() } }
    : {}
  const fallback: AiTaskFallback = aiOutage && !charge.isRetryFree
    ? { mode: 'blocked', reason: say(aiOutage) ?? aiOutage, blockedActionLabel: '创建并开始练习（AI 面试官）', stillAvailable: STILL_AVAILABLE, ...sheetAction }
    : {
        mode: 'result-unavailable',
        reason: say((startFailed ? error : null) ?? '本次没能进入 AI 面试间。') ?? '本次没能进入 AI 面试间。',
        retryHint: charge.startFailureHint
          ? `${charge.startFailureHint}${STILL_AVAILABLE}`
          : pendingSession
            ? `本次没有进入面试间。可以再点一次「创建并开始练习」；不想等的话，${STILL_AVAILABLE}`
            : `本次没有进入面试间。可以直接再点一次「创建并开始练习」。${STILL_AVAILABLE}`,
        ...sheetAction,
      }

  const goTips = () => (onGoStage ? onGoStage('tips') : navigate('/interview/tips'))
  const assistantState = assistantDown ? 'off' : capabilities.state('assistant_chat')
  const mockState: InterviewAiState = control.pill === 'available' ? 'available' : control.pill
  const shownError = interviewUserLine(error, contact)
  const fallbackReason = step === 3 && aiTask.isFailed ? fallback.reason : null
  const interviewer = INTERVIEWERS.find((it) => it.key === interviewerType)
  const difficultyItem = INTERVIEW_DIFFICULTIES.find((item) => item.key === difficulty)
  const durationItem = INTERVIEW_DURATIONS.find((item) => item.key === duration)
  const handleOpenSheet = () => openPracticeSheetSession({
    pendingSession, interviewerType, industry, position, experience, difficulty, duration,
    getToken, setError, setPendingSession, onPracticeSheet: handlePracticeSheet,
  })
  const goNext = () => {
    if (step === 1) {
      const message = validateInterviewBasics({ position, industry, experience })
      if (message) { setError(message); return }
    }
    setError(null)
    setStep((current) => (current === 1 ? 2 : 3))
  }
  const stepCopy = interviewSetupStepCopy(step)
  const echo = interviewSetupEcho({
    interviewerType, difficulty, duration,
    interviewerLabel: interviewer?.label, difficultyLabel: difficultyItem?.label, durationLabel: durationItem?.label,
  })
  const capabilityNote = (
    <InterviewSetupCapabilityNote mockState={mockState} aiOutage={aiOutage} creating={creating} step={step} downNote={INTERVIEW_DOWN_NOTE} />
  )
  const backStep = () => { setError(null); setStep((current) => (current === 3 ? 2 : 1)) }

  return (
    <InterviewShell
      eyebrow={stepCopy.eyebrow}
      title={stepCopy.title}
      subtitle={stepCopy.sub}
      onBack={step > 1 ? backStep : undefined}
      rail={{ labels: ['岗位与经验', '面试官与时长', '核对开始'], now: step - 1 }}
      status={interviewAiPill(mockState, Boolean(aiOutage))}
      ctabar={
        <QxTouchDock
          onBack={step > 1 ? backStep : () => navigate('/interview-service')}
          backLabel={step > 1 ? '上一步' : '返回'}
          ask={assistantState === 'available'
            ? { label: step === 2 ? '问小青：选哪位面试官' : '问小青：这场练习怎么设', draft: step === 2 ? INTERVIEWER_AI_DRAFT : SETUP_AI_DRAFT }
            : assistantOffAsk(assistantState, '可继续手动设置')}
          alert={shownError && shownError !== fallbackReason ? <p className="qxt-iv-alert" role="alert" data-testid="interview-setup-error">{shownError}</p> : undefined}
          primary={{
            label: step < 3 ? '下一步' : creating ? '正在为你准备面试官…' : charge.primaryLabel(aiOutage && pendingSession ? '打印通用题目与答案单' : control.mode === 'sheet' ? '打印通用题目单' : '创建并开始练习'),
            testId: step === 3 ? 'interview-primary' : undefined,
            disabled: step === 3 && (creating || uploading || printingSheet || charge.checkingPay || (!charge.chargeReady && control.mode !== 'sheet' && !(aiOutage && pendingSession)) || (control.mode === 'wait' && !(aiOutage && pendingSession) && !charge.isRetryFree)),
            onClick: () => {
              if (step < 3) goNext()
              else if (charge.isRetryFree && charge.paidTrip) void handleStart(false, charge.paidTrip)
              else if (aiOutage && pendingSession) void handlePracticeSheet()
              else if (control.mode === 'sheet') void handleOpenSheet()
              else if (!charge.chargeReady) return
              else if (control.mode === 'start' && charge.needsPay) void charge.startPay()
              else if (control.mode === 'start' && charge.paidTrip) void handleStart(false, charge.paidTrip)
              else if (control.mode === 'start') void handleStart()
            },
          }}
        />
      }
    >
      {resumeAiConsent.dialog}
      <InterviewIndustryModal
        open={showIndustryPicker}
        industry={industry}
        onChange={setIndustry}
        onClear={() => setIndustry('')}
        onClose={() => setShowIndustryPicker(false)}
      />
      <div data-kiosk-domain="interview" data-kiosk-screen="interview-setup" data-qx-interview="" data-setup-step={step} className="interview-flow interview-setup" data-visual-theme="service-desk" data-ux-density="touch">
        <div className="interview-flow__scroll">
          {step === 1 && (
            <section className="interview-setup__stack qxt-iv-stack">
              {capabilityNote}
              <label className="qxt-iv-field">
                <small>目标岗位（必填，最多 50 字）</small>
                <input
                  value={position}
                  onChange={(e) => { setPosition(e.target.value); if (error?.includes('目标岗位')) setError(null) }}
                  maxLength={50}
                  placeholder="输入目标岗位，例：前端开发工程师"
                />
              </label>
              <div className="qxt-iv-choices" role="group" aria-label="岗位快捷项">
                {INTERVIEW_POSITION_EXAMPLES.map((example) => (
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
                  {INTERVIEW_EXPERIENCES.map((item) => (
                    <button key={item.key} type="button" className="qxt-iv-opt" aria-pressed={experience === item.key} onClick={() => setExperience(experience === item.key ? '' : item.key)}>{item.label}</button>
                  ))}
                </div>
              </div>
              <InterviewSetupTipsButton label="先看面试技巧" onClick={goTips} />
              <InterviewSetupConditions />
              <InterviewNote lead="后面不改的话">
                <span>{interviewer?.label} · {difficultyItem?.label} · {durationItem?.label} · 文字回答。</span>
                <span>行业和经验都不预选。经验再点一次可以取消。</span>
              </InterviewNote>
            </section>
          )}

          {step === 2 && (
            <section className="interview-setup__stack qxt-iv-stack">
              {capabilityNote}
              <div className="interview-setup__interviewer qxt-iv-group is-grow">
                <InterviewSetupPersonas
                  interviewers={INTERVIEWERS} interviewerType={interviewerType} onInterviewer={setInterviewerType}
                  difficulties={INTERVIEW_DIFFICULTIES} difficulty={difficulty} onDifficulty={setDifficulty}
                  durations={INTERVIEW_DURATIONS} duration={duration} onDuration={setDuration}
                />
              </div>
              <InterviewSetupTipsButton label="先看面试技巧" onClick={goTips} />
              <InterviewSetupStep2Note
                echo={echo} interviewerLabel={interviewer?.label} interviewerDesc={interviewer?.desc}
                difficultyLabel={difficultyItem?.label} difficultyDesc={difficultyItem?.desc} durationLabel={durationItem?.label}
              />
            </section>
          )}

          {step === 3 && (
            <section className="qxt-iv-stack is-spread">
              <InterviewSetupSummaryCard
                position={position} industry={industry}
                experienceLabel={INTERVIEW_EXPERIENCES.find((item) => item.key === experience)?.label ?? ''}
                interviewerLabel={interviewer?.label} difficultyLabel={difficultyItem?.label} durationLabel={durationItem?.label}
                onEditStep={setStep}
              />
              <InterviewSetupConditions />
              {capabilityNote}
              {(aiTask.isFailed || aiTask.isRunning) && (
                <AiTaskRegion
                  className="interview-setup-fallback"
                  task={aiTask}
                  label="AI 面试官出题与点评"
                  running={<InterviewNote lead="正在为你准备面试官…"><span>请稍候，完成后进入练习。</span></InterviewNote>}
                  fallback={fallback}
                />
              )}
              <div className="qxt-iv-group">
                <div className="qxt-iv-sec">简历（可选） · {resumeFile ? '已选用 1 份' : '不上传也能开始'}</div>
                <InterviewSetupResume
                  resumeFile={resumeFile} onClearResume={() => setResumeFile(null)}
                  resumeChannel={resumeChannel} onResumeChannel={setResumeChannel}
                  kiosk={kiosk} uploading={uploading}
                  onPickFile={() => { if (!isTerminalKiosk()) fileInputRef.current?.click() }}
                  onUploaded={(file) => setResumeFile({ fileId: file.fileId, name: file.name, fileUrl: file.fileUrl })}
                  onQrBusy={() => undefined} onUsbBusy={setUsbBusy}
                />
                {!kiosk && (
                  <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp" className="hidden" onChange={handleFileChosen} />
                )}
              </div>
              {offerStartWithoutResume ? (
                <button type="button" className="qxt-iv-wide" disabled={creating || !charge.chargeReady} onClick={() => { if (!charge.chargeReady) return; setOfferStartWithoutResume(false); void handleStart(true, charge.paidTrip ?? undefined) }}>
                  <b>不上传也能开始</b>
                  <small>没有简历时按通用问题练习，不会因此少一道题。</small>
                </button>
              ) : null}
              <InterviewSetupTipsButton label="先看面试技巧" onClick={goTips} />
              <AiDeclarationNote />
              <InterviewSetupStep3Guide
                disclaimer={<><b>模拟面试不是企业面试。</b>不代表任何招聘结果承诺，不会发出面试邀请，也不用于候选人筛选或录用判断。</>}
              />
              {charge.showChargeBar && <InterviewSetupChargeBar priceCents={charge.priceCents} />}
            </section>
          )}
        </div>
      </div>
    </InterviewShell>
  )
}

// ============================================================
// 自我探索 · 倾向参考 —— 测评流程（v1）
//
// 视觉真值（2026-09-22 迁入青序流光）：
//   docs/design/kiosk-redesign-2026-08/34-self-assessment.html
//   四条路由 intro / questions / result / history 共用 SaFrame 壳；稿里的
//   review（提交前确认）是 questions 路由的页内阶段，不另起路由；稿的
//   recover-consent / recover-submitted 就是本文件的 fail-closed 拦截面。
//   稿是**静态原型**（没有服务端，所以它不画结果、不画打印）。运行时这三样都是真的，
//   迁移只向前补齐，不按静态稿把已上线能力删掉。
//
// **本文件是合规关键词扫描的锚点**：`services/api/scripts/verify-compliance.ts`
// 的 SELF_ASSESSMENT_FILES 逐路径点名了它。用户可见的中文全部留在这里，
// 呈现原语放 components/self-assessment/SelfAssessmentQxKit.tsx（那边不放文案）。
//
// 合规（与 CLAUDE.md §11 / 18 / docs/compliance/compliance-boundary.md §4.5 同档）：
// - 工具性质说明：非临床 / 非诊断 / 本人自助参考；不沿用 MBTI / 大五 / DISC / 霍兰德标签
// - 答案原文不入库：仅存 SHA-256(answers JSON)
// - 不向企业 / 合作机构 / Partner / Admin 推送结果
// - 闲置 60 秒自动退出（公共一体机；同意/答题/结果/记录四页共用）
// - 同意 / 撤回 / 删除只在结果页主行动区显式操作
// - 同一人 60 秒内可用 sessionStorage 恢复进度；登出 / 隐私清场会清掉，不留给下一位
//
// ── S2-7 接线（接线矩阵 §四 S2-7 / §2.2 P28 行）─────────────────────────────
// 本页的分工在接线时必须一直成立，它是「AI 是加速器不是前置条件」的落点：
//   记分（strength + 依据题号）= 固定权重纯函数（服务端 `self-assessment-scoring.ts`
//     不读库、不写日志、不调 LLM）⇒ 标 E1/E2，**AI 挂了也照常出**；
//   解读（summary + 每维 note）= 唯一由 LLM 产出的东西 ⇒ 标 E3，AI 挂了如实缺。
// 所以只有「解读区」被 AiTaskRegion 包住，记分区永远在外面直接渲染。
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams, type NavigateFunction } from 'react-router-dom'
import type {
  SelfAssessmentDimensionKey,
  SelfAssessmentDimensionResult,
} from '@ai-job-print/shared'
import { SELF_ASSESSMENT_DIMENSIONS, makePrintParams } from '@ai-job-print/shared'
import {
  AiCapabilityChip,
  AiConclusion,
  AiTaskRegion,
  AigcMark,
  EvidenceBadge,
  useAiTask,
  type AiAvailability,
  type AiTaskFallback,
} from '../../ai'
import {
  SelfAssessmentApiError,
  getLatestSelfAssessment,
  printSelfAssessment,
  submitSelfAssessment,
  withdrawSelfAssessment,
} from '../../services/api/selfAssessment'
import {
  CONSENT_ITEMS,
  SELF_ASSESSMENT_CONSENT_VERSION,
  SENSITIVE_QUESTIONS,
  clearSession,
  flattenAnswers,
  formatBytes,
  formatDateTime,
  hasCurrentConsent,
  loadSession,
  progress,
  questionsFor,
  saveSession,
  type SelfAssessmentSession,
} from './selfAssessmentSession'
import { useSelfAssessmentIdleExit } from './useSelfAssessmentIdleExit'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { FilePreviewDialog } from '../../components/FilePreviewDialog'
import {
  SaCard,
  SaChips,
  SaConfirmOverlay,
  SaFlow,
  SaFrame,
  SaGate,
  SaMapGrid,
  SaMeta,
  SaNotice,
  SaPicks,
  SaReviewGrid,
  type SaStatus,
} from './components/self-assessment/SelfAssessmentQxKit'

/** 稿底部那一行不可关闭的边界声明，四个页面共用。 */
const SA_RAIL = ['结果仅供自我参考', '不评分不排名', '不替代能力证明'] as const
const SA_EYEBROW = 'SELF ASSESSMENT'
const SA_TITLE = '自我探索 · 倾向参考'
/** 四条路由共用的固定壳 props：标题、域标识与底部边界声明逐页相同。 */
const SA_FRAME_BASE = { title: SA_TITLE, eyebrow: SA_EYEBROW, rail: SA_RAIL } as const
/** 返回口：稿的返回键指向「简历服务」服务台，不是浏览器历史（一体机没有后退键）。 */
const SA_BACK_ROUTE = '/resume-service'

/**
 * 置灰但仍可读到原因的动作按钮。用 `aria-disabled` 而不是原生 `disabled` ——
 * 原生 disabled 会把按钮踢出 Tab 序列、读屏直接跳过，用户永远读不到「为什么灰」
 * （与 `ai/AiTaskRegion.tsx` 同一口径，`verify:ai-artifact-print-url-contract` 守着）。
 */
function GuardedButton({
  blockedReason,
  onClick,
  variant,
  testId,
  children,
}: {
  blockedReason: string | null
  onClick: () => void
  variant?: 'primary' | 'teal' | 'ghost' | 'danger'
  testId?: string
  children: ReactNode
}) {
  const blocked = Boolean(blockedReason)
  return (
    <span className="sa-guarded">
      <button
        type="button"
        className="qx-btn"
        data-variant={variant}
        data-testid={testId}
        aria-disabled={blocked || undefined}
        onClick={() => { if (!blocked) onClick() }}
      >
        {children}
      </button>
      {blockedReason ? (
        <span className="sa-blocked-reason">{blockedReason}</span>
      ) : null}
    </span>
  )
}

function GhostButton({ label, route, onClick }: { label: string; route?: string; onClick: () => void }) {
  return (
    <button type="button" className="qx-btn" data-variant="ghost" data-route={route} onClick={onClick}>{label}</button>
  )
}

function PrimaryButton({ label, testId, onClick }: { label: string; testId?: string; onClick: () => void }) {
  return (
    <button type="button" className="qx-btn" data-variant="primary" data-testid={testId ?? 'self-assessment-primary'} onClick={onClick}>{label}</button>
  )
}

/**
 * 「现在可以做什么」——稀疏页共用的四个真出口。`from` 是当前路由。
 *
 * 两条硬约束放在这里而不是调用点：**每个出口都换一页**（「继续本次作答」只在当前
 * 不在答题页时才指回 /questions —— 答题页的 fail-closed 面上它指回自己，点了什么都
 * 不会发生）；**登录带着 `from` 回跳**（账号侧记录要登录才归属本人，记录页那条说明
 * 讲的就是这件事，登录完必须回到原来那一页）。
 *
 * 记录页上这张卡兼任该屏的余量吸收块（`grow`）；fail-closed 面与结果空态**不加** ——
 * 那两屏只有两张卡，700px 余量摊到四个出口上会把每个撑成 467px 的空盒子（本轮实测）。
 */
function saExits(go: NavigateFunction, from: string, resumable: boolean) {
  const resume = resumable && from !== '/resume/self-assessment/questions'
  const start = resume ? '/resume/self-assessment/questions' : '/resume/self-assessment/intro'
  return [
    { key: 'start', icon: '答', title: resume ? '继续本次作答' : '开始一次作答', desc: '不登录也能做完全部题目，完成情况当场就能看。', lead: true, route: start, onClick: () => go(start) },
    { key: 'hub', icon: '简', title: '回简历服务', desc: '改简历、生成材料或安排打印，按各自页面的实际状态确认。', route: SA_BACK_ROUTE, onClick: () => go(SA_BACK_ROUTE) },
    { key: 'records', icon: '我', title: '去 AI 服务记录', desc: '在「我的」里查看已经产生的服务与文档记录。', route: '/me/ai-records', onClick: () => go('/me/ai-records') },
    { key: 'login', icon: '登', title: '先登录账号', desc: '登录后账号侧记录才会归到本人名下；能否查看以服务端返回为准。', route: '/login', onClick: () => go('/login', { state: { from } }) },
  ]
}

/** 知情同意勾选块。`role="checkbox"` + `aria-checked`，不是原生 input —— 触控目标要 84px。 */
function ConsentBox({
  checked, label, note, testId, onToggle,
}: { checked: boolean; label: string; note?: string; testId: string; onToggle: () => void }) {
  return (
    <button type="button" className="sa-cbox" role="checkbox" aria-checked={checked} data-testid={testId} onClick={onToggle}>
      <span className="sa-box" aria-hidden="true">✓</span>
      <span>{label}{note ? <small>{note}</small> : null}</span>
    </button>
  )
}

// ============================================================
// 1) 同意页
// ============================================================
export function SelfAssessmentIntroPage() {
  const navigate = useNavigate()
  const session = useMemo(() => loadSession(), [])
  useSelfAssessmentIdleExit()
  const [consent, setConsent] = useState(
    session.consentVersion === SELF_ASSESSMENT_CONSENT_VERSION
      ? session.consent
      : { nonSensitive: false, sensitive: false },
  )
  const bank = useMemo(() => questionsFor(consent.sensitive === true), [consent.sensitive])
  const total = useMemo(() => progress(bank, {}).total, [bank])
  const dimCount = bank.dimensions.length
  const start = useCallback(() => {
    if (!consent.nonSensitive) return
    const next: SelfAssessmentSession = {
      ...session,
      consent,
      consentVersion: SELF_ASSESSMENT_CONSENT_VERSION,
      consentedAt: new Date().toISOString(),
      answers: {},
    }
    saveSession(next)
    navigate('/resume/self-assessment/questions')
  }, [consent, navigate, session])

  const ok = consent.nonSensitive
  const status: SaStatus = ok ? { tone: 'ok', label: '已确认说明' } : { tone: 'warn', label: '待确认说明' }

  return (
    <SaFrame
      {...SA_FRAME_BASE}
      screen="resume-self-assessment-intro"
      state={ok ? 'intro-ready' : 'intro-consent-pending'}
      status={status}
      ask={<>把职业倾向，<em>说得更明白</em>。</>}
      doing={<>{total} 道选择题，覆盖 {dimCount} 个方向；<b>不评分、不排名，结果只给你自己看。</b></>}
      back={{ label: '返回简历服务', onBack: () => navigate(SA_BACK_ROUTE) }}
      gate={
        <SaGate tone={ok ? 'ok' : 'warn'}>
          {ok
            ? <><b>已确认说明。</b>现在可以开始作答，答题过程中随时可以返回修改或退出。</>
            : <><b>还没有勾选上面的确认，暂时不能开始作答。</b>先读完 {CONSENT_ITEMS.length} 条说明并勾选，「开始作答」才会变为可用。</>}
        </SaGate>
      }
      ctabar={
        <>
          <GhostButton label="返回简历服务" route={SA_BACK_ROUTE} onClick={() => navigate(SA_BACK_ROUTE)} />
          <GuardedButton variant="primary" testId="self-assessment-primary" onClick={start}
            blockedReason={ok ? null : '需先勾选第一项同意才能开始作答'}>开始作答</GuardedButton>
        </>
      }
    >
      <SaCard head="这次要做的事" hint={`约 6 分钟 · 不需登录`}>
        <SaChips
          items={[
            { key: 'count', text: <><b>{total}</b> 道选择题</> },
            { key: 'dims', text: <>覆盖 <b>{dimCount}</b> 个方向</> },
            { key: 'back', text: '随时可返回修改' },
            { key: 'norank', text: '不评分、不排名' },
          ]}
        />
        <p className="sa-sub">
          题目问的是你更愿意怎么工作，不是考你会不会。{total} 道题按
          {bank.dimensions.map((d) => d.label).join('、')}排列，题干与选项与共享题库逐字一致，本页不改写题意、不另造题目。
        </p>
      </SaCard>

      <SaCard head="这一页里，哪部分是 AI" hint="分工写在前面，不等结果出来才说">
        <p className="sa-sub" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <AiCapabilityChip tone="ai" />
          <span>记分不经过 AI，解读才经过 AI。</span>
        </p>
        <SaFlow
          items={[
            { key: 'e2', step: 'E2 · 不经过 AI', title: '维度强度与依据题号', current: true, desc: `${dimCount} 个方向的强度由固定权重算出，依据只有你自己的选择 —— AI 不可用时照样出。` },
            { key: 'e3', step: 'E3 · 由 AI 生成', title: `${dimCount} 段陈述式解读`, desc: '它不打分、不排名，也不说你适合或不适合哪类岗位；AI 不可用时会如实缺，不拿别的东西顶上。' },
          ]}
        />
      </SaCard>

      <SaCard head="开始前请先确认" hint="勾选后才能作答">
        <ol className="sa-consent">
          {CONSENT_ITEMS.map((item, index) => (
            <li key={item}><em>{index + 1}</em><div>{item}</div></li>
          ))}
        </ol>
        <p className="sa-sub">
          你现在勾选的是<b>上面这 {CONSENT_ITEMS.length} 条</b>，同意版本 {SELF_ASSESSMENT_CONSENT_VERSION}。
          说明改动会提高版本号，届时会请你重新确认一次。
        </p>
        <ConsentBox
          testId="self-assessment-consent-required" checked={consent.nonSensitive}
          label="我已了解上述说明，并同意开始作答（必勾选）"
          onToggle={() => setConsent({ ...consent, nonSensitive: !consent.nonSensitive })}
        />
        <ConsentBox
          testId="self-assessment-consent-sensitive" checked={consent.sensitive}
          label="同意作答涉及偏好 / 风格的敏感题（可选）"
          note={SENSITIVE_QUESTIONS.length > 0
            ? `不勾会跳过其中 ${SENSITIVE_QUESTIONS.length} 题，进度总数相应减少。`
            : '当前题库（v1）没有标记为敏感的题目，勾不勾都不会改变题目；此项只记录你的意愿。'}
          onToggle={() => setConsent({ ...consent, sensitive: !consent.sensitive })}
        />
      </SaCard>

      <SaNotice>
        <b>本页是自我探索，不是心理、临床或能力测评。</b>它不会参与岗位排序，也不会把你的答案提供给企业或合作机构。
      </SaNotice>
    </SaFrame>
  )
}

// ============================================================
// 2) 答题页（含稿的 review 阶段与两个 fail-closed 拦截面）
// ============================================================
export function SelfAssessmentQuizPage() {
  const navigate = useNavigate()
  const session = useMemo(() => loadSession(), [])
  const consentOk = hasCurrentConsent(session)
  const alreadySubmitted = Boolean(session.result)
  const questions = useMemo(() => questionsFor(session.consent.sensitive === true), [session.consent.sensitive])
  const [answers, setAnswers] = useState<Partial<Record<SelfAssessmentDimensionKey, Record<number, string>>>>(session.answers)
  // 回到答题页时落在「第一道还没答的题」，不是从头再来一遍（稿同一口径）：
  // 会话里的作答一直是从第 1 题起的连续前缀，所以 done+1 就是该继续的那一题。
  const [cursor, setCursor] = useState(() => {
    const resumeAt = progress(questions, session.answers)
    return Math.max(1, Math.min(resumeAt.total, resumeAt.done + 1))
  })
  const [stage, setStage] = useState<'quiz' | 'review'>('quiz')
  useSelfAssessmentIdleExit(consentOk)

  useEffect(() => { if (consentOk) saveSession({ ...session, answers }) }, [answers, consentOk, session])

  /** 把 5 维度 × 5 题摊平成 1..N，顺序 = 稿的推进顺序（同维度按 idx 递增，走完再进下一维度）。 */
  const flat = useMemo(
    () => questions.dimensions.flatMap((dim, dimIndex) =>
      dim.questions.map((q) => ({ dimKey: dim.key, dimLabel: dim.label, dimIndex, idx: q.idx, prompt: q.prompt, choices: q.choices }))),
    [questions],
  )
  const { done, total } = progress(questions, answers)
  const current = flat[cursor - 1]
  /** 题号只能落在「已答数 + 1」以内：本页不允许跳题，跳过的题不会被补答。 */
  const reach = Math.min(total, done + 1)
  const chosen = current ? answers[current.dimKey]?.[current.idx] ?? null : null
  const full = total > 0 && done >= total
  const flatIndexOf = (dimKey: SelfAssessmentDimensionKey, idx: number) =>
    flat.findIndex((item) => item.dimKey === dimKey && item.idx === idx) + 1
  /** 题号地图与提交前复核共用同一套「一行一个维度」的行头，只是格子内容不同。 */
  const gridRows = questions.dimensions.map((dim, dimIndex) => {
    const dimAnswered = dim.questions.filter((q) => answers[dim.key]?.[q.idx]).length
    return {
      dim,
      dimIndex,
      key: dim.key,
      label: dim.label,
      counter: `${dimAnswered} / ${dim.questions.length} 题`,
      full: dimAnswered === dim.questions.length,
    }
  })

  const pick = (choiceKey: string) => {
    if (!current) return
    setAnswers((prev) => ({
      ...prev,
      [current.dimKey]: { ...(prev[current.dimKey] ?? {}), [current.idx]: choiceKey },
    }))
  }

  /**
   * 交卷 = 存盘 + 换页。**提交请求本身不在这一页发**：`POST` 里同步跑着 LLM 解读，
   * 那段等待是本流程唯一真实的「AI 在算」窗口，必须发生在能把 `data-aitask=running`
   * 画出来的地方（结果页的 AiTaskRegion），而不是一个写死「提交中…」的按钮。
   */
  const handOff = () => {
    // 同意门禁：没有当前版本的显式同意就不往下走 —— 下一步会把作答送去调模型。
    if (!consentOk || done < total) return
    saveSession({ ...session, answers })
    navigate('/resume/self-assessment/result')
  }

  const restart = () => { clearSession(); navigate('/resume/self-assessment/intro') }

  /**
   * 两个 fail-closed 拦截面（稿 recover-consent / recover-submitted）。
   * 共用一套版式：说清「为什么不放行」+「已有的东西不会被动」+ 两个真出口。
   * 它们不是错误提示 —— 这一步本来就有前置条件，所以不用红色错误块，用 down 卡。
   */
  const blocked = !consentOk || flat.length === 0
    ? {
        state: 'recover-consent',
        pill: '前置条件未满足',
        ask: <>这一步<em>还打不开</em>。</>,
        doing: <>这一步需要先在说明页确认。<b>页面不会跳过这一步，也不会补一个假结果给你看。</b></>,
        head: '还不能进入作答',
        hint: '这一步本来就有前置条件',
        chips: [
          { key: 'blocked', text: <>当前入口<b>不放行</b></>, tone: 'warn' as const },
          { key: 'keep', text: '已有作答不会被清空' },
          { key: 'none', text: '不生成任何结果' },
        ],
        body: consentOk
          ? '当前题目集为空，请回到说明页重新开始。'
          : `这台机器上还没有记录到你对当前版本（${SELF_ASSESSMENT_CONSENT_VERSION}）说明的同意，或说明已更新。作答会被送去生成 AI 解读，所以必须先看过说明再开始。`,
        secondary: { label: '返回简历服务', route: SA_BACK_ROUTE, onClick: () => navigate(SA_BACK_ROUTE) },
        primary: { label: '去看说明并确认', onClick: () => navigate('/resume/self-assessment/intro') },
      }
    : alreadySubmitted
      ? {
          state: 'recover-submitted',
          pill: '本次已提交',
          ask: <>本次作答<em>已经提交</em>。</>,
          doing: <>已提交的答案不再改动。<b>想换答案就重新开始一次新的作答。</b></>,
          head: '答题页已关闭',
          hint: '本次会话已提交',
          chips: [
            { key: 'blocked', text: <>答题入口<b>不放行</b></>, tone: 'warn' as const },
            { key: 'kept', text: '本次结果仍可查看' },
            { key: 'redo', text: '重新开始会清空这一次' },
          ],
          body: '重新开始一次会清掉这台机器上的本次作答与结果；已提交的那一次若要物理删除，请在结果页用「撤回本次探索」。',
          secondary: { label: '重新开始一次', route: undefined, onClick: restart },
          primary: { label: '查看本次结果', onClick: () => navigate('/resume/self-assessment/result') },
        }
      : null

  if (blocked) {
    return (
      <SaFrame
        {...SA_FRAME_BASE}
        screen="resume-self-assessment-quiz"
        state={blocked.state}
          status={{ tone: 'warn', label: blocked.pill }}
          ask={blocked.ask}
        doing={blocked.doing}
          back={{ label: '返回简历服务', onBack: () => navigate(SA_BACK_ROUTE) }}
        ctabar={
          <>
            <GhostButton label={blocked.secondary.label} route={blocked.secondary.route} onClick={blocked.secondary.onClick} />
            <PrimaryButton label={blocked.primary.label} onClick={blocked.primary.onClick} />
          </>
        }
      >
        <SaCard head={blocked.head} hint={blocked.hint} tone="down" testId="self-assessment-recover">
          <SaChips items={blocked.chips} />
          <p className="sa-sub">{blocked.body}</p>
        </SaCard>
        <SaCard head="现在可以做什么" hint="都是现在就能打开的入口">
          <SaPicks items={saExits(navigate, '/resume/self-assessment/questions', consentOk && !alreadySubmitted)} />
        </SaCard>
      </SaFrame>
    )
  }

  // ── 提交前确认（稿 review）：仍在 questions 路由内，不新增路由 ──
  if (stage === 'review') {
    return (
      <SaFrame
        {...SA_FRAME_BASE}
        screen="resume-self-assessment-quiz"
        state="review"
          status={{ tone: 'ok', label: `已答 ${done}/${total}` }}
          ask={<>提交前，<em>先检查这 {total} 个选择</em>。</>}
        doing={<>{total} 题已全部作答。<b>确认提交后才会把作答送去生成解读；在那之前不产生任何结果。</b></>}
          back={{ label: '返回作答', onBack: () => setStage('quiz') }}
        gate={
          <SaGate tone="ok">
            <><b>{total} 题都已作答。</b>确认无误后再提交；现在取消也不会丢掉这些选择。</>
          </SaGate>
        }
        ctabar={
          <>
            <GhostButton label="取消，返回修改" onClick={() => setStage('quiz')} />
            <PrimaryButton label="确认提交" onClick={handOff} />
          </>
        }
      >
        <SaCard head="你这次选了什么" hint="点任意一项即可回去修改" tone="lead" grow>
          <SaChips
            items={[
              { key: 'done', text: <>已答 <b>{total}</b> 题</> },
              { key: 'dims', text: <>{questions.dimensions.length} 个方向已覆盖</> },
              { key: 'not-yet', text: '尚未提交' },
              { key: 'local', text: '现在只存在于这台机器' },
            ]}
          />
          <SaReviewGrid
            testId="self-assessment-review-grid"
            rows={gridRows.map(({ dim, ...row }) => ({
              ...row,
              cells: dim.questions.map((q) => {
                const n = flatIndexOf(dim.key, q.idx)
                const picked = q.choices.find((c) => c.key === answers[dim.key]?.[q.idx])?.label ?? '未选择'
                return {
                  key: `${dim.key}-${q.idx}`,
                  step: `第 ${n} 题`,
                  value: picked,
                  ariaLabel: `回到第 ${n} 题修改（${dim.label}），当前选择：${picked}`,
                  onSelect: () => { setCursor(n); setStage('quiz') },
                }
              }),
            }))}
          />
        </SaCard>
        <SaCard head="确认提交会发生什么" hint="只有这三件事">
          <SaFlow
            items={[
              { key: 'send', step: '会发生', title: '把作答送去记分与解读', desc: '维度强度由固定权重当场算出；解读由 AI 写，写不出来会如实缺。', current: true },
              { key: 'no-label', step: '不会发生', title: '不生成评分或人格类型', desc: '不打分、不贴类型标签、不判断适不适合某个岗位。' },
              { key: 'no-raw', step: '不会发生', title: '不留存答案原文', desc: '服务端只存作答的哈希；企业、合作机构与管理后台都看不到。' },
            ]}
          />
        </SaCard>
      </SaFrame>
    )
  }

  // ── 正常答题 ──
  const last = cursor === total
  const primaryBlocked = !chosen
    ? '还没有选择本题的答案，选中一项后才能继续'
    : last && !full
      ? `还有 ${total - done} 题没答，答完才能进入提交前确认`
      : null

  return (
    <SaFrame
      {...SA_FRAME_BASE}
      screen="resume-self-assessment-quiz"
      state="quiz"
      status={{ tone: full ? 'ok' : 'warn', label: `已答 ${done}/${total}` }}
      ask={<>第 {cursor} 题，<em>按真实想法选</em>。</>}
      doing={<>当前方向：<b>{current.dimLabel}</b>（第 {current.dimIndex + 1} / {questions.dimensions.length} 个）。已答 {done} 题，还剩 {total - done} 题。</>}
      back={{ label: '返回说明', onBack: () => navigate('/resume/self-assessment/intro') }}
      gate={
        <SaGate tone={chosen ? 'ok' : 'warn'}>
          {chosen
            ? last
              ? full
                ? <><b>{total} 题都已作答。</b>可以进入提交前确认，确认页还能逐题回来改。</>
                : <><b>本题已选择。</b>前面还有没答的题，先把题号里空着的补上。</>
              : <><b>本题已选择。</b>可以进入下一题，之后也能从题号回来改。</>
            : <><b>还没有选择本题的答案，暂时不能前进。</b>选中一项后，「{last ? '去提交前确认' : '下一题'}」才会变为可用。</>}
        </SaGate>
      }
      ctabar={
        <>
          {cursor === 1
            ? <GhostButton label="返回说明" route="/resume/self-assessment/intro" onClick={() => navigate('/resume/self-assessment/intro')} />
            : <GhostButton label="上一题" onClick={() => setCursor(cursor - 1)} />}
          <GuardedButton variant="primary" testId="self-assessment-primary" blockedReason={primaryBlocked}
            onClick={() => { if (last) setStage('review'); else setCursor(cursor + 1) }}>{last ? '去提交前确认' : '下一题'}</GuardedButton>
        </>
      }
    >
      <SaCard head={`第 ${cursor} 题 / 共 ${total} 题`} hint="本次作答不计时" testId="self-assessment-progress">
        <div className="sa-bar" aria-hidden="true"><i style={{ width: `${Math.round((done / Math.max(1, total)) * 100)}%` }} /></div>
        <SaChips
          items={[
            { key: 'done', text: <>已答 <b>{done}</b> 题</> },
            { key: 'left', text: <>还剩 <b>{total - done}</b> 题</> },
            { key: 'dim', text: <>方向 <b>{current.dimLabel}</b></> },
            { key: 'notimer', text: '没有倒计时' },
          ]}
        />
      </SaCard>

      <SaCard head={<span className="sa-qnum">第 {cursor} 题<em>{current.dimLabel}</em></span>}>
        <h2 className="sa-question" id="self-assessment-prompt" data-testid="self-assessment-prompt">{current.prompt}</h2>
        <p className="sa-qhint">选你平时更舒服的那一项，不用揣摩哪个答案更好；选完还可以改。这一页不打分、不排名。</p>
        <div className="sa-answers" role="radiogroup" aria-labelledby="self-assessment-prompt" data-testid="self-assessment-list">
          {current.choices.map((c) => (
            <button
              key={c.key}
              type="button"
              className="sa-answer"
              role="radio"
              aria-checked={chosen === c.key}
              data-testid="self-assessment-answer"
              onClick={() => pick(c.key)}
            >
              <span className="sa-radio" aria-hidden="true" />
              {c.label}
            </button>
          ))}
        </div>
      </SaCard>

      <SaCard head={`${total} 题按 ${questions.dimensions.length} 个方向分行`} hint="深色＝当前题 · 浅绿＝已答可改 · 虚线＝答完前面才开放">
        <SaMapGrid
          testId="self-assessment-question-map"
          rows={gridRows.map(({ dim, dimIndex, ...row }) => ({
            ...row,
            current: dimIndex === current.dimIndex,
            cells: dim.questions.map((q) => {
              const n = flatIndexOf(dim.key, q.idx)
              const locked = n > reach
              const answeredHere = Boolean(answers[dim.key]?.[q.idx])
              const kind = n === cursor ? 'current' : answeredHere ? 'done' : locked ? 'locked' : 'open'
              return {
                key: `${dim.key}-${q.idx}`,
                kind,
                number: n,
                ariaLabel: `第 ${n} 题（${dim.label}）${locked ? '，答完前面的题才能进入' : answeredHere ? '，已作答，可修改' : '，当前可作答'}`,
                onSelect: () => setCursor(n),
              } as const
            }),
          }))}
        />
        <div className="sa-quickrow">
          <button type="button" className="sa-quick" data-testid="self-assessment-restart" onClick={restart}>
            ↻ 重新开始（清空本次 {done} 个答案）
          </button>
          <button type="button" className="sa-quick" data-testid="self-assessment-exit" onClick={() => { clearSession(); navigate(SA_BACK_ROUTE) }}>
            ✕ 退出并清空，回简历服务
          </button>
        </div>
      </SaCard>

      <SaNotice>
        <AiCapabilityChip tone="ai" />
        <span>提交后维度强度由固定权重当场算出，解读由 AI 写；AI 不可用时记分照常，<b>这次不会有解读，也不会用别的东西顶上</b>。</span>
      </SaNotice>
    </SaFrame>
  )
}

// ============================================================
// 3) 结果页
// ============================================================
export function SelfAssessmentResultPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const [searchParams] = useSearchParams()
  const [session, setSession] = useState<SelfAssessmentSession>(() => loadSession())
  const linkedTaskId = searchParams.get('taskId')
  /** 请求在飞：`running` 的唯一来源，永远等于「后端已受理且这次调用还没回来」。 */
  const [inflight, setInflight] = useState<'submit' | 'fetch' | null>(null)
  const [taskError, setTaskError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const startedRef = useRef<string | null>(null)
  const mountedRef = useRef(true)
  const [printing, setPrinting] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  // 撤回二次确认用页内遮罩，不用浏览器原生 confirm（Kiosk 全屏下样式 / 触控不受控）（SES-06）
  const [withdrawConfirmOpen, setWithdrawConfirmOpen] = useState(false)
  const [printed, setPrinted] = useState<{ fileId: string; signedUrl: string; printFileUrl?: string; filename: string; pageCount: number; sizeBytes: number; expiresAt?: string } | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useSelfAssessmentIdleExit(inflight === null && !printing && !withdrawing && !previewOpen)

  const result = session.result ?? null
  const taskId = session.taskId ?? result?.taskId ?? linkedTaskId
  const consentOk = hasCurrentConsent(session)
  // 依赖必须是稳定引用，否则下面那个 effect 会被反复触发。
  const pendingAnswers = useMemo(() => flattenAnswers(session.answers), [session.answers])
  const pendingComplete = useMemo(() => {
    const { done, total } = progress(questionsFor(session.consent.sensitive === true), session.answers)
    return total > 0 && done >= total
  }, [session.answers, session.consent.sensitive])
  useBusyLock(printing || withdrawing || inflight !== null)

  // StrictMode 会把 effect 演一遍再重来。挂载守卫必须在 effect 体里**重新置真**，
  // 否则演练的那次卸载会把它永久钉死在 false，请求回来时不敢再 setState
  // （与 `pages/resume/components/ResumeUsbImportPanel.tsx` 同一处置）。
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  /**
   * 本页两件网络事，互斥，都由真实生命周期驱动，没有任何计时器：
   *   submit —— 交卷（服务端在这一次调用里同步跑 LLM 解读）；
   *   fetch  —— 带 `?taskId=` 深链回看时按编号读回（GET /:taskId 的唯一消费点）。
   * 同意门禁在这里再拦一次：`consentOk` 为假一律不发 submit，深链绕不过去。
   * 去重靠 `startedRef`，**不靠 cleanup 里的 active 标志** —— effect 一旦重演，
   * cleanup 作废上一发、去重又拦下第二发，结果是永远停在「正在生成」。
   */
  useEffect(() => {
    if (result) return
    const mode: 'submit' | 'fetch' | null =
      consentOk && pendingComplete ? 'submit' : linkedTaskId ? 'fetch' : null
    if (!mode) return
    const runKey = `${mode}:${linkedTaskId ?? 'session'}:${attempt}`
    if (startedRef.current === runKey) return
    startedRef.current = runKey

    setInflight(mode)
    setTaskError(null)
    const request = mode === 'submit'
      ? submitSelfAssessment(
          {
            answers: pendingAnswers,
            // 送会话里存的那一版，不是 SELF_ASSESSMENT_CONSENT_VERSION 常量：
            // 报「用户实际同意的是哪一版」，而不是「本次构建认为当前是哪一版」。
            consent: {
              nonSensitive: session.consent.nonSensitive,
              sensitive: session.consent.sensitive,
              consentVersion: session.consentVersion,
            },
          },
          { token: getToken(), accessToken: session.accessToken },
        )
      : getLatestSelfAssessment(linkedTaskId as string, { token: getToken(), accessToken: session.accessToken })

    void request
      .then((data) => {
        if (!mountedRef.current) return
        setSession((prev) => {
          const next: SelfAssessmentSession = {
            ...prev,
            taskId: data.taskId,
            accessToken: data.accessToken ?? prev.accessToken,
            result: data,
          }
          saveSession(next)
          return next
        })
      })
      .catch((err: unknown) => {
        // 失败必须看得见：不把「没生成出来 / 读不回来」渲染成「生成完了但内容为空」。
        if (mountedRef.current) setTaskError(err instanceof SelfAssessmentApiError ? err.message : mode === 'submit' ? '提交失败，请稍后重试' : '这次结果读取失败，请稍后重试')
      })
      .finally(() => { if (mountedRef.current) setInflight(null) })
  }, [attempt, consentOk, getToken, linkedTaskId, pendingAnswers, pendingComplete, result, session.accessToken, session.consent.nonSensitive, session.consent.sensitive, session.consentVersion])

  // ── AI 任务四态（S1-1）。取的全是后端真值，前端没有可以自行推进的地方。 ──
  //   unavailable —— 后端明说 LLM 调不通（`llm-self-assessment.service.ts:113-118`）；
  //   available   —— 已拿到本次响应，或本次调用正在飞（尚无不可用的反证）；
  //   unknown     —— 既没发调用也没有响应，fail-closed 停 idle，不画进度。
  // 本项目没有 AI 专用健康探针，`useApiReadiness` 只证明 API 可达，拿它当 AI 可用性
  // 是过度宣称 —— 这里只认「这次调用自己的返回」。
  // failed 还含「解读全空」：不把「没生成出来」画成「生成完了但内容为空」。
  // 响应缺 `dimensions` = 这次结果不可用。此前这里直接 `result.dimensions.some(...)`，
  // 形状一变就整页崩到路由错误边界（白屏），用户看到的是「页面暂时无法显示」而不是
  // 「这次没拿到结果」—— 白屏既说不清发生了什么，也把重试入口一起带走了。
  const dimensions = Array.isArray(result?.dimensions) ? result.dimensions : null
  const malformed = Boolean(result) && dimensions === null
  const hasInterpretation = (dimensions?.some((d) => Boolean(d.note)) ?? false) || Boolean(result?.summary)
  const aiUnavailable = result?.providerName === 'llm_unavailable'
  const availability: AiAvailability = aiUnavailable ? 'unavailable' : result || inflight ? 'available' : 'unknown'
  const task = useAiTask({
    availability,
    pending: inflight !== null,
    failed: Boolean(taskError) || malformed || (Boolean(result) && (result?.status === 'rejected' || !hasInterpretation)),
    hasResult: hasInterpretation,
  })

  if (!result || !taskId || !dimensions) {
    const failure = taskError ?? (malformed ? '服务端这次返回的结果缺少维度数据，本页不展示不完整结果。' : null)
    const state = inflight === 'submit' ? 'submitting' : inflight === 'fetch' ? 'fetching' : failure ? 'result-error' : 'result-empty'
    const status: SaStatus = inflight
      ? { tone: 'unknown', label: inflight === 'submit' ? '正在生成' : '正在读取' }
      : failure
        ? { tone: 'bad', label: '这次没拿到结果' }
        : { tone: 'unknown', label: '无最近结果' }
    return (
      <SaFrame
        {...SA_FRAME_BASE}
        screen="resume-self-assessment-result"
        state={state}
          status={status}
          ask={inflight ? <>请稍候，<em>这一步在等服务端</em>。</> : failure ? <>这次<em>没能拿到结果</em>。</> : <>还没有<em>可查看的结果</em>。</>}
        doing={inflight
          ? <>页面不设倒计时，也不会自己变成「完成」；<b>只有服务端真实返回才会换屏。</b></>
          : failure
            ? <>失败原因写在下面。<b>页面不会用别的东西顶上，也不会假装已完成。</b></>
            : <>完成页只在本次答满并提交后才有内容。<b>直接打开这个地址不会补一个结果给你看。</b></>}
          back={{ label: '返回简历服务', onBack: () => navigate(SA_BACK_ROUTE) }}
        ctabar={
          <>
            <GhostButton label="返回简历服务" route={SA_BACK_ROUTE} onClick={() => navigate(SA_BACK_ROUTE)} />
            <PrimaryButton label={failure ? '重新作答' : '去看说明并开始'} onClick={() => navigate('/resume/self-assessment/intro')} />
          </>
        }
      >
        <AiTaskRegion task={task} label="AI 陈述式解读" className="sa-ai-region"
          fallback={{
            mode: 'result-unavailable',
            reason: failure ?? '这次没能拿到结果，页面不会用别的东西顶上。',
            retryHint: `${linkedTaskId ? `记录编号 ${linkedTaskId}。` : ''}作答还留在这台机器上，可以直接重试；离开或闲置 60 秒会清空。`,
            action: { label: '重试这一次', onClick: () => { startedRef.current = null; setAttempt((n) => n + 1) } },
          }}
          running={
            <SaCard head={inflight === 'submit' ? '正在生成本次解读' : '正在读取这次结果'} hint="等服务端真实返回">
              <p className="sa-sub" data-ai-progress="true">
                {inflight === 'submit'
                  ? '维度强度由固定权重当场算出，解读由 AI 写 —— 这一步在等服务端的真实返回，页面不设倒计时，也不会自己变成「完成」。'
                  : '正在按记录编号向服务端读回本次结果。'}
              </p>
            </SaCard>
          }
          idle={
            <SaCard head="暂无最近结果" hint="不是没加载出来，是本来就不存" tone="down">
              <SaChips
                items={[
                  { key: 'none', text: <>本次会话<b>没有已提交的作答</b></>, tone: 'warn' },
                  { key: 'ttl', text: '结果只在本机保留 24 小时' },
                  { key: 'noguess', text: '不补一个示例结果' },
                ]}
              />
              <p className="sa-sub">请先完成作答；结果只在本机保留 24 小时，过期会自动清理。</p>
            </SaCard>
          }
        />
        <SaCard head="现在可以做什么" hint="都是现在就能打开的入口">
          <SaPicks items={saExits(navigate, '/resume/self-assessment/result', false)} />
        </SaCard>
      </SaFrame>
    )
  }

  const handlePrint = async () => {
    setPrinting(true)
    setError(null)
    try {
      const file = await printSelfAssessment(taskId, { token: getToken(), accessToken: session.accessToken })
      setPrinted({
        fileId: file.fileId,
        signedUrl: file.signedUrl,
        printFileUrl: file.printFileUrl,
        filename: file.filename,
        pageCount: file.pageCount,
        sizeBytes: file.sizeBytes,
        expiresAt: file.expiresAt,
      })
      setPreviewOpen(true)
    } catch (err) {
      setError(err instanceof SelfAssessmentApiError ? err.message : '打印文件生成失败')
    } finally {
      setPrinting(false)
    }
  }

  /**
   * 交接到打印工作台核价（`interface-handoff.md` §2A：先落地资产、拿到真实文件再开出口）。
   * 只有服务端签出的 `printFileUrl` 能被打印链路认；缺它就置灰并写清原因，不假装能打。
   */
  const handoffToPrint = () => {
    if (!printed?.printFileUrl) return
    navigate('/print/confirm', {
      state: {
        file: {
          name: printed.filename,
          size: formatBytes(printed.sizeBytes),
          pages: printed.pageCount,
          fileId: printed.fileId,
          fileUrl: printed.printFileUrl,
          mimeType: 'application/pdf',
        },
        params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
      },
    })
  }

  const handleWithdraw = () => { setWithdrawConfirmOpen(true) }

  const confirmWithdraw = async () => {
    setWithdrawConfirmOpen(false)
    setWithdrawing(true)
    setError(null)
    try {
      await withdrawSelfAssessment(taskId, { token: getToken(), accessToken: session.accessToken })
      clearSession()
      navigate('/')
    } catch (err) {
      setError(err instanceof SelfAssessmentApiError ? err.message : '撤回失败')
    } finally {
      setWithdrawing(false)
    }
  }

  // 匿名 + 整体拒答时服务端不签发 accessToken（`self-assessment.service.ts:240-247`），
  // 后续 print / withdraw 必然 403 —— 与其让用户点了才报错，不如当面说清。
  const hasAccess = Boolean(getToken() || session.accessToken)
  const accessReason = hasAccess ? null : '本次未拿到访问凭证（AI 解读整体失败时服务端不签发），无法生成打印件或撤回；记录会在到期后自动清理。'

  const fallback: AiTaskFallback = {
    // AI 是这几段解读的唯一产出源，且没有「点一下重试」的入口 —— 结果区直接说办不到，
    // 不编一条假的手动路径（三种降级里只有 result-unavailable 对得上本页）。
    mode: 'result-unavailable',
    reason: aiUnavailable
      ? 'AI 解读服务当前不可用，这几段陈述这次没有生成。前面三步（作答、记分、依据题号）都已完成。'
      : result.failReason
        ?? '本次解读未能生成合规结果，已整体丢弃，不做任何替换或补写。',
    retryHint: '答案原文不留存，服务恢复后也补不回这一次；要拿到解读需要重新作答（约 5 分钟）。下面的维度强度与依据题号不依赖 AI，现在就能看、能打印。',
    action: { label: '重新作答（约 5 分钟）', onClick: () => { clearSession(); navigate('/resume/self-assessment/intro') } },
  }

  const completedAt = formatDateTime(session.consentedAt)
  const expiresAt = formatDateTime(result.expiresAt)
  const aiFailed = task.isFailed

  return (
    <SaFrame
      {...SA_FRAME_BASE}
      screen="resume-self-assessment-result"
      state={aiFailed ? 'result-ai-down' : 'result-ready'}
      status={aiFailed ? { tone: 'warn', label: 'AI 解读缺失' } : { tone: 'ok', label: '本次结果已生成' }}
      ask={<>本次作答<em>已完成并提交</em>。</>}
      doing={<>本页只陈述本次作答的倾向参考。<b>不评分、不排名，不生成人格类型，也不判断适不适合某个岗位。</b></>}
      back={{ label: '返回简历服务', onBack: () => navigate(SA_BACK_ROUTE) }}
      ctabar={
        <>
          <GhostButton label="查看记录" route="/resume/self-assessment/history" onClick={() => navigate('/resume/self-assessment/history')} />
          <GuardedButton variant="teal" testId="self-assessment-print" onClick={() => void handlePrint()}
            blockedReason={printing ? '正在生成 PDF，请稍候' : accessReason}>{printing ? '生成 PDF 中…' : '生成 PDF 预览'}</GuardedButton>
          <GuardedButton variant="danger" testId="self-assessment-withdraw" onClick={handleWithdraw}
            blockedReason={withdrawing ? '正在撤回，请稍候' : accessReason}>{withdrawing ? '撤回中…' : '撤回本次探索'}</GuardedButton>
        </>
      }
    >
      <SaCard head="本次自我探索已完成" hint="仅供本人参考" tone="lead">
        <SaChips
          items={[
            { key: 'dims', text: <>覆盖 <b>{dimensions.length}</b> 个方向</> },
            { key: 'norank', text: '不评分、不排名' },
            { key: 'self', text: '仅本人可见' },
            aiFailed
              ? { key: 'ai', text: <>AI 解读<b>本次未生成</b></>, tone: 'warn' as const }
              : { key: 'ai', text: 'AI 解读已生成' },
          ]}
        />
        <p className="sa-sub">
          本结果基于本人作答的 {dimensions.length} 维度倾向，不含临床 / 心理 / 人格诊断；
          不代任何招聘结果、能力证明或心理评估；不向企业、合作机构或第三方推送。
        </p>
        <SaMeta
          items={[
            { key: 'task', label: '记录编号', value: taskId, mono: true },
            { key: 'consented', label: '同意时间', value: completedAt ?? '本机会话未记录' },
            { key: 'version', label: '同意版本', value: session.consentVersion ?? '本机会话未记录（本次结果由记录编号读回）' },
            { key: 'expires', label: '保留至', value: expiresAt ?? '未返回到期时间（撤回后或整体拒答时无到期）' },
          ]}
        />
      </SaCard>

      {/* AI 只负责这一块，它挂了不影响下面的维度强度与依据题号。走到这里 result
          一定在手，四态只可能是 done / failed，running / idle 由上一支负责。 */}
      <AiTaskRegion task={task} label="AI 陈述式解读" className="sa-ai-region" fallback={fallback}>
        <SaCard head="整体解读" hint={<AigcMark />}>
          {result.summary
            ? <AiConclusion text={result.summary} />
            : <p className="sa-sub sa-muted">本次整体解读未生成（受合规要求被拒或未启用）。</p>}
          <p className="sa-sub">
            这几段只描述<b>本次作答</b>，不打分、不排名、不说适合或不适合哪类岗位。隔一段时间再做，答不一样话就不一样。
          </p>
        </SaCard>
      </AiTaskRegion>

      <SaCard head="维度强度与依据" hint="这一块不经过 AI">
        <p className="sa-sub" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <EvidenceBadge level="E2" />
          <span>
            每一项的强度都是<b>固定权重累加</b>算出来的，依据只有你自己的选择
            <EvidenceBadge level="E1" compact />
            。这部分不经过 AI{aiFailed ? '，所以这次 AI 没成也照常有' : ''}。
          </span>
        </p>
        <div className="sa-dims">
          {dimensions.map((d) => <DimensionCard key={d.key} d={d} aiFailed={aiFailed} />)}
        </div>
      </SaCard>

      {error ? (
        <SaCard head="操作失败" hint="这次失败不改动任何已有记录" tone="down">
          <p className="sa-sub">{error}</p>
        </SaCard>
      ) : null}

      {printed ? (
        <SaCard head="PDF 已生成" hint={`${printed.filename} · ${printed.pageCount} 页 · ${formatBytes(printed.sizeBytes)}`}>
          <div className="sa-quickrow">
            <button type="button" className="sa-quick" onClick={() => setPreviewOpen(true)}>页内预览 PDF</button>
            <GuardedButton onClick={handoffToPrint}
              blockedReason={printed.printFileUrl ? null : '打印链接未就绪，这份文件暂时送不到打印工作台；页内预览与扫码带走不受影响。'}>去打印工作台核价</GuardedButton>
          </div>
        </SaCard>
      ) : null}

      {withdrawConfirmOpen ? (
        <SaConfirmOverlay
          title="撤回本次探索" description="本次自我探索将被物理删除，结果不可恢复。是否继续？"
          cancelLabel="取消" confirmLabel="确认撤回"
          onCancel={() => setWithdrawConfirmOpen(false)} onConfirm={() => void confirmWithdraw()}
        />
      ) : null}

      {previewOpen && printed ? (
        <FilePreviewDialog
          fileUrl={printed.signedUrl} fileName={printed.filename} mimeType="application/pdf"
          phoneDownloadUrl={printed.signedUrl} expiresAt={printed.expiresAt} regenerating={printing}
          onRegenerate={() => { void handlePrint() }} onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </SaFrame>
  )
}

function DimensionCard({ d, aiFailed }: { d: SelfAssessmentDimensionResult; aiFailed: boolean }) {
  const label = SELF_ASSESSMENT_DIMENSIONS.find((dim) => dim.key === d.key)?.label ?? d.label
  return (
    <section className="sa-dim">
      <div className="sa-dim-h">
        <h3>{label}</h3>
        <span className="sa-strength">强度 {d.strength}/5</span>
      </div>
      {d.note ? <AiConclusion text={d.note} /> : (
        <p className="sa-muted">
          {aiFailed ? '本次解读未生成 —— 缺的只是这段文字，强度与依据题号已经算出来了。' : '本维度解读未生成。'}
        </p>
      )}
      <footer>
        依据：本组第 {d.evidenceQuestionIdx.length > 0 ? d.evidenceQuestionIdx.map((i) => i + 1).join('、') : '—'} 题的选择（只记题号，不含选项内容）。
        本解读仅描述本次作答的倾向，不构成能力评价或职业推荐。
      </footer>
    </section>
  )
}

// ============================================================
// 4) 记录页（生产口径：独立路由，不是结果页里的一个阶段）
//
// 切分差异（缺页规划 #619 G-11）：原型把「往期记录」做成同一页的 s4 阶段，生产是
// 独立路由且被 verify-fusion-w5 / w6 的路由清单锁定 —— **以生产的独立路由为准**：
// 结果页只回答「这次是什么」，本页只回答「我做过没有、去哪看明细」，一屏一件事。
// 诚实边界：服务端没有「按人列出历次」的端点（只有 GET /:taskId 按编号读回），
// 所以本页不编列表 —— 只显示当前会话这一次，跨次明细指向「我的 → AI 服务记录」。
// ============================================================
export function SelfAssessmentHistoryPage() {
  const navigate = useNavigate()
  const session = useMemo(() => loadSession(), [])
  useSelfAssessmentIdleExit()
  const current = session.taskId ?? session.result?.taskId ?? null
  const consentedAt = formatDateTime(session.consentedAt)
  const expiresAt = formatDateTime(session.result?.expiresAt)
  const answered = session.result?.dimensions?.length ?? 0

  return (
    <SaFrame
      {...SA_FRAME_BASE}
      screen="resume-self-assessment-history"
      state={current ? 'history-current' : 'history-empty'}
      status={current ? { tone: 'ok', label: '本机有 1 条记录' } : { tone: 'unknown', label: '本机无记录' }}
      ask={current ? <>这台机器上<em>有本次记录</em>。</> : <>这台机器上<em>还没有记录</em>。</>}
      doing={<>本页不生成示例历史，也不把未提交的答案写成记录。<b>跨次历史由账号侧的「AI 服务记录」负责，本页不做跨次对比。</b></>}
      back={{ label: '返回简历服务', onBack: () => navigate(SA_BACK_ROUTE) }}
      ctabar={
        <>
          <GhostButton label="返回说明" route="/resume/self-assessment/intro" onClick={() => navigate('/resume/self-assessment/intro')} />
          <PrimaryButton label="前往 AI 服务记录" onClick={() => navigate('/me/ai-records')} />
        </>
      }
    >
      {current ? (
        <SaCard head="这台机器上的本次记录" hint="只对本人可见" tone="lead" testId="self-assessment-list">
          <SaMeta
            items={[
              { key: 'task', label: '记录编号', value: current, mono: true },
              { key: 'consented', label: '同意时间', value: consentedAt ?? '未记录' },
              { key: 'dims', label: '维度', value: answered > 0 ? `${answered} 个维度已出结果` : '未拿到结果' },
              { key: 'expires', label: '保留至', value: expiresAt ?? '未返回到期时间' },
            ]}
          />
          <div className="sa-quickrow">
            <button
              type="button"
              className="sa-quick"
              data-route="/resume/self-assessment/result"
              onClick={() => navigate(`/resume/self-assessment/result?taskId=${encodeURIComponent(current)}`)}
            >
              回看这次结果
            </button>
          </div>
        </SaCard>
      ) : (
        <SaCard head="这里还没有可查看的记录" hint="不是没加载出来，是本来就不存" testId="self-assessment-list">
          <SaChips
            items={[
              { key: 'none', text: <>本机会话<b>没有记录</b></>, tone: 'warn' },
              { key: 'nofake', text: '不生成示例历史' },
              { key: 'nodraft', text: '未提交的答案不算记录' },
            ]}
          />
          <p className="sa-sub">
            匿名会话不留库，会话退出后本机记录自动清理；会员本人历史可在「我的 → AI 服务记录 → 自我探索」查看与管理。
          </p>
        </SaCard>
      )}

      <SaCard head="这里没有什么" hint="每一条都可核对">
        <SaMeta
          items={[
            { key: 'raw', label: '答案原文', value: '从未入库' },
            { key: 'expired', label: '过期的解读', value: '到期自动清理' },
            { key: 'withdrawn', label: '撤回的那次', value: '已物理删除，不可恢复' },
            { key: 'enterprise', label: '企业 / 合作机构 / 管理后台', value: '都看不到，也不参与岗位排序' },
          ]}
        />
        <p className="sa-sub">
          本页不做跨次对比 —— 要能比就得留着两次的作答原文，本机选了不留，这是取舍不是漏做。
        </p>
      </SaCard>

      <SaCard head="现在可以做什么" hint="都是现在就能打开的入口" grow>
        <SaPicks items={saExits(navigate, '/resume/self-assessment/history', hasCurrentConsent(session) && !session.result)} />
      </SaCard>

      <SaNotice>
        本次作答只存在于这台机器的当前浏览器会话，<b>不是账号记录</b>，退出或闲置 60 秒会被清掉，不会留给下一位使用者。
      </SaNotice>
    </SaFrame>
  )
}

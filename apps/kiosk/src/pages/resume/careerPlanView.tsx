// 求职方案各状态的正文。从 CareerPlanPage 拆出，避免单文件超过 500 行。
// 壳上的读取、生成、打印与身份门控仍留在 CareerPlanPage。
import type { ReactNode } from 'react'
import type { CareerPlanResponse } from '@ai-job-print/shared'
import {
  ArrowRightIcon, BotIcon, CompassIcon, HelpCircleIcon,
  PencilLineIcon, PrinterIcon, RefreshCwIcon, RouteIcon, TargetIcon,
} from 'lucide-react'
import { AiConclusion, AigcMark, EvidenceLegend, type AiAvailability, type AiTaskFallback, type AiTaskStatus } from '../../ai'
import { Action } from './careerPlanAction'
import { buildCareerPlanUnreadyView } from './careerPlanUnreadyView'
import { CareerPlanExistingMaterials } from './components/career-plan/CareerPlanExistingMaterials'
import { CareerPlanSelfAssessmentExcluded } from './components/career-plan/CareerPlanSelfAssessmentExcluded'
import { CareerPlanColumns, CareerPlanGenerateRegion } from './components/career-plan/CareerPlanSection'
import { CtaNote, Ghosts, Guardline, KitRows, ListRows, Nots, RouteCards, Sec, Steps, Verdict, Waiting, Why } from './jobFit/jobFitQxKit'

export type CareerScreen =
  | 'session-ended' | 'missing-task' | 'rejected-task' | 'loading' | 'guide' | 'generating' | 'ai-down' | 'failed'
  | 'ready' | 'print-pending' | 'print-failed' | 'print-degraded'

export interface CareerPlanViewDeps {
  screen: CareerScreen
  plan: CareerPlanResponse | null
  availability: AiAvailability
  degradedPrint: { filename: string; pageCount: number; go: () => void } | null
  printError: string | null
  goUpload: () => void
  goResumeHub: () => void
  goJobFit: () => void
  goOptimize: () => void
  goPrintHub: () => void
  goSelfAssessment: () => void
  navigate: (to: string) => void
  handleGenerate: () => void
  handlePrint: () => void
  setDegradedPrint: (value: { filename: string; pageCount: number; go: () => void } | null) => void
  setPrintError: (value: string | null) => void
  hostingOpen: boolean
  getToken: () => string | null
  aiTask: AiTaskStatus
  fallback: AiTaskFallback
  error: string | null
  printButton: ReactNode
  generateButton: ReactNode
}

export function buildCareerPlanView(d: CareerPlanViewDeps) {
  const {
    screen, plan, availability, degradedPrint, printError,
    goUpload, goResumeHub, goJobFit, goOptimize, goPrintHub, goSelfAssessment,
    navigate, handleGenerate, handlePrint, setDegradedPrint, setPrintError,
    hostingOpen, getToken, aiTask, fallback, error, printButton, generateButton,
  } = d
  function buildView(): { title: string; subtitle: string; pill: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }; body: ReactNode; cta: ReactNode } {
    if (screen === 'missing-task') return {
      title: '规划要基于真实材料',
      subtitle: '求职方案会基于已完成的简历诊断整理已有材料、目标与方向、尚需准备和执行计划；没有可读取的本人简历任务时，不生成任何个人规划内容。',
      pill: { tone: 'warn', label: '缺少可读取的本人简历任务' },
      body: (
        <>
          <Sec title="当前状态" hint="只写已确认的事实">
            <Verdict items={[
              { tone: 'bad', label: '本人简历任务', value: '尚未可用' },
              { tone: 'warn', label: '求职方案', value: '尚未生成' },
              { tone: 'ok', label: '材料与打印', value: '不受影响' },
            ]} />
          </Sec>
          <Sec title="规划会用到、也只会用到这些" hint="输入范围写在前面" grow>
            <ListRows items={[
              '当前本人简历任务里的经历、技能与教育信息',
              '你自己填写或选择的目标方向（可以留空）',
              '本人此前的简历对照，且需要你同意这次使用',
              '本人此前的模拟面试摘要，且需要你同意这次使用',
              '不使用他人材料，不引入企业侧数据，不做录用或收入承诺',
            ]} />
          </Sec>
          <Sec title="现在能做的两件事" hint="按你手上有什么来选">
            <RouteCards items={[
              { title: '上传或扫描简历', desc: '有了可读取的简历任务，才能开始做规划。', action: '去简历上传', onClick: goUpload },
              { title: '先和 AI 顾问聊目标', desc: '还没想清楚方向时，可以先把想法说出来。', action: '去 AI 顾问', onClick: () => navigate('/assistant') },
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>没有可读取的简历任务时，不生成任何个人规划内容。</CtaNote>
          <Action label="返回简历服务" variant="ghost" onClick={goResumeHub} />
          <Action label="去上传简历" variant="primary" onClick={goUpload} icon={<ArrowRightIcon size={22} aria-hidden="true" />} />
        </>
      ),
    }

    // 出口一律不带 taskId / accessToken：会话已经不属于现在站在屏幕前的这一位。
    if (screen === 'session-ended') return {
      title: '这次办理已结束',
      subtitle: '登录状态或这台机器上的这次使用刚刚变化（退出、过期或清场）。刚才的求职方案、打印件和还在路上的请求都不再显示或继续。',
      pill: { tone: 'warn', label: '这次办理已结束 · 内容已隐藏' },
      body: (
        <>
          <Sec title="这次请求的结果" hint="只写已经确认的事实">
            <Verdict items={[
              { tone: 'warn', label: '这次办理', value: '已结束' },
              { tone: 'bad', label: '刚才的方案', value: '已隐藏' },
            ]} />
          </Sec>
          <Sec title="你能确认的事" hint="不猜测具体故障">
            <Why items={[
              { head: '你能确认', title: '这次使用已经变化', desc: '退出、过期或清场之后，刚才的方案不再属于现在站在屏幕前的这一位。' },
              { head: '你能确认', title: '方案与打印件已隐藏', desc: '不再显示刚才的规划、依据或材料。' },
              { head: '你能确认', title: '不再继续生成或打印', desc: '不再用刚才的登录凭证读取、生成或打印。' },
              { head: '你能确认', title: '在途结果已停', desc: '还在路上的返回结果不会再进入打印确认。' },
              { head: '边界', title: '仍不提供给企业', desc: '无论这次办理是否结束，规划内容都不提供给企业或第三方。' },
            ]} />
          </Sec>
          <Sec title="接下来三选一" hint="都进入既有流程">
            <RouteCards items={[
              { title: '返回简历服务', desc: '刚才的方案、打印件和还在路上的请求都不再显示。', action: '返回简历服务', onClick: goResumeHub },
              { title: '重新上传简历', desc: '需要继续时，重新准备一份可读取的简历。', action: '重新上传', onClick: goUpload },
              { title: '查看帮助', desc: '操作说明和联系方式都在帮助页，不依赖刚才那次登录。', action: '打开帮助', onClick: () => navigate('/help') },
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>需要继续时，请重新登录或重新上传简历。</CtaNote>
          <Action label="返回简历服务" variant="ghost" onClick={goResumeHub} />
          <Action label="重新上传简历" variant="primary" onClick={goUpload} icon={<ArrowRightIcon size={22} aria-hidden="true" />} />
        </>
      ),
    }

    if (screen === 'rejected-task') return {
      title: '这台机器上读不到你那份简历解析结果了',
      subtitle: '解析结果有保存期限，也只对本人开放。这次读不到它，所以本页拿不到任何依据 —— 重新上传一次简历、跑完诊断，就能回到这里生成。',
      pill: { tone: 'bad', label: '简历任务不可读取' },
      body: (
        <>
          <Sec title="这次请求的结果" hint="只写已经确认的事实">
            <Verdict items={[
              { tone: 'bad', label: '本人简历任务', value: '不可读取' },
              { tone: 'warn', label: '求职方案', value: '尚未生成' },
              { tone: 'ok', label: '不会顶替', value: '不用他人任务' },
            ]} />
          </Sec>
          <Sec title="让它重新可用的三步" hint="每一步都在既有流程里">
            <Steps items={[
              { title: '重新上传或扫描一份简历', desc: '进入简历材料入口，选择文件上传、纸质扫描或手机传输。' },
              { title: '等待解析完成', desc: '解析成功后才会出现可用任务；失败会直接显示失败原因。' },
              { title: '回到求职方案生成', desc: '任务可用后，再由你确认开始生成。' },
            ]} />
          </Sec>
          <Sec title="这次没有发生的事" hint="明确否定，避免误解">
            <Nots items={['没有读取到本人简历原文', '没有生成任何方向或计划', '没有把简历内容提供给企业或第三方']} />
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>不会用其他人的任务或历史结果顶替这份不可读取的任务。</CtaNote>
          <Action label="返回简历服务" variant="ghost" onClick={goResumeHub} />
          <Action label="重新上传简历" variant="primary" onClick={goUpload} icon={<ArrowRightIcon size={22} aria-hidden="true" />} />
        </>
      ),
    }

    if (screen === 'loading') return {
      title: '正在读取你的求职方案',
      subtitle: '读取的是本人此前保存的规划。读到才显示；没有或读取失败会直接说明。',
      pill: { tone: 'unknown', label: '正在读取已有求职方案' },
      body: (
        <>
          <Sec title="正在确认是否存在可继续查看的真实规划结果" hint="无进度条 · 无预计时间">
            <Waiting icon={<RouteIcon size={34} />} title="读取请求已提交，等待返回" desc="读取成功才显示方向、技能计划和行动清单；没有已有规划时会转到生成入口，不显示空壳内容。" tag="整体等待中，没有百分比" />
          </Sec>
          <Sec title="读取之后会怎么走" hint="三种结果都写清楚" grow>
            <Steps items={[
              { title: '读到已有规划', desc: '直接显示上一次生成的内容，全部由系统提供。' },
              { title: '没有已有规划', desc: '转到生成入口，由你确认后再开始，不会自动替你生成。' },
              { title: '读取失败', desc: '直接显示失败状态，不用模板内容或他人内容顶替。' },
            ]} />
          </Sec>
          <Sec title="还没有返回的内容" hint="返回前一律留空">
            <Ghosts items={[
              { title: '目标与方向', desc: '方向、原因与第一步由结果给出。', tag: '等待返回' },
              { title: '尚需准备', desc: '技能缺口按阶段返回后才显示。', tag: '等待返回' },
              { title: '执行计划', desc: '近期清单返回后才显示。', tag: '等待返回' },
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>读取期间不生成、不保存、不打印任何内容。</CtaNote>
          <Action label="返回简历服务" variant="ghost" onClick={goResumeHub} />
          <Action label="取消读取，先看简历对照" variant="primary" onClick={goJobFit} />
        </>
      ),
    }

    if (screen === 'print-pending') return {
      title: '打印件还在等生成',
      subtitle: '文件真实生成后才进入既有打印确认流程；本页不代表已经打印。',
      pill: { tone: 'unknown', label: '等待生成打印文件' },
      body: (
        <>
          <Sec title="已提交生成打印件" hint="生成 ≠ 打印">
            <Waiting icon={<PrinterIcon size={34} />} title="请求已提交，等待文件生成" desc="生成成功后进入打印确认页，由你确认份数、单双面和费用。" tag="等待生成，没有进度和预计时间" />
          </Sec>
          <Sec title="打印这件事的真实状态" hint="逐条对照，不含糊">
            <ListRows items={[
              '打印文件还没有返回，没有可预览的版本',
              '打印机没有收到任务，也没有开始出纸',
              '没有取件码，也没有订单号',
              '本页没有发起支付',
              '生成成功后会进入打印确认页，由你逐项确认后再打印',
            ]} />
          </Sec>
          <Sec title="生成成功后才会出现" hint="现在一律留空">
            <Ghosts items={[
              { title: '打印预览', desc: '文件生成后才可以预览页数与版式。', tag: '等待生成' },
              { title: '打印确认', desc: '份数、单双面与费用在确认页由你决定。', tag: '等待生成' },
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>离开本页后，这次生成的结果不会再把你带去打印确认页。</CtaNote>
          <Action label="返回简历服务" variant="ghost" onClick={goResumeHub} />
          <Action label="改用现有文件打印" variant="primary" onClick={goPrintHub} />
        </>
      ),
    }

    if (screen === 'print-failed') return {
      title: '打印件没有生成',
      subtitle: '文件生成失败。系统不会把失败写成已发送到打印机，也不产生取件码。',
      pill: { tone: 'bad', label: '打印文件生成失败' },
      body: (
        <>
          <Sec title="这次的结果" hint="只写已确认的事实">
            <Verdict items={[
              { tone: 'bad', label: '打印文件', value: '未生成' },
              { tone: 'ok', label: plan ? '规划内容' : '生成入口', value: plan ? '仍可查看' : '仍可使用' },
              { tone: 'ok', label: '打印机', value: '未收到任务' },
            ]} />
            {printError && <p className="jfq-alert" role="alert">{printError}</p>}
          </Sec>
          <Sec title="可以按这个顺序试" hint="从代价最小的开始">
            <Steps items={[
              { title: '先确认规划内容仍可打开', desc: '回到求职方案，确认内容还在，再决定要不要重试。' },
              { title: '重新生成一次打印版', desc: '沿用当前规划再试，不需要重新生成规划本身。' },
              { title: '仍然失败就换现有文件', desc: '手上已有可用文件或纸质件时，直接走既有打印流程。' },
              { title: '需要帮助时看帮助页', desc: '帮助页有操作说明和联系方式。' },
              { title: '没有生成成功就不会下单', desc: '没有生成成功就不会进入打印确认，也不会产生取件码。' },
            ]} />
          </Sec>
          <Sec title="三个既有入口" hint="按需要选一个">
            <KitRows items={[
              { icon: <RefreshCwIcon size={22} />, title: '重新生成打印件', desc: '沿用当前内容再试一次', onClick: () => void handlePrint() },
              { icon: <PrinterIcon size={22} />, title: '打印现有文件', desc: '走既有打印流程，不依赖生成', onClick: goPrintHub },
              { icon: <HelpCircleIcon size={22} />, title: '查看帮助', desc: '现场操作说明与联系方式', onClick: () => navigate('/help') },
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>失败不写成已发送打印，也不产生取件码。</CtaNote>
          <Action label="返回求职方案" variant="ghost" onClick={() => setPrintError(null)} />
          <Action label="重新生成打印件" variant="primary" onClick={() => void handlePrint()} />
        </>
      ),
    }

    if (screen === 'print-degraded' && degradedPrint) return {
      title: '这次拿到的不是上面那份',
      subtitle: `生成出来的是「${degradedPrint.filename}」。要拿到按你简历原文逐条对应的完整版本，需要重新生成一次。`,
      pill: { tone: 'warn', label: '打印件未含 AI 规划正文' },
      body: (
        <>
          <Sec title="这次请求的结果" hint="只写已经确认的事实">
            <div className="qx-card jfq-consent-card" role="alert">
              <p>
                你屏幕上这份 AI 规划已经按留存期限到期清理了，所以本次打印件里<strong>没有</strong> AI 规划正文，
                只有你自己填的自我探索记分、通用求职自检清单和岗位要求计数（共 {degradedPrint.pageCount} 页）。
              </p>
            </div>
            <Verdict items={[
              { tone: 'warn', label: '本次打印件', value: '未含 AI 规划' },
              { tone: 'warn', label: '屏幕上的规划', value: '已按期限清理' },
            ]} />
          </Sec>
          <Sec title="你能确认的事" hint="不把参考单写成完整规划">
            <Why items={[
              { head: '你能确认', title: '打印件不含 AI 规划正文', desc: '只有自我探索记分、通用自检清单和岗位要求计数。' },
              { head: '你能确认', title: '打印机未收到任务', desc: '也还没有进入打印确认，没有取件码，没有写成已经打印。' },
              { head: '你能确认', title: '屏幕上不会出现新正文', desc: '重新生成之前，这一页不显示新的规划正文。' },
              { head: '边界', title: '仍不提供给企业', desc: '这份参考单不会提供给企业或第三方。' },
              { head: '接下来', title: '由你决定打不打印', desc: '可以重新生成完整版，也可以只打印这份参考单，或先留在这一页。' },
            ]} />
          </Sec>
          <Sec title="接下来三选一" hint="都进入既有流程">
            <RouteCards items={[
              { title: '重新生成完整版', desc: '按你的简历原文再生成一次规划，之后再打印。', action: '重新生成', onClick: () => { setDegradedPrint(null); void handleGenerate() } },
              { title: '仍然打印这份参考单', desc: '只含自我探索记分、通用自检清单和岗位要求计数。', action: '去打印确认', onClick: degradedPrint.go },
              { title: '先留在这一页', desc: '留在这一页看说明，不会进入打印确认。', action: '留在本页', onClick: () => setDegradedPrint(null) },
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>确认之前不会进入打印确认页。</CtaNote>
          <Action label="先不打印" variant="ghost" onClick={() => setDegradedPrint(null)} />
          <Action label="仍然打印这份参考单" variant="primary" onClick={degradedPrint.go} />
        </>
      ),
    }

    if (screen === 'ready' && plan) return {
      title: '求职方案',
      subtitle: `依据：本人简历${plan.basedOn?.jobFit ? ` + 简历对照（${plan.basedOn.jobFit}）` : ''}${plan.basedOn?.interview ? ` + 模拟面试表现（${plan.basedOn.interview}）` : ''}。依据说明这份规划根据什么生成，不是你手上的文件清单。`,
      pill: { tone: 'ok', label: '规划已返回 · 只供本人参考' },
      body: (
        <>
          <Sec title="先看结论，再安排下一步" hint="四栏：已有材料、目标与方向、尚需准备、执行计划">
            <div className="rdq-ai">
              {/* 全页恰好一次的 AIGC 可见标识（interface-handoff.md §3）。 */}
              <div className="rdq-chips">
                <AigcMark />
                {/*
                  按真实登录态区分：匿名结果那行 endUserId 为 null，「我的 AI 记录」按 endUserId
                  过滤 —— 匿名场景下写「已存入 AI服务记录」为假（CLAUDE.md §9 不伪造能力）。
                */}
                <span className="rdq-chip">{getToken() ? '已存入 AI服务记录' : '未登录 · 本次结果不进入「我的」记录，可先打印带走'}</span>
              </div>
              {plan.summary ? <AiConclusion text={plan.summary} /> : null}
            </div>
            <Guardline
              head="只供本人参考"
              body="本机不预测前景、不预测薪资、不说「三年后你能到什么岗」—— 那些本机没有依据。本机不代收简历、不代为投递；是否转方向、是否考证，由你自己决定。"
            />
            <CareerPlanSelfAssessmentExcluded excluded={plan.selfAssessmentExcluded} onGo={goSelfAssessment} />
          </Sec>

          <CareerPlanExistingMaterials />

          <CareerPlanColumns plan={plan} />

          {/*
            已生成的规划是**已落库的成品**，不是正在跑的 AI 任务：AI 现在挂了也不该
            让它从屏幕上消失（否则打印这条非 AI 能力跟着一起没了）。所以本区域只治理
            「再生成一次」这个 AI 任务面，规划正文渲染在它之外。
          */}
          <CareerPlanGenerateRegion task={aiTask} fallback={fallback} error={error} regenerate />

          <Sec title="继续下一步" hint="都是既有流程">
            <KitRows items={[
              { icon: <PencilLineIcon size={22} />, title: '优化简历', desc: '按规划里的方向调整内容重点', onClick: goOptimize },
              { icon: <TargetIcon size={22} />, title: '简历对照', desc: '对照一个具体岗位看差距', onClick: goJobFit },
              { icon: <BotIcon size={22} />, title: '模拟面试', desc: '把准备的内容练一遍', onClick: () => navigate('/interview/setup') },
              { icon: <CompassIcon size={22} />, title: '做一次自我探索', desc: '25 道选择题，记分不经过 AI', onClick: goSelfAssessment },
            ]} />
            <div className="rdq-ai"><EvidenceLegend /></div>
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>规划只供本人参考，不构成录用或收入承诺。</CtaNote>
          {printButton}
          {generateButton}
        </>
      ),
    }

    return buildCareerPlanUnreadyView({
      screen, availability, hostingOpen, navigate,
      goJobFit, goOptimize, goPrintHub, goResumeHub, handleGenerate,
      printButton, generateButton, aiTask, fallback, error,
    })
  }

  return buildView()
}

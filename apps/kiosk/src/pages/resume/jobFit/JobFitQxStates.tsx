// 简历对照（岗位匹配）的六个「非选岗 / 非结果」屏。
//
// 稿：46-resume-decision-workspace.html?screen=job-fit&state=…
//     missing-task / rejected-task / loading / analyzing / ai-down / failed
//
// 每个屏返回一份 { title, subtitle, pill, body, cta } 描述，由 JobFitPage 交给
// QxPageFrame 渲染 —— 壳只有一层，不在每屏各挂一个 frame。
//
// 所有出口都是站内既有 route（简历服务台 / 上传诊断 / 打印服务 / 扫描 / 岗位信息 /
// 简历优化 / AI 顾问）。这里不新增页面，也不外跳。招聘内容托管关闭（3.13）时没有
// 「岗位信息」这个出口（exits.jobs 为空），对应位置换成本机照常能走的扫描。

import type { ReactNode } from 'react'
import {
  BotIcon,
  ClockIcon,
  FileTextIcon,
  HelpCircleIcon,
  ListIcon,
  LockIcon,
  PenLineIcon,
  PrinterIcon,
  RefreshCwIcon,
  ScanLineIcon,
  ShieldCheckIcon,
  TargetIcon,
  XIcon,
} from 'lucide-react'
import {
  Checks,
  CtaNote,
  Ghosts,
  KitRows,
  ListRows,
  Nots,
  RouteCards,
  Sec,
  Slots,
  Steps,
  Trace,
  Verdict,
  Waiting,
  Why,
} from './jobFitQxKit'

export type JobFitStaticState = 'missing-task' | 'rejected-task' | 'loading' | 'analyzing' | 'ai-down' | 'failed'

/** 站内既有去处。全部由 JobFitPage 用 navigate 实现，这里只声明意图。 */
export interface JobFitExits {
  resumeHub: () => void
  triage: () => void
  printHub: () => void
  scan: () => void
  /** 招聘内容托管打开时才有；关闭时为空，页面不摆「看来源岗位要求」。 */
  jobs?: () => void
  optimize: () => void
  assistant: () => void
  /** 返回目标岗位选择（保留已选岗位与手填内容）。 */
  backToPick: () => void
  /** 用当前已确认的输入重新提交分析。 */
  retryAnalyze: () => void
}

export interface JobFitStateView {
  title: string
  subtitle: string
  pill: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
  body: ReactNode
  cta: ReactNode
}

function Cta({ note, children }: { note: string; children: ReactNode }) {
  return (
    <>
      <CtaNote>{note}</CtaNote>
      {children}
    </>
  )
}

function Ghost({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="qx-btn" data-variant="ghost" onClick={onClick}>{label}</button>
}

function Primary({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="qx-btn" data-variant="primary" onClick={onClick}>{label}</button>
}

export function buildJobFitStateView(state: JobFitStaticState, exits: JobFitExits, failMessage?: string | null): JobFitStateView {
  if (state === 'missing-task') {
    return {
      title: '先补上简历任务，再谈岗位匹配',
      subtitle: '岗位匹配需要一份仍可读取的本人简历任务。现在没有，所以不显示任何岗位、企业或匹配结论。',
      pill: { tone: 'warn', label: '缺少可读取的本人简历任务' },
      body: (
        <>
          <Sec no="01" title="这次匹配要用到的输入" hint="四项都要有真实来源">
            <Slots items={[
              { label: '本人简历任务', value: '尚未选择' },
              { label: '目标岗位', value: '尚未选择' },
              { label: '本人授权', value: '未确认' },
              { label: '结果归属', value: '仅本人可见', fixed: true },
            ]} />
          </Sec>
          <Sec no="02" title="现在缺哪一项" hint="补齐前不会启动分析" grow>
            <Checks items={[
              { tone: 'off', icon: <FileTextIcon size={24} />, title: '本人简历任务', desc: '还没有可读取的简历任务。上传 PDF 或扫描纸质简历，解析成功后才会出现可选任务。', chip: '缺失' },
              { tone: 'wait', icon: <TargetIcon size={24} />, title: '目标岗位', desc: exits.jobs ? '可以从已发布岗位里选，也可以只填一个目标岗位名称。当前尚未选择。' : '填一份岗位要求，至少要有岗位名称。当前尚未填写。', chip: '待选择' },
              { tone: 'wait', icon: <ShieldCheckIcon size={24} />, title: '本人授权', desc: '匿名任务和会员账号按各自规则确认。任务补齐后再走这一步。', chip: '待确认' },
              { tone: 'ok', icon: <LockIcon size={24} />, title: '结果去向', desc: '匹配参考只供本人准备，不提供给企业，也不形成任何投递记录。', chip: '已固定' },
            ]} />
          </Sec>
          <Sec no="03" title="不做 AI 分析，也能先推进这些" hint="都是既有流程">
            <KitRows items={[
              { icon: <PrinterIcon size={22} />, title: '打印现有简历', desc: '已有电子稿或纸质件，直接走打印流程', onClick: exits.printHub },
              { icon: <ScanLineIcon size={22} />, title: '扫描纸质简历', desc: '先扫成 PDF 存下来，再决定要不要分析', onClick: exits.scan },
              ...(exits.jobs ? [{ icon: <ListIcon size={22} />, title: '看来源岗位要求', desc: '直接浏览来源平台的岗位信息，自己比对', onClick: exits.jobs }] : []),
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <Cta note="没有本人简历任务时，本页不显示任何岗位、企业或匹配结论。">
          <Ghost label="返回简历服务" onClick={exits.resumeHub} />
          <Primary label="去上传或扫描简历" onClick={exits.triage} />
        </Cta>
      ),
    }
  }

  if (state === 'rejected-task') {
    return {
      title: '这份任务现在读不出来',
      subtitle: '服务端没有返回这份简历任务的内容。系统不会用其他人的任务或历史结果替代它。',
      pill: { tone: 'bad', label: '任务不可读取，需重新准备' },
      body: (
        <>
          <Sec title="读不出来的三种可能" hint="具体原因以服务端返回为准">
            <Why items={[
              { head: '可能原因', title: '任务已过期', desc: '临时任务有保存期限，过期后不再返回原文，也不保留分析结果。' },
              { head: '可能原因', title: '不属于当前会话', desc: '换人使用或重新登录后，上一次的任务不会带到这次会话里。' },
              { head: '可能原因', title: '服务端已停止读取', desc: '服务端可以主动停止某份任务的读取，此时不展示任何原文片段。' },
            ]} />
          </Sec>
          <Sec title="让它重新可用的三步" hint="每一步都在既有流程里" grow>
            <Steps items={[
              { title: '重新上传或扫描一份简历', desc: '进入简历材料入口，选择文件上传、纸质扫描或手机传输。' },
              { title: '等待解析完成', desc: '解析成功后才会出现可用任务；失败会直接显示失败原因，不会静默通过。' },
              { title: '回到岗位匹配重新选目标', desc: '任务可用后，再选择目标岗位并确认本人授权。' },
            ]} />
          </Sec>
          <Sec title="这次没有发生的事" hint="明确否定，避免误解">
            <Nots items={[
              '没有读取到本人简历原文',
              '没有生成任何对照结果或建议',
              '没有把简历内容提供给企业或第三方',
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <Cta note="不会用其他人的任务或历史结果顶替这份不可读取的任务。">
          <Ghost label="返回简历服务" onClick={exits.resumeHub} />
          <Primary label="重新上传简历" onClick={exits.triage} />
        </Cta>
      ),
    }
  }

  if (state === 'loading') {
    return {
      title: '正在读取，还没有结果',
      subtitle: '读取请求已经提交。读到历史报告才显示内容；没有报告或读取失败会直接转到对应状态。',
      pill: { tone: 'unknown', label: '正在等待服务端返回' },
      body: (
        <>
          <Sec title="正在读取历史岗位匹配报告" hint="无进度条 · 无预计时间">
            <Waiting
              icon={<ClockIcon size={34} />}
              title="请求已提交，等待服务端返回"
              desc="读取的是你本人此前的简历对照报告。返回之前，不显示对照要点或建议。"
              tag="只表达整体等待，没有百分比"
            />
          </Sec>
          <Sec title="已经确认并提交的内容" hint="本次读取用到的真实条件" grow>
            <ListRows items={[
              '当前会话身份已校验，只读取本人的任务与报告',
              '读取请求已发送给服务端，等待确认这份任务是否仍然可用',
              '如果历史报告存在，其目标岗位会随报告一起返回',
              '如果不存在历史报告，会转到目标岗位选择，而不是显示一份空结果',
              '等待期间不放开打印，也不提前展示任何结论',
            ]} />
          </Sec>
          <Sec title="还没有返回的内容" hint="返回前一律留空">
            <Ghosts items={[
              { title: '对照要点', desc: '已写到与还没体现的要求，只在结果返回后显示。', tag: '等待返回' },
              { title: '匹配依据', desc: '岗位要求与简历依据由服务端逐条给出。', tag: '等待返回' },
              { title: '行动建议', desc: '差距与准备建议只出现在真实结果里。', tag: '等待返回' },
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <Cta note="读取失败或没有历史报告时会直接说明，不会显示一份空白结果。">
          <Ghost label="返回简历服务" onClick={exits.resumeHub} />
        </Cta>
      ),
    }
  }

  if (state === 'analyzing') {
    return {
      title: '已提交分析，等待返回',
      subtitle: '目标岗位与本人授权已确认。服务端返回之前，不显示对照要点、百分比或任何录用相关结论。',
      pill: { tone: 'unknown', label: '分析进行中，等待服务端返回' },
      body: (
        <>
          <Sec title="正在等待岗位匹配结果" hint="无阶段名 · 无百分比">
            <Waiting
              icon={<BotIcon size={34} />}
              title="分析请求已提交给服务端"
              desc="本页只表达整体等待。没有阶段进度，也不预告结果会是什么。"
              tag="等待中，可随时取消并返回"
            />
          </Sec>
          <Sec title="当前停在哪一步" hint="只标位置，不画进度">
            <Trace items={[
              { phase: '输入', title: '已确认输入', desc: '目标岗位与本人授权都已确认。' },
              { phase: '当前', title: '等待服务端返回', desc: '对照要点与建议全部由服务端给出。', now: true },
              { phase: '之后', title: '由本人决定下一步', desc: '看完参考后，是否优化、准备材料或打印由你决定。' },
            ]} />
          </Sec>
          <Sec title="等待期间不会发生的事" hint="合规边界不随状态放宽" grow>
            <Nots items={[
              '不显示匹配百分比、评分或通过率预测',
              '不给出录用、面试或 Offer 相关结论',
              '不把简历内容提供给企业或第三方',
              '不在本页生成文件、发起支付或打印',
              '不替你在来源渠道完成任何投递或预约动作',
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <Cta note="分析结果只供本人准备使用，不构成企业侧任何判断。">
          <Ghost label="返回简历服务" onClick={exits.resumeHub} />
          <Primary label="取消分析，返回目标选择" onClick={exits.backToPick} />
        </Cta>
      ),
    }
  }

  if (state === 'ai-down') {
    return {
      title: 'AI 匹配当前不可用',
      subtitle: failMessage ?? '这项分析暂时调不通。系统不显示对照要点或建议，也不会用旧结果冒充这次的结论。',
      pill: { tone: 'bad', label: 'AI 匹配服务当前不可用' },
      body: (
        <>
          <Sec title="当前判定" hint="只写已经确认的事实">
            <Verdict items={[
              { tone: 'bad', label: 'AI 匹配分析', value: '当前不可用' },
              { tone: 'ok', label: '本人简历任务', value: '仍可查看和打印' },
              { tone: 'warn', label: '其他 AI 能力', value: '需各自打开确认' },
            ]} />
          </Sec>
          <Sec title="现在能走的三条路" hint="都进入既有流程">
            <RouteCards items={[
              { title: '继续改简历', desc: '不依赖这项分析，先按目标岗位自己调整内容重点。', action: '去简历优化', onClick: exits.optimize },
              exits.jobs
                ? { title: '看来源岗位要求', desc: '直接浏览来源平台的岗位信息，自己逐条比对。', action: '去岗位信息', onClick: exits.jobs }
                : { title: '扫描纸质简历', desc: '先把纸质件扫成 PDF 存下来，服务恢复后再对照。', action: '去扫描', onClick: exits.scan },
              { title: '打印现有简历', desc: '手上已有可用文件时，直接进入既有打印流程。', action: '去打印服务', onClick: exits.printHub },
            ]} />
          </Sec>
          <Sec title="不可用期间，这些仍然成立" hint="不因故障降低标准" grow>
            <Why items={[
              { head: '状态', title: '不做假降级', desc: '不会用模板结论或历史报告冒充这一次的分析结果。' },
              { head: '恢复', title: '不承诺恢复时间', desc: '服务端没有给出可用时间，本页也不写「稍后自动恢复」。' },
              { head: '数据', title: '材料仍在你这边', desc: '分析不可用不影响你查看、修改和打印自己的材料。' },
              { head: '费用', title: '本页没有发起支付', desc: '这条流程不含支付步骤；服务端是否已计入当日次数，本页无法确认。' },
              { head: '边界', title: '仍不提供给企业', desc: '无论服务是否可用，简历都不会提供给企业或第三方。' },
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <Cta note="服务不可用时不显示任何匹配结论，也不保留半截结果。">
          <Ghost label="返回目标选择" onClick={exits.backToPick} />
          <Primary label="重新提交分析" onClick={exits.retryAnalyze} />
        </Cta>
      ),
    }
  }

  return {
    title: '这次分析没有完成',
    subtitle: failMessage ?? '请求中断，没有可确认的结果。系统不展示对照要点或建议，也不保留半截结论。',
    pill: { tone: 'bad', label: '本次分析未完成' },
    body: (
      <>
        <Sec title="这次请求的结果" hint="只写事实，不猜原因">
          <Verdict items={[
            { tone: 'bad', label: '本次分析', value: '未完成' },
            { tone: 'warn', label: '可用结果', value: '没有返回' },
          ]} />
        </Sec>
        <Sec title="重试之前，先确认这几件事" hint="确认后再决定要不要重来" grow>
          <Checks items={[
            { tone: 'wait', icon: <FileTextIcon size={24} />, title: '这次失败没有指向简历任务', desc: '本次返回的不是任务失效。重试沿用同一个任务；若它其实已失效，重试会转到「重新上传简历」。', chip: '未确认' },
            { tone: 'wait', icon: <TargetIcon size={24} />, title: '目标岗位保持不变', desc: '上一次选择的目标仍在本次会话内，重试会沿用它。', chip: '待确认' },
            { tone: 'wait', icon: <RefreshCwIcon size={24} />, title: '重试次数由你决定', desc: '系统不会自动重复请求，也不会在后台悄悄重跑。', chip: '手动' },
            { tone: 'off', icon: <XIcon size={24} />, title: '没有部分结果', desc: '不保留半截结论，也不把上一次的报告当成这次的结果。', chip: '无' },
            { tone: 'ok', icon: <LockIcon size={24} />, title: '记录只留在你这边', desc: '失败记录只用于本人排查，不提供给企业或第三方。', chip: '已固定' },
          ]} />
        </Sec>
        <Sec title="不想重试，也有别的走法" hint="都是既有入口">
          <KitRows items={[
            { icon: <PenLineIcon size={22} />, title: '先自己改简历', desc: '按目标岗位重排内容重点，不依赖 AI', onClick: exits.optimize },
            { icon: <PrinterIcon size={22} />, title: '打印现有简历', desc: '已有可用文件就直接走打印流程', onClick: exits.printHub },
            { icon: <HelpCircleIcon size={22} />, title: '问 AI 顾问怎么准备', desc: '让顾问按你的目标给准备思路', onClick: exits.assistant },
          ]} />
        </Sec>
      </>
    ),
    cta: (
      <Cta note="失败不会写成已完成，也不会写成已发送到打印机。">
        <Ghost label="返回目标选择" onClick={exits.backToPick} />
        <Primary label="重新提交分析" onClick={exits.retryAnalyze} />
      </Cta>
    ),
  }
}

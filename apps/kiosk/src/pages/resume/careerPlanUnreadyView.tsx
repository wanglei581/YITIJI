// 还没有已生成规划时的几屏：生成中、不可用、失败、状态未确认、生成前说明。
// 从 careerPlanView 拆出，避免单文件超过 500 行。
import type { ReactNode } from 'react'
import { FileTextIcon, ListIcon, PencilLineIcon, PrinterIcon, TargetIcon } from 'lucide-react'
import type { AiAvailability, AiTaskFallback, AiTaskStatus } from '../../ai'
import { CareerPlanGenerateRegion, CareerPlanSelfCheck } from './components/career-plan/CareerPlanSection'
import { Action } from './careerPlanAction'
import type { CareerScreen } from './careerPlanView'
import { CtaNote, Guardline, KitRows, ListRows, Nots, RouteCards, Sec, Slots, Verdict, Why } from './jobFit/jobFitQxKit'

export function buildCareerPlanUnreadyView(d: {
  screen: CareerScreen
  availability: AiAvailability
  hostingOpen: boolean
  navigate: (to: string) => void
  goJobFit: () => void
  goOptimize: () => void
  goPrintHub: () => void
  goResumeHub: () => void
  handleGenerate: () => void
  printButton: ReactNode
  generateButton: ReactNode
  aiTask: AiTaskStatus
  fallback: AiTaskFallback
  error: string | null
}): { title: string; subtitle: string; pill: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }; body: ReactNode; cta: ReactNode } {
  const {
    screen, availability, hostingOpen, navigate,
    goJobFit, goOptimize, goPrintHub, goResumeHub, handleGenerate,
    printButton, generateButton, aiTask, fallback, error,
  } = d
    // 以下四屏都没有已生成的 plan：guide（idle）/ generating（running）/ ai-down / failed。
    // 同一个生成任务面（CareerPlanGenerateRegion 里的 AiTaskRegion）按 data-aitask 四态渲染，屏与屏之间只换外围的说明与出口。
    const generationRegion = <CareerPlanGenerateRegion task={aiTask} fallback={fallback} error={error} />

    if (screen === 'generating') return {
      title: '已提交生成，等待返回',
      subtitle: '生成请求已提交。返回之前，不显示方向、技能计划或行动清单。',
      pill: { tone: 'unknown', label: '规划生成中，等待返回' },
      body: (
        <>
          <Sec title="正在等待求职方案结果" hint="无阶段名 · 无百分比">{generationRegion}</Sec>
          <Sec title="本次生成提交的输入" hint="只用你本人的材料">
            <Slots items={[
              { label: '本人简历任务', value: '已随请求提交' },
              { label: '可选上下文', value: '以已有记录为准' },
              { label: '结果归属', value: '仅本人可见', fixed: true },
            ]} />
          </Sec>
          <Sec title="生成期间不会发生的事" hint="边界不随状态放宽" grow>
            <Nots items={[
              '不显示生成进度百分比或阶段名称',
              '不承诺薪资、录用或跳槽结果',
              '不把简历或规划内容提供给企业',
              '不把未完成的内容自动保存为最终版本',
              '不生成打印文件、不发起支付',
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>离开本页不会撤回已提交的请求；回到本页时会重新读取结果。</CtaNote>
          <Action label="先看简历对照" variant="ghost" onClick={goJobFit} />
          <Action label="返回简历服务" variant="primary" onClick={goResumeHub} />
        </>
      ),
    }

    if (screen === 'ai-down') return {
      title: '规划生成当前不可用',
      subtitle: '这项 AI 能力暂时调不通。系统不显示方向、技能计划或行动清单，也不用模板内容顶替。',
      pill: { tone: 'bad', label: '职业规划生成当前不可用' },
      body: (
        <>
          <Sec title="当前判定" hint="只写已确认的事实">
            <Verdict items={[
              { tone: 'bad', label: 'AI 规划生成', value: '当前不可用' },
              { tone: 'ok', label: '简历与打印', value: '仍可正常使用' },
              { tone: 'warn', label: '其他 AI 能力', value: '需各自打开确认' },
            ]} />
            {generationRegion}
          </Sec>
          <CareerPlanSelfCheck />
          <Sec title="现在能用的非 AI 入口" hint="都是既有流程" grow>
            <KitRows items={[
              { icon: <FileTextIcon size={22} />, title: '手动整理求职材料', desc: '按自己的判断准备材料清单', onClick: () => navigate('/resume/materials') },
              ...(hostingOpen ? [{ icon: <ListIcon size={22} />, title: '看来源岗位与要求', desc: '直接浏览来源平台的岗位信息', onClick: () => navigate('/jobs') }] : []),
              { icon: <PrinterIcon size={22} />, title: '打印现有材料', desc: '走既有打印流程，不依赖 AI', onClick: goPrintHub },
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>服务不可用时不显示任何规划内容，也不承诺恢复时间。</CtaNote>
          {printButton}
          {generateButton}
        </>
      ),
    }

    if (screen === 'failed') return {
      title: '这次规划没有生成成功',
      subtitle: '没有可确认的规划结果。系统不保留半截内容，也不把上一次的结果当成这次的。',
      pill: { tone: 'bad', label: '本次职业规划生成未完成' },
      body: (
        <>
          <Sec title="这次请求的结果" hint="只写事实，不猜原因">
            <Verdict items={[
              { tone: 'bad', label: '本次生成', value: '未完成' },
              { tone: 'warn', label: '可用规划', value: '没有返回' },
            ]} />
            {generationRegion}
          </Sec>
          <Sec title="你能确认的事" hint="不猜测具体故障">
            <Why items={[
              { head: '可能原因', title: '生成请求中断', desc: '这次办理在返回结果前中断了这次请求，本页不猜测具体原因。' },
              { head: '你能确认', title: '简历任务没有变化', desc: '重试不需要重新上传，材料仍然可用。' },
              { head: '你能确认', title: '没有半截规划', desc: '不保留未完成的方向或计划片段，也不把上一次的结果当成这次的。' },
              { head: '你能确认', title: '没有进入打印', desc: '生成没有完成，本页也没有进入打印确认。' },
              { head: '边界', title: '仍不提供给企业', desc: '规划内容不会提供给企业或第三方。' },
            ]} />
          </Sec>
          <Sec title="接下来三选一" hint="都进入既有流程">
            <RouteCards items={[
              { title: '重新生成规划', desc: '沿用当前材料再试一次，不需要重新上传。', action: '重新生成', onClick: () => void handleGenerate() },
              { title: '先做简历对照', desc: '先看清目标岗位的差距，再谈长期规划。', action: '去简历对照', onClick: goJobFit },
              { title: '先改简历', desc: '按自己的判断调整材料重点，不依赖规划结果。', action: '去简历优化', onClick: goOptimize },
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>未完成不会写成已生成，也不会自动保存。</CtaNote>
          {printButton}
          {generateButton}
        </>
      ),
    }

    if (availability !== 'available') return {
      title: '求职方案',
      subtitle: availability === 'unknown'
        ? '服务状态还没有确认。本页不把未确认写成已生成，也不显示方向、技能计划或行动清单。'
        : '这项能力现在不可用。本页不显示方向、技能计划或行动清单，也不写成已经成功。',
      pill: availability === 'unknown'
        ? { tone: 'unknown', label: '服务状态未确认' }
        : { tone: 'bad', label: '职业规划生成当前不可用' },
      body: (
        <>
          <Sec title="这次请求的结果" hint="只写已经确认的事实">
            <Verdict items={availability === 'unknown'
              ? [
                  { tone: 'warn', label: '服务状态', value: '尚未确认' },
                  { tone: 'warn', label: '可用规划', value: '没有返回' },
                ]
              : [
                  { tone: 'bad', label: '本次生成', value: '未完成' },
                  { tone: 'warn', label: '可用规划', value: '没有返回' },
                ]} />
            {generationRegion}
          </Sec>
          <Sec title="你能确认的事" hint="不把未确认写成已生成">
            <Why items={[
              { head: '状态', title: '服务状态尚未确认', desc: '还没有确认这项生成现在能不能用，本页不把它写成可用或已成功。' },
              { head: '结果', title: '没有返回规划', desc: '不显示方向、技能计划或行动清单。' },
              { head: '你能确认', title: '不会自动开始', desc: '仍由你确认后才提交生成，不会在未确认时自己跑。' },
              { head: '你能确认', title: '不用旧结果顶替', desc: '不会把上一次的规划或他人的内容当成这次的结果。' },
              { head: '边界', title: '仍不提供给企业', desc: '无论状态是否确认，规划内容都不提供给企业或第三方。' },
            ]} />
          </Sec>
          <Sec title="接下来三选一" hint="都进入既有流程">
            <RouteCards items={[
              { title: '仍由你确认后再生成', desc: '不会自动开始，也不会把未确认写成已经成功。', action: '生成求职方案', onClick: () => void handleGenerate() },
              { title: '先做简历对照', desc: '先看清目标岗位的差距，再谈长期规划。', action: '去简历对照', onClick: goJobFit },
              { title: '先改简历', desc: '按自己的判断调整材料重点，不依赖规划结果。', action: '去简历优化', onClick: goOptimize },
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>{availability === 'unknown' ? '服务状态未确认，不会写成已生成。' : '当前不可用，不会写成已生成。'}</CtaNote>
          {printButton}
          {generateButton}
        </>
      ),
    }

    return {
      title: '求职方案',
      subtitle: '四栏：已有材料、目标与方向、尚需准备、执行计划',
      pill: { tone: 'ok', label: '尚未生成 · 由你确认后开始' },
      body: (
        <>
          <Sec title="生成前说明" hint="把简历经历变成可执行的下一步">
            {generationRegion}
            <Guardline
              head="只供本人参考"
              body="本机不预测前景、不预测薪资、不说「三年后你能到什么岗」—— 那些本机没有依据。本建议仅供本人职业发展参考，不构成任何就业、薪资或录用承诺。"
            />
          </Sec>
          <Sec title="生成时只会用到这些" hint="输入范围写在前面">
            <ListRows items={[
              '当前本人简历任务里的经历、技能与教育信息',
              '你自己填写或选择的目标方向（可以留空）',
              '本人此前的简历对照或模拟面试摘要，且需要你同意这次使用',
              '不使用他人材料，不引入企业侧数据',
              '不做录用、薪资或通过率承诺',
            ]} />
          </Sec>
          <Sec title="生成之后能做的" hint="都是既有流程">
            <KitRows items={[
              { icon: <PencilLineIcon size={22} />, title: '按方向改简历', desc: '去简历优化调整内容重点', onClick: goOptimize },
              { icon: <TargetIcon size={22} />, title: '对照一个岗位', desc: '去简历对照看具体差距', onClick: goJobFit },
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>由你确认后才开始生成，本页不会自动替你生成。</CtaNote>
          {printButton}
          {generateButton}
        </>
      ),
    }
}

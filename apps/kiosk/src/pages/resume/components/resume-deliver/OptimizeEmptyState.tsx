import type { QxTouchIconName } from '../../../../components/qingxu/touch/QxTouchIcon'
import { ExitRow } from '../resume-report/ResumeReportExits'

const MANUAL_STEPS = [
  '先改诊断报告里排在最前面的那一条',
  '每段经历只保留一个最想被看到的结果',
  '把「负责」换成你实际做到的动作',
  '数字只写你自己核对过的',
  '技能写工具名称，再写做到什么程度',
  '删掉与目标岗位无关的段落',
  '同一件事不要在两个板块重复写',
  '改完通读一遍，再导出 PDF',
] as const

/**
 * 优化建议拿不到时的出路：三条不依赖本页建议的去处，加一份不用 AI 也能自己改的 8 步清单。
 * AI 停用、读取失败、没有建议时都在，页面不会只剩一句「不可用」。
 */
export function OptimizeEmptyState(props: {
  onReport: () => void
  onManualEdit: () => void
  onMyResumes: () => void
}) {
  const exits: Array<{ title: string; description: string; take: string; icon: QxTouchIconName; route: string; testId: string; action: () => void }> = [
    {
      title: '返回诊断报告',
      description: '看清楚要改哪几处，再决定怎么改',
      take: '去诊断报告',
      icon: 'file',
      route: '/resume/report',
      testId: 'resume-optimize-empty-report',
      action: props.onReport,
    },
    {
      // 稿 23-resume-optimize.html:961 —— data-route 是 /resume/generate，
      // 副标题也逐字取自稿。此前指向 /me/resumes，与下面「打开我的简历」同去向，
      // 读起来像两张重复的卡；稿里本来就是两个不同出口。
      title: '手动逐项修改',
      description: '自己填写并原样导出草稿，不经过模型',
      take: '去填写',
      icon: 'pen',
      route: '/resume/generate',
      testId: 'resume-optimize-empty-manual',
      action: props.onManualEdit,
    },
    {
      title: '打开我的简历',
      description: '查看和整理已保存的版本',
      take: '去看简历',
      icon: 'folder',
      // 稿 :962 的 data-route 写的是 /me/ai-records，但它自己的 href 指向
      // 39-member-records.html?view=resumes，而运行时保存版本的路由是 /me/resumes
      // （包 L6 订正 24 页时按运行时改过）。此处以运行时为准，稿的 data-route 待订正。
      route: '/me/resumes',
      testId: 'resume-optimize-empty-resumes',
      action: props.onMyResumes,
    },
  ]

  return (
    <div className="qxt-fallback" data-testid="resume-optimize-empty-fallback">
      <div className="qxt-sec">不靠这一步，也能继续<small>三条都不动你的原件</small></div>
      <div className="qxt-exit-col" data-testid="resume-optimize-empty-paths">
        {exits.map((exit, index) => (
          <ExitRow
            key={exit.testId}
            icon={exit.icon}
            title={exit.title}
            desc={exit.description}
            take={exit.take}
            testId={exit.testId}
            route={exit.route}
            index={index}
            onClick={exit.action}
          />
        ))}
      </div>
      <section className="qxt-olist qxt-rise" style={{ ['--i' as string]: exits.length + 1 }}>
        <div className="qxt-olist-t">不用 AI，也能自己改<span className="qxt-ck">8 步 · 零模型</span></div>
        <ol className="qxt-steps" data-testid="resume-optimize-empty-steps">
          {MANUAL_STEPS.map((step, index) => (
            <li className="qxt-check" key={step}><i aria-hidden="true">{index + 1}</i><span>{step}</span></li>
          ))}
        </ol>
      </section>
    </div>
  )
}

import { ChevronRightIcon, FileSearchIcon, FolderOpenIcon, PencilLineIcon } from 'lucide-react'

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

export function OptimizeEmptyState(props: {
  onReport: () => void
  onManualEdit: () => void
  onMyResumes: () => void
}) {
  const exits = [
    {
      title: '返回诊断报告',
      description: '看清楚要改哪几处，再决定怎么改',
      icon: FileSearchIcon,
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
      icon: PencilLineIcon,
      route: '/resume/generate',
      testId: 'resume-optimize-empty-manual',
      action: props.onManualEdit,
    },
    {
      title: '打开我的简历',
      description: '查看和整理已保存的版本',
      icon: FolderOpenIcon,
      // 稿 :962 的 data-route 写的是 /me/ai-records，但它自己的 href 指向
      // 39-member-records.html?view=resumes，而运行时保存版本的路由是 /me/resumes
      // （包 L6 订正 24 页时按运行时改过）。此处以运行时为准，稿的 data-route 待订正。
      route: '/me/resumes',
      testId: 'resume-optimize-empty-resumes',
      action: props.onMyResumes,
    },
  ]

  return (
    <div className="qx-optimize-empty" data-testid="resume-optimize-empty-fallback">
      <section className="qx-card qx-optimize-empty__section">
        <div className="qx-sec-h">
          <h2>不靠这一步，也能继续</h2>
          <span>三条都不动你的原件</span>
        </div>
        <div className="qx-rows" data-testid="resume-optimize-empty-paths">
          {exits.map(({ title, description, icon: Icon, route, testId, action }) => (
            <button
              key={testId}
              type="button"
              className="qx-row qx-optimize-empty__row"
              data-route={route}
              data-testid={testId}
              onClick={action}
            >
              <span className="qx-row-ic" aria-hidden="true"><Icon size={28} /></span>
              <span className="qx-row-tx">
                <b className="qx-row-t">{title}</b>
                <span className="qx-row-d">{description}</span>
              </span>
              <span className="qx-row-go" aria-hidden="true"><ChevronRightIcon size={24} /></span>
            </button>
          ))}
        </div>
      </section>

      <section className="qx-card qx-optimize-empty__section">
        <div className="qx-sec-h">
          <h2>不用 AI，也能自己改</h2>
          <span>8 步 · 零模型</span>
        </div>
        <ol className="qx-optimize-empty__steps" data-testid="resume-optimize-empty-steps">
          {MANUAL_STEPS.map((step, index) => (
            <li key={step}>
              <span aria-hidden="true">{index + 1}</span>
              <p>{step}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

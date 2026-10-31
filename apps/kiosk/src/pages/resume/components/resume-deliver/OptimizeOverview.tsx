import { COMPLIANCE_COPY, type ResumeOptimizeModule } from '@ai-job-print/shared'
import { detectUnconfirmedTextAdditions } from './facts'
import { moduleKeyOf, type ResumeDecisionMap, type ResumeModuleDecision, type ResumeSwitchBlock } from './resumeDecisions'

const DECISION_LABEL: Record<ResumeModuleDecision, string> = { optimized: '用改写', original: '保留原文' }
/** 切换不了的条目直接说原因；不画开关，免得点了才说换不了、还把原因推给用户。 */
const MANUAL_NOTE: Record<ResumeSwitchBlock, string> = {
  'not-found': '这条改写没有原样写进优化稿，这里没法切换；要用哪一版，请在编辑区里对照着改。',
  'original-empty': '这条是新加的一句，原文里没有对应的句子，这里没法切换；不要的话，请在编辑区里删掉。',
}

/**
 * 稿 optimize 总览（改动清单）：四格统计、批量、每条「用改写 / 保留原文 / 打开」、编辑与回报告。
 *
 * 清空选择只清除本屏选择标记，不撤销已写进编辑区的内容。
 * 「待确认事实」只比对数字和职责词，不是通用事实校验。
 *
 * 切换靠在优化稿里找改写的原句；找不到（或原文为空）的条目记为「只能手改」：不画开关、不进用改写 / 保留原文的计数和批量。
 * 一条可切换的都没有时（例如演示模式的建议句），计数只剩「只能手改」和「待确认事实」，批量按钮不画。
 */
export function OptimizeOverview(props: {
  modules: ResumeOptimizeModule[]
  decisions: ResumeDecisionMap
  switchBlocks: Record<string, ResumeSwitchBlock | null>
  synthetic: boolean
  disabled: boolean
  onDecisionChange: (key: string, next: ResumeModuleDecision) => void
  onBatch: (next: ResumeModuleDecision) => void
  clearedChoices: ReadonlySet<string>
  onClear: () => void
  decisionIssues: Record<string, string>
  onCompare: (focusIndex?: number) => void
  onEditor: () => void
  onManual: () => void
  onReport: () => void
}) {
  const rows = props.modules.map((module, index) => {
    const key = moduleKeyOf(module, index)
    const decision: ResumeModuleDecision = props.decisions[key] ?? 'optimized'
    const block = props.switchBlocks[key] ?? null
    return { key, module, index, decision, block, switchable: block === null, additions: detectUnconfirmedTextAdditions(module.after, module.before) }
  })
  const total = rows.length
  const switchableRows = rows.filter((row) => row.switchable)
  const optimizedCount = switchableRows.filter((row) => !props.clearedChoices.has(row.key) && row.decision === 'optimized').length
  const originalCount = switchableRows.filter((row) => !props.clearedChoices.has(row.key) && row.decision === 'original').length
  const manualCount = total - switchableRows.length
  const factCount = rows.filter((row) => row.additions.length > 0).length
  const canSwitch = switchableRows.length > 0

  return (
    <div className="qxt-overview" data-testid="resume-optimize-overview">
      {props.synthetic ? <p className="qxt-fine">合成样本</p> : null}
      <div className="qxt-stats" aria-label="当前选择" data-testid="resume-optimize-counts">
        {canSwitch && <span data-d="optimized"><u>用改写</u><b><i>{optimizedCount}</i><small> / {switchableRows.length}</small></b></span>}
        {canSwitch && <span data-d="original"><u>保留原文</u><b>{originalCount}</b></span>}
        {manualCount > 0 && <span data-d="manual"><u>只能手改</u><b>{manualCount}</b></span>}
        <span data-d="facts"><u>待确认事实</u><b>{factCount}</b></span>
      </div>
      {canSwitch ? (
        <div className="qxt-batch" aria-label="批量处理" data-testid="resume-optimize-batch">
          <button type="button" disabled={props.disabled || optimizedCount === switchableRows.length} onClick={() => props.onBatch('optimized')}>
            <b>全部用改写</b><small>有待确认事实的，导出前仍要逐项确认</small>
          </button>
          <button type="button" disabled={props.disabled || originalCount === switchableRows.length} onClick={() => props.onBatch('original')}>
            <b>全部保留原文</b><small>这几条都换回你原来的句子</small>
          </button>
          <button type="button" disabled={props.disabled || switchableRows.every((row) => props.clearedChoices.has(row.key))} onClick={props.onClear}>
            <b>清空选择</b><small>清除选择标记，编辑区内容保留</small>
          </button>
        </div>
      ) : null}
      <p className="qxt-draft" role="note">
        {props.clearedChoices.size > 0 ? '选择标记已清空，编辑区已有内容保留；可以重新选择。' : canSwitch
          ? '上面的选择已经写进编辑区里的这一份：选了「保留原文」的几条，用你原来的句子'
          : '上面这几条都没法在这里切换，要用哪一版，请在编辑区里对照着改'}
      </p>
      <ul className="qxt-rows" data-testid="resume-optimize-list">
        {rows.map((row) => {
          const title = row.module.title || `第 ${row.index + 1} 条`
          const snippet = row.module.before.replace(/\s+/g, ' ').trim()
          return (
            <li key={row.key} className="qxt-row" data-decision={row.switchable ? row.decision : 'manual'} data-pending={row.additions.length}>
              <div className="qxt-rowtx">
                <b>{title}</b>
                <small>原文：{snippet || '这一条没有留下原句。'}{row.block ? ' 这一条只能在编辑区里改。' : ''}{row.additions.length > 0 ? ` 待确认：${row.additions.join('、')}` : ''}</small>
              </div>
              {row.switchable ? (
                <div className="qxt-segsel" role="group" aria-label={`第 ${row.index + 1} 条用哪一版`}>
                  <button type="button" aria-pressed={!props.clearedChoices.has(row.key) && row.decision === 'optimized'} disabled={props.disabled} onClick={() => props.onDecisionChange(row.key, 'optimized')}>用改写</button>
                  <button type="button" aria-pressed={!props.clearedChoices.has(row.key) && row.decision === 'original'} disabled={props.disabled} onClick={() => props.onDecisionChange(row.key, 'original')}>保留原文</button>
                </div>
              ) : <span className="qxt-hand">只能手改</span>}
              <button
                type="button"
                className="qxt-open"
                onClick={() => props.onCompare(row.index)}
                aria-label={`第 ${row.index + 1} 条 ${title}，${row.switchable ? `当前${DECISION_LABEL[row.decision]}` : '这一条只能在编辑区里改'}，去逐条对照`}
              >
                打开
              </button>
              {row.block
                ? <p className="qxt-rowstatus" data-testid="resume-optimize-row-manual" role="status">{MANUAL_NOTE[row.block]}</p>
                : props.decisionIssues[row.key] && <p className="qxt-rowstatus" role="status">{props.decisionIssues[row.key]}</p>}
            </li>
          )
        })}
      </ul>
      <div className="qxt-ovx">
        <button type="button" data-testid="resume-optimize-open-editor" aria-label="编辑简历" onClick={props.onEditor}>编辑简历</button>
        <button type="button" onClick={props.onManual}>自己动手改</button>
        <button type="button" onClick={props.onReport}>回诊断报告</button>
      </div>
      <p className="qxt-fine">导出的就是编辑区里的这一份，你还可以再改；导出前要逐项确认事实。PDF 可以进打印确认；Word、TXT、Markdown 先保存到手机。{COMPLIANCE_COPY.KIOSK_RESUME_OPTIMIZE_DISCLAIMER}页面只展示表达调整参考，不承诺提分或招聘结果。</p>
    </div>
  )
}

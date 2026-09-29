import type { ResumeOptimizeModule } from '@ai-job-print/shared'
import { ChevronRightIcon, FileTextIcon, PencilLineIcon } from 'lucide-react'
import { detectUnconfirmedTextAdditions } from './facts'
import { moduleKeyOf, type ResumeDecisionMap, type ResumeModuleDecision, type ResumeSwitchBlock } from './resumeDecisions'

const DECISION_LABEL: Record<ResumeModuleDecision, string> = { optimized: '用改写', original: '保留原文' }
/** 切换不了的条目直接说原因；不画开关，免得点了才说换不了、还把原因推给用户。 */
const MANUAL_NOTE: Record<ResumeSwitchBlock, string> = {
  'not-found': '这条改写没有原样写进优化稿，这里没法切换；要用哪一版，请在编辑区里对照着改。',
  'original-empty': '这条是新加的一句，原文里没有对应的句子，这里没法切换；不要的话，请在编辑区里删掉。',
}

function charCount(text: string): number {
  return text.replace(/\s/g, '').length
}

/**
 * 稿 23（2.0）总览：计数与批量、全部建议、编辑与导出三张卡。
 *
 * 运行时每条只有两种选择（用改写 / 保留原文），选了就写进优化稿、随草稿保存；
 * 稿里的「自己写」「待定」「清空裁决」在逐条对照页（/resume/optimize/compare）里，
 * 这里不画没有的状态。「待确认事实」是本页的文字比对：只比对数字和职责词，不是通用事实校验。
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
  const optimizedCount = switchableRows.filter((row) => row.decision === 'optimized').length
  const originalCount = switchableRows.length - optimizedCount
  const manualCount = total - switchableRows.length
  const factCount = rows.filter((row) => row.additions.length > 0).length
  const canSwitch = switchableRows.length > 0

  return (
    <div className="qx-opt-overview" data-testid="resume-optimize-overview">
      <section className="qx-opt-sec" aria-labelledby="qx-opt-count-title">
        <div className="qx-opt-sec-h">
          <h2 id="qx-opt-count-title">这份简历有 {total} 处可以改</h2>
          {props.synthetic ? <small>合成样本</small> : null}
        </div>
        <p className="qx-opt-lead">
          建议<b>只改表达</b>：正常情况下只会重排、删减你原文里已经写过的内容，不新增学校、公司、证书、时间、薪资、获奖。
          改写里若出现原文没有的数字或职责词，那一条会标出来，导出前要你<b>逐项确认</b>。
        </p>
        <div className="qx-opt-stat" aria-label="当前选择" data-testid="resume-optimize-counts">
          {canSwitch && <span data-d="optimized"><u>用改写</u><b>{optimizedCount}<small> / {switchableRows.length}</small></b></span>}
          {canSwitch && <span data-d="original"><u>保留原文</u><b>{originalCount}</b></span>}
          {manualCount > 0 && <span data-d="manual"><u>只能手改</u><b>{manualCount}</b></span>}
          <span data-d="facts"><u>待确认事实</u><b>{factCount}</b></span>
        </div>
        <div className="qx-opt-seg" aria-hidden="true">
          {rows.map((row) => <u key={row.key} data-d={row.switchable ? row.decision : 'manual'} />)}
        </div>
        {canSwitch && <div className="qx-opt-batch" data-testid="resume-optimize-batch">
          <button
            type="button"
            className="qx-opt-bx"
            disabled={props.disabled || optimizedCount === switchableRows.length}
            onClick={() => props.onBatch('optimized')}
          >
            全部用改写<small>有待确认事实的，导出前仍要逐项确认</small>
          </button>
          <button
            type="button"
            className="qx-opt-bx"
            disabled={props.disabled || originalCount === switchableRows.length}
            onClick={() => props.onBatch('original')}
          >
            全部保留原文<small>这几条都换回你原来的句子</small>
          </button>
        </div>}
      </section>

      <section className="qx-opt-sec qx-opt-sec--list" aria-labelledby="qx-opt-list-title">
        <div className="qx-opt-sec-h">
          <h2 id="qx-opt-list-title">全部建议</h2>
          <small>点一条去逐条对照</small>
        </div>
        <ul className="qx-opt-mods" data-testid="resume-optimize-list">
          {rows.map((row) => {
            const title = row.module.title || `第 ${row.index + 1} 条`
            const factLine = row.additions.length > 0
              ? `改写里有原文没有的：${row.additions.join('、')}`
              : '文字比对未发现新增事实'
            return (
              <li key={row.key} className="qx-opt-mod" data-decision={row.switchable ? row.decision : 'manual'} data-pending={row.additions.length}>
                <button
                  type="button"
                  className="qx-opt-mod-open"
                  onClick={() => props.onCompare(row.index)}
                  aria-label={`第 ${row.index + 1} 条 ${title}，${row.switchable ? `当前${DECISION_LABEL[row.decision]}` : '这一条只能在编辑区里改'}，去逐条对照`}
                >
                  <i className="no" aria-hidden="true">{row.index + 1}</i>
                  <span className="tx">
                    <b>{title}</b>
                    <span className={row.additions.length > 0 ? 'warn' : undefined}>
                      原文 {charCount(row.module.before)} 字 → 建议 {charCount(row.module.after)} 字 · {factLine}
                    </span>
                  </span>
                  <ChevronRightIcon className="go" aria-hidden="true" />
                </button>
                {row.switchable ? <div className="qx-opt-toggle" role="group" aria-label={`第 ${row.index + 1} 条用哪一版`}>
                  <button
                    type="button"
                    aria-pressed={row.decision === 'optimized'}
                    disabled={props.disabled}
                    onClick={() => props.onDecisionChange(row.key, 'optimized')}
                  >
                    用改写
                  </button>
                  <button
                    type="button"
                    aria-pressed={row.decision === 'original'}
                    disabled={props.disabled}
                    onClick={() => props.onDecisionChange(row.key, 'original')}
                  >
                    保留原文
                  </button>
                </div> : null}
                {row.block
                  ? <p className="qx-opt-decision-row-status" data-testid="resume-optimize-row-manual" role="status">{MANUAL_NOTE[row.block]}</p>
                  : props.decisionIssues[row.key] && <p className="qx-opt-decision-row-status" role="status">{props.decisionIssues[row.key]}</p>}
              </li>
            )
          })}
        </ul>
      </section>

      <section className="qx-opt-sec" aria-labelledby="qx-opt-save-title">
        <div className="qx-opt-sec-h">
          <h2 id="qx-opt-save-title">优化版简历编辑与导出</h2>
          <small>唯一可导出的工作区</small>
        </div>
        <div className="qx-opt-save">
          <button type="button" className="qx-opt-sbtn" data-testid="resume-optimize-open-editor" onClick={props.onEditor}>
            <span>编辑优化版简历</span>
            <small>排版 · 模板 · 导出</small>
          </button>
          <div className="qx-opt-need">
            <span>· {canSwitch
              ? '上面的选择已经写进编辑区里的这一份：选了「保留原文」的几条，用你原来的句子'
              : '上面这几条都没法在这里切换，要用哪一版，请在编辑区里对照着改'}</span>
            <span>· 导出的就是编辑区里的这一份，你还可以再改；导出前要逐项确认事实</span>
            <span>· PDF 可以进打印确认；Word、TXT、Markdown 先保存到手机</span>
          </div>
        </div>
        <div className="qx-opt-exits">
          <button type="button" className="qx-opt-row" onClick={props.onManual}>
            <i aria-hidden="true"><PencilLineIcon /></i>
            <span className="tx"><b>自己动手改</b><span>自己填写并原样导出草稿，不经过模型</span></span>
            <ChevronRightIcon className="go" aria-hidden="true" />
          </button>
          <button type="button" className="qx-opt-row" onClick={props.onReport}>
            <i aria-hidden="true"><FileTextIcon /></i>
            <span className="tx"><b>回看诊断报告</b><span>确认哪几条最该改</span></span>
            <ChevronRightIcon className="go" aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  )
}

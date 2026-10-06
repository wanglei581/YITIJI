import type { ReactNode } from 'react'
import type { GeneratedResume, ResumeOptimizeModule } from '@ai-job-print/shared'
import { ChevronRightIcon, FileTextIcon, PencilLineIcon } from 'lucide-react'
import {
  buildOverviewRows,
  overviewStats,
  type OverviewBatchAction,
  type OverviewChoice,
} from './optimizeOverviewModel'
import { type ResumeDecisionMap, type ResumeModuleDecision, type ResumeSwitchBlock } from './resumeDecisions'

const CHOICE_LABEL: Record<OverviewChoice, string> = { optimized: '采纳', original: '保留原文', todo: '待定' }
const MANUAL_NOTE: Record<ResumeSwitchBlock, string> = {
  'not-found': '这条改写没有原样写进优化稿，这里没法切换；要用哪一版，请在编辑区里对照着改。',
  'original-empty': '这条是新加的一句，原文里没有对应的句子，这里没法切换；不要的话，请在编辑区里删掉。',
}

function charCount(text: string): number {
  return text.replace(/\s/g, '').length
}

/**
 * 稿 23（2.0）总览。没点过的条目是待定：稿里仍是改写，导出也用这一句。
 * 点了「用改写 / 保留原文」立刻写进优化稿。自己写按导出稿里对不上原文也对不上改写的条数计。
 */
export function OptimizeOverview(props: {
  modules: ResumeOptimizeModule[]
  decisions: ResumeDecisionMap
  baseResume: GeneratedResume | null
  exportResume: GeneratedResume | null
  synthetic: boolean
  disabled: boolean
  batchNote: string | null
  decisionIssues: Record<string, string>
  saveExtra: ReactNode
  onDecisionChange: (key: string, next: ResumeModuleDecision) => void
  onBatch: (action: OverviewBatchAction) => void
  onCompare: (focusIndex?: number) => void
  onEditor: () => void
  onManual: () => void
  onReport: () => void
}) {
  const rows = buildOverviewRows(props.modules, props.decisions, props.baseResume)
  const stats = overviewStats(rows, props.exportResume)
  const total = stats.total
  const canAdopt = rows.some((row) => row.switchable && row.additions.length === 0 && row.decision !== 'optimized')
  const canKeep = rows.some((row) => row.switchable && row.decision === 'todo')
  const canClear = rows.some((row) => row.decision !== 'todo')

  return (
    <div className="qx-opt-overview" data-testid="resume-optimize-overview">
      <section className="qx-opt-sec" aria-labelledby="qx-opt-count-title">
        <div className="qx-opt-sec-h">
          <h2 id="qx-opt-count-title">这份简历有 {total} 处可以改</h2>
          {props.synthetic ? <small>合成样本</small> : null}
        </div>
        <p className="qx-opt-lead">
          建议<b>只改表达</b>：正常情况下只会重排、删减你原文里已经写过的内容，不新增学校、公司、证书、时间、薪资、获奖。
          改写里若出现原文没有的数字或职责词，那一条会标成待确认事实。「可采纳的全部采纳」会跳过这些条；你仍可以逐条点「用改写」，导出前还要逐项确认。
          你在这里的选择会写进优化稿，导出的就是这一版。
        </p>
        <div className="qx-opt-stat" aria-label="当前选择" data-testid="resume-optimize-counts">
          <span data-k="已决定" data-d="decided"><u>已决定</u><b>{stats.decided}<small>/{stats.total}</small></b></span>
          <span data-k="采纳" data-d="adopt"><u>采纳</u><b>{stats.adopt}</b></span>
          <span data-k="保留原文" data-d="keep"><u>保留原文</u><b>{stats.keep}</b></span>
          <span data-k="自己写" data-d="custom"><u>自己写</u><b>{stats.custom}</b></span>
          <span data-k="待确认事实" data-d="facts"><u>待确认事实</u><b>{stats.facts}</b></span>
        </div>
        <div className="qx-opt-seg" aria-hidden="true">
          {rows.map((row) => <u key={row.key} data-d={row.switchable ? row.decision : 'manual'} />)}
        </div>
        {stats.canSwitch ? (
          <div className="qx-opt-batch" data-testid="resume-optimize-batch">
            <button
              type="button"
              className="qx-opt-bx"
              data-testid="resume-optimize-batch-adopt"
              disabled={props.disabled || !canAdopt}
              onClick={() => props.onBatch('adopt-eligible')}
            >
              可采纳的全部采纳<small>跳过有待确认事实的那几条</small>
            </button>
            <button
              type="button"
              className="qx-opt-bx"
              data-testid="resume-optimize-batch-keep"
              disabled={props.disabled || !canKeep}
              onClick={() => props.onBatch('keep-undecided')}
            >
              其余保留原文<small>把还没决定的都记为保留</small>
            </button>
            <button
              type="button"
              className="qx-opt-bx"
              data-tone="danger"
              data-testid="resume-optimize-batch-clear"
              disabled={props.disabled || !canClear}
              onClick={() => props.onBatch('clear')}
            >
              清空全部选择<small>全部回到待定</small>
            </button>
          </div>
        ) : null}
        {props.batchNote ? <p className="qx-opt-batch-note" data-testid="resume-optimize-batch-note" role="status">{props.batchNote}</p> : null}
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
            const choice = row.switchable ? CHOICE_LABEL[row.decision] : '这一条只能在编辑区里改'
            return (
              <li key={row.key} className="qx-opt-mod" data-decision={row.switchable ? row.decision : 'manual'} data-pending={row.additions.length}>
                <button
                  type="button"
                  className="qx-opt-mod-open"
                  onClick={() => props.onCompare(row.index)}
                  aria-label={`第 ${row.index + 1} 条 ${title}，当前${choice}，去逐条对照`}
                >
                  <i className="no" aria-hidden="true">{row.index + 1}</i>
                  <span className="tx">
                    <b>{title}</b>
                    <span className={row.additions.length > 0 ? 'warn' : undefined}>
                      原文 {charCount(row.module.before)} 字 → 建议 {charCount(row.module.after)} 字 · {factLine}
                    </span>
                  </span>
                  <span className="qx-opt-chip" data-d={row.switchable ? row.decision : 'manual'}>{row.switchable ? CHOICE_LABEL[row.decision] : '只能手改'}</span>
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

      <section className="qx-opt-sec qx-opt-sec--save" aria-labelledby="qx-opt-save-title">
        <div className="qx-opt-sec-h">
          <h2 id="qx-opt-save-title">优化版简历编辑与导出</h2>
          <small>唯一可导出的工作区</small>
        </div>
        <div className="qx-opt-save">
          <button type="button" className="qx-opt-sbtn" data-testid="resume-optimize-open-editor" onClick={props.onEditor}>
            <span>编辑优化版简历</span>
            <small>排版 · 模板 · 导出</small>
          </button>
          <div className="qx-opt-need" data-testid="resume-optimize-save-need">
            {stats.canSwitch ? (
              <>
                <span>· 选了「用改写」或「保留原文」的，已经写进优化稿，导出的就是这一版</span>
                <span>· 还没点选的，导出仍用稿里的改写；自己写要在编辑区里改，这里不会自动替换</span>
                <span>· 登录后会自动保存草稿，并留下已导出的版本；没登录时，刷新会丢掉这次选择</span>
              </>
            ) : (
              <span>· 上面这几条都没法在这里切换，要用哪一版，请在编辑区里对照着改</span>
            )}
            <span>· PDF 可以进打印确认；Word、TXT、Markdown 先保存到手机</span>
          </div>
        </div>
        {props.saveExtra}
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

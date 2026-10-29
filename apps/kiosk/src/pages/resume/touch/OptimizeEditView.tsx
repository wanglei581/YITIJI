import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { GeneratedResume, ResumeLayoutSettings, ResumeTemplate } from '@ai-job-print/shared'
import { AiDeclarationNote } from '../../../ai/AiDeclarationNote'
import { QxTouchChip } from '../../../components/qingxu/touch/QxTouchChip'
import { QxTouchIcon } from '../../../components/qingxu/touch/QxTouchIcon'
import type { ResumeLayoutAdjustAction } from '../../../services/api/ai'
import { OptimizedResumeEditor } from '../components/OptimizedResumeEditor'
import { ResumeLayoutControls } from '../components/ResumeLayoutControls'
import { AIGC_SCREEN_MARK, COMPRESS_ONE_PAGE, HTML_PREVIEW_NOTE } from '../components/resume-deliver/constants'
import { ResumeVersionsPanel } from '../components/resume-deliver/ResumeVersionsPanel'
import './edit.css'

const ACCENT_NAME: Record<string, string> = { blue: '蓝', green: '绿', slate: '灰' }
const FONT_NAME: Record<string, string> = { compact: '紧凑', standard: '标准', large: '放大' }
const LINE_NAME: Record<string, string> = { compact: '紧凑', standard: '标准', relaxed: '舒展' }
const MARGIN_NAME: Record<string, string> = { narrow: '窄', normal: '标准', wide: '宽' }

/**
 * 编辑（稿 resume-edit）：左边是简历页（可直接点开改字）与六条说明，右边是状态、模板、主色、更多版式、AI 辅助调整。
 * 页数导出前不知道，这里的页数提示只是示意；导出的就是编辑区里的这一份。
 */
export function OptimizeEditView(props: {
  resume: GeneratedResume
  onResumeChange: (next: GeneratedResume) => void
  unconfirmed: string[]
  layout: Required<ResumeLayoutSettings>
  onLayoutChange: (next: Required<ResumeLayoutSettings>) => void
  previewClassName: string
  previewStyle: CSSProperties
  templates: ResumeTemplate[]
  templatesError: boolean
  selectedTemplateId: string
  onTemplateChange: (id: string) => void
  onTemplates: () => void
  loading: boolean
  exporting: boolean
  aiUnavailable: boolean
  adjusting: ResumeLayoutAdjustAction | null
  lastResumeBeforeAiAdjust: GeneratedResume | null
  adjustWarnings: string[]
  adjustError: string | null
  onAiAdjust: (action: ResumeLayoutAdjustAction) => void
  onUndoAi: () => void
  estimatedPagesLabel: string
  /** 草稿状态一句话：未登录 / 未保存 / 草稿已保存 hh:mm:ss / 保存失败… */
  saveText: string
  saveTone: 'bad' | 'plain'
  hasModules: boolean
  onBackToOverview: () => void
  token: string | null
  taskId?: string
  exportVersion: number
}) {
  const [moreLayout, setMoreLayout] = useState(false)
  const { layout, loading, exporting, resume: optimizedResume, adjusting } = props
  const selected = props.templates.find((tpl) => tpl.id === props.selectedTemplateId)
  const pending = props.unconfirmed.length
  const aiAdjustDisabled = props.aiUnavailable || loading || exporting || !optimizedResume || Boolean(adjusting)
  return (
    <div className="qxt-edit">
      <div className="qxt-paperbox">
        <p className="qxt-paperbox-note">{AIGC_SCREEN_MARK} · {HTML_PREVIEW_NOTE} · 导出后的 PDF 才是打印稿。</p>
        <div className="qxt-paperbox-in">
          <OptimizedResumeEditor
            resume={props.resume}
            onChange={props.onResumeChange}
            layout={layout}
            previewClassName={props.previewClassName}
            previewStyle={props.previewStyle}
          />
        </div>
        <div className="qxt-sheetfacts">
          <div><b>页数</b><span>{props.estimatedPagesLabel}</span></div>
          <div className="qxt-wide"><b>模板</b><span>{selected ? `当前选中「${selected.title}」。想换别的，去右边素材库。` : '没有选中模板，导出用默认版式。想换，去右边素材库。'}</span></div>
          <div><b>状态</b><span>{props.saveText}。选择和版式要在编辑区里才进导出。</span></div>
          <div className="qxt-wide"><b>事实</b><span>{pending > 0 ? `还有 ${pending} 处待确认：${props.unconfirmed.join('、')}。未全勾不能出文件。` : '改写里没有原文之外的新增事实；导出前仍要逐项核对。'}</span></div>
          <div><b>主色</b><span>现在是{ACCENT_NAME[layout.accent] ?? layout.accent}。要改就点右边的色块，绿和灰同样能选。</span></div>
          <div><b>栏数</b><span>现在是{layout.columns === 2 ? '双栏' : '单栏'}。字号、行距、页边距在「更多版式」里。</span></div>
        </div>
      </div>
      <div className="qxt-side">
        <p className="qxt-savestat" data-tone={props.saveTone} role="status">{props.saveText}</p>
        {pending > 0 ? <p className="qxt-warn">还有 {pending} 处事实待你确认，确认后才能导出</p> : null}
        <div className="qxt-block">
          <div className="qxt-lab">模板</div>
          {props.templatesError ? <p className="qxt-note">模板列表这次没读取到，不是没有模板。导出仍可进行，会使用默认版式；排版调整照常可用。</p> : null}
          {props.templates.map((tpl) => (
            <button key={tpl.id} type="button" className="qxt-tpl" aria-pressed={props.selectedTemplateId === tpl.id} disabled={exporting} onClick={() => props.onTemplateChange(tpl.id)}>
              {tpl.title}
            </button>
          ))}
          <button type="button" className="qxt-outlink" onClick={props.onTemplates}>去素材库看更多模板</button>
          <p className="qxt-hint">换模板出新稿，不保留原件版式；PDF 导出按所选模板自动填充版式；Word/TXT/Markdown 保持内容格式导出。</p>
        </div>
        <ResumeLayoutControls variant="touch" layout={layout} onChange={props.onLayoutChange} disabled={exporting} only={['accent']} />
        <button type="button" className="qxt-outlink qxt-morebtn" id="d4LayoutMore" aria-expanded={moreLayout} onClick={() => setMoreLayout((open) => !open)}>
          {moreLayout ? '收起版式' : '更多版式 ›'}
        </button>
        {moreLayout ? (
          <div className="qxt-layout">
            <ResumeLayoutControls variant="touch" layout={layout} onChange={props.onLayoutChange} disabled={exporting} only={['fontScale', 'lineSpacing', 'margin', 'columns']} />
            <button type="button" className="qxt-outlink" disabled={exporting} onClick={() => props.onLayoutChange({ ...layout, fontScale: 'compact', lineSpacing: 'compact' })}>{COMPRESS_ONE_PAGE}</button>
          </div>
        ) : null}
        <div className="qxt-ai">
          <h3>AI 辅助调整 <QxTouchChip tone="teal">AI</QxTouchChip></h3>
          <p>仅基于当前简历和原文做表达密度调整，不新增经历或事实</p>
          <p>导出的就是编辑区里的这一份。PDF 可以进打印确认；Word、TXT、Markdown 先保存到手机。</p>
          <div className="qxt-ai-acts">
            <button type="button" disabled={aiAdjustDisabled} onClick={() => props.onAiAdjust('condense')}>{adjusting === 'condense' ? '正在精简…' : 'AI 精简'}</button>
            <button type="button" disabled={aiAdjustDisabled} onClick={() => props.onAiAdjust('reformat')}>{adjusting === 'reformat' ? '正在调整…' : 'AI 调整排版'}</button>
          </div>
          {props.aiUnavailable && <p className="qxt-note" role="status">AI 暂时不可用，不能精简或调整排版；你仍可手动编辑和调整版式。</p>}
          <AiDeclarationNote />
          {props.lastResumeBeforeAiAdjust ? <button type="button" className="qxt-outlink" onClick={props.onUndoAi}>撤销 AI 调整</button> : null}
          {props.adjustWarnings.slice(0, 3).map((warning) => <p key={warning} className="qxt-note">{warning}</p>)}
          {props.adjustError ? <p className="qxt-note" data-tone="bad" role="alert">{props.adjustError}</p> : null}
        </div>
        {props.hasModules ? (
          <button type="button" className="qxt-outlink" onClick={props.onBackToOverview}>
            <QxTouchIcon name="chevL" size={26} strokeWidth={2.4} />返回建议总览
          </button>
        ) : null}
        {props.token && props.taskId ? (
          <details className="qxt-all qxt-versions">
            <summary>已确认版本</summary>
            <ResumeVersionsPanel taskId={props.taskId} token={props.token} refreshKey={props.exportVersion} />
          </details>
        ) : null}
        {moreLayout ? null : (
          <div className="qxt-now">
            <b>当前版式</b>
            <span>字号{FONT_NAME[layout.fontScale]} · 行距{LINE_NAME[layout.lineSpacing]} · 页边距{MARGIN_NAME[layout.margin]} · {layout.columns === 2 ? '双栏' : '单栏'} · 主色{ACCENT_NAME[layout.accent]}</span>
            <span>这些收在「更多版式」里。导出的是编辑区里的这一份。</span>
          </div>
        )}
      </div>
    </div>
  )
}

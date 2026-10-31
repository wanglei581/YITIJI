import type { ComponentProps } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchOverlay } from '../../components/qingxu/touch/QxTouchOverlay'
import { Hit } from '../public-touch/PublicBlocks'
import { AdvisorManualEntries } from './AdvisorConversation'
import { AiToolSection } from './AdvisorTools'
import { advisorUserReason } from './advisorUserCopy'

export type AssistantSheetKind = 'tools' | 'manual' | 'acts'

type ToolProps = ComponentProps<typeof AiToolSection>

/**
 * 问小青的三张底部弹层：本机 AI 专项、不经过 AI 直接去办、这一主题还能去哪。
 * 只在有弹层要开时才渲染：QxTouchScreen 按「有没有 overlay」把底下的内容置为 inert，不能永远传一个空壳进去。
 */
export function AssistantSheets({
  sheet,
  onClose,
  tools,
  goActions,
}: {
  sheet: AssistantSheetKind
  onClose: () => void
  tools: Pick<ToolProps, 'degraded' | 'degradedReason' | 'availability' | 'activeSkill'>
  goActions: ReadonlyArray<{ route: string; label: string }> | undefined
}) {
  const navigate = useNavigate()
  const actions = <button type="button" className="qxt-btn qxt-btn-sec" onClick={onClose}>收起</button>
  if (sheet === 'tools') {
    return (
      <QxTouchOverlay kind="sheet" title="本机 AI 专项" onClose={onClose} dismissOnScrim actions={actions}>
        <AiToolSection {...tools} />
      </QxTouchOverlay>
    )
  }
  if (sheet === 'manual') {
    return (
      <QxTouchOverlay kind="sheet" title="不经过 AI，直接去办" onClose={onClose} dismissOnScrim actions={actions}>
        <AdvisorManualEntries variant="sheet" />
      </QxTouchOverlay>
    )
  }
  return (
    <QxTouchOverlay kind="sheet" title="这一主题还能去哪" onClose={onClose} dismissOnScrim actions={actions}>
      {goActions && goActions.length > 0 ? (
        <div className="action-chips" aria-label="这一主题的办事入口">
          {goActions.map((action) => (
            <Hit key={action.route} title={advisorUserReason(action.label, '去办理')} sub="去办理" onClick={() => navigate(action.route)} />
          ))}
        </div>
      ) : (
        <p className="qxp-note">本终端未开放岗位与招聘会信息。这一主题没有「去办理」入口，问题仍可以问。</p>
      )}
    </QxTouchOverlay>
  )
}

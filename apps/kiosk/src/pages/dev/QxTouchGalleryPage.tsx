import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchBand } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchCallout } from '../../components/qingxu/touch/QxTouchCallout'
import { QxTouchChip } from '../../components/qingxu/touch/QxTouchChip'
import { QxTouchDock } from '../../components/qingxu/touch/QxTouchDock'
import { QxTouchNav } from '../../components/qingxu/touch/QxTouchNav'
import { QxTouchOverlay } from '../../components/qingxu/touch/QxTouchOverlay'
import { QxTouchScreen } from '../../components/qingxu/touch/QxTouchScreen'
import { QxTouchSeg } from '../../components/qingxu/touch/QxTouchSeg'
import { QxTouchSlab } from '../../components/qingxu/touch/QxTouchSlab'
import { QxTouchTask } from '../../components/qingxu/touch/QxTouchTask'
import { QxTouchTile } from '../../components/qingxu/touch/QxTouchTile'
import { buildStateFrame, galleryAsk, type GalleryStateId } from './touchGalleryFrames'

const STATES: { id: GalleryStateId; label: string }[] = [
  { id: 'loading', label: '加载' },
  { id: 'empty', label: '空' },
  { id: 'error', label: '出错' },
  { id: 'unavailable', label: '不可用' },
  { id: 'device-off', label: '设备停用' },
  { id: 'unconfirmed', label: '结果未确认' },
  { id: 'ai-down', label: '小青不可用' },
]

type OverlayKind = 'dialog' | 'sheet'

/** 开发样板（非业务屏）。只在开发环境挂上路由，不进导航。 */
export function QxTouchGalleryPage() {
  const navigate = useNavigate()
  const [view, setView] = useState<'parts' | GalleryStateId>('parts')
  const [overlay, setOverlay] = useState<OverlayKind | null>(null)
  const [seg, setSeg] = useState('one')
  const [note, setNote] = useState('')
  const nav = (
    <QxTouchNav
      current="home"
      onHome={() => navigate('/')}
      onAdvisor={() => navigate('/assistant')}
      onProfile={() => navigate('/profile')}
    />
  )
  const backToParts = () => {
    setNote('')
    setOverlay(null)
    setView('parts')
  }
  const openState = (id: GalleryStateId) => {
    setNote('')
    setOverlay(null)
    setView(id)
  }

  if (view !== 'parts') {
    const frame = buildStateFrame(view, {
      onGo: (label) => setNote(`样板去向：${label}`),
      onHome: () => navigate('/'),
      onBack: backToParts,
    })
    return (
      <QxTouchScreen
        key={view}
        stateId={view}
        testId="touch-gallery"
        motion="enter"
        bodyClassName={frame.bodyClassName}
        band={frame.band}
        dock={frame.dock}
        nav={nav}
      >
        {frame.body}
        {note ? <p className="qxt-note">{note}</p> : null}
      </QxTouchScreen>
    )
  }

  return (
    <QxTouchScreen
      key="parts"
      stateId="parts"
      testId="touch-gallery"
      motion="enter"
      bodyClassName="qxt-body-scroll"
      band={(
        <QxTouchBand
          eyebrow="触屏公共件"
          title="开发样板"
          sub="这一屏只摆公共件，不接业务。"
          place=" "
          seal="idle"
          status={{ text: '状态未知', tone: 'unknown' }}
          onBack={() => navigate('/')}
        />
      )}
      dock={(
        <QxTouchDock
          onBack={() => navigate('/')}
          ask={galleryAsk('问小青：这一步怎么办？', '这一步我不知道怎么继续。请只说明可以怎么做。不要替我提交或下单。')}
          primary={{ label: '主按钮', onClick: () => setNote('样板：主按钮已按下') }}
        />
      )}
      nav={nav}
      overlay={overlay === 'dialog' ? (
        <QxTouchOverlay
          kind="dialog"
          title="确认这一步？"
          onClose={() => setOverlay(null)}
          dismissOnScrim={true}
          actions={(
            <>
              <button type="button" className="qxt-btn qxt-btn-sec" onClick={() => setOverlay(null)}>留下</button>
              <button type="button" className="qxt-btn qxt-btn-pri" onClick={() => setOverlay(null)}>关闭</button>
            </>
          )}
        >
          <p>这一层是对话框。点遮罩可以关掉。</p>
        </QxTouchOverlay>
      ) : overlay === 'sheet' ? (
        <QxTouchOverlay
          kind="sheet"
          title="底单"
          onClose={() => setOverlay(null)}
          actions={(
            <button type="button" className="qxt-btn qxt-btn-sec" onClick={() => setOverlay(null)}>关闭</button>
          )}
        >
          <p className="qxt-note">这一层是底单。点遮罩和 Esc 都不会关掉。</p>
        </QxTouchOverlay>
      ) : null}
    >
      <QxTouchTile icon="folder" title="示例磁贴" desc="点一下有按下反馈" onClick={() => setNote('样板：磁贴已按下')} />
      <QxTouchTask icon="file" title="示例任务" desc="主卡槽位，插画留给后面的页面。" take="去看" onClick={() => setNote('样板：任务已按下')} />
      <QxTouchSlab row title="示例厚卡" desc="横排厚卡，右边是空的插画槽。" onClick={() => setNote('样板：厚卡已按下')} />
      <QxTouchChip>示例标签</QxTouchChip>
      <QxTouchSeg
        label="示例分段"
        value={seg}
        onChange={setSeg}
        options={[
          { id: 'one', label: '第一项' },
          { id: 'two', label: '第二项' },
          { id: 'off', label: '不可用', disabled: true },
        ]}
      />
      <QxTouchCallout kind="remind">这是提醒条，不是业务结论。</QxTouchCallout>
      <div className="qxt-openers">
        {STATES.map((item) => (
          <button key={item.id} type="button" className="qxt-btn qxt-btn-sec" data-qxt-open={item.id} onClick={() => openState(item.id)}>
            {item.label}
          </button>
        ))}
        <button type="button" className="qxt-btn qxt-btn-sec" data-qxt-open="dialog" onClick={() => setOverlay('dialog')}>对话框</button>
        <button type="button" className="qxt-btn qxt-btn-sec" data-qxt-open="sheet" onClick={() => setOverlay('sheet')}>底单</button>
      </div>
      {note ? <p className="qxt-note">{note}</p> : null}
    </QxTouchScreen>
  )
}

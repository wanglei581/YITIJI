import { createContext, useContext, type ReactNode } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { QxTouchBand } from '../components/qingxu/touch/QxTouchBand'
import { QxTouchDock } from '../components/qingxu/touch/QxTouchDock'
import { QxTouchScreen } from '../components/qingxu/touch/QxTouchScreen'
import { CapabilityExplain, CapabilityStayCards, P10HelpRemind } from './CapabilityStayCards'
import './capability-gate-touch.css'
import {
  OFF_SMART_CAMPUS_CAPABILITY,
  type SmartCampusCapabilityState,
  useSmartCampusCapabilityState,
} from '../hooks/useSmartCampusConfig'
import {
  OFF_TOOLBOX_CAPABILITY,
  type ToolboxCapabilityState,
  useToolboxCapabilityState,
} from '../hooks/useToolboxConfig'
import { getTerminalId } from '../services/api/terminalConfig'

/* eslint-disable react-refresh/only-export-components -- route boundaries and their fail-closed contexts are one security unit */

const ToolboxCapabilityContext = createContext<ToolboxCapabilityState | null>(null)
const SmartCampusCapabilityContext = createContext<SmartCampusCapabilityState | null>(null)

export function useToolboxCapabilitySnapshot(): ToolboxCapabilityState {
  return useContext(ToolboxCapabilityContext) ?? OFF_TOOLBOX_CAPABILITY
}

export function useSmartCampusCapabilitySnapshot(): SmartCampusCapabilityState {
  return useContext(SmartCampusCapabilityContext) ?? OFF_SMART_CAMPUS_CAPABILITY
}

function capabilityReady(state: {
  status: 'loading' | 'ready'
  enabled: boolean
  terminalId: string
}): boolean {
  const currentTerminalId = getTerminalId()
  return (
    state.status === 'ready' &&
    state.enabled &&
    currentTerminalId.length > 0 &&
    state.terminalId === currentTerminalId
  )
}

/** 读取中的占位：只有字，没有任何按钮。 */
const TOOLBOX_LOADING = ['正在读取服务名称', '正在读取打开方式', '正在读取说明', '正在读取上架状态', '正在读取入口', '正在读取说明文字', '正在读取打开方式', '正在读取上架范围'] as const
const CAMPUS_LOADING = ['正在读取迎新与行李', '正在读取校园卡', '正在读取一卡通', '正在读取校园网', '正在读取导览', '正在读取办事窗口', '正在读取开通范围', '正在读取说明'] as const

function CapabilityUnavailable({ loading, label }: { loading: boolean; label: string }) {
  const navigate = useNavigate()
  const text = loading ? `${label}配置检查中` : `本机暂未开启${label}`
  const campus = label.startsWith('智慧校园')
  const title = campus ? '智慧校园' : '百宝箱'
  return (
    <QxTouchScreen
      testId="capability-gate-touch"
      stateId={loading ? 'loading' : 'off'}
      bodyClassName="qxt-body-scroll"
      band={(
        <QxTouchBand
          eyebrow="本机能力"
          title={title}
          sub={loading ? '读完之前不显示服务，也不能进入。' : '这项还没在这台机器上开通。下面这些去处不受影响。'}
          back={false}
          status={{ text: loading ? '正在确认' : '未开启', tone: 'unknown' }}
        />
      )}
      dock={loading ? undefined : (
        <QxTouchDock
          back={false}
          primary={{ label: '返回首页', onClick: () => navigate('/'), noArrow: true }}
        />
      )}
    >
      <div className="p10-gate-wrap">
        <div
          className="p10-gate"
          data-kiosk-screen="capability-gate"
          data-kiosk-capability-gate={campus ? 'smart-campus' : 'toolbox'}
          data-capability-state={loading ? 'loading' : 'unavailable'}
        >
          <p role="status" aria-live="polite">{text}</p>
        </div>
        {loading ? (
          (campus ? CAMPUS_LOADING : TOOLBOX_LOADING).map((hint, index) => (
            <div className="p10-sk" key={`${hint}-${index}`}>{hint}</div>
          ))
        ) : (
          <>
            <CapabilityExplain opensAt="首页" />
            <CapabilityStayCards />
            <P10HelpRemind />
          </>
        )}
      </div>
    </QxTouchScreen>
  )
}

function Boundary<T extends { status: 'loading' | 'ready'; enabled: boolean; terminalId: string }>({
  state,
  label,
  provider,
}: {
  state: T
  label: string
  provider: (children: ReactNode) => ReactNode
}) {
  if (!capabilityReady(state)) {
    return <CapabilityUnavailable loading={state.status === 'loading'} label={label} />
  }
  return <>{provider(<Outlet />)}</>
}

export function ToolboxCapabilityBoundary() {
  const state = useToolboxCapabilityState()
  return (
    <Boundary
      state={state}
      label="百宝箱服务"
      provider={(children) => (
        <ToolboxCapabilityContext.Provider value={state}>{children}</ToolboxCapabilityContext.Provider>
      )}
    />
  )
}

export function SmartCampusCapabilityBoundary() {
  const state = useSmartCampusCapabilityState()
  return (
    <Boundary
      state={state}
      label="智慧校园服务"
      provider={(children) => (
        <SmartCampusCapabilityContext.Provider value={state}>
          {children}
        </SmartCampusCapabilityContext.Provider>
      )}
    />
  )
}

import { Button, Card } from '@ai-job-print/ui'
import { createContext, useContext, type ReactNode } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
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

function CapabilityUnavailable({ loading, label }: { loading: boolean; label: string }) {
  const navigate = useNavigate()
  return (
    <div
      className="grid min-h-screen place-items-center p-10"
      data-kiosk-screen="capability-gate"
      data-kiosk-capability-gate={label.startsWith('智慧校园') ? 'smart-campus' : 'toolbox'}
      data-capability-state={loading ? 'loading' : 'unavailable'}
    >
      <Card className="kproto-card flex flex-col items-center justify-center gap-4 p-10 text-center">
        <p className="text-lg text-neutral-500" role="status" aria-live="polite">
          {loading ? `${label}配置检查中` : `本机暂未开启${label}`}
        </p>
        {!loading ? (
          <Button size="lg" onClick={() => navigate('/')}>
            返回首页
          </Button>
        ) : null}
      </Card>
    </div>
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

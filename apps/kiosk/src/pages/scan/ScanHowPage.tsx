import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loginPathForCurrentLocation } from '../../auth/returnPath'
import { useAuth } from '../../auth/useAuth'
import { useLocalScanProbe } from '../../hooks/useTerminalDeviceStatus'
import { PhoneHelpLine } from '../print-scan/phoneHelp'
import { armScanHowContinue, clearScanHowContinue, consumeScanHowContinue, peekScanHowContinue } from './scanHowContinue'
import { SCAN_MATERIALS, panelScanType, type ScanMaterial } from './scanMaterials'
import { scanReadyChipText, screenScanBlockReason } from './scanProbeCopy'
import { openPanelScanSettings } from './ScanStartPage'
import { SCAN_DEVICE_RAIL, ScanWorkbenchShell, type ScanDock } from './ScanWorkbenchChrome'
import { type ScanStage } from './scanWorkbenchModel'
import { patchScanWorkbenchSession, readScanWorkbenchSession } from './scanWorkbenchSession'
import { useScanDeviceCapability } from './useScanDeviceCapability'
import './styles/scan-device-qx.css'

function labelOf(material: ScanMaterial): string {
  return SCAN_MATERIALS.find((item) => item.material === material)?.label ?? ''
}

export function ScanHowPage({ onGoStage }: { onGoStage?: (stage: ScanStage) => void } = {}) {
  const navigate = useNavigate()
  const { isLoggedIn } = useAuth()
  const cap = useScanDeviceCapability()
  const probe = useLocalScanProbe(true)
  const [material, setMaterial] = useState<ScanMaterial | null>(null)
  const [way, setWay] = useState<'screen' | 'panel'>('panel')
  const userPicked = useRef(false)

  useEffect(() => {
    const session = readScanWorkbenchSession()
    if (session?.live || session?.result) {
      clearScanHowContinue()
      onGoStage?.('start')
      return
    }
    let next = session?.material ?? null
    if (isLoggedIn) {
      const pending = peekScanHowContinue()
      if (pending) {
        consumeScanHowContinue()
        if (!next) {
          next = pending
          patchScanWorkbenchSession({
            stage: 'how',
            material: pending,
            scanType: panelScanType(pending),
          })
        }
      }
    }
    if (!next) {
      onGoStage?.('start')
      return
    }
    setMaterial(next)
  }, [isLoggedIn, onGoStage])

  const showOff = !cap.loading && !cap.unknown && !cap.allowed
  const blockReason = screenScanBlockReason({
    capLoading: cap.loading,
    capUnknown: cap.unknown,
    capAllowed: cap.allowed,
    probe,
  })
  const screenAllowed = blockReason === null && !showOff

  useEffect(() => {
    if (!screenAllowed) {
      setWay('panel')
      return
    }
    if (!userPicked.current) setWay('screen')
  }, [screenAllowed])

  if (!material) return null

  const readyLabel = scanReadyChipText(screenAllowed && probe.freshReady && cap.allowed)
  const pending = cap.loading || (cap.allowed && probe.phase !== 'done')
  const createsOnNext = showOff || (!pending && !(screenAllowed && way === 'screen'))
  const goWhat = (): void => {
    patchScanWorkbenchSession({ stage: 'start' })
    onGoStage?.('start')
  }
  const goPanel = (): void => {
    openPanelScanSettings(navigate, onGoStage, panelScanType(material))
  }
  const goNext = (): void => {
    if (pending) return
    if (screenAllowed && way === 'screen') {
      patchScanWorkbenchSession({ stage: 'device-settings' })
      onGoStage?.('device-settings')
      return
    }
    goPanel()
  }
  const goLogin = (): void => {
    if (!armScanHowContinue(material)) {
      onGoStage?.('start')
      return
    }
    navigate(loginPathForCurrentLocation())
  }

  const status = showOff
    ? { tone: 'warn' as const, label: '屏上扫描未开通' }
    : readyLabel
      ? { tone: 'ok' as const, label: readyLabel }
      : { tone: 'warn' as const, label: blockReason ?? '状态未知' }

  const dock: ScanDock = showOff
    ? {
        left: { label: '返回', leaveTo: '/print-scan' },
        primary: { label: '到打印机面板上扫', onClick: goPanel },
      }
    : {
        left: { label: '返回', onClick: goWhat },
        primary: pending
          ? { label: '正在检查扫描仪', onClick: () => undefined, disabled: true, noArrow: true }
          : { label: '下一步', onClick: goNext },
      }

  return (
    <ScanWorkbenchShell
      page={showOff ? 'scan-off' : 'scan-how'}
      state="setup"
      title={showOff ? '这台机器还不能在屏上开始扫描' : '怎么扫？'}
      subtitle={showOff ? '先用打印机面板扫描，文件会传回这台机器。' : null}
      status={status}
      dock={dock}
      bandEyebrow={showOff ? '屏上扫描' : `屏上扫描 · ${labelOf(material)}`}
      bandRail={showOff ? null : { labels: SCAN_DEVICE_RAIL, now: 1 }}
      onBandBack={showOff ? undefined : goWhat}
      bandBackLabel={showOff ? '返回打印扫描' : '返回'}
    >
      {showOff ? (
        <div className="cs-ways">
          <button type="button" className="cs-way" disabled data-testid="scan-way-screen">
            <span className="tx">
              <span className="sx-chip is-warn">这台机器还没开通</span>
              <h3>在这块屏上开始扫描</h3>
              <p>放好纸，在屏上点开始，扫描仪自己动。这台机器暂时做不到。</p>
            </span>
          </button>
          <button type="button" className="cs-way" data-testid="scan-way-panel" onClick={goPanel}>
            <span className="tx">
              <span className="sx-chip">现在可以用</span>
              <h3>到打印机面板上扫</h3>
              <p>在打印机屏幕上按扫描，文件传回这台机器。</p>
            </span>
          </button>
        </div>
      ) : (
        <div className="cs-ways">
          <button
            type="button"
            className="cs-way"
            data-testid="scan-way-screen"
            disabled={!screenAllowed}
            aria-pressed={way === 'screen'}
            onClick={() => {
              if (!screenAllowed) return
              userPicked.current = true
              setWay('screen')
            }}
          >
            <span className="tx">
              {screenAllowed ? <span className="sx-chip">推荐</span> : null}
              <h3>在这块屏上开始扫描</h3>
              <p>{screenAllowed ? '放好纸，在屏上点开始，扫描仪自己动' : blockReason}</p>
            </span>
          </button>
          <button
            type="button"
            className="cs-way"
            data-testid="scan-way-panel"
            aria-pressed={way === 'panel'}
            onClick={() => {
              userPicked.current = true
              setWay('panel')
            }}
          >
            <span className="tx">
              <h3>到打印机面板上扫</h3>
              <p>在打印机屏幕上按扫描，文件传回这台机器</p>
            </span>
          </button>
        </div>
      )}
      {!showOff && !isLoggedIn ? (
        <div className="cs-login">
          <span>想带走电子版？先扫码登录（微信一扫，不用短信），扫完会存进「我的文档」</span>
          <button type="button" className="qxt-btn qxt-btn-pri" data-testid="scan-how-login" onClick={goLogin}>先登录</button>
        </div>
      ) : null}
      {!showOff ? (
        <div className="cs-hold" role="note">用 U 盘：在打印机面板上选「扫描到 U 盘」——这台机器暂未开通</div>
      ) : (
        <PhoneHelpLine />
      )}
      {createsOnNext ? <p className="cs-create" role="status">下一步会真实建立这次扫描</p> : null}
    </ScanWorkbenchShell>
  )
}

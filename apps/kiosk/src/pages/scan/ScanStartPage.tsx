import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams, type NavigateFunction } from 'react-router-dom'
import { canCreateFormalPrintScanTask } from '@ai-job-print/shared'
import { useLocalScanProbe } from '../../hooks/useTerminalDeviceStatus'
import { FsRow } from '../print-scan/FsRow'
import { PhoneHelpLine } from '../print-scan/phoneHelp'
import {
  loadConfiguredCapabilities,
  type ConfiguredCapability,
} from '../../services/api/printScanCapabilities'
import { isScanMaterial, panelScanType, type ScanMaterial } from './scanMaterials'
import { scanReadyChipText } from './scanProbeCopy'
import {
  SCAN_DEVICE_RAIL,
  ScanTypeCards,
  ScanSample,
  ScanWorkbenchShell,
  type ScanDock,
} from './ScanWorkbenchChrome'
import { type ScanType } from './scanWorkbench'
import { type ScanStage } from './scanWorkbenchModel'
import { patchScanWorkbenchSession, readScanWorkbenchSession } from './scanWorkbenchSession'
import { useScanDeviceCapability } from './useScanDeviceCapability'

/**
 * 面板路线真正建会话的那一次跳转。变量名必须是 selected：门禁按这个名字核对带去设置页的类型。
 * 合同进面板时 selected 已经是 document。
 */
export function openPanelScanSettings(
  navigate: NavigateFunction,
  onGoStage: ((stage: ScanStage) => void) | undefined,
  selected: ScanType,
): void {
  patchScanWorkbenchSession({
    stage: 'settings',
    scanType: selected,
    live: undefined,
    result: undefined,
  })
  if (onGoStage) {
    onGoStage('settings')
    return
  }
  navigate('/scan?stage=settings', { state: { scanType: selected } })
}

/** 能力门禁态：禁止伪装硬件已就绪。 */
type ScanGate = 'loading' | 'allowed' | 'blocked' | 'unknown'

const CAPABILITY_STATUS_NOTES: Record<string, string> = {
  testing: '测试中，暂未对用户开放',
  maintenance: '维护中，暂时不可用',
  unsupported: '本终端不支持该能力',
  not_verified: '待验收，暂未开放',
}

function resolveGate(scanCap: ConfiguredCapability | undefined, loadStatus: 'ok' | 'skipped' | 'error'): ScanGate {
  if (loadStatus === 'error') return 'unknown'
  if (!scanCap) return 'allowed'
  return canCreateFormalPrintScanTask(scanCap.status) ? 'allowed' : 'blocked'
}

export function ScanStartPage({ onGoStage }: { onGoStage?: (stage: ScanStage) => void } = {}) {
  const navigate = useNavigate()
  const [params, setSearchParams] = useSearchParams()
  const usbPanel = params.get('mode') === 'usb-panel'
  const storedSession = readScanWorkbenchSession()
  const storedType = storedSession?.material
    ?? (isScanMaterial(storedSession?.scanType) ? storedSession.scanType : null)
  /* 进来不替人选类型（走查 I-16，回归：#1326 改成不默认选，触屏集成又改回 'resume'）。
   * 想扫证件、普通文档的人不点类型直接「下一步」，会被悄悄建成简历扫描。
   * 只有本机登记里已经有类型（同一场里回到这一屏）时才恢复；verify-fusion-w2-print-scan 钉住这句初值。 */
  const [selected, setSelected] = useState<ScanMaterial | null>(storedType ?? null)
  const probe = useLocalScanProbe(false)
  const deviceCap = useScanDeviceCapability()
  const readyLabel = scanReadyChipText(probe.freshReady && deviceCap.allowed)
  const [gate, setGate] = useState<ScanGate>('loading')
  const [blockedNote, setBlockedNote] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const refreshGate = useCallback(async () => {
    setChecking(true)
    try {
      const result = await loadConfiguredCapabilities()
      const scanCap = result.map.scan
      setGate(resolveGate(scanCap, result.status))
      if (scanCap && !canCreateFormalPrintScanTask(scanCap.status)) {
        setBlockedNote(scanCap.note ?? CAPABILITY_STATUS_NOTES[scanCap.status] ?? '该终端当前不提供扫描服务')
      } else {
        setBlockedNote(null)
      }
    } catch {
      setGate('unknown')
      setBlockedNote(null)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void refreshGate()
  }, [refreshGate])

  const blocked = !usbPanel && (gate === 'blocked' || gate === 'unknown' || gate === 'loading')
  const workbenchState = usbPanel
    ? 'usb-panel'
    : gate === 'loading'
      ? 'loading'
      : gate === 'unknown'
        ? 'unknown'
        : gate === 'blocked'
          ? 'blocked'
          : 'setup'
  const status =
    usbPanel
      ? { tone: 'warn' as const, label: '独立路径 · 扫描到 U 盘' }
      : gate === 'loading'
        ? { tone: 'unknown' as const, label: '正在确认扫描能力' }
        : gate === 'blocked'
          ? { tone: 'bad' as const, label: '扫描能力暂未开放' }
          : gate === 'unknown'
            ? { tone: 'unknown' as const, label: '能力状态暂不可用' }
            : readyLabel
              ? { tone: 'ok' as const, label: readyLabel }
              : { tone: 'ok' as const, label: '可创建扫描任务 · 需面板操作' }

  const subtitle = usbPanel
    ? '这是打印机自己的独立能力，不经过屏幕上的扫描流程'
    : blocked
      ? '当前无法创建扫描任务，请查看说明或改用其他方式'
      : '请先选择一种材料。本页尚未创建任务。'

  const goStart = () => {
    if (onGoStage) {
      setSearchParams({ stage: 'start' }, { replace: true })
      return
    }
    navigate('/scan?stage=start')
  }
  const dock: ScanDock = usbPanel
    ? {
        left: { label: '返回材料扫描', onClick: goStart },
        primary: { label: '完成后回打印扫描', onClick: () => navigate('/print-scan') },
      }
    : blocked
      ? {
          left: { label: '返回打印扫描', onClick: () => navigate('/print-scan') },
          primary: { label: '改用上传文件打印', onClick: () => navigate('/print/upload') },
        }
      : selected === null
        ? {
            // 没选类型：说明为什么按不了，而不是一颗说「下一步」却不动的灰按钮。
            primary: { label: '先选一种材料', onClick: () => undefined, disabled: true, noArrow: true },
          }
        : {
            primary: {
              label: '下一步',
              onClick: () => {
                if (selected === null) return
                patchScanWorkbenchSession({
                  stage: 'how',
                  material: selected,
                  scanType: panelScanType(selected),
                  deviceChoice: undefined,
                  live: undefined,
                  result: undefined,
                })
                if (onGoStage) {
                  onGoStage('how')
                  return
                }
                navigate('/scan?stage=how')
              },
            },
          }

  return (
    <ScanWorkbenchShell
      page="scan-start"
      state={workbenchState}
      title={
        usbPanel
          ? '扫描到 U 盘'
          : gate === 'loading'
            ? '正在确认扫描能力'
            : gate === 'blocked'
              ? '扫描能力暂未开放'
              : gate === 'unknown'
                ? '能力状态暂不可用'
                : '扫什么？'
      }
      subtitle={subtitle}
      status={status}
      layout="stack"
      dock={dock}
      bandEyebrow={usbPanel || blocked ? undefined : '屏上扫描'}
      bandRail={usbPanel || blocked ? undefined : { labels: SCAN_DEVICE_RAIL, now: 0 }}
    >
      {usbPanel ? (
        <>
          <p className="fs-warn">这条能力暂未开通，不能把这条说明当成已经可以用。</p>
          <div className="fs-grow is-status">
            <div className="fs-facts">
              <div className="fs-pairgrid">
                <div className="fs-fact"><b>把 U 盘插上</b><span>插到打印机支持的 USB 接口。</span></div>
                <div className="fs-fact"><b>在打印机屏幕上选</b><span>打开「扫描」，选择「扫描到 U 盘」。</span></div>
                <div className="fs-fact"><b>按面板提示</b><span>选文件格式和保存位置，再开始扫描。</span></div>
                <div className="fs-fact"><b>拔出之前</b><span>先按面板提示安全结束，再拔出 U 盘。</span></div>
              </div>
              <div className="fs-fact wide"><b>和平台扫描不同</b><span>文件只进你的 U 盘。不创建平台任务，没有任务编号，不显示进度，不进「我的文档」。扫描服务不接收这次文件。</span></div>
              <div className="fs-fact wide"><b>面板没有这一项</b><span>不要反复点。菜单名称和接口位置以打印机屏幕为准。</span></div>
            </div>
            <PhoneHelpLine />
            <ScanSample art="usb" />
          </div>
        </>
      ) : blocked ? (
        <>
          <div className="fs-grow is-status">
            <div className="fs-facts">
              <div className="fs-fact wide">
                <b>{gate === 'loading' ? '正在读取配置' : gate === 'unknown' ? '状态未知' : '暂未开放'}</b>
                <span>
                  {gate === 'loading'
                    ? '正在读取这台机器的扫描配置。扫描服务还没确认。'
                    : gate === 'unknown'
                      ? '本机未能读取扫描能力配置。恢复后可继续；扫描仍需在打印机面板操作。'
                      : (blockedNote ?? '扫描还没对这台机器开放，或正在维护。恢复之后可以再试。')}
                </span>
              </div>
              <div className="fs-pairgrid">
                <div className="fs-fact"><b>测试中，暂未对用户开放</b><span>还在测试，或正在维护，现在都不能扫描。</span></div>
                <div className="fs-fact"><b>维护中，暂时不可用</b><span>这台机器暂时不支持扫描。恢复之后可以再试。</span></div>
                <div className="fs-fact"><b>现在不能开始</b><span>确认完成之前，不能建立扫描，也不能在面板上开始。</span></div>
              </div>
              <div className="fs-fact wide"><b>你现在还能做什么</b><span>上传现成文件仍可打印。也可以看扫描到 U 盘的说明，那条仍写暂未开通。</span></div>
            </div>
            <PhoneHelpLine />
            <ScanSample />
          </div>
          <FsRow
            title={checking || gate === 'loading' ? '正在确认…' : '重新确认能力'}
            desc="再读一次这台机器的扫描配置"
            disabled={checking || gate === 'loading'}
            onClick={() => void refreshGate()}
          />
          <FsRow
            title="改用面板扫描到 U 盘"
            disabled
            desc="暂未开通 · 文件只进你的 U 盘，平台不接收"
            onClick={() => {
              if (onGoStage) {
                setSearchParams({ stage: 'start', mode: 'usb-panel' }, { replace: true })
                return
              }
              navigate('/scan?stage=start&mode=usb-panel')
            }}
          />
        </>
      ) : (
        <>
          <ScanTypeCards selected={selected} onPick={setSelected} />
          <FsRow
            title="改用面板扫描到 U 盘"
            disabled
            desc="暂未开通 · 不创建平台任务，文件只在你的 U 盘"
            onClick={() => {
              if (onGoStage) {
                setSearchParams({ stage: 'start', mode: 'usb-panel' }, { replace: true })
                return
              }
              navigate('/scan?stage=start&mode=usb-panel')
            }}
          />
          <div className="fs-grow">
          <div className="sw-truth" data-disclaimer="true" data-testid="scan-workbench-truth">
            <div>
              <b>这一步</b>
              只选材料，还没有建立扫描。
            </div>
            <div>
              <b>未登录</b>
              未登录扫描件不会进入「我的文档」。
            </div>
          </div>
          </div>
        </>
      )}
    </ScanWorkbenchShell>
  )
}

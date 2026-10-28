import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { canCreateFormalPrintScanTask } from '@ai-job-print/shared'
import { FsRow } from '../print-scan/FsRow'
import { PhoneHelpLine } from '../print-scan/phoneHelp'
import {
  loadConfiguredCapabilities,
  type ConfiguredCapability,
} from '../../services/api/printScanCapabilities'
import {
  ScanSample,
  ScanTypeCards,
  ScanWorkbenchShell,
  type ScanDock,
} from './ScanWorkbenchChrome'
import { SCAN_TRUTH, SCAN_TYPE_LABELS, type ScanType } from './scanWorkbench'
import { type ScanStage } from './scanWorkbenchModel'
import { patchScanWorkbenchSession, readScanWorkbenchSession } from './scanWorkbenchSession'

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
  const storedType = readScanWorkbenchSession()?.scanType
  const [selected, setSelected] = useState<ScanType>(storedType ?? 'resume')
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
            : { tone: 'ok' as const, label: '可创建扫描任务 · 需面板操作' }

  const subtitle = usbPanel
    ? '这是打印机自己的独立能力，不经过屏幕上的扫描流程'
    : blocked
      ? '当前无法创建扫描任务，请查看说明或改用其他方式'
      : '请先选择扫描类型；本页尚未创建任务。下一步会真实建立这次扫描'

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
      : {
          primary: {
            label: '下一步 · 建立这次扫描',
            onClick: () => {
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
                : '材料扫描'
      }
      subtitle={subtitle}
      status={status}
      layout="stack"
      dock={dock}
    >
      {usbPanel ? (
        <>
          <p className="fs-warn">这条能力暂未开通，不能把这条说明当成已经可以用。</p>
          <div className="fs-grow is-status">
            <div className="fs-facts">
              <div className="fs-pairgrid">
                <div className="fs-fact"><b>把 U 盘插上</b><span>插到打印机支持的 USB 接口。</span></div>
                <div className="fs-fact"><b>在奔图面板上选</b><span>打开「扫描」，选择「扫描到 U 盘」。</span></div>
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
            desc="文件只进你的 U 盘，平台不接收"
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
            desc="不创建平台任务，文件只在你的 U 盘"
            onClick={() => {
              if (onGoStage) {
                setSearchParams({ stage: 'start', mode: 'usb-panel' }, { replace: true })
                return
              }
              navigate('/scan?stage=start&mode=usb-panel')
            }}
          />
          <div className="fs-grow">
          <div className="fs-facts">
            <div className="fs-fact wide">
              <b>屏幕上没有「开始扫描」</b>
              <span>只能在奔图面板启动。网页不能远程驱动扫描仪，也没有扫到第几张的进度。</span>
            </div>
            <div className="fs-pairgrid">
              <div className="fs-fact"><b>放好纸</b><span>把原稿放进扫描区。你在打印机上操作。</span></div>
              <div className="fs-fact"><b>面板上按扫描</b><span>按屏幕上给出的这次说明操作。</span></div>
            </div>
            <div className="fs-fact wide"><b>回到这台机器</b><span>文件回来后在这里确认。未登录扫描件不会进入「我的文档」。</span></div>
            <div className="fs-fact wide">
              <b>已选「{SCAN_TYPE_LABELS[selected]}」</b>
              <span>点类型只是选中。下一步建立这次扫描，并确认这台机器能收到扫描件。</span>
            </div>
          </div>
          <div className="sw-truth" data-disclaimer="true" data-testid="scan-workbench-truth">
            {SCAN_TRUTH.map((item) => (
              <div key={item.title}>
                <b>{item.title}</b>
                {item.body}
              </div>
            ))}
          </div>
          </div>
        </>
      )}
    </ScanWorkbenchShell>
  )
}

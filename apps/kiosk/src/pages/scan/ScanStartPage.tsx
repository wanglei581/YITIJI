import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { canCreateFormalPrintScanTask } from '@ai-job-print/shared'
import { HeadphonesIcon, RefreshCwIcon, UploadIcon } from 'lucide-react'
import {
  loadConfiguredCapabilities,
  type ConfiguredCapability,
} from '../../services/api/printScanCapabilities'
import {
  ScanChain,
  ScanCta,
  ScanNoteCard,
  ScanPlan,
  ScanSec,
  ScanStatusPanel,
  ScanTypeCards,
  ScanWorkbenchShell,
} from './ScanWorkbenchChrome'
import { SCAN_TYPE_LABELS, type ScanType } from './scanWorkbench'
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
    ? '这是打印机自己的独立能力，不经过平台扫描会话'
    : blocked
      ? '当前无法创建扫描任务，请查看说明或改用其他方式'
      : '请先选择扫描类型；本页尚未创建任务。下一步会创建真实扫描会话'

  return (
    <ScanWorkbenchShell
      page="scan-start"
      state={workbenchState}
      title="材料扫描"
      subtitle={subtitle}
      status={status}
      facts={
        usbPanel
          ? ['不创建平台任务', '文件只在你的 U 盘', 'Windows / 奔图真机尚未验收']
          : blocked
            ? undefined
            : ['这台机器的接收目录已由管理员配好，面板上直接选就行，不用你填任何地址。']
      }
      ctabar={
        usbPanel ? (
          <ScanCta>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/help')}>
              <HeadphonesIcon aria-hidden="true" />
              联系工作人员
            </button>
            <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/print-scan')}>
              完成后回打印扫描
            </button>
          </ScanCta>
        ) : blocked ? (
          <ScanCta reason="能力确认前不会创建扫描任务">
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/print-scan')}>
              返回打印扫描
            </button>
            <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/print/upload')}>
              <UploadIcon aria-hidden="true" />
              改用上传文件打印
            </button>
          </ScanCta>
        ) : (
          <ScanCta>
            <button
              type="button"
              className="qx-btn"
              data-variant="ghost"
              onClick={() => {
                if (onGoStage) {
                  setSearchParams({ stage: 'start', mode: 'usb-panel' }, { replace: true })
                  return
                }
                navigate('/scan/start?mode=usb-panel')
              }}
            >
              改用面板扫描到 U 盘
            </button>
            <button
              type="button"
              className="qx-btn"
              data-variant="primary"
              onClick={() => {
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
                navigate('/scan/settings', { state: { scanType: selected } })
              }}
            >
              下一步 · 创建扫描会话
            </button>
          </ScanCta>
        )
      }
    >
      {usbPanel ? (
        <>
          <ScanSec no="01" title="在奔图面板选择「扫描到 U 盘」" hint="这是打印机自己的独立能力，不经过平台扫描会话" grow>
            <div className="sw-grid2">
              <ScanNoteCard
                title="面板上怎么做"
                foot="具体菜单名称、可选格式和 USB 接口位置以现场奔图面板为准。"
              >
                <ScanPlan items={[
                  '把 U 盘插到打印机支持的 USB 接口。',
                  '在奔图操作面板打开「扫描」，选择「扫描到 U 盘」。',
                  '按面板提示选择文件格式与保存位置，再开始扫描。',
                  '完成后先按面板提示安全结束，再拔出 U 盘。',
                ]} />
              </ScanNoteCard>
              <ScanNoteCard
                title="这条路与平台扫描的区别"
                foot="平台不会读取、上传或保留这次扫描产生的文件。"
              >
                <ScanPlan items={[
                  '不创建平台扫描任务，所以本页没有任务编号。',
                  '不显示扫描进度或结果，成功失败只看打印机面板。',
                  '不进入「我的文档」，文件只保存在你的 U 盘。',
                  '当前尚未完成 Windows / 奔图真机验收，不能把这条说明当成真机通过。',
                ]} />
              </ScanNoteCard>
            </div>
          </ScanSec>
          <ScanSec no="02" title="完成之后怎么继续" hint="U 盘里的文件要重新导入才能在本机办理">
            <div className="sw-grid2">
              <ScanNoteCard title="要打印或继续加工" foot="导入链路仍以 Terminal Agent 与本地令牌状态为准。">
                <p>回到打印扫描，选择<b>U 盘导入</b>。本机只读取你再次选中的文件，不会自动扫描整个 U 盘。</p>
              </ScanNoteCard>
              <ScanNoteCard title="面板没有这个选项" foot="本页不假设所有奔图固件都提供相同菜单。">
                <p>不要在本页反复点击。请联系工作人员确认机型、固件和现场 USB 配置。</p>
              </ScanNoteCard>
            </div>
          </ScanSec>
        </>
      ) : blocked ? (
        <>
          <ScanStatusPanel
            tone={gate === 'loading' ? 'info' : 'error'}
            title={gate === 'loading' ? '正在确认扫描能力' : gate === 'unknown' ? '能力状态暂不可用' : '扫描能力暂未开放'}
            breathe={gate === 'loading'}
            chips={[
              { label: gate === 'loading' ? '正在读取配置' : gate === 'unknown' ? '状态未知' : '暂未开放', tone: 'warn' },
              { label: '不会创建扫描任务' },
            ]}
          >
            <p>
              {gate === 'loading'
                ? '正在读取本终端的扫描服务配置。'
                : gate === 'unknown'
                  ? '本机未能读取扫描能力配置。恢复后可继续；扫描仍需在打印机面板操作。'
                  : (blockedNote ?? '管理员尚未对本终端开放扫描服务，或该能力处于维护 / 待验收状态。')}
            </p>
          </ScanStatusPanel>
          <div className="sw-grid2">
            <ScanNoteCard title="你现在还能做什么">
              <ScanPlan items={[
                '上传文件打印：手机 / U 盘里的现成文件仍可打印。',
                '本机扫描任务：当前终端扫描能力未开放或状态未知。',
                '改用面板扫描到 U 盘：不经过平台会话，文件只进你的 U 盘。',
              ]} />
            </ScanNoteCard>
            <ScanNoteCard title="确认能力" foot="若长时间未恢复，请到服务台联系现场工作人员检查终端能力配置。">
              <p>本页不会假装扫描仪已经就绪，也不会在能力未知时创建任务。</p>
              <div className="sw-cta-row sw-note-actions">
                <button
                  type="button"
                  className="qx-btn"
                  data-variant="ghost"
                  disabled={checking || gate === 'loading'}
                  onClick={() => void refreshGate()}
                >
                  <RefreshCwIcon aria-hidden="true" />
                  {checking || gate === 'loading' ? '正在确认…' : '重新确认能力'}
                </button>
                <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/help')}>
                  <HeadphonesIcon aria-hidden="true" />
                  联系工作人员
                </button>
              </div>
            </ScanNoteCard>
          </div>
        </>
      ) : (
        <>
          <ScanSec no="01" title="要扫什么" hint={`扫描服务 · 已选「${SCAN_TYPE_LABELS[selected]}」`}>
            <ScanTypeCards selected={selected} onPick={setSelected} />
          </ScanSec>
          <ScanSec no="02" title="这条链路长这样" hint="四段都走完，文件才到你手上">
            <ScanChain active={-1} />
          </ScanSec>
          <ScanSec no="03" title="动手之前先看两件事" grow>
            <div className="sw-grid2">
              <ScanNoteCard
                title="为什么屏幕上没有「开始扫描」"
                foot="合同类材料的扫描从「合同审阅」工作台发起，本屏不重复开口子。"
              >
                <p>这台一体机的扫描<b>只能在奔图自己的操作面板上启动</b>，网页不能远程驱动扫描仪。本机负责建会话、转达服务端指引、等文件回传。</p>
                <p>所以这一屏不会有「一键扫描」，也不会有扫到第几张的进度。</p>
              </ScanNoteCard>
              <ScanNoteCard
                title="扫完之后这份文件能干什么"
                foot="费用以办理时服务端报价与现场规则为准。未登录扫描件不会进入「我的文档」。"
              >
                <ScanPlan items={[
                  '简历扫描件可以进 AI 识别，做诊断与优化。',
                  '拿去打印：到打印流程重新选定，由服务端报价后出纸。',
                  '留存按文件类型与服务端规则；本屏无登录步骤，匿名件不进「我的文档」。',
                ]} />
              </ScanNoteCard>
            </div>
          </ScanSec>
        </>
      )}
    </ScanWorkbenchShell>
  )
}

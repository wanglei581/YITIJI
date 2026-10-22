import { formatDateTime, type FirstOrderProject, type FirstOrderTerminal } from '@ai-job-print/shared'
import { StatusBadge } from '@ai-job-print/ui'

const printerLabels: Record<string, string> = { ready: '就绪', idle: '空闲', online: '已连接', printing: '打印中', busy: '忙碌', offline: '离线', paper_out: '缺纸', paper_jam: '卡纸', error: '故障', unknown: '暂不能确认' }

export function ProjectDetails({ project, terminals }: { project: FirstOrderProject; terminals: FirstOrderTerminal[] }) {
  const now = Date.now()
  const phase = now < Date.parse(project.serviceStartAt) ? '服务尚未开始' : now > Date.parse(project.serviceEndAt) ? '服务期限已到，请联系平台核对续约' : '在约定服务期内'
  return <section aria-label="项目与设备资料" className="space-y-4 rounded-xl border border-neutral-200 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">项目与设备资料</h4><StatusBadge label={phase} status={now > Date.parse(project.serviceEndAt) ? 'warning' : 'info'} /></div>
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div><dt className="text-neutral-500">合同或采购编号</dt><dd className="break-words">{project.reference}</dd></div>
      <div><dt className="text-neutral-500">服务期限（北京时间）</dt><dd>{formatDateTime(project.serviceStartAt)} 至 {formatDateTime(project.serviceEndAt)}</dd></div>
      <div className="sm:col-span-2"><dt className="text-neutral-500">免费服务与维保范围</dt><dd className="whitespace-pre-wrap break-words">{project.serviceScope}</dd></div>
      <div className="sm:col-span-2"><dt className="text-neutral-500">服务联系渠道</dt><dd className="whitespace-pre-wrap break-words">{project.supportContact}</dd></div>
    </dl>
    <div className="space-y-3"><h5 className="text-sm font-semibold">设备与安装位置</h5>{project.deployments.length === 0 ? <p className="text-sm text-neutral-500">尚未登记项目设备，请联系平台核对安装资料。</p> : project.deployments.map((deployment) => {
      const terminal = terminals.find((item) => item.id === deployment.terminalId)
      return <div key={deployment.id} className="space-y-1 rounded-lg bg-neutral-50 p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{deployment.terminalCode} · {deployment.locationLabel}</p><StatusBadge label={deployment.endedAt ? '本次部署已结束' : terminal?.online ? '主机在线' : terminal ? '主机未在线' : '当前设备归属待核对'} status={deployment.endedAt ? 'default' : terminal?.online ? 'success' : 'warning'} /></div>
        <p className="text-xs text-neutral-500">部署登记：{formatDateTime(deployment.startedAt)}{deployment.endedAt ? `，结束：${formatDateTime(deployment.endedAt)}` : ''}</p>
        {!deployment.endedAt && terminal && <p className="text-xs text-neutral-500">打印机：{terminal.online && terminal.printerStatus ? printerLabels[terminal.printerStatus] ?? '暂不能识别，请现场核对' : '当前不能确认'} · 最后心跳：{terminal.lastHeartbeatAt ? formatDateTime(terminal.lastHeartbeatAt) : '尚未上报'}</p>}
      </div>
    })}</div>
    <p className="text-xs leading-relaxed text-neutral-500">主机在线不代表打印或扫描已经成功。安装能力和耗材以现场核验为准，未接入的遥测不估算；报障、维修与换机由平台负责，机构负责提供现场情况并核对结果。</p>
  </section>
}

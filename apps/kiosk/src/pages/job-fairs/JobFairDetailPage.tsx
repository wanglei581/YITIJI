import { useState } from 'react'
import { useNavigate, useLocation, useParams } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import type { ExternalJobFair } from '@ai-job-print/shared'
import {
  CalendarIcon,
  ExternalLinkIcon,
  InfoIcon,
  MapPinIcon,
  PrinterIcon,
  QrCodeIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react'

const STATUS_CONFIG = {
  upcoming: { label: '未开始', bg: 'bg-blue-50', text: 'text-blue-600' },
  ongoing:  { label: '进行中', bg: 'bg-green-50', text: 'text-green-700' },
  ended:    { label: '已结束', bg: 'bg-gray-100', text: 'text-gray-400' },
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatSync(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

// ─── QR placeholder overlay ───────────────────────────────────────────────────

function QrOverlay({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="relative w-72 rounded-2xl bg-white p-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-gray-400 hover:bg-gray-100"
        >
          <XIcon className="h-5 w-5" />
        </button>
        <p className="mb-6 text-center text-sm font-medium text-gray-700">{label}</p>
        <div className="mx-auto flex h-44 w-44 items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50">
          <div className="flex flex-col items-center gap-2 text-gray-300">
            <QrCodeIcon className="h-16 w-16" />
            <span className="text-xs">二维码由来源平台生成</span>
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-gray-400">
          扫描后将跳转至来源平台，预约结果由对方平台管理
        </p>
      </div>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function JobFairDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const fair = (location.state as { fair?: ExternalJobFair } | null)?.fair

  const [showQr, setShowQr] = useState(false)

  if (!fair || fair.id !== id) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <InfoIcon className="h-12 w-12 text-gray-300" />
        <p className="mt-4 text-sm text-gray-500">活动数据未找到，请返回列表重试</p>
        <Button className="mt-6" onClick={() => navigate('/job-fairs')}>
          返回招聘会列表
        </Button>
      </div>
    )
  }

  const sc = STATUS_CONFIG[fair.status]
  const isEnded = fair.status === 'ended'

  const handlePrintMaterial = () => {
    navigate('/print/confirm', {
      state: {
        file: {
          name: `${fair.name}_活动资料.pdf`,
          size: '256 KB',
          pages: 2,
        },
        copies: 1,
        duplex: 'single',
        color: 'bw',
      },
    })
  }

  return (
    <div className="flex h-full flex-col">
      {showQr && (
        <QrOverlay label="扫码前往来源平台预约" onClose={() => setShowQr(false)} />
      )}

      <div className="px-6 pt-6">
        <PageHeader
          title="招聘会详情"
          subtitle={fair.sourceName}
          actions={
            <Button size="sm" variant="secondary" onClick={() => navigate('/job-fairs')}>
              返回列表
            </Button>
          }
        />
      </div>

      <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
        {/* 基本信息卡 */}
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="flex-1 text-xl font-bold text-gray-900">{fair.name}</h2>
            <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${sc.bg} ${sc.text}`}>
              {sc.label}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500">主办方：{fair.organizer}</p>

          <div className="mt-4 space-y-2 text-sm text-gray-700">
            <div className="flex items-start gap-2">
              <CalendarIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
              <span>
                {formatDateTime(fair.startTime)}
                <span className="mx-1 text-gray-400">–</span>
                {formatDateTime(fair.endTime)}
              </span>
            </div>
            <div className="flex items-start gap-2">
              <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
              <span>{fair.venue}</span>
            </div>
            {fair.boothCount && (
              <div className="flex items-center gap-2">
                <UsersIcon className="h-4 w-4 shrink-0 text-gray-400" />
                <span>{fair.boothCount} 家单位参展</span>
              </div>
            )}
          </div>
        </Card>

        {/* 活动简介 */}
        {fair.description && (
          <Card className="p-5">
            <p className="mb-2 text-sm font-medium text-gray-700">活动简介</p>
            <p className="text-sm leading-relaxed text-gray-600">{fair.description}</p>
          </Card>
        )}

        {/* 来源信息 */}
        <Card className="p-5">
          <p className="mb-3 text-sm font-medium text-gray-700">数据来源</p>
          <div className="space-y-2 text-sm text-gray-600">
            <div className="flex justify-between">
              <span className="text-gray-400">来源机构</span>
              <span>{fair.sourceName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">同步时间</span>
              <span>{formatSync(fair.syncTime)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">外部编号</span>
              <span className="font-mono text-xs">{fair.externalId}</span>
            </div>
          </div>
        </Card>

        {/* 合规说明 */}
        <div className="flex items-start gap-2 rounded-lg bg-gray-50 px-4 py-3">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
          <p className="text-xs leading-relaxed text-gray-400">
            本系统仅展示第三方来源招聘会信息，不参与活动报名流程。系统仅记录外部跳转行为，活动预约由来源平台管理。
          </p>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="px-6 pb-6 pt-2">
        <div className="grid grid-cols-2 gap-3">
          {!isEnded && (
            <>
              <Button
                size="lg"
                className="flex items-center gap-2"
                onClick={() => setShowQr(true)}
              >
                <ExternalLinkIcon className="h-4 w-4" />
                去来源平台预约
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="flex items-center gap-2"
                onClick={() => setShowQr(true)}
              >
                <QrCodeIcon className="h-4 w-4" />
                扫码预约
              </Button>
            </>
          )}
          <Button
            size="lg"
            variant="secondary"
            className={`flex items-center gap-2 ${isEnded ? 'col-span-2' : ''}`}
            onClick={handlePrintMaterial}
          >
            <PrinterIcon className="h-4 w-4" />
            打印活动资料
          </Button>
          {isEnded && (
            <Button
              size="lg"
              variant="secondary"
              className="col-span-2"
              onClick={() => navigate('/job-fairs')}
            >
              返回列表
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

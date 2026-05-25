import { useState } from 'react'
import { useNavigate, useLocation, useParams } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import type { ExternalJob } from '@ai-job-print/shared'
import {
  BuildingIcon,
  ExternalLinkIcon,
  InfoIcon,
  MapPinIcon,
  QrCodeIcon,
  TagIcon,
  XIcon,
} from 'lucide-react'

const TAG_STYLES: Record<string, string> = {
  全职: 'bg-blue-50 text-blue-600',
  实习: 'bg-orange-50 text-orange-600',
  校招: 'bg-green-50 text-green-600',
  兼职: 'bg-purple-50 text-purple-600',
}

function formatSync(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

// ─── QR placeholder overlay ───────────────────────────────────────────────────

function QrOverlay({ onClose }: { onClose: () => void }) {
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
        <p className="mb-6 text-center text-sm font-medium text-gray-700">扫码前往来源平台投递</p>
        {/* QR placeholder */}
        <div className="mx-auto flex h-44 w-44 items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50">
          <div className="flex flex-col items-center gap-2 text-gray-300">
            <QrCodeIcon className="h-16 w-16" />
            <span className="text-xs">二维码由来源平台生成</span>
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-gray-400">
          扫描后将跳转至来源平台，投递结果由对方平台管理
        </p>
      </div>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function JobDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const job = (location.state as { job?: ExternalJob } | null)?.job

  const [showQr, setShowQr] = useState(false)

  if (!job || job.id !== id) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <InfoIcon className="h-12 w-12 text-gray-300" />
        <p className="mt-4 text-sm text-gray-500">岗位数据未找到，请返回列表重试</p>
        <Button className="mt-6" onClick={() => navigate('/jobs')}>
          返回岗位列表
        </Button>
      </div>
    )
  }

  const handleExternalLink = () => {
    // 记录外部跳转行为（mock），实际连接后端时写入日志
    setShowQr(false)
    // 在真实环境中通过 window.open(job.sourceUrl) 跳转
    // Kiosk 模式下使用二维码替代
    setShowQr(true)
  }

  return (
    <div className="flex h-full flex-col">
      {showQr && <QrOverlay onClose={() => setShowQr(false)} />}

      <div className="px-6 pt-6">
        <PageHeader
          title="岗位详情"
          subtitle={job.sourceName}
          actions={
            <Button size="sm" variant="secondary" onClick={() => navigate('/jobs')}>
              返回列表
            </Button>
          }
        />
      </div>

      <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
        {/* 基本信息卡 */}
        <Card className="p-5">
          <h2 className="text-xl font-bold text-gray-900">{job.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-gray-600">
            <span className="flex items-center gap-1.5">
              <BuildingIcon className="h-4 w-4 text-gray-400" />
              {job.company}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPinIcon className="h-4 w-4 text-gray-400" />
              {job.city}
            </span>
          </div>
          {job.salary && (
            <p className="mt-3 text-lg font-semibold text-primary-600">{job.salary}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {job.tags.map((t) => (
              <span
                key={t}
                className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium ${TAG_STYLES[t] ?? 'bg-gray-100 text-gray-500'}`}
              >
                <TagIcon className="h-3 w-3" />
                {t}
              </span>
            ))}
          </div>
        </Card>

        {/* 岗位描述 */}
        {(job.description || job.requirements) && (
          <Card className="p-5">
            {job.description && (
              <div className="mb-4">
                <p className="mb-2 text-sm font-medium text-gray-700">岗位描述</p>
                <p className="text-sm leading-relaxed text-gray-600">{job.description}</p>
              </div>
            )}
            {job.requirements && (
              <div>
                <p className="mb-2 text-sm font-medium text-gray-700">任职要求</p>
                <p className="text-sm leading-relaxed text-gray-600">{job.requirements}</p>
              </div>
            )}
          </Card>
        )}

        {/* 来源信息 */}
        <Card className="p-5">
          <p className="mb-3 text-sm font-medium text-gray-700">数据来源</p>
          <div className="space-y-2 text-sm text-gray-600">
            <div className="flex justify-between">
              <span className="text-gray-400">来源机构</span>
              <span>{job.sourceName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">同步时间</span>
              <span>{formatSync(job.syncTime)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">外部编号</span>
              <span className="font-mono text-xs">{job.externalId}</span>
            </div>
          </div>
        </Card>

        {/* 合规说明 */}
        <div className="flex items-start gap-2 rounded-lg bg-gray-50 px-4 py-3">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
          <p className="text-xs leading-relaxed text-gray-400">
            本系统仅展示第三方来源岗位信息，不参与招聘流程。系统仅记录外部跳转行为，不保存企业端招聘结果。
          </p>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="px-6 pb-6 pt-2">
        <div className="grid grid-cols-2 gap-3">
          <Button
            size="lg"
            className="flex items-center gap-2"
            onClick={handleExternalLink}
          >
            <ExternalLinkIcon className="h-4 w-4" />
            去来源平台投递
          </Button>
          <Button
            size="lg"
            variant="secondary"
            className="flex items-center gap-2"
            onClick={() => setShowQr(true)}
          >
            <QrCodeIcon className="h-4 w-4" />
            扫码投递
          </Button>
        </div>
      </div>
    </div>
  )
}

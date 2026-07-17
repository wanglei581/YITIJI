// ============================================================
// PrintScanFeatureInfoPage — 打印扫描能力 MVP 说明页
//   路由：/print-scan/feature/:key（key = id-photo）
//
// 证件照当前只做可点击的说明页，介绍能力规划 + 当前可用替代路径 + 合规声明，
// 不做完整实现。签名盖章已接入真实功能（/print-scan/sign），不再经过此说明页。
//
// 合规：证件照=敏感文件清理提示。
// ============================================================

import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@ai-job-print/ui'
import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import {
  ArrowLeftIcon,
  CameraIcon,
  FileType2Icon,
  Grid2X2Icon,
  ImageIcon,
  InfoIcon,
  ListIcon,
  PrinterIcon,
  ShieldCheckIcon,
  UserSquareIcon,
} from 'lucide-react'

type FeatureKey = 'id-photo'

interface FeatureInfo {
  icon: React.ComponentType<{ className?: string }>
  iconBg: string
  iconColor: string
  title: string
  summary: string
  plans: string[]
  /** 合规声明（可选）：'sensitive' = 敏感文件清理 */
  notice?: 'sensitive'
  /** 当前可用的替代路径按钮 */
  fallbackLabel?: string
  fallbackTo?: string
}

type IconComponent = React.ComponentType<{ className?: string }>

const PLAN_SUPPORT: Array<[IconComponent, string, string]> = [
  [ListIcon, '选择证件照规格与底色', '一寸、二寸、小一寸等常见规格，支持常用底色要求'],
  [Grid2X2Icon, '自动排版到 6 寸相纸 / A4', '同一版面排多张，按纸张规格自动计算张数；相纸支持以上线后本机配置为准'],
  [PrinterIcon, '直接接入打印流程出图', '确认排版后走本机打印流程，现场取件'],
]

const PLANNED_FLOW: Array<[IconComponent, string]> = [
  [CameraIcon, '上传或拍摄照片，支持手机扫码上传'],
  [ListIcon, '选择规格与底色，按用途挑选常见规格'],
  [Grid2X2Icon, '自动排版并预览，确认张数与版面'],
  [PrinterIcon, '进入打印流程，本机出纸现场取件'],
]

const FEATURES: Record<FeatureKey, FeatureInfo> = {
  'id-photo': {
    icon: UserSquareIcon,
    iconBg: 'bg-warning-bg',
    iconColor: 'text-warning-fg',
    title: '证件照',
    summary: '即将支持常见规格证件照的尺寸排版与打印（一寸 / 二寸 / 小一寸等）。',
    plans: [
      '选择证件照规格与底色',
      '自动排版到 6 寸相纸 / A4',
      '直接接入打印流程出图',
    ],
    notice: 'sensitive',
    fallbackLabel: '先用照片打印',
    fallbackTo: '/print/upload',
  },
}

function isFeatureKey(k: string | undefined): k is FeatureKey {
  return k === 'id-photo'
}

export function PrintScanFeatureInfoPage() {
  const navigate = useNavigate()
  const { key } = useParams<{ key: string }>()

  // 未知 key 直达容错：不白屏，引导回服务中心
  if (!isFeatureKey(key)) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-neutral-100">
          <FileType2Icon className="h-10 w-10 text-neutral-400" />
        </div>
        <h1 className="mt-6 text-xl font-semibold text-neutral-900">未找到该功能</h1>
        <p className="mt-2 text-sm text-neutral-500">请返回打印扫描服务选择可用功能</p>
        <Button className="mt-8" onClick={() => navigate('/print-scan')}>
          返回打印扫描服务
        </Button>
      </div>
    )
  }

  const info = FEATURES[key]
  const Icon = info.icon

  return (
    <div className="flex h-full flex-col bg-canvas px-6 py-5 text-neutral-900">
      <header className="flex h-[72px] shrink-0 items-center justify-between rounded-lg bg-dark px-6 text-surface shadow-sm">
        <div>
          <b className="block text-[21px] font-bold">就业服务大厅 · 01号机</b>
          <span className="mt-1 block text-sm text-neutral-100">AI求职打印服务终端</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-base text-neutral-100">2026年7月17日 10:24</span>
          <span className="inline-flex h-10 items-center gap-2 rounded-full bg-success-bg px-4 text-base font-semibold text-success-fg">
            <span className="h-2.5 w-2.5 rounded-full bg-current" />
            打印机正常 · A4纸充足
          </span>
        </div>
      </header>

      <div className="mt-5 flex shrink-0 items-center gap-5">
        <button type="button" onClick={() => navigate('/print-scan')} className="inline-flex h-14 items-center gap-2 rounded-md border border-neutral-200 bg-surface px-5 text-lg font-semibold text-neutral-700">
          <ArrowLeftIcon className="h-5 w-5" />
          返回打印扫描服务
        </button>
        <div>
          <h1 className="font-serif text-[42px] font-black leading-tight tracking-normal">{info.title}</h1>
          <p className="mt-1 text-xl text-neutral-500">功能说明（即将上线）</p>
        </div>
      </div>

      <main className="mt-4 flex min-h-0 flex-1 gap-5">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <section className="flex items-center gap-6 rounded-lg border border-warning/30 bg-surface p-7 shadow-sm">
            <span className="grid h-24 w-24 shrink-0 place-items-center rounded-[24px] bg-warning-bg text-warning-fg">
              <Icon className="h-12 w-12" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <h2 className="flex items-center gap-3 font-serif text-[36px] font-black tracking-normal">
                {info.title}
                <span className="rounded-full border border-neutral-200 bg-canvas px-4 py-1.5 font-sans text-base font-semibold text-neutral-500">即将上线</span>
              </h2>
              <p className="mt-2 text-[19px] leading-relaxed text-neutral-500">{info.summary}</p>
            </span>
          </section>

          <section className="flex flex-1 flex-col rounded-lg border border-warning/30 bg-surface p-6 shadow-sm">
            <b className="mb-2 block text-[22px] font-bold">计划支持</b>
            {PLAN_SUPPORT.map(([PlanIcon, title, copy]) => (
              <div key={String(title)} className="flex flex-1 items-center gap-4 border-b border-dashed border-neutral-200 py-3 last:border-b-0">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-warning-bg text-warning-fg">
                  <PlanIcon className="h-7 w-7" />
                </span>
                <span>
                  <b className="block text-[21px] font-bold">{title}</b>
                  <span className="mt-1 block text-[17px] leading-relaxed text-neutral-500">{copy}</span>
                </span>
              </div>
            ))}
          </section>

          <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success-bg px-5 py-4 text-base leading-relaxed text-success-fg">
            <ShieldCheckIcon className="mt-0.5 h-5 w-5 shrink-0" />
            {COMPLIANCE_COPY.KIOSK_PRINT_SCAN_SENSITIVE}
          </div>
        </div>

        <aside className="flex w-[420px] shrink-0 flex-col gap-4">
          <section className="rounded-lg border border-neutral-200 bg-surface p-5 shadow-sm">
            <b className="mb-1 block text-xl font-bold">常见证件照规格参考</b>
            <p className="mb-3 text-[16.5px] text-neutral-500">仅供了解，实际以功能上线后支持的规格为准</p>
            {[
              ['一寸', '25 × 35 mm'],
              ['小一寸', '22 × 32 mm'],
              ['二寸', '35 × 49 mm'],
              ['小二寸', '35 × 45 mm'],
              ['简历常用', '一寸 / 小二寸'],
            ].map(([key, value]) => (
              <div key={key} className="flex items-baseline justify-between border-b border-dashed border-neutral-200 py-2.5 last:border-b-0">
                <span className="text-[17.5px] text-neutral-500">{key}</span>
                <span className="text-lg font-semibold">{value}</span>
              </div>
            ))}
          </section>

          <section className="rounded-lg border border-warning/30 bg-surface p-5 shadow-sm">
            <b className="mb-3 block text-xl font-bold">现在可以先这样做</b>
            <button type="button" onClick={() => navigate(info.fallbackTo ?? '/print/upload')} className="flex min-h-24 w-full items-center gap-4 rounded-lg border border-warning/30 bg-warning-bg px-4 text-left text-warning-fg">
              <span className="grid h-12 w-12 place-items-center rounded-md bg-surface">
                <ImageIcon className="h-6 w-6" />
              </span>
              <span>
                <b className="block text-xl font-bold">{info.fallbackLabel ?? '先用照片打印'}</b>
                <span className="mt-1 block text-base text-neutral-500">已有排好版的证件照图片，可直接上传打印</span>
              </span>
            </button>
          </section>

          <div className="flex items-start gap-3 rounded-lg border border-info/30 bg-info-bg px-5 py-4 text-base leading-relaxed text-info-fg">
            <InfoIcon className="mt-0.5 h-5 w-5 shrink-0" />
            本机当前仅支持 A4 普通纸打印；相纸打印能力以功能上线后本机配置为准。
          </div>

          <section className="flex flex-1 flex-col rounded-lg border border-neutral-200 bg-surface p-5 shadow-sm">
            <b className="mb-1 block text-xl font-bold">上线后使用流程（规划）</b>
            <p className="mb-2 text-[15.5px] text-neutral-500">以下为规划中的操作流程，最终以上线版本为准</p>
            {PLANNED_FLOW.map(([FlowIcon, copy], index) => (
              <div key={String(copy)} className="flex flex-1 items-center gap-3 border-b border-dashed border-neutral-200 py-2 last:border-b-0">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-warning-bg text-lg font-bold text-warning-fg">{index + 1}</span>
                <FlowIcon className="h-5 w-5 shrink-0 text-warning-fg" />
                <p className="text-[17px] leading-relaxed text-neutral-500">{copy}</p>
              </div>
            ))}
          </section>
        </aside>
      </main>

      <div className="mt-5 flex h-[76px] shrink-0 items-center gap-4 border-t border-neutral-200 bg-canvas pt-4">
        <Button variant="secondary" size="lg" className="h-14 px-7 text-lg" onClick={() => navigate('/print-scan')}>
          <ArrowLeftIcon className="mr-2 h-5 w-5" />
          返回打印扫描服务
        </Button>
        <span className="flex-1" />
        <Button size="lg" className="h-14 min-w-[420px] text-lg" onClick={() => navigate(info.fallbackTo ?? '/print/upload')}>
          <ImageIcon className="mr-2 h-5 w-5" />
          {info.fallbackLabel ?? '先用照片打印'}
        </Button>
      </div>
    </div>
  )
}

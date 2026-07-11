import { useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import { AlertCircleIcon, FileTextIcon, InfoIcon, LoaderIcon } from 'lucide-react'
import type { PrintJobParams } from '@ai-job-print/shared'
import { useAuth } from '../../auth/useAuth'
import { API_MODE } from '../../services/api/client'
import {
  estimatePrintCents,
  formatPriceCents,
  unitCentsFor,
  usePrintPriceConfig,
} from '../../services/print/priceConfigApi'
import { createPrintJob } from '../../services/print/printJobsApi'
import {
  clearPrintMaterialSession,
  printUploadPathForSource,
  readPrintMaterialSession,
  type MaterialCheckSummary,
  type PrintMaterialSource,
  type PrintFileState,
} from './printMaterialSession'

type PrintFile = PrintFileState

interface LocationState {
  file: PrintFile
  params: PrintJobParams
  materialCheck?: MaterialCheckSummary
  source?: PrintMaterialSource
}

const DUPLEX_LABEL: Record<string, string> = {
  simplex: '单面',
  duplex_long_edge: '双面（长边翻转）',
  duplex_short_edge: '双面（短边翻转）',
}

const ORIENTATION_LABEL: Record<string, string> = {
  auto: '自动',
  portrait: '纵向',
  landscape: '横向',
}

const DEFAULT_PARAMS: PrintJobParams = {
  copies: 1,
  colorMode: 'black_white',
  duplex: 'simplex',
  paperSize: 'A4',
  pageRange: 'all',
  orientation: 'auto',
  quality: 'standard',
  scale: 'fit',
  pagesPerSheet: 1,
}

export function PrintConfirmPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = location.state as LocationState | null
  const restoredSession = useMemo(() => readPrintMaterialSession(), [])
  const file = state?.file ?? restoredSession?.file ?? { name: '未知文件', size: '-', pages: null }
  const params = state?.params ?? restoredSession?.printParams ?? DEFAULT_PARAMS
  const materialCheck = state?.materialCheck ?? restoredSession?.materialCheck
  const source = state?.source ?? restoredSession?.source
  const uploadPath = printUploadPathForSource(source)
  const effectivePages = file.pages ?? 1
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { totalFaces, sheetsUsed, paperSaved } = useMemo(() => {
    const facesPerCopy = Math.ceil(effectivePages / params.pagesPerSheet)
    const tf = facesPerCopy * params.copies
    const su = params.duplex === 'simplex' ? tf : Math.ceil(tf / 2)
    return { totalFaces: tf, sheetsUsed: su, paperSaved: tf - su }
  }, [effectivePages, params])

  // ── 展示价（W-A：唯一来源=服务端价目；估价口径与服务端一致=单价×内容页×份数）──
  // 实际扣款金额由服务端建单时计算（绝不信任前端）；付费单进收银台必见真实金额。
  const priceCfg = usePrintPriceConfig()
  const unitCents = unitCentsFor(priceCfg.config, params.colorMode)
  const estimateCents = estimatePrintCents(priceCfg.config, {
    pages: file.pages,
    copies: params.copies,
    colorMode: params.colorMode,
  })

  const summaryRows = [
    { label: '文件名称', value: file.name },
    { label: '文件页数', value: file.pages === null ? '待识别，以实际打印为准' : `${file.pages} 页` },
    { label: '纸张规格', value: 'A4（210 × 297 mm）' },
    { label: '打印份数', value: `${params.copies} 份` },
    { label: '色彩模式', value: params.colorMode === 'color' ? '彩色' : '黑白' },
    { label: '单双面', value: DUPLEX_LABEL[params.duplex] ?? params.duplex },
    { label: '页面方向', value: ORIENTATION_LABEL[params.orientation] ?? params.orientation },
    { label: '缩放方式', value: params.scale === 'fit' ? '适合页面' : '实际大小' },
    {
      label: '页面范围',
      value: params.pageRange ?? '全部页面',
    },
  ]

  const handleConfirm = async () => {
    // 生产/联网模式(http):必须有真实 fileUrl 才能创建真任务并轮询真实打印状态。
    if (API_MODE === 'http') {
      // 无真实 fileUrl(如上游 AI 导出未拿到 signedUrl)时,严禁退回下方 SIM 动画伪造
      // "打印成功"(CLAUDE.md §9:无真实结果不得展示已打印)。拦截并提示重新生成/上传。
      if (!file.fileUrl) {
        setSubmitError('打印文件尚未就绪，无法提交打印。请返回重新上传或重新生成文件后再试。')
        return
      }
      setSubmitting(true)
      setSubmitError(null)
      try {
        const created = await createPrintJob({
          fileUrl:  file.fileUrl,
          fileMd5:  file.fileMd5,
          fileName: file.name,
          params,
          token:    getToken(),
        })
        clearPrintMaterialSession()
        // C5-3：付费单先进收银页出码支付；免费单（amountCents=0，已 paid+free）直接进履约。
        // orderId/amountCents/priceLines 透传给收银页与「完成」页（后者据 orderId 取 paid 后 pickupCode）。
        const nextState = {
          ...location.state,
          file,
          params,
          source,
          taskId:      created.taskId,
          orderId:     created.orderId,
          orderNo:     created.orderNo,
          amountCents: created.amountCents,
          priceLines:  created.priceLines,
          paymentSessionToken: created.paymentSessionToken,
        }
        if (created.amountCents > 0 && created.payStatus !== 'paid') {
          navigate('/print/cashier', { state: nextState })
        } else {
          navigate('/print/progress', { state: nextState })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '提交失败，请重试'
        setSubmitError(msg)
        setSubmitting(false)
      }
      return
    }
    // 仅 mock/dev 模式(API_MODE !== 'http')→ 前端模拟动画,用于本地演示,绝不用于生产。
    clearPrintMaterialSession()
    navigate('/print/progress', { state: { ...location.state, file, params, source } })
  }

  // Guard: 直达 /print/confirm（无前置上传）会拿到"未知文件"占位，禁止继续提交无效任务。
  // 所有 hook 已在上方执行，此处安全提前返回。
  if (!state?.file && !restoredSession?.file) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-warning-bg">
          <AlertCircleIcon className="h-10 w-10 text-warning" />
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-neutral-900">未找到文件信息</p>
          <p className="mt-2 text-sm text-neutral-500">请重新上传文件后再确认打印</p>
        </div>
        <Button size="lg" onClick={() => navigate(uploadPath)}>
          重新上传文件
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="确认打印"
        subtitle="核对以下参数，确认无误后开始打印"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate(-1)}>
            返回修改
          </Button>
        }
      />

      <div className="mt-6 flex flex-1 flex-col gap-4 overflow-y-auto">
        {/* File info */}
        <Card className="flex items-center gap-4 p-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-50">
            <FileTextIcon className="h-6 w-6 text-primary-600" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium text-neutral-900">{file.name}</p>
            <p className="mt-0.5 text-sm text-neutral-500">{file.size}</p>
          </div>
        </Card>

        {/* Parameter summary */}
        <Card className="overflow-hidden p-0">
          <table className="w-full">
            <tbody>
              {summaryRows.map(({ label, value }, i) => (
                <tr key={label} className={i % 2 === 0 ? 'bg-white' : 'bg-neutral-50'}>
                  <td className="border-b border-neutral-100 px-5 py-3.5 text-sm text-neutral-500">
                    {label}
                  </td>
                  <td className="border-b border-neutral-100 px-5 py-3.5 text-right text-sm font-medium text-neutral-900">
                    {value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {materialCheck && (
          <Card
            className={[
              'p-5',
              materialCheck.redaction?.resultFileCreated === false && materialCheck.redactedCount > 0
                ? 'border-warning/30 bg-warning-bg'
                : 'border-success/30 bg-success-bg',
            ].join(' ')}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white">
                <InfoIcon
                  className={[
                    'h-5 w-5',
                    materialCheck.redaction?.resultFileCreated === false && materialCheck.redactedCount > 0 ? 'text-warning-fg' : 'text-success-fg',
                  ].join(' ')}
                />
              </div>
              <div className="min-w-0">
                <p
                  className={[
                    'font-semibold',
                    materialCheck.redaction?.resultFileCreated === false && materialCheck.redactedCount > 0 ? 'text-warning-fg' : 'text-success-fg',
                  ].join(' ')}
                >
                  隐私检查摘要{materialCheck.mode === 'demo' ? '（流程演示）' : ''}
                </p>
                <p
                  className={[
                    'mt-1 text-sm leading-relaxed',
                    materialCheck.redaction?.resultFileCreated === false && materialCheck.redactedCount > 0 ? 'text-warning-fg' : 'text-success-fg',
                  ].join(' ')}
                >
                  {materialCheck.mode === 'demo' ? '已完成打印前材料检查流程演示' : '已完成打印前材料检查'}；
                  遮挡 {materialCheck.redactedCount} 项，保留 {materialCheck.keptCount} 项。
                  {materialCheck.redaction?.resultFileCreated === false && materialCheck.redactedCount > 0
                    ? '当前版本尚未生成遮挡后文件，打印仍使用原文件；请确认是否继续。'
                    : '本次打印前选择已记录，仅用于本次确认。'}
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Usage + cost */}
        <Card className="p-5">
          <div className="grid grid-cols-2 gap-y-2.5 text-sm">
            <span className="text-neutral-500">总打印面</span>
            <span className="text-right font-medium text-neutral-900">{totalFaces} 面</span>
            <span className="text-neutral-500">预计用纸</span>
            <span className="text-right font-medium text-neutral-900">{sheetsUsed} 张</span>
          </div>

          {paperSaved > 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-success-bg px-3 py-2 text-xs text-success-fg">
              <InfoIcon className="h-4 w-4 shrink-0" />
              双面打印比单面节省 {paperSaved} 张纸
            </div>
          )}

          <div className="mt-4 flex items-baseline justify-between border-t border-neutral-100 pt-4">
            <div>
              <p className="text-sm text-neutral-700 font-medium">预计费用</p>
              <p className="mt-0.5 text-xs text-neutral-400">
                {priceCfg.status === 'error' || unitCents === null
                  ? '价格暂不可用，实付以收银台显示为准'
                  : file.pages === null
                    ? `${formatPriceCents(unitCents)}/页（${params.colorMode === 'color' ? '彩色' : '黑白'}）× 页数待识别`
                    : `${formatPriceCents(unitCents)}/页（${params.colorMode === 'color' ? '彩色' : '黑白'}）× ${file.pages} 页 × ${params.copies} 份`}
              </p>
            </div>
            <div className="text-right">
              <span className="text-2xl font-bold text-neutral-900">
                {estimateCents === null ? '—' : formatPriceCents(estimateCents)}
              </span>
              <p className="mt-0.5 text-xs text-neutral-400">按内容页计费，实付以收银台为准</p>
            </div>
          </div>

          {params.colorMode === 'color' && (
            <p className="mt-3 text-xs text-warning-fg">彩色效果以设备支持和当前耗材状态为准</p>
          )}
        </Card>
      </div>

      {/* Submit error */}
      {submitError && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-error/30 bg-error-bg px-4 py-3 text-sm text-error-fg">
          <AlertCircleIcon className="h-4 w-4 shrink-0" />
          <span>{submitError}</span>
        </div>
      )}

      {/* Bottom action */}
      <div className="mt-4 flex gap-3">
        <Button variant="secondary" size="lg" className="flex-1" disabled={submitting} onClick={() => navigate(-1)}>
          返回修改
        </Button>
        <Button size="lg" className="flex-1" disabled={submitting} onClick={() => void handleConfirm()}>
          {submitting ? (
            <span className="flex items-center gap-2">
              <LoaderIcon className="h-4 w-4 animate-spin" />
              提交中…
            </span>
          ) : (
            '按以上设置打印'
          )}
        </Button>
      </div>
    </div>
  )
}

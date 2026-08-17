// ============================================================
// 简历诊断失败态的**非 AI 出路**。
//
// 改动前这一屏只有「返回首页 / 重新解析」两个按钮：文件已经好好地传到服务端了，
// 用户却在一台打印终端上一张纸也拿不走，只能反复重试同一个挂掉的 AI。
//
// 口径来源：docs/design/kiosk-ai-os-v3-2026-08/09-resume-workbench.html 的 ai-down 支线
//   - :1325 「解析中断，文件没有丢」/「可打印或存档」
//   - :1357 「带去打印：原件 3 页」（data-when="ai-down"，走打印工作台）
//   - :1332 「诊断不可用，原文可正常翻看」/「不猜、不给通用建议」
//
// 三条硬约束：
//   1. 不伪造：这里一条 AI 结论都不给。诊断没跑出来就是没有，不拿通用建议顶替。
//   2. 出路必须是真的：打印原件走的是 /print/confirm + 真实 HMAC content URL，
//      和「我的文档」打印同一条链路；拿不到 URL 时按钮如实置灰并写明原因。
//   3. 置灰一律 aria-disabled，不用原生 disabled ——
//      原生 disabled 会退出 Tab 序列、读屏跳过，触屏也没有 hover 读不到 title。
// ============================================================

import { useNavigate } from 'react-router-dom'
import { Button, Card } from '@ai-job-print/ui'
import { makePrintParams } from '@ai-job-print/shared'
import { BriefcaseIcon, CalendarDaysIcon, PrinterIcon } from 'lucide-react'

export interface ResumeDiagnosisFailFile {
  name: string
  size: string
  format: string
  /** kiosk-upload 下发的 HMAC content URL（30 分钟 TTL）。刷新丢 state 后为空。 */
  fileUrl?: string
  mimeType?: string
}

interface Props {
  file?: ResumeDiagnosisFailFile
  onRetry: () => void
  onHome: () => void
}

/** 拿不到打印链接时的真实原因。写在按钮旁边常驻可见，不放 tooltip。 */
const NO_PRINT_URL_REASON =
  '这一屏刷新过，本次上传的文件访问凭证只在内存里，已经随刷新丢了 —— 不是文件被删了。重新上传一次就能直接打印原件。'

export function ResumeDiagnosisFailExits({ file, onRetry, onHome }: Props) {
  const navigate = useNavigate()
  const canPrintOriginal = Boolean(file?.fileUrl)

  const printOriginal = () => {
    if (!file?.fileUrl) return
    navigate('/print/confirm', {
      state: {
        file: {
          name: file.name,
          size: file.size,
          pages: null,
          fileUrl: file.fileUrl,
          mimeType: file.mimeType,
        },
        params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
      },
    })
  }

  return (
    <div className="resume-report-fail-exits mt-8 w-full max-w-3xl">
      <Card className="border-neutral-200 bg-white p-5">
        <p className="text-base font-semibold text-neutral-900">解析中断，你上传的文件没有丢</p>
        <p className="mt-1 text-sm leading-relaxed text-neutral-600">
          {file?.name
            ? `「${file.name}」已经完整传到服务端，中断的只是「读懂它」这一步。`
            : '中断的只是「读懂它」这一步。'}
          下面几件事都不需要 AI，现在就能做。这一屏不会给任何诊断结论 —— 没跑出来就是没有，不拿通用建议顶替。
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {canPrintOriginal ? (
            <Button
              size="lg"
              className="resume-primary-action flex min-h-[56px] items-center justify-center gap-2 sm:col-span-2"
              onClick={printOriginal}
            >
              <PrinterIcon className="h-5 w-5" aria-hidden="true" />
              打印我上传的原件（不需要 AI）
            </Button>
          ) : (
            <div className="sm:col-span-2">
              {/*
                真 <button> + aria-disabled，不加原生 disabled：
                置灰的按钮也必须能被 Tab 到、被读屏读到，并且读得到「为什么点不动」。
                这里刻意不绑 onClick，按下去不会有任何副作用。
              */}
              <button
                type="button"
                aria-disabled="true"
                aria-describedby="resume-fail-print-reason"
                className="flex min-h-[56px] w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-neutral-100 px-4 text-base font-medium text-neutral-400"
              >
                <PrinterIcon className="h-5 w-5" aria-hidden="true" />
                打印我上传的原件（本次不可用）
              </button>
              <p id="resume-fail-print-reason" className="mt-2 text-xs leading-relaxed text-neutral-500">
                {NO_PRINT_URL_REASON}
              </p>
            </div>
          )}

          <Button
            size="lg"
            variant="outline"
            className="flex min-h-[56px] items-center justify-center gap-2"
            onClick={() => navigate('/print-scan')}
          >
            <PrinterIcon className="h-5 w-5" aria-hidden="true" />
            去打印 / 扫描其他材料
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="flex min-h-[56px] items-center justify-center gap-2"
            onClick={() => navigate('/jobs')}
          >
            <BriefcaseIcon className="h-5 w-5" aria-hidden="true" />
            查看岗位
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="flex min-h-[56px] items-center justify-center gap-2 sm:col-span-2"
            onClick={() => navigate('/job-fairs')}
          >
            <CalendarDaysIcon className="h-5 w-5" aria-hidden="true" />
            查看招聘会
          </Button>
        </div>
      </Card>

      <div className="mt-4 flex w-full gap-3">
        <Button variant="secondary" size="lg" className="min-h-[56px] flex-1" onClick={onHome}>
          返回首页
        </Button>
        <Button size="lg" className="resume-primary-action min-h-[56px] flex-1" onClick={onRetry}>
          重新解析
        </Button>
      </div>
    </div>
  )
}

// ============================================================
// 简历诊断**明确失败**态的非 AI 出路（稿 22 diagnose-failed 的 `.exits` 卡与自查清单）。
//
// 改动前这一屏只有「返回首页 / 重新解析」两个按钮：文件已经好好地传到服务端了，
// 用户却在一台打印终端上一张纸也拿不走，只能反复重试同一个挂掉的 AI。
// 「返回首页 / 重新解析」现在在报告页的青序操作条里；这里只放不需要 AI 的出路。
//
// 三条硬约束：
//   1. 不伪造：这里一条 AI 结论都不给。诊断没跑出来就是没有，不拿通用建议顶替。
//   2. 出路必须是真的：打印原件走的是 /print/confirm + 真实 HMAC content URL，
//      和「我的文档」打印同一条链路；拿不到 URL 时按钮如实置灰并写明原因。
//   3. 置灰一律 aria-disabled，不用原生 disabled ——
//      原生 disabled 会退出 Tab 序列、读屏跳过，触屏也没有 hover 读不到 title。
// 样式只用报告页既有的 rrp-exits / rrp-row / rrp-checks（resume-report-qx.css，行高 88px）。
// ============================================================

import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { makePrintParams } from '@ai-job-print/shared'
import { BriefcaseIcon, CalendarDaysIcon, PrinterIcon } from 'lucide-react'
import { useRecruitmentHosting } from '../../../hooks/useRecruitmentHosting'
import { MANUAL_CHECKS } from '../resume-report-model'

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
}

/** 拿不到打印链接时的真实原因。写在按钮旁边常驻可见，不放 tooltip。 */
const NO_PRINT_URL_REASON =
  '这一屏刷新过，本次上传的文件访问凭证只在内存里，已经随刷新丢了 —— 不是文件被删了。重新上传一次就能直接打印原件。'

/** 置灰行：沿用 rrp-row 的尺寸，只换虚线与弱化色，读得出「点不动」。 */
const DEAD_ROW: CSSProperties = { borderStyle: 'dashed', color: 'var(--qx-ink-3)', cursor: 'not-allowed' }

export function ResumeDiagnosisFailExits({ file }: Props) {
  const navigate = useNavigate()
  const canPrintOriginal = Boolean(file?.fileUrl)
  // 招聘内容托管（3.13）关闭时没有岗位与招聘会可看，这两条出路不摆。
  const hostingOpen = useRecruitmentHosting().enabled

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
    <>
      <section className="rrp-exits resume-report-fail-exits" data-testid="resume-report-fail-exits">
        <div className="rrp-zh">这些都不需要 AI<span>现在就能做</span></div>
        <p className="rrp-export-reason" style={{ marginBottom: 12 }}>
          {file?.name ? `「${file.name}」已经传到服务端，文件没有丢。` : '你上传的文件没有丢。'}
          这一屏不给任何诊断结论 —— 没跑出来就是没有，不拿通用建议顶替。
        </p>
        <div className="rows" style={{ display: 'grid', gap: 10 }}>
          {canPrintOriginal ? (
            <button type="button" className="rrp-row" onClick={printOriginal} data-route="/print/confirm">
              <PrinterIcon size={26} aria-hidden="true" />
              <span className="tx"><b>打印我上传的原件</b><span>不需要 AI，按原样进打印确认</span></span>
            </button>
          ) : (
            <div>
              {/*
                真 <button> + aria-disabled，不加原生 disabled：
                置灰的按钮也必须能被 Tab 到、被读屏读到，并且读得到「为什么点不动」。
                这里刻意不绑 onClick，按下去不会有任何副作用。
              */}
              <button
                type="button"
                className="rrp-row"
                aria-disabled="true"
                aria-describedby="resume-fail-print-reason"
                style={DEAD_ROW}
              >
                <PrinterIcon size={26} aria-hidden="true" />
                <span className="tx"><b>打印我上传的原件</b><span>本次不可用</span></span>
              </button>
              <p id="resume-fail-print-reason" className="rrp-export-reason" style={{ marginTop: 8 }}>
                {NO_PRINT_URL_REASON}
              </p>
            </div>
          )}
          <button type="button" className="rrp-row" onClick={() => navigate('/print-scan')} data-route="/print-scan">
            <PrinterIcon size={26} aria-hidden="true" />
            <span className="tx"><b>去打印 / 扫描其他材料</b><span>打印扫描不依赖 AI，照常可用</span></span>
          </button>
          {hostingOpen ? (
            <>
              <button type="button" className="rrp-row" onClick={() => navigate('/jobs')} data-route="/jobs">
                <BriefcaseIcon size={26} aria-hidden="true" />
                <span className="tx"><b>查看岗位</b><span>来源平台的岗位信息照常可看</span></span>
              </button>
              <button type="button" className="rrp-row" onClick={() => navigate('/job-fairs')} data-route="/job-fairs">
                <CalendarDaysIcon size={26} aria-hidden="true" />
                <span className="tx"><b>查看招聘会</b><span>现场活动信息照常可看</span></span>
              </button>
            </>
          ) : null}
        </div>
      </section>
      <section className="rrp-checks" data-testid="resume-report-fallback">
        <div className="rrp-zh">不等 AI，先自己核一遍<span>6 项 · 纸质简历同样适用</span></div>
        <div className="list" data-testid="resume-report-list">
          {MANUAL_CHECKS.map((item, i) => (
            <div key={item}><i>{i + 1}</i><span>{item}</span></div>
          ))}
        </div>
      </section>
    </>
  )
}

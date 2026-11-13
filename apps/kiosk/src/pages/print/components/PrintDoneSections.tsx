// ============================================================
// PrintDoneSections —— /print/done（稿 15-print-fulfill）完成态的纯展示分区
//
// 只收 PrintDonePage 已经向服务端核验过的真值：不发请求、不判定任务状态、不改金额。
//   PrintDoneRecordSection 完成态「本次记录」：摘要默认可见，保留与删除记录可展开
//   PrintJobSummaryCard    完成态「本次任务摘要」
//
// 少见失败态（普通失败、卡纸、缺纸、费用与订单边界）在 PrintDoneFailed.tsx，版式照稿 st-unconfirmed。
// 结果判定（completed / failed / errorCode 分态）、带走链接、重试与清场仍在页面里，门禁按页面文件取证。
// 本文件渲染在完成页上，守同一套文案红线：不写「已支付」（用「已付」）、不出现退款 / 赔付字样。
// ============================================================

import { useState } from 'react'
import type { PrintJobParams } from '@ai-job-print/shared'
import { pagesPerCopy } from '../printProgressModel'
import { PrintFileDeletionRecords } from './PrintFileDeletionRecords'
import { PrintFileRetentionNotice } from './PrintFileRetentionNotice'
import type { PrintFileRetentionInput } from './printFileRetention'

const DUPLEX_LABEL: Record<string, string> = {
  simplex:           '单面',
  duplex_long_edge:  '双面（长边）',
  duplex_short_edge: '双面（短边）',
}

/** 完成页下半部：摘要默认展开，文件保留与删除记录收在同一区里，避免把求助挤出首屏。 */
export function PrintDoneRecordSection({
  file,
  params,
  retention,
}: {
  file?: { name: string; pages: number | null }
  params?: Partial<PrintJobParams>
  retention: PrintFileRetentionInput
}) {
  const [open, setOpen] = useState(false)
  return (
    <section className="pff-record" aria-label="本次记录">
      <div className="pff-sec-h"><span className="t">本次记录</span></div>
      {file && params ? <PrintJobSummaryCard file={file} params={params} /> : (
        <p className="print-done-card-sub">这次没有带到文件名和打印参数，摘要留空。</p>
      )}
      <button
        type="button"
        className="pff-record-toggle"
        aria-expanded={open}
        aria-controls="print-done-record-extra"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? '收起文件保留和删除记录' : '查看文件保留和删除记录'}
      </button>
      <div id="print-done-record-extra" className="pff-record-extra" hidden={!open}>
        <PrintFileRetentionNotice retention={retention} />
        <PrintFileDeletionRecords />
      </div>
    </section>
  )
}

export function PrintJobSummaryCard({ file, params }: {
  file: { name: string; pages: number | null }
  params: Partial<PrintJobParams>
}) {
  const perCopy = pagesPerCopy(file, params)
  const copies = params.copies != null && params.copies >= 1 ? params.copies : null
  const pagesText = perCopy != null && perCopy >= 1
    ? (copies != null && copies > 1 ? `${perCopy} 页 × ${copies} 份` : `${perCopy} 页`)
    : copies != null ? `${copies} 份，页数待识别` : '页数 / 份数未提供'
  return (
    <div className="qx-card">
      <b className="pff-info-hd">本次任务摘要</b>
      <div className="pff-i-row"><span className="pff-i-k">文件名</span><span className="pff-i-v">{file.name}</span></div>
      <div className="pff-i-row"><span className="pff-i-k">页数 / 份数</span><span className="pff-i-v">{pagesText}</span></div>
      <div className="pff-i-row"><span className="pff-i-k">打印面</span><span className="pff-i-v">{params.duplex ? DUPLEX_LABEL[params.duplex] ?? params.duplex : '未提供'}</span></div>
      <div className="pff-i-row">
        <span className="pff-i-k">色彩 / 质量</span>
        <span className="pff-i-v">
          {params.colorMode === 'color' ? '彩色' : params.colorMode === 'black_white' ? '黑白' : '未提供'}{params.quality ? ` · ${params.quality === 'draft' ? '草稿' : params.quality === 'high' ? '高质量' : '标准'}` : ''}
        </span>
      </div>
    </div>
  )
}

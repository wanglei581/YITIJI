// /job-fairs/:id/materials —— 活动物料（稿 28-jobfair-enhanced.html，screen=materials / 091）。
//
// 状态：list | empty | error | print-failed。
//
// 与稿的两处差异，都在 fairWorkbenchSpecs 与 verify:fair-workbench-qx 里登记过：
//   · `error` 是稿没建模的状态（FAIR_PILL_GAPS）。稿把 materials 的失败只画成
//     `expired`，于是 GET /materials 返回 500 时页面会对用户说「限时签名链接超时失效，
//     重新获取一次即可，内容不变」—— 服务端 500 时这三句每一句都不成立。
//   · `expired` 因此**没有**任何代码路径：后端当前不下发任何「链接已过期」的信号
//     （print-url 的失败码是 MATERIAL_NOT_PRINTABLE / MATERIAL_PRINT_PREPARING /
//     MATERIAL_INTEGRITY_FAILED，都不是过期），本页不会凭猜测把别的失败说成过期。
//     恢复条件写在门禁的 UNIMPLEMENTED_DRAFT_STATES 登记表上。
// 稿的三条打印说明是本页的事实边界，不得简化：
//   ① 物料链接有有效期，过期要重新获取，不能用旧链接直接打印；
//   ② 份数 / 单双面 / 黑白彩色在打印页选，价格以现场公示与服务端报价为准；
//   ③ 打印是否成功以打印机回流状态为准，本页不显示逐页进度。
//
// 打印文件一律由后端按需生成短期 FileObject 并返回内部 HMAC printFileUrl；
// 绝不消费 material.fileUrl（那是对象存储的外部签名 URL，打印链路不接）。

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { FairMaterialDTO, ExternalJobFairDTO, FairMaterialType } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import { FAIR_MATERIAL_TYPE_LABELS } from '../../types/fair'
import {
  BriefcaseIcon,
  BuildingIcon,
  CalendarIcon,
  FileTextIcon,
  MapIcon,
  MapPinIcon,
  NewspaperIcon,
  PrinterIcon,
  SparklesIcon,
} from 'lucide-react'
import { getFairMaterials, getJobFairById, prepareFairMaterialPrint } from '../../services/api'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { DEMO_MODE_NO_REAL_FILE_REASON } from '../../lib/capabilityReasons'
import { API_MODE } from '../../services/api/client'
import { QxFairWorkbench } from './QxFairWorkbench'
import { FAIR_HEAD } from './fairWorkbenchSpecs'
import { FairSkeletonList } from './components/FairWorkbenchBits'
import { fmtFairSyncDate } from './fairFormat'
import {
  DirKv,
  DirNote,
  DirState,
  DirSteps,
  DirStrip,
  DirStripItem,
} from '../../components/qingxu/directory/DirectoryBits'

function formatSize(kb: number) {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`
}

/** 物料类型 → 图标。标签文案取 FAIR_MATERIAL_TYPE_LABELS，不在本页另起一套叫法。 */
function MaterialIcon({ type }: { type: FairMaterialType }) {
  switch (type) {
    case 'schedule': return <CalendarIcon size={26} aria-hidden />
    case 'venue_map': return <MapIcon size={26} aria-hidden />
    case 'company_list': return <NewspaperIcon size={26} aria-hidden />
    case 'position_list': return <BriefcaseIcon size={26} aria-hidden />
    case 'brochure': return <FileTextIcon size={26} aria-hidden />
    default: return <MapPinIcon size={26} aria-hidden />
  }
}

export function FairMaterialsPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const fairId = id ?? ''

  const [fair, setFair] = useState<ExternalJobFairDTO | null>(null)
  const [materials, setMaterials] = useState<FairMaterialDTO[]>([])
  const [materialsTotal, setMaterialsTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [printingId, setPrintingId] = useState<string | null>(null)
  const [printError, setPrintError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    Promise.all([getJobFairById(fairId), getFairMaterials(fairId)])
      .then(([fairRes, matsRes]) => {
        if (cancelled) return
        setFair(fairRes.data)
        setMaterials(matsRes.data)
        setMaterialsTotal(matsRes.pagination?.total ?? matsRes.data.length)
      })
      // 取不到就说取不到。不猜是不是过期 —— 过期有过期的话术（「重取即可，内容不变」），
      // 那句话在 500 / 断网时是假的，而用户会照着它反复点重取。
      .catch((err) => { if (!cancelled) setLoadError(userMessageOf(err, '活动物料列表这次没取到，请重新加载')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fairId, retryKey])

  // 打印时由后端按需把 FairMaterial 转为短期 FileObject，只消费内部 HMAC printFileUrl。
  const handlePrint = async (material: FairMaterialDTO) => {
    if (printingId) return
    setPrintingId(material.id)
    setPrintError(null)
    try {
      const printable = await prepareFairMaterialPrint(fairId, material.id)
      if (!printable.printFileUrl) throw new Error('打印链接未就绪')
      navigate('/print/confirm', {
        state: {
          file: {
            name: printable.filename,
            size: formatSize(Math.max(1, Math.round(printable.sizeBytes / 1024))),
            pages: printable.pageCount > 0 ? printable.pageCount : null,
            fileId: printable.fileId,
            fileUrl: printable.printFileUrl,
            mimeType: printable.mimeType,
          },
          params: makePrintParams({
            copies: 1,
            duplex: printable.pageCount > 1 ? 'double' : 'single',
            color: 'bw',
          }),
        },
      })
    } catch (error) {
      setPrintError(userMessageOf(error, '打印文件准备失败，请稍后重试'))
    } finally {
      setPrintingId(null)
    }
  }

  if (loading) {
    return (
      <QxFairWorkbench screen="materials" state="list" fairId={fairId}>
        <div className="dw-sec-h"><span className="t">正在取活动物料</span><span className="hint">未返回前不显示份数</span></div>
        <FairSkeletonList rows={3} />
      </QxFairWorkbench>
    )
  }

  const uiState = printError ? 'print-failed' : loadError ? 'error' : materials.length === 0 ? 'empty' : 'list'

  const ctabar = uiState === 'print-failed'
    ? (
      <>
        <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/help')}>找工作人员处理</button>
        <button type="button" className="qx-btn" data-variant="primary" onClick={() => setPrintError(null)}>回到物料列表</button>
      </>
    )
    : uiState === 'error'
      ? (
        <>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/print-scan')}>打印你自己的材料</button>
          {/* 重试只重发这两条请求，不走 window.location.reload —— 一体机整页重载会把
              路由与已填状态一起清掉，用户还得从服务台一路点回来。 */}
          <button type="button" className="qx-btn" data-variant="primary" onClick={() => setRetryKey((k) => k + 1)}>重新加载</button>
        </>
      )
      : uiState === 'empty'
        ? (
          <>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate(`/job-fairs/${fairId}/companies`)}>看参展名单</button>
            <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/print-scan')}>打印你自己的材料</button>
          </>
        )
        : (
          <>
            <p className="why">打印份数、单双面与黑白彩色在打印页选择，价格以现场公示与系统报价为准。</p>
            <button type="button" className="qx-btn narrow" data-variant="ghost" onClick={() => navigate(`/job-fairs/${fairId}`)}>返回招聘会</button>
          </>
        )

  return (
    <QxFairWorkbench
      screen="materials"
      state={uiState}
      fairId={fairId}
      subtitle={fair ? `${fair.name} · ${FAIR_HEAD.materials[1]}` : undefined}
      ctabar={ctabar}
    >
      {uiState === 'print-failed' ? (
        <>
          <DirState tone="error" testId="fair-materials-print-failed" title="这次打印没有成功">
            {printError}
            <br />
            <b>没出纸就是没出纸</b>，本机不会把它记成已完成。如果已经扣费，请带着订单号找工作人员处理。
          </DirState>
          <DirStrip>
            <DirStripItem icon={PrinterIcon} title="查看打印订单状态" desc="打印结果以打印机回流状态为准" onClick={() => navigate('/me/print-orders')} />
            <DirStripItem icon={FileTextIcon} tone="wheat" title="换一份或重新发起" desc="回到物料列表再选一次" onClick={() => setPrintError(null)} />
          </DirStrip>
        </>
      ) : uiState === 'error' ? (
        <>
          <DirState tone="error" testId="fair-materials-error" title="活动物料这次没取到">
            {loadError}
            <br />
            这是<b>请求没成功</b>，不是主办方没传，也不是链接过期。本机不显示上一次的物料清单——
            清单错了你会按着不存在的手册去找。
          </DirState>
          <DirStrip>
            <DirStripItem icon={BuildingIcon} tone="wheat" title="一直获取不到？" desc="可以找现场工作人员要一份纸质版" onClick={() => navigate('/help')} />
            <DirStripItem icon={PrinterIcon} title="打印你自己的材料" desc="简历、证件材料照常可以打印" onClick={() => navigate('/print-scan')} />
          </DirStrip>
        </>
      ) : uiState === 'empty' ? (
        <>
          <DirState tone="empty" testId="fair-materials-empty" title="这场还没有可下载的物料">
            主办方没有上传名单、手册或指引。本机<b>不生成一份「参考版」冒充官方物料</b>。
          </DirState>
          <DirStrip>
            <DirStripItem icon={SparklesIcon} title="把简历改好再去" desc="诊断、优化和材料工坊都在简历服务里" onClick={() => navigate('/resume-service')} />
            <DirStripItem icon={BuildingIcon} tone="wheat" title="返回招聘会" desc="时间地点和参展名单仍可查看" onClick={() => navigate(`/job-fairs/${fairId}`)} />
          </DirStrip>
        </>
      ) : (
        <>
          <p className="dw-rhead">
            <span className="rn">活动物料</span>
            <span>
              {materialsTotal > materials.length
                ? `已取回 ${materials.length} / 共 ${materialsTotal} 份`
                : `共 ${materials.length} 份`}
            </span>
            <span className="rsp">下载链接临时有效，过期需重新打开</span>
          </p>

          <div className="dw-rlist" data-testid="fair-materials-list">
            {materials.map((mat) => {
              const isPreparingThis = printingId === mat.id
              const canPrint = mat.allowPrint && API_MODE === 'http' && !printingId
              const printLabel = isPreparingThis
                ? '正在准备打印文件…'
                : API_MODE !== 'http'
                  ? '暂不可打印'
                  : `去打印（${mat.pageCount} 页）`

              return (
                <div key={mat.id} className="dw-row solid">
                  <span className="dw-row-ic"><MaterialIcon type={mat.type} /></span>
                  <span className="dw-row-main">
                    <span className="dw-row-t">
                      {mat.name}
                      <span className="dw-tag slate">{FAIR_MATERIAL_TYPE_LABELS[mat.type]}</span>
                    </span>
                    {mat.description ? <span className="dw-row-sub"><span>{mat.description}</span></span> : null}
                    <span className="dw-row-sub">
                      {/* 不写「格式 PDF」：FairMaterialDTO 没有文件格式字段，写死就是编造。
                          物料种类已由上面的 dw-tag（FAIR_MATERIAL_TYPE_LABELS）如实给出。 */}
                      <span>页数 {mat.pageCount} 页</span>
                      <span>体积 {formatSize(mat.fileSizeKB)}</span>
                      {/*
                        2026-08-11（CLAUDE.md §9）：原为「已打印 {mat.printCount} 次」。
                        FairMaterial.printCount 全后端**没有出纸完成后递增的写路径**
                        （资料转打印文件时只更新桥接记录 fair-material-print-bridge.service.ts:82），
                        故恒为 0——对求职者显示「已打印 0 次」既不实也无决策价值，直接移除。
                        恢复条件：打印完成回调中递增该字段后，方可重新展示。
                      */}
                    </span>
                  </span>
                  {mat.allowPrint ? (
                    <span className="qxfw-matacts">
                      {/* printingId 是瞬时态（保留原生 disabled）；演示模式没有后端是能力门禁，
                          改 aria-disabled + 常显原因 —— 写在 title 里触屏读不到。 */}
                      <button
                        type="button"
                        className="qx-btn"
                        data-variant="teal"
                        disabled={printingId !== null}
                        aria-disabled={API_MODE !== 'http' || undefined}
                        aria-describedby={API_MODE !== 'http' ? `fair-material-blocked-${mat.id}` : undefined}
                        onClick={() => { if (canPrint) void handlePrint(mat) }}
                      >
                        <PrinterIcon size={20} aria-hidden />
                        {printLabel}
                      </button>
                      {API_MODE !== 'http' ? (
                        <span id={`fair-material-blocked-${mat.id}`} className="qxfw-blocked">
                          {DEMO_MODE_NO_REAL_FILE_REASON}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="qxfw-blocked">该资料暂不开放打印</span>
                  )}
                </div>
              )
            })}
          </div>

          <section className="dw-blk">
            <div className="dw-sec-h"><span className="t">关于打印这些物料</span></div>
            <DirSteps items={[
              '物料链接有有效期，过期后需要重新获取，不能用旧链接直接打印。',
              '打印份数、单双面与黑白彩色在打印页选择，价格以现场公示与服务端报价为准。',
              '打印是否成功以打印机回流的状态为准；本页不显示逐页进度。',
            ]} />
          </section>

          {fair ? (
            <DirKv rows={[
              ['来源机构', fair.sourceName],
              ['同步时间', fair.syncTime ? fmtFairSyncDate(fair.syncTime) : '同步时间未知'],
              ['外部编号', fair.externalId],
            ]} />
          ) : null}

          <DirNote>
            资料由主办方 / 机构上传；标记为可打印的资料可在本机打印，费用以下单时报价为准，实际页数以文件为准。
          </DirNote>
        </>
      )}
    </QxFairWorkbench>
  )
}

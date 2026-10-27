// ============================================================
// PrintScanFeatureInfoPage — /print-scan/feature/:key
//
// 视觉真值：docs/design/kiosk-redesign-2026-08-v2/10-print-hub.html
//   state: feature-id-photo | feature-not-found（稿里有）
//          feature-copy（稿里没有：R4，2026-09-29 产品负责人拍板复印走打印机面板；
//                        同日定合规新状态不画新稿，用 2.0 现有组件与字阶实现）
// 证件照当前只有说明 + 两条真实替代路径，不做排版 / 换底 / 成品生成。
// 复印只有「怎么在打印机面板上复印」的说明，不经过本机下单，不宣称复印结果。
// ============================================================

import { useNavigate, useParams } from 'react-router-dom'
import { FsSheetArt } from './FsSheetArt'
import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import {
  FilesIcon,
  ImageIcon,
  PackageCheckIcon,
  PrinterIcon,
  ScanLineIcon,
  UserSquareIcon,
} from 'lucide-react'
import {
  COPY_GUIDE_CASES,
  COPY_GUIDE_KEY,
  COPY_GUIDE_LEGAL,
  COPY_GUIDE_ROUTE,
  COPY_GUIDE_STEPS,
  HUB_PILL,
  type HubFeatureState,
} from './printHubContent'
import {
  PrintHubRecordNotes,
  PrintHubState,
  PrintHubTruth,
  PrintHubEmphasis,
  type QxPrintQuickLinkView,
} from './components/QxPrintHubView'
import { PhoneHelpLine } from './phoneHelp'
import { toolBandStatus } from './toolBand'
import { TouchToolScreen } from './TouchToolScreen'
import './styles/print-hub-qx.css'

const PHOTO_FALLBACK = '/print/upload?source=document&tab=file&category=photo'
const SCAN_FALLBACK = '/scan'
/** 复印说明页的主按钮：有电子版要打，走「文档打印」同一个入口。 */
const DOC_PRINT_ENTRY = '/print/upload?source=document&tab=file'

const RECORD_LINKS: readonly (QxPrintQuickLinkView & { to: string })[] = [
  { key: 'documents', icon: FilesIcon, title: '我的文档', description: '已上传 / 生成的文件', to: '/me/documents' },
  { key: 'print-orders', icon: PrinterIcon, title: '打印订单', description: '任务状态与到机码', to: '/me/print-orders' },
]

function featureState(key: string | undefined): HubFeatureState {
  if (key === 'id-photo') return 'feature-id-photo'
  if (key === COPY_GUIDE_KEY) return 'feature-copy'
  return 'feature-not-found'
}

export function PrintScanFeatureInfoPage() {
  const navigate = useNavigate()
  const { key } = useParams<{ key: string }>()
  const hubState = featureState(key)
  const found = hubState !== 'feature-not-found'
  const pill = toolBandStatus(HUB_PILL[hubState])

  if (!found) {
    return (
      <TouchToolScreen
        eyebrow="打印扫描"
        title="这个能力名我不认识"
        sub="地址里的能力名对不上现有说明"
        status={pill}
        onBack={() => navigate('/print-scan')}
        askLabel="问小青：这个功能是什么"
        dock={
          <button
            type="button"
            className="qx-btn"
            data-variant="primary"
            data-testid="print-hub-primary"
            onClick={() => navigate('/print-scan')}
          >
            返回打印扫描
          </button>
        }
      >
        <div
          className="qx-scroll ph-page fs-page"
          data-w2-page="print-scan-feature"
          data-qx-page="print-hub"
          data-state="feature-not-found"
          data-testid="print-hub-state-feature-not-found"
        >
          <div className="fs-fact" data-testid="print-hub-fallback">
            <b>没有这项能力说明</b>
            <span>这个名字不在复印、证件照这些说明里。本页不编一套步骤。多半是旧二维码或旧链接。</span>
          </div>
          <div className="fs-fact">
            <b>复印</b>
            <span>复印的说明在「怎么在打印机上复印」。</span>
          </div>
          <div className="fs-fact">
            <b>证件照</b>
            <span>证件照这一页写的是尚未开放，和两条替代路径。</span>
          </div>
          <div className="fs-fact">
            <b>下一步</b>
            <span>回到打印扫描，从那里选已经有的功能。</span>
          </div>
          <button type="button" className="fs-row" onClick={() => navigate('/print-scan/feature/id-photo')}>
            看证件照说明
          </button>
          <PrintHubRecordNotes
            links={RECORD_LINKS}
            onOpen={(linkKey) => {
              if (linkKey === COPY_GUIDE_KEY) {
                navigate(COPY_GUIDE_ROUTE)
                return
              }
              const link = RECORD_LINKS.find((item) => item.key === linkKey)
              if (link) navigate(link.to)
            }}
          />
          <FsSheetArt caption="示意图。这个名字没有对应的办理步骤，回到打印扫描再选。" />
          <footer className="ph-foot">
            <PrintHubTruth />
            <PhoneHelpLine />
          </footer>
        </div>
      </TouchToolScreen>
    )
  }

  if (hubState === 'feature-copy') {
    return (
      <TouchToolScreen
        eyebrow="复印"
        title="怎么在打印机上复印"
        sub="复印不用在这台屏幕上下单，也不会出现在「我的打印订单」里"
        status={pill}
        onBack={() => navigate('/print-scan')}
        askLabel="问小青：复印要注意什么"
        dock={
          <>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/print-scan')}>
              返回打印扫描
            </button>
            <button
              type="button"
              className="qx-btn"
              data-variant="primary"
              data-testid="print-hub-primary"
              onClick={() => navigate(DOC_PRINT_ENTRY)}
            >
              去打印文件
            </button>
          </>
        }
      >
        <div
          className="qx-scroll ph-page fs-page"
          data-w2-page="print-scan-feature"
          data-qx-page="print-hub"
          data-state="feature-copy"
          data-testid="print-hub-state-feature-copy"
        >
          <p className="fs-lead">复印不用在这台屏幕上下单，也不会出现在「我的打印订单」里。照下面五步做就行。</p>
          <p className="fs-h" id="ph-copy-steps">照着做：五步复印</p>
          <ol className="fs-ol" data-testid="print-hub-copy-steps">
            {COPY_GUIDE_STEPS.map((step, index) => (
              <li key={step.title} className="fs-step">
                <span className="n" aria-hidden="true">{index + 1}</span>
                <b>{step.title}</b>
                <span className="d"><PrintHubEmphasis text={step.body} marks={step.emphasis} /></span>
              </li>
            ))}
          </ol>
          <p className="fs-h" id="ph-copy-cases">这几种原件这样复印</p>
          {COPY_GUIDE_CASES.map((item) => (
            <div
              key={item.key}
              className="fs-fact"
              data-static="true"
              data-testid={`print-hub-copy-case-${item.key}`}
              data-pending={item.pending || undefined}
            >
              <b>{item.title}</b>
              <span><PrintHubEmphasis text={item.body} marks={['「身份证复印」', '「票据复印」']} /></span>
            </div>
          ))}
          <section className="ph-fallback">
            <PrintHubState
              kind="warn"
              icon={<PackageCheckIcon size={28} />}
              heading="复印件和原件一起带走"
              testId="print-hub-copy-take-original"
            >
              <p className="ph-state-p">
                复印件和原件一起带走。原件还在玻璃上或进纸口里，请务必取回。
              </p>
              <PhoneHelpLine />
            </PrintHubState>
          </section>
          <footer className="ph-foot">
            <div className="ph-truth" data-disclaimer="true" data-testid="print-hub-copy-legal">
              <div>
                <b>法律提示</b>
                {COPY_GUIDE_LEGAL}
              </div>
            </div>
          </footer>
        </div>
      </TouchToolScreen>
    )
  }

  return (
    <TouchToolScreen
      eyebrow="证件照"
      title="证件照：本机尚未开放"
      sub="现在不能裁切、换底色或排版，也不会生成证件照成品"
      status={pill}
      onBack={() => navigate('/print-scan')}
      askLabel="问小青：证件照怎么办"
      dock={
        <>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/print-scan')}>
            返回打印扫描
          </button>
          <button
            type="button"
            className="qx-btn"
            data-variant="primary"
            data-testid="print-hub-primary"
            onClick={() => navigate(PHOTO_FALLBACK)}
          >
            先用照片打印
          </button>
        </>
      }
    >
      <div
        className="qx-scroll ph-page fs-page"
        data-w2-page="print-scan-feature"
        data-qx-page="print-hub"
        data-state="feature-id-photo"
        data-testid="print-hub-state-feature-id-photo"
      >
        <div className="fs-idhead" data-testid="print-hub-idphoto-unavailable">
          <div className="vis" aria-hidden="true"><UserSquareIcon size={72} /></div>
          <div>
            <h2>本机暂未开放证件照</h2>
            <p>已经有电子版可以按照片打印；只有纸质的，先在打印机上扫描。裁切、换底色和排版都不在这台机器上做。</p>
          </div>
        </div>
        <div className="fs-pair">
          <button type="button" className="fs-act" data-testid="print-hub-idphoto-fallback" onClick={() => navigate(PHOTO_FALLBACK)}>
            <span className="vis" aria-hidden="true"><ImageIcon size={48} /></span>
            <span className="tx"><h3>已经有证件照文件</h3><p>传到这台机器，按普通照片打印。尺寸和底色以你手上的原图为准。</p></span>
            <span className="go" aria-hidden="true">›</span>
          </button>
          <button type="button" className="fs-act" data-testid="print-hub-idphoto-scan" onClick={() => navigate(SCAN_FALLBACK)}>
            <span className="vis" aria-hidden="true"><ScanLineIcon size={48} /></span>
            <span className="tx"><h3>只有纸质照片</h3><p>在打印机面板上扫描，回到这台机器取电子版。扫描不做裁切和换底色。</p></span>
            <span className="go" aria-hidden="true">›</span>
          </button>
        </div>
        <div className="fs-plan">
          <div className="hd"><b>以后会做</b><span className="fs-chip">规划，不是承诺</span></div>
          <ol>
            <li>选常见规格与底色（一寸 / 二寸 / 小一寸）。</li>
            <li>按纸张规格自动排版，确认张数后进入打印流程。</li>
            <li>证件照属敏感文件，按短期留存策略清理。</li>
          </ol>
          <p className="fs-p" data-disclaimer="true">{COMPLIANCE_COPY.KIOSK_PRINT_SCAN_SENSITIVE}</p>
        </div>
        <FsSheetArt caption="示意图。这台机器现在不做证件照成品，可以按照片打印或先扫描。" />
        <footer className="ph-foot">
          <PrintHubTruth />
          <PhoneHelpLine />
        </footer>
      </div>
    </TouchToolScreen>
  )
}

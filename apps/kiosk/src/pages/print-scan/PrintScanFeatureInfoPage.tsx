// ============================================================
// PrintScanFeatureInfoPage — /print-scan/feature/:key
//
// 视觉真值：docs/design/kiosk-redesign-2026-08/10-print-hub.html
//   state: feature-id-photo | feature-not-found
// 证件照当前只有说明 + 两条真实替代路径，不做排版 / 换底 / 成品生成。
// ============================================================

import type { CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import {
  ArrowRightIcon,
  FilesIcon,
  ImageIcon,
  InfoIcon,
  PrinterIcon,
  ScanLineIcon,
  UserSquareIcon,
} from 'lucide-react'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import {
  HUB_PILL,
  type HubUiState,
} from './printHubContent'
import {
  PrintHubHero,
  PrintHubNavbar,
  PrintHubRecordNotes,
  PrintHubState,
  PrintHubTruth,
  type QxPrintQuickLinkView,
} from './components/QxPrintHubView'
import './styles/print-hub-qx.css'

const PHOTO_FALLBACK = '/print/upload?source=document&tab=file&category=photo'
const SCAN_FALLBACK = '/scan'

const RECORD_LINKS: readonly (QxPrintQuickLinkView & { to: string })[] = [
  { key: 'documents', icon: FilesIcon, title: '我的文档', description: '已上传 / 生成的文件', to: '/me/documents' },
  { key: 'print-orders', icon: PrinterIcon, title: '打印订单', description: '任务状态与取件凭证码', to: '/me/print-orders' },
]

function isIdPhoto(key: string | undefined): boolean {
  return key === 'id-photo'
}

export function PrintScanFeatureInfoPage() {
  const navigate = useNavigate()
  const { key } = useParams<{ key: string }>()
  const found = isIdPhoto(key)
  const hubState: HubUiState = found ? 'feature-id-photo' : 'feature-not-found'
  const pill = HUB_PILL[hubState]
  const backToHub = { label: '返回打印扫描', onBack: () => navigate('/print-scan') }
  const navbar = (
    <PrintHubNavbar
      onHome={() => navigate('/')}
      onAdvisor={() => navigate('/assistant')}
      onProfile={() => navigate('/profile')}
    />
  )

  if (!found) {
    return (
      <QxPageFrame
        back={backToHub}
        title="未找到该功能"
        status={pill}
        terminalLabel="就业服务大厅"
        navbar={navbar}
        ctabar={
          <>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/help')}>
              联系工作人员
            </button>
            <button
              type="button"
              className="qx-btn"
              data-variant="primary"
              data-testid="print-hub-primary"
              onClick={() => navigate('/print-scan')}
            >
              返回打印扫描服务
            </button>
          </>
        }
      >
        <div
          className="qx-scroll ph-page"
          data-w2-page="print-scan-feature"
          data-qx-page="print-hub"
          data-state="feature-not-found"
          data-testid="print-hub-state-feature-not-found"
        >
          <PrintHubHero state="feature-not-found" doing="大概率是旧链接。回打印扫描首页重新选一次。" />
          <section className="ph-fallback">
            <PrintHubState kind="warn" icon={<InfoIcon size={28} />} heading="没有这项能力说明" testId="print-hub-fallback">
              <p className="ph-state-p">
                地址里带了一个本机<b>不认识的能力名称</b>。当前只有「证件照」一项有说明页。
              </p>
              <p className="ph-state-p">多半是旧二维码或旧链接。回打印扫描首页重新选一次即可。</p>
            </PrintHubState>
          </section>
          <section className="ph-sec">
            <div className="ph-sec-h">
              <span className="ph-no">01</span>
              <span className="t">可以直接去的地方</span>
            </div>
            <PrintHubRecordNotes
              links={RECORD_LINKS}
              onOpen={(linkKey) => {
                const link = RECORD_LINKS.find((item) => item.key === linkKey)
                if (link) navigate(link.to)
              }}
            />
          </section>
          <section className="ph-sec ph-sec--fill">
            <div className="ph-sec-h">
              <span className="ph-no">02</span>
              <span className="t">本机现在有哪些能力说明</span>
              <span className="hint">只有证件照一项</span>
            </div>
            <div className="ph-pgrp">
              <h4>
                <UserSquareIcon size={28} aria-hidden="true" />
                证件照说明
              </h4>
              <p className="ph-state-p">
                目前只有证件照提供未开放说明和替代路径。其他陌生名称不会进入办理流程，请回打印扫描首页重新选择。
              </p>
              <div className="ph-axes">
                <button type="button" className="ph-chip" onClick={() => navigate('/print-scan/feature/id-photo')}>
                  看证件照说明
                </button>
                <button type="button" className="ph-chip" onClick={() => navigate('/print-scan')}>
                  回打印扫描首页
                </button>
              </div>
            </div>
          </section>
          <footer className="ph-foot">
            <PrintHubTruth />
          </footer>
        </div>
      </QxPageFrame>
    )
  }

  return (
    <QxPageFrame
      back={backToHub}
      title="证件照"
      status={pill}
      terminalLabel="就业服务大厅"
      navbar={navbar}
      ctabar={
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
        className="qx-scroll ph-page"
        data-w2-page="print-scan-feature"
        data-qx-page="print-hub"
        data-state="feature-id-photo"
        data-testid="print-hub-state-feature-id-photo"
      >
        <PrintHubHero
          state="feature-id-photo"
          doing="我不会假装能给你排版出图；下面是真的能走的两条路。"
        />
        <section className="ph-fallback">
          <PrintHubState
            kind="warn"
            icon={<UserSquareIcon size={28} />}
            heading="证件照：本机尚未开放"
            testId="print-hub-idphoto-unavailable"
          >
            <p className="ph-state-p">
              这项只有说明，<b>没有可用流程</b>。本机不做尺寸裁切、底色处理、版面排布，也不生成证件照成品。
            </p>
            <p className="ph-state-p" data-disclaimer="true">
              开放前不提供换底色、自动排版和成品生成，免得你按着不存在的流程走一遍。
            </p>
          </PrintHubState>
        </section>
        <section className="ph-sec">
          <div className="ph-sec-h">
            <span className="ph-no">01</span>
            <span className="t">现在可以怎么办</span>
          </div>
          <div className="ph-src-list">
            <button
              type="button"
              className="ph-src"
              style={{ '--ph-i': 1 } as CSSProperties}
              data-testid="print-hub-idphoto-fallback"
              onClick={() => navigate(PHOTO_FALLBACK)}
            >
              <span className="ph-src-ic" data-tone="teal" aria-hidden="true">
                <ImageIcon size={40} />
              </span>
              <span className="ph-src-main">
                <span className="ph-src-name">
                  已经有证件照文件
                  <span className="ph-tag">现在可用</span>
                </span>
                <span className="ph-src-desc">
                  相册里已有的证件照，传进来<b>按普通照片打印</b>。尺寸和底色以你手上的原图为准。
                </span>
              </span>
              <span className="ph-src-go" aria-hidden="true"><ArrowRightIcon size={28} /></span>
            </button>
            <button
              type="button"
              className="ph-src"
              style={{ '--ph-i': 2 } as CSSProperties}
              data-testid="print-hub-idphoto-scan"
              onClick={() => navigate(SCAN_FALLBACK)}
            >
              <span className="ph-src-ic" data-tone="slate" aria-hidden="true">
                <ScanLineIcon size={40} />
              </span>
              <span className="ph-src-main">
                <span className="ph-src-name">纸质照片想留电子版</span>
                <span className="ph-src-desc">
                  在奔图面板上扫描，回本机取走电子版。<b>扫描不做裁切和底色处理。</b>
                </span>
              </span>
              <span className="ph-src-go" aria-hidden="true"><ArrowRightIcon size={28} /></span>
            </button>
          </div>
        </section>
        <section className="ph-sec ph-sec--fill">
          <div className="ph-pgrp">
            <h4>开放后会做什么<span>规划，不是承诺</span></h4>
            <ul className="ph-plan">
              <li><span className="sq" />选常见规格与底色（一寸 / 二寸 / 小一寸）。</li>
              <li><span className="sq" />按纸张规格自动排版，确认张数后进入打印流程。</li>
              <li><span className="sq" />证件照属敏感文件，按短期留存策略清理。</li>
            </ul>
            <p className="ph-pgrp-note" data-disclaimer="true">{COMPLIANCE_COPY.KIOSK_PRINT_SCAN_SENSITIVE}</p>
          </div>
        </section>
        <footer className="ph-foot">
          <PrintHubTruth />
        </footer>
      </div>
    </QxPageFrame>
  )
}

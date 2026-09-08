// ============================================================
// PrintScanFeatureInfoPage — /print-scan/feature/:key
//
// 视觉真值：docs/design/kiosk-redesign-2026-08/10-print-hub.html
//   state: feature-id-photo | feature-not-found
// 证件照当前只有说明 + 两条真实替代路径，不做排版 / 换底 / 成品生成。
// ============================================================

import { useNavigate, useParams } from 'react-router-dom'
import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import {
  ArrowRightIcon,
  CopyIcon,
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
  PrintHubTruth,
} from './components/QxPrintHubView'
import './styles/print-hub-qx.css'

const PHOTO_FALLBACK = '/print/upload?source=document&tab=file&category=photo'
const SCAN_FALLBACK = '/scan/start'

function isIdPhoto(key: string | undefined): boolean {
  return key === 'id-photo'
}

export function PrintScanFeatureInfoPage() {
  const navigate = useNavigate()
  const { key } = useParams<{ key: string }>()
  const found = isIdPhoto(key)
  const hubState: HubUiState = found ? 'feature-id-photo' : 'feature-not-found'
  const pill = HUB_PILL[hubState]
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
        back={{ label: '返回打印扫描', onBack: () => navigate('/print-scan') }}
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
            <div className="qx-state" data-tone="empty" data-testid="print-hub-fallback">
              <span className="qx-state-ic"><InfoIcon size={28} aria-hidden /></span>
              <span>
                <div className="qx-state-t">没有这项能力说明</div>
                <p className="qx-state-d">
                  地址里带了一个本机<b>不认识的能力名称</b>。当前只有「证件照」一项有说明页。
                </p>
                <p className="qx-state-d">多半是旧二维码或旧链接。回打印扫描首页重新选一次即可。</p>
              </span>
            </div>
          </section>
          <section className="ph-sec">
            <div className="ph-sec-h">
              <span className="ph-no">01</span>
              <span className="t">可以直接去的地方</span>
            </div>
            <div className="ph-notes">
              <button type="button" className="ph-note" onClick={() => navigate('/me/documents')}>
                <span className="ph-note-ic" aria-hidden="true"><FilesIcon size={26} /></span>
                <span>
                  <b>我的文档</b>
                  <span className="d">已上传 / 生成的文件</span>
                  <span className="ph-note-go">查看 →</span>
                </span>
              </button>
              <button type="button" className="ph-note" onClick={() => navigate('/me/print-orders')}>
                <span className="ph-note-ic" aria-hidden="true"><PrinterIcon size={26} /></span>
                <span>
                  <b>打印订单</b>
                  <span className="d">任务状态与取件凭证码</span>
                  <span className="ph-note-go">查看 →</span>
                </span>
              </button>
              <div className="ph-note" role="group" data-disclaimer="true" data-static="true">
                <span className="ph-note-ic" data-tone="wheat" aria-hidden="true"><CopyIcon size={26} /></span>
                <span>
                  <b>复印</b>
                  <span className="d">请直接在奔图机器面板上操作。本机网页没有复印流程，也不代收费。</span>
                </span>
              </div>
            </div>
          </section>
          <section className="ph-sec ph-sec--grow">
            <div className="ph-sec-h">
              <span className="ph-no">02</span>
              <span className="t">本机现在有哪些能力说明</span>
              <span className="hint">只有证件照一项</span>
            </div>
            <div className="qx-card ph-pgrp qx-grow">
              <div className="qx-state-t">证件照说明</div>
              <p className="qx-state-d">
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
          <PrintHubTruth />
        </div>
      </QxPageFrame>
    )
  }

  return (
    <QxPageFrame
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
          <div className="qx-state" data-tone="empty" data-testid="print-hub-idphoto-unavailable">
            <span className="qx-state-ic"><UserSquareIcon size={28} aria-hidden /></span>
            <span>
              <div className="qx-state-t">证件照：本机尚未开放</div>
              <p className="qx-state-d">
                这项只有说明，<b>没有可用流程</b>。本机不做尺寸裁切、底色处理、版面排布，也不生成证件照成品。
              </p>
              <p className="qx-state-d" data-disclaimer="true">
                开放前不提供换底色、自动排版和成品生成，免得你按着不存在的流程走一遍。
              </p>
            </span>
          </div>
        </section>
        <section className="ph-sec">
          <div className="ph-sec-h">
            <span className="ph-no">01</span>
            <span className="t">现在可以怎么办</span>
          </div>
          <button
            type="button"
            className="ph-src"
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
          <div className="ph-stack" />
          <button
            type="button"
            className="ph-src"
            data-testid="print-hub-idphoto-scan"
            onClick={() => navigate(SCAN_FALLBACK)}
          >
            <span className="ph-src-ic" data-tone="slate" aria-hidden="true">
              <ScanLineIcon size={40} />
            </span>
            <span className="ph-src-main">
              <span className="ph-src-name">纸质照片想留电子版</span>
              <span className="ph-src-desc">
                在奔图面板上扫成 PDF，回本机取走。<b>扫描不做裁切和底色处理。</b>
              </span>
            </span>
            <span className="ph-src-go" aria-hidden="true"><ArrowRightIcon size={28} /></span>
          </button>
        </section>
        <section className="ph-sec ph-sec--grow">
          <div className="qx-card ph-pgrp qx-grow">
            <h4>开放后会做什么<span>规划，不是承诺</span></h4>
            <ul className="ph-plan">
              <li><span className="sq" />选常见规格与底色（一寸 / 二寸 / 小一寸）。</li>
              <li><span className="sq" />按纸张规格自动排版，确认张数后进入打印流程。</li>
              <li><span className="sq" />证件照属敏感文件，按短期留存策略清理。</li>
            </ul>
            <p className="qx-state-d" data-disclaimer="true">{COMPLIANCE_COPY.KIOSK_PRINT_SCAN_SENSITIVE}</p>
          </div>
        </section>
        <PrintHubTruth />
      </div>
    </QxPageFrame>
  )
}

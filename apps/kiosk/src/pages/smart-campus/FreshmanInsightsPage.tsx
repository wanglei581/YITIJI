// ============================================================
// FreshmanInsightsPage — 迎新服务导览（/smart-campus/freshman-insights）
//
// 2026-09-07 产品裁定：本平台没有迎新报到数据，本页不做统计，只导览
// 新生到校后用得上的、已经存在的真实能力。行李帮运 / VR / 校园卡 /
// 一卡通 / 校园网仍是办理说明占位，本页不链过去。
// ============================================================

import { useNavigate } from 'react-router-dom'
import {
  BookmarkIcon,
  ChevronRightIcon,
  FileTextIcon,
  FilesIcon,
  GraduationCapIcon,
  PrinterIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from 'lucide-react'
import { FusionBadge, FusionNotice, KioskPageFrame } from '../jobs/components/W4Presentation'

interface GuideEntry {
  key: string
  icon: LucideIcon
  title: string
  description: string
  to: string
}

const GUIDE_ENTRIES: GuideEntry[] = [
  {
    key: 'print',
    icon: PrinterIcon,
    title: '打印材料',
    description: '上传报到表、承诺书等 PDF 或图片，本机预览后打印。Word 需转换引擎开放后才能转 PDF。',
    to: '/print/upload',
  },
  {
    key: 'resume',
    icon: FileTextIcon,
    title: '简历服务',
    description: '上传简历做 AI 诊断与优化，或按引导生成草稿，并可进入本机打印。',
    to: '/resume-service',
  },
  {
    key: 'campus-jobs',
    icon: GraduationCapIcon,
    title: '校园招聘信息',
    description: '查看校园主题招聘会的参展企业、导览与材料。投递请去来源平台，本机不收简历。',
    to: '/campus',
  },
  {
    key: 'policy',
    icon: BookmarkIcon,
    title: '政策服务',
    description: '查看就业政策、社保与档案登记材料指引。只展示已审核信息，不代办、不承诺结果。',
    to: '/policy-service',
  },
  {
    key: 'documents',
    icon: FilesIcon,
    title: '我的文档',
    description: '登录后查看、预览或重新打印本人已保存的文件。未登录时会提示先登录。',
    to: '/me/documents',
  },
]

export function FreshmanInsightsPage() {
  const navigate = useNavigate()
  const back = () => navigate('/smart-campus')

  return (
    <KioskPageFrame
      tone="wheat"
      title="迎新服务导览"
      subtitle="新生到校后可在本机使用的服务入口"
      backLabel="返回智慧校园"
      onBack={back}
      badge={<FusionBadge>本机已有能力</FusionBadge>}
    >
      <div className="kproto kproto-teal kproto-content">
        <div className="kproto-auth">
          <ShieldCheckIcon aria-hidden="true" />
          <p>
            本页只列出本机已经开放的服务入口，不采集报到信息，也不做任何统计展示。报到登记请前往学校官方系统。
          </p>
        </div>

        <div className="sc-mod-grid">
          {GUIDE_ENTRIES.map((entry) => {
            const Icon = entry.icon
            return (
              <button
                key={entry.key}
                type="button"
                onClick={() => navigate(entry.to)}
                className="sc-mod"
              >
                <span className="sc-mod-icon">
                  <Icon aria-hidden="true" />
                </span>
                <span className="sc-mod-title">
                  <b>{entry.title}</b>
                </span>
                <p>{entry.description}</p>
                <span className="sc-mod-go">
                  进入
                  <ChevronRightIcon aria-hidden="true" />
                </span>
              </button>
            )
          })}
        </div>

        <FusionNotice>
          本平台没有迎新报到数据。报到、缴费、宿舍分配请以学校官方系统为准。
        </FusionNotice>

        <div className="kproto-actionbar">
          <button type="button" className="kproto-btn" onClick={back}>
            返回智慧校园
          </button>
        </div>
      </div>
    </KioskPageFrame>
  )
}

export default FreshmanInsightsPage

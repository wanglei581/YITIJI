import { ComplianceBanner } from '@ai-job-print/ui'
import type { RecruitmentHostingView } from '../components/recruitment/useRecruitmentHosting'

/** 只提示：读取中或失败也显示；明确开启托管后才隐藏。 */
export function AssetUploadNotice({ hosting }: { hosting: RecruitmentHostingView }) {
  if (hosting.status === 'ready' && hosting.enabled) return null
  return (
    <ComplianceBanner title="上传前请先看" tone="info">
      <ul className="list-disc space-y-2 pl-5">
        <li>不要上传：招聘简章；写了用人单位和岗位、人数、薪资、条件或报名方式的图片或视频；列出企业或岗位的招聘会海报；企业或商业招聘网站的二维码。</li>
        <li>可以上传：机构介绍和服务时间；就业政策和补贴宣传；不指向具体单位和岗位的讲座、培训通知；本机使用指引。</li>
        <li>拿不准的先不放：只写时间地点的招聘会预告；机构招聘自己工作人员的公告；人才引进政策里附带的岗位表。</li>
      </ul>
      <p className="mt-2">图片和视频里的招聘信息，同样算发布招聘信息。</p>
    </ComplianceBanner>
  )
}

import { useEffect, useState } from 'react'
import { AlertTriangleIcon } from 'lucide-react'
import { isOrgContentPublishable } from '@ai-job-print/shared'
import { getOrgProfile, type PartnerOrgProfile } from '../services/api/orgSelf'
import { useRecruitmentHosting } from '../services/capabilities'

/**
 * 「本机构的内容为什么还没上架」的常驻说明。
 *
 * ## 谁来上架，决定了这条横幅该说什么
 *
 * `PATCH partner/{jobs,fairs,policies}/:id/publish` 的 handler 分别是
 * `unpublishPartnerJob` / `unpublishPartnerFair` / `unpublishPartnerPolicy`，
 * `@Body() _dto` 直接丢弃、service 里 `publishStatus: 'unpublished'` 硬编码 ——
 * **路由叫 publish，实际只会下架。**
 *
 * 3.13（2026-09-26）起政策改由机构自己审核并发布（`PATCH partner/policies/:id/release`，
 * 须确认发布责任）；岗位 / 招聘会（仅托管打开时存在）仍由管理员上架。两条路都受「内容可信」
 * 闸门约束：机构没被标为 `contentTrustStatus=active` 之前，`assertOrgContentTrustActive`
 * 会 fail-closed 拒绝，内容审核通过了也上不了终端。
 *
 * 合作机构看到的现象是：**我的岗位审核通过了，一体机上却没有**，而后台不给任何原因。
 * 这条横幅补的就是这个原因，以及该找谁。
 *
 * ## 为什么挂在布局层
 *
 * 岗位 / 招聘会 / 政策三个管理页各 500+ 行（CLAUDE.md §8 的 500 行阈值），
 * 逐页塞会漂移、将来新增页会漏。挂在 Outlet 上方，所有 Partner 页面自然都有。
 *
 * ## 失败静默
 *
 * 取不到机构资料时不显示。宁可少提示，也不能因一次网络抖动就对一个其实已可信的
 * 机构挂一条「内容上不了架」—— 那是另一种伪造状态。
 */
export function ContentTrustBanner() {
  const [profile, setProfile] = useState<PartnerOrgProfile | null>(null)
  // 只有服务端明确打开托管时才提岗位与招聘会；关闭或没读到时只提政策。
  const recruitmentHosting = useRecruitmentHosting() === 'on'

  useEffect(() => {
    let alive = true
    getOrgProfile()
      .then((p) => { if (alive) setProfile(p) })
      .catch(() => { /* 取不到就不显示，见上方注释 */ })
    return () => { alive = false }
  }, [])

  if (!profile) return null
  const archived = Boolean(profile.archived)
  if (isOrgContentPublishable(profile.contentTrustStatus, archived)) return null

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-[10px] border border-amber-300 bg-amber-50 px-4 py-3"
    >
      <AlertTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
      <div className="text-sm leading-relaxed text-amber-900">
        <div className="font-semibold">本机构的内容目前还不会出现在终端上</div>
        <div className="mt-1">
          {archived
            ? '本机构已归档。已归档机构的内容不会被上架到一体机与小程序。'
            : recruitmentHosting
              ? '本机构尚未通过平台的「内容可信」核验。在核验通过之前，岗位 / 招聘会 / 政策即使已经录入、通过审核，也无法上架到一体机与小程序。'
              : '本机构尚未通过平台的「内容可信」核验。在核验通过之前，政策即使已经录入、通过审核，也无法发布到一体机与小程序。'}
        </div>
        <div className="mt-1">
          {archived
            ? '如需继续供稿，请联系平台运营取消归档并重新核验。'
            : recruitmentHosting
              ? '岗位 / 招聘会由平台管理员上架，政策由本机构自行发布，两者都要先通过核验。请联系平台完成来源授权核验（需提供授权书 / 合同 / 公开声明编号等核验依据），核验通过后本提示会自动消失。'
              : '政策由本机构自行审核发布，发布前要先通过核验。请联系平台完成来源授权核验（需提供授权书 / 合同 / 公开声明编号等核验依据），核验通过后本提示会自动消失。'}
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { OrgOfficialChannelsPanel } from './OrgOfficialChannelsPanel'
import { OrgVerifiedDomainsPanel } from './OrgVerifiedDomainsPanel'

/**
 * 机构详情抽屉里的 3.14 两节：「官方域名（入驻核验）」与「官方渠道」。
 *
 * 两节放在一起，是因为渠道链接是否还在登记范围内取决于当前登记的域名：
 * 域名小节读到或保存后的列表交给渠道小节，用来提示「这一条终端不会显示」。
 * 与招聘内容托管开关无关，托管开或关两节都一样。
 */
export function OrgOfficialChannelSections({ orgId, orgName }: { orgId: string; orgName: string }) {
  const [domains, setDomains] = useState<string[] | null>(null)
  return (
    <>
      <OrgVerifiedDomainsPanel orgId={orgId} onDomainsChange={setDomains} />
      <OrgOfficialChannelsPanel orgId={orgId} orgName={orgName} domains={domains} />
    </>
  )
}

// 我的权益（C-2D 分页化）：只读展示；补贴资格提示 info-only，无「到账 / 已发放金额」承诺。

import type { MemberBenefitItem } from '@ai-job-print/shared'
import { BENEFIT_META, benefitMetaText } from './format'
import { AssetGroupShell, AssetRow } from './ui'
import type { AssetGroupHandle } from './useMemberAssetGroups'

export function BenefitsGroup({ group }: { group: AssetGroupHandle<MemberBenefitItem> }) {
  return (
    <AssetGroupShell
      title="我的权益"
      group={group}
      empty="暂无可用权益，参与活动或购买套餐后在此查看"
      renderRow={(b) => {
        const meta = BENEFIT_META[b.benefitType]
        return (
          <AssetRow
            key={b.id}
            icon={meta.icon}
            iconBg={meta.iconBg}
            iconColor={meta.iconColor}
            name={b.title}
            meta={`${meta.label} · ${benefitMetaText(b)}`}
          />
        )
      }}
    />
  )
}

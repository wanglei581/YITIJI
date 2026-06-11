// 我的打印订单（C-2D 分页化）：只读安全元数据；无文件原文 / 签名链接 / 哈希 / 支付字段。

import type { MemberPrintOrderItem } from '@ai-job-print/shared'
import { PrinterIcon } from 'lucide-react'
import { printOrderMetaText } from './format'
import { AssetGroupShell, AssetRow } from './ui'
import type { AssetGroupHandle } from './useMemberAssetGroups'

export function PrintOrdersGroup({ group }: { group: AssetGroupHandle<MemberPrintOrderItem> }) {
  return (
    <AssetGroupShell
      title="我的打印订单"
      group={group}
      empty="暂无账号打印订单"
      renderRow={(o) => (
        <AssetRow
          key={o.id}
          icon={PrinterIcon}
          iconBg="bg-amber-50"
          iconColor="text-amber-600"
          name={o.fileName || '打印任务'}
          meta={printOrderMetaText(o)}
        />
      )}
    />
  )
}

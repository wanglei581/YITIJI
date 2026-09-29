import { Card, StatusBadge } from '@ai-job-print/ui'
import { FileTextIcon, PrinterIcon } from 'lucide-react'
import { MATERIAL_TYPE_LABELS, PUBLISH_BADGE, formatSize, resolvePreviewUrl } from './shared'
import type { FairMaterialView } from '../../../services/api/fairsAdmin'

/**
 * 招聘会「活动资料」页签（只读 + 紧急下架）。
 *
 * 3.15 起管理员不代发招聘会内容：上传 / 发布 / 下架 / 编辑 / 删除资料不论托管开关一律停放，
 * 完整可写版本在同目录 MaterialsTabEditor.tsx（不被 import）。紧急下架是单向处置，照常保留。
 */
export function MaterialsTab({
  materials,
  onTakedown,
}: {
  materials: FairMaterialView[]
  /** 紧急下架（单向）。两种托管状态都提供。 */
  onTakedown: (material: FairMaterialView) => void
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-600">{materials.length} 份资料(已发布的在一体机"活动资料"页可见)</p>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['资料名称', '类型', '页数', '大小', '打印次数', '状态', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap border-b border-neutral-900/10 bg-neutral-50/90 px-4 py-2.5 text-left text-[11.5px] font-bold tracking-[0.04em] text-neutral-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900/[0.06]">
              {materials.length === 0 ? (
                <tr><td colSpan={7} className="py-10 text-center text-xs text-neutral-400">暂无活动资料</td></tr>
              ) : (
                materials.map((m) => (
                  <tr key={m.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FileTextIcon className="h-4 w-4 shrink-0 text-neutral-400" />
                        <span className="font-medium text-neutral-800">{m.name}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{MATERIAL_TYPE_LABELS[m.type] ?? m.type}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{m.pageCount > 0 ? `${m.pageCount} 页` : '未填写'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{formatSize(m.fileSizeKB)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {/* 2026-08-11：printCount 无递增写入（见 StatsTab 注释），恒为 0，改为明示未接入 */}
                      <span className="flex items-center gap-1 text-xs text-neutral-400">
                        <PrinterIcon className="h-3.5 w-3.5 text-neutral-300" />
                        未接入
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        dot
                        status={PUBLISH_BADGE[m.publishStatus]?.status ?? 'default'}
                        label={PUBLISH_BADGE[m.publishStatus]?.label ?? m.publishStatus}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-1">
                        {m.previewUrl ? (
                          <a
                            href={resolvePreviewUrl(m.previewUrl)}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
                          >
                            预览
                          </a>
                        ) : (
                          <span className="rounded px-2 py-1 text-xs text-neutral-300" title="mock 模式无真实文件">预览</span>
                        )}
                        <button
                          type="button"
                          onClick={() => onTakedown(m)}
                          className="rounded px-2 py-1 text-xs font-medium text-error-fg hover:bg-error-bg"
                        >
                          紧急下架
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-neutral-400">
        活动资料由招聘会的发布机构上传，本平台不代为上传、发布或下架；如有违法违规内容，请用紧急下架。一体机经签名短时链接访问资料，不暴露存储地址。
      </p>
    </div>
  )
}

import { Card } from '@ai-job-print/ui'
import type { FairCompanyView } from '../../../services/api/fairsAdmin'

/**
 * 招聘会「参展企业」页签（只读）。
 *
 * 3.15 起管理员不代改招聘会内容：新增 / 编辑 / 删除参展企业与岗位明细不论托管开关一律停放，
 * 完整可写版本在同目录 CompaniesTabEditor.tsx（不被 import）。
 */
export function CompaniesTab({ companies }: { companies: FairCompanyView[] }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-600">{companies.length} 家参展企业</p>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['企业名称', '行业', '规模', '招聘标签', '岗位数'].map((h) => (
                  <th key={h} className="whitespace-nowrap border-b border-neutral-900/10 bg-neutral-50/90 px-4 py-2.5 text-left text-[11.5px] font-bold tracking-[0.04em] text-neutral-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900/[0.06]">
              {companies.length === 0 ? (
                <tr><td colSpan={5} className="py-10 text-center text-xs text-neutral-400">暂无参展企业</td></tr>
              ) : (
                companies.map((c) => (
                  <tr key={c.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-medium text-neutral-800">{c.name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{c.industry ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{c.scale ? `${c.scale} 人` : '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.hiringTags.length === 0
                          ? <span className="text-xs text-neutral-400">—</span>
                          : c.hiringTags.map((t) => (
                            <span key={t} className="rounded bg-info-bg px-1.5 py-0.5 text-xs text-info-fg">{t}</span>
                          ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">{c.jobsCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-neutral-400">
        参展企业由招聘会的发布机构维护，本平台不代为新增或修改。企业信息仅用于招聘会现场服务展示，系统不接收求职者简历，不参与招聘闭环。
      </p>
    </div>
  )
}

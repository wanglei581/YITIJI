import { PencilLineIcon } from 'lucide-react'

/** 复用决策台的改写呈现，但数据严格限于既有 targetedSuggestions 字符串列表。 */
export function ResumeRewriteCard({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <section className="job-fit-card job-fit-rewrite rounded-2xl border border-neutral-100 bg-white p-5" aria-label="简历定向优化建议">
      <div className="mb-3 flex items-center gap-2">
        <PencilLineIcon className="h-4 w-4 text-primary-600" aria-hidden="true" />
        <h2 className="text-base font-semibold text-neutral-900">简历定向优化建议</h2>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((item, index) => (
          <li key={`${item.slice(0, 24)}-${index}`} className="flex items-start gap-2 text-sm leading-relaxed text-neutral-700">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-400" aria-hidden="true" />
            {item}
          </li>
        ))}
      </ul>
    </section>
  )
}

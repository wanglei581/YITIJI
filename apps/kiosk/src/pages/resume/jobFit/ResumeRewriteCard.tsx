import { PencilLineIcon } from 'lucide-react'

/** 简历定向优化建议 — 对齐原型屏55 a-clay card with sug-list */
export function ResumeRewriteCard({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <section className="job-fit-card job-fit-rewrite jf-section jf-section--clay" aria-label="简历定向优化建议">
      <div className="jf-card-head">
        <span className="jf-card-icon" aria-hidden="true"><PencilLineIcon /></span>
        <div>
          <h2>简历定向优化建议</h2>
        </div>
      </div>
      <ul className="jf-sug-list">
        {items.map((item, index) => (
          <li key={`${item.slice(0, 24)}-${index}`}>{item}</li>
        ))}
      </ul>
    </section>
  )
}

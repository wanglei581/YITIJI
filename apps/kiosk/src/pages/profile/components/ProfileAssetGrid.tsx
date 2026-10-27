import { useNavigate } from 'react-router-dom'
import type { MemberAssetCounts } from '../assets/useMemberAssetCounts'

/** 六项资产数量，一个 3 列网格，每格是一颗按钮（稿 fe-counts）。未取到的数量写「—」。 */
const ITEMS = [
  { key: 'resumes' as const, label: '我的简历', desc: '这次要用哪一份', route: '/me/resumes' },
  { key: 'documents' as const, label: '我的文档', desc: '传上来和生成的文件', route: '/me/documents' },
  { key: 'orders' as const, label: '打印订单', desc: '进度和到机码', route: '/me/print-orders' },
  { key: 'favorites' as const, label: '我的收藏', desc: '收藏的政策', route: '/me/favorites' },
  { key: 'benefits' as const, label: '我的权益', desc: '能不能用', route: '/me/benefits' },
  { key: 'ai' as const, label: 'AI 服务记录', desc: '诊断、生成和面试', route: '/me/ai-records' },
]

export function ProfileAssetGrid({
  counts,
  loading,
}: {
  counts: MemberAssetCounts
  loading: boolean
}) {
  const navigate = useNavigate()
  return (
    <section aria-label="我的资产" className="me-counts">
      {ITEMS.map((item) => {
        const value = counts[item.key]
        return (
          <button
            type="button"
            key={item.key}
            className="me-count"
            data-testid={`profile-asset-${item.key}`}
            onClick={() => navigate(item.route)}
          >
            <span>{item.label}</span>
            <small>{item.desc}</small>
            {value === null ? (
              <b data-unloaded={loading ? 'loading' : 'missing'}>—</b>
            ) : (
              <b>{value}<em>条</em></b>
            )}
          </button>
        )
      })}
    </section>
  )
}

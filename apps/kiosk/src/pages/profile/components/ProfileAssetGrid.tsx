import { useNavigate } from 'react-router-dom'
import type { MemberAssetCounts } from '../assets/useMemberAssetCounts'

const MAIN = [
  { key: 'resumes' as const, label: '我的简历', desc: '这次要用哪一份', route: '/me/resumes' },
  { key: 'documents' as const, label: '我的文档', desc: '传上来和生成的文件', route: '/me/documents' },
  { key: 'orders' as const, label: '打印订单', desc: '含取件码与出纸状态', route: '/me/print-orders' },
]

const MORE = [
  { key: 'favorites' as const, label: '我的收藏', route: '/me/favorites' },
  { key: 'benefits' as const, label: '我的权益', route: '/me/benefits' },
  { key: 'ai' as const, label: 'AI 服务记录', route: '/me/ai-records' },
]

function CountValue({ value, loading }: { value: number | null; loading: boolean }) {
  if (value === null) {
    return (
      <b className="qx-num pf-asset-num" data-unloaded={loading ? 'loading' : 'missing'}>
        —
      </b>
    )
  }
  return <b className="qx-num pf-asset-num">{value}</b>
}

export function ProfileAssetGrid({
  counts,
  loading,
}: {
  counts: MemberAssetCounts
  loading: boolean
}) {
  const navigate = useNavigate()
  return (
    <section aria-label="我的资产">
      <div className="qx-sec-h">
        <span className="t">简历、文档与订单</span>
        <span className="hint">{loading ? '数量返回前一律显示「—」' : '数量由服务端返回，未返回显示「—」'}</span>
      </div>
      <div className="pf-grid3">
        {MAIN.map((item) => (
          <button
            type="button"
            key={item.key}
            className="pf-asset"
            data-testid={`profile-asset-${item.key}`}
            onClick={() => navigate(item.route)}
          >
            <span className="pf-asset-t">{item.label}</span>
            <span className="pf-asset-d">{item.desc}</span>
            <span className="pf-asset-n">
              <CountValue value={counts[item.key]} loading={loading} />
              <span className="pf-asset-unit">条</span>
            </span>
          </button>
        ))}
      </div>
      <div className="pf-morelinks">
        {MORE.map((item) => (
          <button
            type="button"
            key={item.key}
            className="pf-mlink"
            data-testid={`profile-asset-${item.key}`}
            onClick={() => navigate(item.route)}
          >
            {item.label}
            <CountValue value={counts[item.key]} loading={loading} />
          </button>
        ))}
      </div>
    </section>
  )
}

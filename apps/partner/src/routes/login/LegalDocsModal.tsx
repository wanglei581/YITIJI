// LegalDocsModal — 合作机构后台《用户服务协议》《隐私政策》弹层
//
// Partner 应用没有独立的 /legal 路由，登录页协议勾选的两个链接在此弹层内展示全文。
// 登录页无 JWT，读公开当前有效版本 GET /kiosk/legal/:type（与 admin 同源同表）。
// 接不到真实文档时只显示「法务文档加载失败」，**不得回落到硬编码 v1 草拟文**
// —— 口径与 apps/admin/src/routes/login/LegalDocsModal.tsx 一致，原因见
// ../../services/api/legalDocs.ts 顶部。

import { useEffect, useState } from 'react'
import { XIcon } from 'lucide-react'
import {
  getActiveLegalDoc,
  LEGAL_DOC_TYPE,
  type LegalDocActiveView,
} from '../../services/api/legalDocs'

export type LegalDocKind = 'terms' | 'privacy'

const DOC_TITLE: Record<LegalDocKind, string> = {
  terms: '用户服务协议',
  privacy: '隐私政策',
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ok'; data: LegalDocActiveView }

export function LegalDocsModal({
  initialDoc,
  onClose,
}: {
  initialDoc: LegalDocKind
  onClose: () => void
}) {
  const [doc, setDoc] = useState<LegalDocKind>(initialDoc)
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    getActiveLegalDoc(LEGAL_DOC_TYPE[doc])
      .then((data) => {
        if (cancelled) return
        if (!data?.content?.trim()) setState({ status: 'error' })
        else setState({ status: 'ok', data })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [doc])

  const title = state.status === 'ok' ? state.data.title : DOC_TITLE[doc]
  const versionLabel = state.status === 'ok' ? state.data.version : null

  return (
    <div className="c-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="c-modal-card wide">
        <div className="c-modal-head">
          <div>
            <h3>{title}</h3>
            <p>{versionLabel ? `当前有效版本 ${versionLabel}` : '读取当前有效版本'}</p>
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label="关闭">
            <XIcon size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="c-doc-tabs">
          <button type="button" className={doc === 'terms' ? 'on' : ''} onClick={() => setDoc('terms')}>
            用户服务协议
          </button>
          <button type="button" className={doc === 'privacy' ? 'on' : ''} onClick={() => setDoc('privacy')}>
            隐私政策
          </button>
        </div>

        <div className="c-doc">
          {state.status === 'loading' && <p>正在加载法务文档…</p>}
          {state.status === 'error' && <p className="c-doc-error">法务文档加载失败</p>}
          {state.status === 'ok' &&
            state.data.content
              .split(/\n{2,}/)
              .map((paragraph) => paragraph.trim())
              .filter(Boolean)
              .map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        </div>
      </div>
    </div>
  )
}

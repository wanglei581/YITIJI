import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@ai-job-print/ui'
import type { MemberDocumentItem, MemberResumeItem } from '@ai-job-print/shared'
import { FolderOpenIcon, Loader2Icon } from 'lucide-react'
import { useAuth } from '../../../../auth/useAuth'
import { getMyDocuments, getMyResumes } from '../../../../services/api/memberAssets'
import { CareerPlanSection } from './CareerPlanSection'

type MaterialsView = 'signed-out' | 'loading' | 'ready' | 'error'

const SIGNED_OUT_COPY = '登录后可看到你已保存的材料。未登录时不会查询会员文件。'
const SOURCE_COPY =
  '这一栏来自你已保存的文件，是事实清单，不经过模型。页头「依据」说的是这份规划根据什么生成，和这里不是一回事。'
const ERROR_COPY = '材料列表这次没读到，可以重试。下面三栏来自求职方案，互不影响。'

function resumeKindLabel(kind: MemberResumeItem['kind']): string {
  if (kind === 'parse') return '上传诊断'
  if (kind === 'generate') return '引导生成'
  return '简历记录'
}

export function CareerPlanExistingMaterials() {
  const navigate = useNavigate()
  const { isLoggedIn, getToken } = useAuth()
  const [view, setView] = useState<MaterialsView>(isLoggedIn ? 'loading' : 'signed-out')
  const [resumes, setResumes] = useState<MemberResumeItem[]>([])
  const [resumeTotal, setResumeTotal] = useState(0)
  const [documents, setDocuments] = useState<MemberDocumentItem[]>([])
  const [documentTotal, setDocumentTotal] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!isLoggedIn) {
      setView('signed-out')
      setResumes([])
      setResumeTotal(0)
      setDocuments([])
      setDocumentTotal(0)
      return
    }
    const token = getToken()
    if (!token) {
      setView('signed-out')
      return
    }
    let cancelled = false
    setView('loading')
    Promise.all([
      getMyResumes(token, { pageSize: 20 }),
      getMyDocuments(token, { pageSize: 20 }),
    ])
      .then(([resumePage, documentPage]) => {
        if (cancelled) return
        setResumes(resumePage.items)
        setResumeTotal(resumePage.total)
        setDocuments(documentPage.items)
        setDocumentTotal(documentPage.total)
        setView('ready')
      })
      .catch(() => {
        if (!cancelled) setView('error')
      })
    return () => { cancelled = true }
  }, [getToken, isLoggedIn, reloadKey])

  const goDocuments = () => navigate('/me/documents')

  return (
    <CareerPlanSection title="已有材料" Icon={FolderOpenIcon} column="materials">
      <div data-career-plan-materials-state={view}>
        {view === 'signed-out' ? (
          <p className="career-plan-lightflow__materials-note">{SIGNED_OUT_COPY}</p>
        ) : null}

        {view === 'loading' ? (
          <p className="career-plan-lightflow__materials-note" role="status" aria-live="polite">
            <Loader2Icon className="career-plan-lightflow__button-spinner" aria-hidden="true" />
            正在读取你已保存的材料
          </p>
        ) : null}

        {view === 'error' ? (
          <div className="career-plan-lightflow__stack">
            <p className="career-plan-lightflow__materials-note" role="alert">{ERROR_COPY}</p>
            <div className="career-plan-lightflow__next-actions">
              <Button
                size="lg"
                className="career-plan-lightflow__materials-exit"
                onClick={() => setReloadKey((key) => key + 1)}
              >
                重新读取材料
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="career-plan-lightflow__materials-exit"
                onClick={goDocuments}
              >
                去我的文档
              </Button>
            </div>
          </div>
        ) : null}

        {view === 'ready' ? (
          <div className="career-plan-lightflow__stack">
            <p className="career-plan-lightflow__materials-note">{SOURCE_COPY}</p>
            <p className="career-plan-lightflow__materials-counts">
              已保存简历 {resumeTotal} 份
              {resumes.length > 0 ? `（${resumes.map((item) => resumeKindLabel(item.kind)).join('、')}）` : ''}
              ；已保存文档 {documentTotal} 份。
            </p>
            {documents.length > 0 ? (
              <ul className="career-plan-lightflow__materials-files">
                {documents.slice(0, 5).map((doc) => (
                  <li key={doc.id}>{doc.filename}</li>
                ))}
              </ul>
            ) : null}
            {documentTotal > documents.length ? (
              <p className="career-plan-lightflow__muted">其余文件在「我的文档」里查看。</p>
            ) : null}
            <Button
              size="lg"
              variant="secondary"
              className="career-plan-lightflow__materials-exit"
              onClick={goDocuments}
            >
              去我的文档
            </Button>
          </div>
        ) : null}
      </div>
    </CareerPlanSection>
  )
}

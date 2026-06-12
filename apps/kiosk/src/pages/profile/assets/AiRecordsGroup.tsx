// AI 服务记录（C-2D）：解析 / 优化 / 生成 / 岗位匹配 如实区分。
// 删除：两步确认 → DELETE /me/ai-records/:id（硬删；parse 级联删同任务 optimize 行，
// 服务端审计留痕）。删除后简历组可能联动变化 → 由父级回调一并刷新。
//
// 模拟面试记录接入「我的」AI服务记录口径（闭环补丁，零新模型）：
// 复用既有 GET/DELETE /me/mock-interviews（归属/审计已验收），在本组顶部并列展示
// 「模拟面试报告」条目（仅元数据：岗位/面试官/时间/状态，绝不含回答正文/转写）；
// 查看报告 → /interview/report（凭会员 token 走原归属校验）；「查看全部」互链
// /interview/reports。匿名不展示（账号资产区本就仅登录态渲染，不伪装跨会话资产）。

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { MemberAiRecordItem, MemberInterviewItem } from '@ai-job-print/shared'
import { EyeIcon, MicIcon, SparklesIcon } from 'lucide-react'
import { useAuth } from '../../../auth/useAuth'
import { deleteMyAiRecord } from '../../../services/api/memberAssets'
import { deleteMyInterview, getMyInterviews } from '../../../services/api/interview'
import { AI_KIND_LABEL, aiStatusLabel, formatTime } from './format'
import { AssetGroupShell, AssetRow, TwoStepDeleteButton } from './ui'
import type { AssetGroupHandle } from './useMemberAssetGroups'

export function AiRecordsGroup({
  group,
  onDeleted,
  onToast,
}: {
  group: AssetGroupHandle<MemberAiRecordItem>
  /** 删除成功后回调（父级刷新简历组：级联删除可能摘掉 parse/optimize 行） */
  onDeleted: (record: MemberAiRecordItem) => void
  onToast: (msg: string) => void
}) {
  const { getToken, isLoggedIn } = useAuth()
  const navigate = useNavigate()

  // ── 模拟面试报告（独立加载，失败只影响本子区，不阻塞 AI 记录列表）──
  const [interviews, setInterviews] = useState<MemberInterviewItem[]>([])
  const [interviewsError, setInterviewsError] = useState(false)

  const loadInterviews = useCallback(() => {
    if (!isLoggedIn) return
    setInterviewsError(false)
    getMyInterviews(getToken())
      .then((r) => setInterviews(r.items))
      .catch(() => setInterviewsError(true))
  }, [isLoggedIn, getToken])

  useEffect(() => { loadInterviews() }, [loadInterviews])

  const removeInterview = async (it: MemberInterviewItem) => {
    const token = getToken()
    if (!token) return
    try {
      await deleteMyInterview(token, it.sessionId)
      setInterviews((prev) => prev.filter((x) => x.sessionId !== it.sessionId))
      onToast('面试练习记录已删除')
    } catch {
      onToast('删除失败，请稍后重试')
    }
  }

  const remove = async (record: MemberAiRecordItem) => {
    const token = getToken()
    if (!token) return
    try {
      const res = await deleteMyAiRecord(token, record.id)
      if (res.deletedCount > 1) {
        // parse 级联删了同任务 optimize 行：本地摘单行会留下幽灵行，整组重载
        group.reload()
      } else {
        group.removeLocal(record.id)
      }
      onDeleted(record)
      onToast(res.deletedCount > 1 ? 'AI 记录已删除（含派生的优化记录）' : 'AI 记录已删除')
    } catch {
      onToast('删除失败，请稍后重试')
    }
  }

  return (
    <AssetGroupShell
      title="AI 服务记录"
      group={group}
      empty="暂无 AI 服务记录"
      beforeRows={
        (interviews.length > 0 || interviewsError) && (
          <div className="mb-1 rounded-xl bg-violet-50/40 px-1 py-1">
            <div className="flex items-center justify-between px-1 py-1">
              <p className="text-xs font-medium text-violet-700">模拟面试报告</p>
              <button
                type="button"
                onClick={() => navigate('/interview/reports')}
                className="min-h-[40px] rounded-lg px-2 text-xs font-medium text-primary-600 hover:bg-primary-50"
              >
                查看全部
              </button>
            </div>
            {interviewsError ? (
              <div className="flex items-center justify-between px-1 pb-1.5 text-xs">
                <span className="text-gray-500">面试记录加载失败</span>
                <button
                  type="button"
                  onClick={loadInterviews}
                  className="min-h-[40px] rounded-lg border border-gray-200 px-3 font-medium text-primary-600 hover:bg-primary-50"
                >
                  重试
                </button>
              </div>
            ) : (
              <div className="divide-y divide-violet-100/60">
                {interviews.slice(0, 3).map((it) => (
                  <AssetRow
                    key={it.sessionId}
                    icon={MicIcon}
                    iconBg="bg-violet-100"
                    iconColor="text-violet-600"
                    name={`模拟面试报告 · ${it.position} · ${it.interviewerLabel}`}
                    meta={`${formatTime(it.createdAt)} · 已完成${it.hasReport ? '' : ' · 报告已过期'}`}
                  >
                    {it.hasReport && (
                      <button
                        type="button"
                        onClick={() => navigate('/interview/report', { state: { sessionId: it.sessionId } })}
                        className="flex min-h-[48px] shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-3 text-sm font-medium text-primary-600 transition-colors hover:bg-primary-50"
                      >
                        <EyeIcon className="h-4 w-4" aria-hidden="true" />
                        查看报告
                      </button>
                    )}
                    <TwoStepDeleteButton title="删除面试记录" onConfirm={() => void removeInterview(it)} />
                  </AssetRow>
                ))}
                {interviews.length > 3 && (
                  <p className="px-1 py-1.5 text-xs text-gray-400">还有 {interviews.length - 3} 条，点「查看全部」查看</p>
                )}
              </div>
            )}
          </div>
        )
      }
      renderRow={(a) => (
        <AssetRow
          key={a.id}
          icon={SparklesIcon}
          iconBg="bg-violet-50"
          iconColor="text-violet-600"
          name={`${AI_KIND_LABEL[a.kind] ?? a.kind} · ${aiStatusLabel(a.status)}`}
          meta={formatTime(a.createdAt)}
        >
          <TwoStepDeleteButton title="删除记录" onConfirm={() => void remove(a)} />
        </AssetRow>
      )}
    />
  )
}

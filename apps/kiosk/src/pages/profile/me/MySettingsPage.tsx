// ============================================================
// 账号设置（轻量版）— /me/settings。
//
// 范围（P0a）：只读账号状态 + 会话说明 + 协议/隐私入口 + 退出登录 / 切换账号。
// 明确不做：昵称修改、手机号换绑、账号注销、账号合并、多角色身份切换。
//
// 诚实化与合规：
// - 登录态只展示后端已脱敏手机号（phoneMasked），绝不展示原始号码。
// - 公共终端：登录态仅存内存，刷新/超时/退出即清除，不写任何浏览器存储。
// - 「身份切换」= 退出当前账号后用另一手机号重新登录；退出会清空内存会话，
//   不会把上一账号数据带入下一账号，避免数据串号。
// ============================================================

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import {
  BadgeCheckIcon,
  ChevronRightIcon,
  FileTextIcon,
  LogInIcon,
  LogOutIcon,
  RepeatIcon,
  ShieldCheckIcon,
  ShieldQuestionIcon,
  SmartphoneIcon,
  UserRoundIcon,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../../../auth/useAuth'

// 退出 / 切换账号确认弹层：公共终端二次确认，避免误触清空会话。
function ConfirmOverlay({
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-action-title"
        aria-describedby="account-action-desc"
        className="w-[22rem] max-w-full rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="account-action-title" className="text-base font-semibold text-gray-900">{title}</p>
        <p id="account-action-desc" className="mt-2 text-sm leading-relaxed text-gray-500">{description}</p>
        <div className="mt-5 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onCancel}>
            取消
          </Button>
          <Button className="flex-1" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

function LinkRow({
  icon: Icon,
  iconBg,
  iconColor,
  label,
  desc,
  onClick,
}: {
  icon: LucideIcon
  iconBg: string
  iconColor: string
  label: string
  desc?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[64px] w-full items-center gap-3 border-t border-gray-100 py-3.5 text-left first:border-t-0"
    >
      <span className={['flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', iconBg].join(' ')}>
        <Icon className={['h-5 w-5', iconColor].join(' ')} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-gray-800">{label}</span>
        {desc && <span className="mt-0.5 block text-xs text-gray-400">{desc}</span>}
      </span>
      <ChevronRightIcon className="h-5 w-5 shrink-0 text-gray-300" aria-hidden="true" />
    </button>
  )
}

const cardSurface = 'rounded-2xl border border-neutral-200 bg-white px-5 shadow-sm'

export function MySettingsPage() {
  const navigate = useNavigate()
  const { user, isLoggedIn, logout } = useAuth()
  const [confirm, setConfirm] = useState<'logout' | 'switch' | null>(null)

  const phoneMasked = user?.phoneMasked ?? ''

  // 退出登录：清空内存会话后回到「我的」（游客态）。
  const handleLogout = () => {
    setConfirm(null)
    logout()
    navigate('/profile')
  }

  // 切换账号：退出当前账号 → 直达登录页用另一手机号登录。先 logout 清空内存会话，避免数据串号。
  const handleSwitch = () => {
    setConfirm(null)
    logout()
    navigate('/login', { state: { from: '/profile' } })
  }

  return (
    <div className="flex h-full flex-col px-6 pt-6">
      <PageHeader
        title="账号设置"
        subtitle="账号状态 · 会话说明 · 协议与隐私"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/profile')}>
            返回我的
          </Button>
        }
      />

      <div className="mt-4 flex-1 overflow-y-auto pb-8">
        <div className="flex flex-col gap-4">
          {/* 账号状态 */}
          {isLoggedIn ? (
            <div className={`${cardSurface} py-5`}>
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-600">
                  <SmartphoneIcon className="h-7 w-7" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-bold text-gray-900">{phoneMasked || '已登录用户'}</p>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-600">
                      <BadgeCheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      已登录
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-500">会员账号 · 手机号已脱敏展示，仅本人可见</p>
                </div>
              </div>
            </div>
          ) : (
            <div className={`${cardSurface} py-5`}>
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400">
                  <UserRoundIcon className="h-7 w-7" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-bold text-gray-900">游客</p>
                  <p className="mt-1 text-sm text-gray-500">登录后用于绑定本人服务记录，仅本次会话有效</p>
                </div>
                <Button
                  size="lg"
                  className="flex h-12 shrink-0 items-center gap-1 px-4"
                  onClick={() => navigate('/login', { state: { from: '/me/settings' } })}
                >
                  <LogInIcon className="h-5 w-5" aria-hidden="true" />
                  手机号登录
                </Button>
              </div>
            </div>
          )}

          {/* 会话说明 */}
          <Card className="flex items-start gap-3 p-5">
            <ShieldCheckIcon className="h-5 w-5 shrink-0 text-primary-600" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900">公共终端会话说明</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">
                本终端为公共设备，登录状态只保存在当前会话内存中，不写入本机存储。页面刷新、离开或闲置超时会自动退出登录并清除会话信息。请勿在终端上留存个人物品与文件。
              </p>
            </div>
          </Card>

          {/* 协议 / 隐私入口 */}
          <section aria-label="协议与隐私" className={`${cardSurface} py-1`}>
            <LinkRow
              icon={FileTextIcon}
              iconBg="bg-primary-50"
              iconColor="text-primary-600"
              label="用户服务协议"
              desc="服务范围、账号、收费与打印说明"
              onClick={() => navigate('/legal/terms')}
            />
            <LinkRow
              icon={ShieldCheckIcon}
              iconBg="bg-cyan-50"
              iconColor="text-cyan-600"
              label="隐私政策"
              desc="信息收集、使用与文件留存说明"
              onClick={() => navigate('/legal/privacy')}
            />
          </section>

          {/* 账号操作（仅登录态） */}
          {isLoggedIn && (
            <section aria-label="账号操作" className={`${cardSurface} py-1`}>
              <LinkRow
                icon={RepeatIcon}
                iconBg="bg-indigo-50"
                iconColor="text-indigo-600"
                label="切换账号"
                desc="退出当前账号后用另一手机号登录"
                onClick={() => setConfirm('switch')}
              />
              <button
                type="button"
                onClick={() => setConfirm('logout')}
                className="flex min-h-[64px] w-full items-center gap-3 border-t border-gray-100 py-3.5 text-left"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50">
                  <LogOutIcon className="h-5 w-5 text-rose-500" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 text-sm font-semibold text-rose-600">退出登录</span>
                <ChevronRightIcon className="h-5 w-5 shrink-0 text-gray-300" aria-hidden="true" />
              </button>
            </section>
          )}

          {/* 暂不开放说明（诚实化：避免被误以为可改资料 / 注销） */}
          <div className="flex items-start gap-3 rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4">
            <ShieldQuestionIcon className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
            <p className="text-xs leading-relaxed text-gray-500">
              昵称修改、手机号换绑、账号注销等功能暂未开放。如需协助，请联系现场工作人员。
            </p>
          </div>
        </div>
      </div>

      {confirm === 'logout' && (
        <ConfirmOverlay
          title="退出登录"
          description="退出后将清除本次会话的登录状态，返回游客模式。本人记录已保存在账号下，下次登录仍可查看。"
          confirmLabel="退出登录"
          onConfirm={handleLogout}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'switch' && (
        <ConfirmOverlay
          title="切换账号"
          description="将退出当前账号并前往登录页，使用另一手机号登录。当前会话信息会被清除，不会带入下一个账号。"
          confirmLabel="退出并切换"
          onConfirm={handleSwitch}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@ai-job-print/ui'
import { Building2Icon } from 'lucide-react'
import { login, getToken } from '../../services/auth'

export default function LoginPage() {
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  useEffect(() => {
    if (getToken()) {
      nav('/', { replace: true })
    }
  }, [nav])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (loading) return
    setError(null)
    setLoading(true)
    const r = await login(username.trim(), password)
    setLoading(false)
    if (r.ok) {
      // 校验角色:本入口只允许 partner
      if (r.user.role !== 'partner') {
        setError(`当前账号角色为 ${r.user.role},不允许登录合作机构后台`)
        // 防误登:清掉刚才存的 token
        localStorage.removeItem('partner_auth_v1')
        return
      }
      nav('/', { replace: true })
      return
    }
    if (r.code === 'ThrottlerException: Too Many Requests' || r.code === 'HTTP_429') {
      setError('登录请求过于频繁,请稍后再试')
      return
    }
    setError(r.message || r.code || '登录失败')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50">
            <Building2Icon className="h-5 w-5 text-primary-600" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">合作机构登录</h1>
            <p className="text-xs text-neutral-500">AI 求职打印服务终端</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-neutral-700">账号</span>
            <input
              type="text"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="h-10 rounded-lg border border-neutral-300 px-3 text-sm focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-200"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-neutral-700">密码</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-10 rounded-lg border border-neutral-300 px-3 text-sm focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-200"
            />
          </label>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <Button type="submit" variant="primary" size="md" disabled={loading} className="mt-2">
            {loading ? '登录中…' : '登录'}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-neutral-400">
          dev 账号:partner1 / partner1
        </p>
      </div>
    </div>
  )
}

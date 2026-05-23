export type UserRole = 'admin' | 'partner_staff' | 'user' | 'guest'

export interface User {
  id: string
  role: UserRole
  phone: string
  createdAt: string
}

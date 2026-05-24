import { AdminLayout, type AdminLayoutProps } from './AdminLayout'

export interface PartnerLayoutProps extends Omit<AdminLayoutProps, 'appName'> {
  /** Organisation display name shown in the sidebar. */
  orgName?: string
}

/**
 * Wraps AdminLayout with partner-appropriate defaults.
 * Identical structure to AdminLayout — only branding differs.
 * Phase 6 will add partner-specific nav items and permission guards.
 */
export function PartnerLayout({ orgName = '合作机构', ...props }: PartnerLayoutProps) {
  return <AdminLayout appName={orgName} {...props} />
}

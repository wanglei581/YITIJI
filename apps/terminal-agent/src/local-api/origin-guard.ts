export function allowedOrigins(configured?: string[]): string[] {
  return [...new Set((configured ?? []).map((item) => item.trim()).filter(Boolean))]
}

export function isOriginAllowed(origin: string | undefined, allowed: string[]): origin is string {
  if (!origin) return false
  return allowed.includes(origin)
}

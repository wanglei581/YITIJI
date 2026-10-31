/** ScanTaskFileView.fileUrl is an internal HMAC content URL, even with object storage. */
export function takeawayUrlOf(fileUrl: string, origin: string): { url: string; expiresAt: string } | null {
  try {
    const url = new URL(fileUrl, origin)
    const expires = url.searchParams.getAll('expires')
    const signatures = url.searchParams.getAll('sig')
    if (url.origin !== origin || url.username || url.password || url.hash ||
        !/^\/api\/v1\/files\/[^/]+\/content$/.test(url.pathname) ||
        expires.length !== 1 || !/^\d+$/.test(expires[0]) ||
        signatures.length !== 1 || !/^[a-f0-9]{64}$/i.test(signatures[0])) return null
    const millis = Number(expires[0])
    if (!Number.isSafeInteger(millis) || millis <= 0 || millis > 8_640_000_000_000_000) return null
    // Expired but well-formed links remain distinguishable for the expiry message.
    return { url: url.toString(), expiresAt: new Date(millis).toISOString() }
  } catch {
    return null
  }
}

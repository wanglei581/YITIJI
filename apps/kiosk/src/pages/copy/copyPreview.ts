/** 每一组预览独占请求和 URL；换页、重扫、到期及清场同步撤销。 */
export class CopyPreview {
  private controller = new AbortController()
  private urls: string[] = []
  clear(): void {
    this.controller.abort()
    for (const url of this.urls) URL.revokeObjectURL(url)
    this.urls = []
    this.controller = new AbortController()
  }
  async load(pages: number[], fetcher: (page: number, signal: AbortSignal) => Promise<Blob>): Promise<string[]> {
    this.clear()
    const controller = this.controller
    const urls: string[] = []
    try {
      for (const page of pages) {
        const blob = await fetcher(page, controller.signal)
        if (controller.signal.aborted) throw new Error('COPY_PREVIEW_ABORTED')
        const url = URL.createObjectURL(blob)
        this.urls.push(url)
        urls.push(url)
      }
      return urls
    } catch (error) {
      if (this.controller === controller) this.clear()
      throw error
    }
  }
}

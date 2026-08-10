declare module '@baiducloud/sdk' {
  type BosResponse = {
    body?: Buffer
    http_headers?: Record<string, string | undefined>
  }

  export class Auth {
    constructor(accessKeyId: string, secretAccessKey: string)
    generateAuthorization(
      method: string,
      resource: string,
      params?: Record<string, unknown>,
      headers?: Record<string, unknown>,
      timestamp?: number,
      expirationInSeconds?: number,
      headersToSign?: readonly string[],
    ): string
  }

  export class BosClient {
    constructor(config: {
      endpoint: string
      credentials: { ak: string; sk: string }
      pathStyleEnable?: boolean
    })
    putObject(
      bucket: string,
      key: string,
      body: Buffer,
      options?: Record<string, unknown>,
    ): Promise<BosResponse>
    getObject(bucket: string, key: string): Promise<BosResponse>
    getObjectMetadata(bucket: string, key: string): Promise<BosResponse>
    deleteObject(bucket: string, key: string): Promise<BosResponse>
  }
}

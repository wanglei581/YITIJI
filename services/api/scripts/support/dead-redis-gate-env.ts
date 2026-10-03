/**
 * 两条「Redis 指到死端口」门禁共用的等待上限。
 *
 * 不写进 verify-redis-degradation-truth.ts：那个文件已经超过 500 行，
 * 而且 verify:error-observability 要同一组值，复制一份会漂。
 *
 * 只缩短「连不上之后还要干等多久」。端口仍是死的，命令仍会真的失败，
 * 健康检查和 5xx 仍走真实 src/main.ts。不断言、不换桩。
 */
export function deadRedisGateEnv(redisUrl: string): Record<string, string> {
  return {
    REDIS_URL: redisUrl,
    // 第一次断连就放弃本条命令。不设时是 ioredis 默认 20：
    // 新连接大约 10.5 秒才失败；启动期退避顶到 2 秒后，下一条命令还要再等将近 40 秒。
    // 0 仍是真的 ECONNREFUSED → MaxRetriesPerRequestError，不是桩。
    REDIS_MAX_RETRIES_PER_REQUEST: '0',
    // BullMQ 自建连接把 maxRetriesPerRequest 钉死为 null，上面的变量管不到。
    // 死端口上调度注册永远不会成功，这里只把干等上限从 8 秒降到 250 毫秒。
    MEMBER_PRIVACY_SCHEDULER_TIMEOUT_MS: '250',
    // PING 在命令立刻失败时到不了默认的 5 秒。留短上限，避免退回干等满默认值。
    REDIS_BOOT_PROBE_TIMEOUT_MS: '400',
  }
}

# nginx https 改造草案（支付回调可达，W-D ①）

> **草案，未经真机/真实商户验证。** 2026-07-06 起草。
> 现状：百度云 120.48.13.190，nginx 监听 80(kiosk) / 8081(admin) / 8082(partner)，API 为 PM2 单实例监听 127.0.0.1:3010，**无域名无 https**。
> 目标：渠道回调 `https://<域名>/api/v1/payment/callback/{wechat|alipay}` 可达且验签通过（微信/支付宝生产回调均要求 https，且本项目启动门禁强制 `PAYMENT_NOTIFY_BASE_URL` 为 https）。
> 代码事实：回调验签基于**原始请求字节**（`services/api/src/config/body-parsers.ts` 对 `/api/v1/payment/callback/` 前缀捕获 rawBody；微信为 JSON、支付宝为 form-urlencoded）——**任何改写 body 的反代行为都会让验签必然失败**。

---

## 1. 前置条件（顺序执行，全部完成才能进 §2）

1. 购买/复用一个域名（如已有已备案域名，可用其子域过渡，见方案文档 §六风险表）。
2. **ICP 备案**：服务器在境内（百度云），域名解析到 120.48.13.190 并提供 web 服务必须完成备案；备案周期数周，须与商户申请并行启动。〔待确认：是否已有可复用的已备案域名〕
3. DNS 解析：为选定域名（下文以 `pay.example.com` 占位，**非真实值**）添加 A 记录 → `120.48.13.190`，TTL 建议 600。
4. 百度云安全组放行 TCP 443（80 已放行）。
5. 服务器时间同步确认（`timedatectl` 显示 NTP synchronized）：微信/支付宝回调均有 ±5 分钟时间窗校验，时钟漂移会拒回调。

---

## 2. 证书获取（两条路径二选一）

### 路径 A：certbot / Let's Encrypt（免费，90 天自动续期）

```bash
# 以 Ubuntu/Debian 为例；CentOS 用 dnf/yum 对应包
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d pay.example.com
# 验证自动续期
sudo certbot renew --dry-run
```

- certbot 的 `--nginx` 插件会临时用 80 端口做 HTTP-01 验证并自动写入 443 server 块；如不想让它改配置，用 `certbot certonly --webroot` 后手工按 §3 配置。
- 注意：80 端口当前被 kiosk 站占用——HTTP-01 验证要求 `http://pay.example.com/.well-known/acme-challenge/` 可达。若 kiosk server 块是 `default_server`（按 IP 访问），只需为 `pay.example.com` 增加独立 server 块即可，互不影响（见 §5）。

### 路径 B：云证书（百度云 SSL 证书，免费 DV 版一年）

1. 百度云控制台 → SSL 证书 → 申请免费 DV 证书 → 域名验证（DNS TXT 记录方式，不占用 80 端口）。
2. 下载 nginx 格式证书包（`.crt` 全链 + `.key`），上传服务器如 `/etc/nginx/ssl/pay.example.com/`，权限 `600`、属主 root。
3. 到期前须手工换发（免费版一年）；建议设日历提醒。〔待确认：百度云当前免费证书有效期政策〕

> 两条路径均产出：`ssl_certificate`（全链证书）与 `ssl_certificate_key`。微信/支付宝回调发起方要求证书为**受信任 CA 签发且证书链完整**——自签证书不可用；证书链不全（缺中间证书）是回调收不到的常见原因。

---

## 3. 443 server 块示例（支付回调专用域名）

写入 `/etc/nginx/conf.d/payment-callback.conf`（文件名可调整；与现有 kiosk/admin/partner 配置分离，避免误改）：

```nginx
server {
    listen 443 ssl;
    http2 on;                                  # nginx < 1.25 用 “listen 443 ssl http2;”
    server_name pay.example.com;               # ← 换成真实域名

    ssl_certificate     /etc/nginx/ssl/pay.example.com/fullchain.crt;
    ssl_certificate_key /etc/nginx/ssl/pay.example.com/private.key;
    ssl_protocols       TLSv1.2 TLSv1.3;       # 微信支付要求 TLS ≥ 1.2
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_session_timeout 10m;

    # ── 支付回调：反代到本机 API，body 一个字节都不能动 ──────────────
    location /api/v1/payment/callback/ {
        proxy_pass http://127.0.0.1:3010;

        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;

        # 原样透传请求体（验签依赖原始字节）：
        proxy_request_buffering on;    # 默认值；缓冲不改字节，允许
        client_max_body_size 1m;       # 回调报文很小，收紧防滥用

        proxy_connect_timeout 5s;
        proxy_read_timeout    15s;     # API 侧回调处理为同步验签+入账，10s 内完成
    }

    # 该域名只服务支付回调（及未来 API 白名单路径），其余一律 404，
    # 避免把 kiosk/admin 页面暴露在新域名下扩大攻击面。
    location / {
        return 404;
    }
}
```

**禁止出现在该 location（或其继承链）里的指令 / 行为**——任何一条都会改写 body 或签名相关头，导致微信/支付宝验签必然失败：

| 禁止项 | 原因 |
|---|---|
| `sub_filter` / `sub_filter_once` | 直接改写响应/请求内容 |
| `gzip`/`gunzip` 作用于请求体、`proxy_set_body`、`body_filter_by_lua*` 等 | 改写请求体字节 |
| 任何 WAF/安全模块对该路径做「参数清洗/重编码」 | form-urlencoded（支付宝 notify）被重排/重编码即验签失败 |
| `proxy_set_header Content-Type …` 强改类型 | 微信=JSON、支付宝=form-urlencoded，必须原样 |
| 丢弃/改写 `Wechatpay-Timestamp` / `Wechatpay-Nonce` / `Wechatpay-Signature` / `Wechatpay-Serial` 请求头 | 微信回调验签四要素；nginx 默认透传带连字符的头，不要配置 `proxy_hide_header`/`ignore_headers` 波及它们 |
| 在该路径上做 30x 跳转（含 §4 的 80→443 跳转以外的任何跳转） | 渠道回调 POST 不跟随跳转，回调即失败 |

> `underscores_in_headers` 无需开启（微信头是连字符不是下划线）。
> 百度云若启用了 CDN/WAF 挂在该域名前，须确认其不缓存、不改写 POST——建议回调域名**直连源站不过 CDN**。〔待确认〕

## 4. 80 端口跳转策略

现状 80 端口是 kiosk 站（按 IP 访问）。**不要做全局 80→443 跳转**，只对支付域名的 server_name 生效：

```nginx
server {
    listen 80;
    server_name pay.example.com;               # ← 只匹配支付域名，不影响按 IP 访问的 kiosk

    # certbot HTTP-01 续期验证路径保持可达（路径 A 时需要）：
    location /.well-known/acme-challenge/ { root /var/www/certbot; }

    location / { return 301 https://$host$request_uri; }
}
```

- 现有 kiosk 的 80 server 块保持不动（它应是 `default_server` 或 `server_name _`/IP）。
- 渠道回调直接配置 https URL（`PAYMENT_NOTIFY_BASE_URL=https://pay.example.com`），不依赖 80 跳转；80 跳转只服务浏览器人工访问与 certbot。
- 后续若 kiosk/admin/partner 也迁 https，另行规划，不在本草案范围。

## 5. 与现有三个站点的共存检查

1. `nginx -t` 通过后 `nginx -s reload`（不重启，不断 kiosk 服务）。
2. 确认 `curl -I http://120.48.13.190/` 仍返回 kiosk 页面（80 按 IP 访问不受影响）。
3. 确认 8081/8082 不变。
4. 新 443 块的 `server_name` 精确匹配，不设 `default_server`，避免劫持未来其他域名。

## 6. 上线前验证步骤（逐条执行并记录）

```bash
# ① DNS 生效
dig +short pay.example.com          # 期望输出 120.48.13.190

# ② TLS 握手与协议版本（期望 TLSv1.2 成功、TLSv1.3 成功、TLSv1.1 失败）
openssl s_client -connect pay.example.com:443 -tls1_2 </dev/null | head -5
openssl s_client -connect pay.example.com:443 -tls1_3 </dev/null | head -5
openssl s_client -connect pay.example.com:443 -tls1_1 </dev/null | head -5

# ③ 证书链完整（期望 Verify return code: 0 (ok)）
openssl s_client -connect pay.example.com:443 -servername pay.example.com </dev/null 2>/dev/null | grep "Verify return code"

# ④ 回调路径可达（期望：HTTP 4xx 业务拒绝 —— 空体/无签名被 API fail-closed 拒绝
#    即为正确；出现 502/504/超时/301 才是反代问题）
curl -i -X POST https://pay.example.com/api/v1/payment/callback/wechat \
  -H 'Content-Type: application/json' -d '{}'
curl -i -X POST https://pay.example.com/api/v1/payment/callback/alipay \
  -H 'Content-Type: application/x-www-form-urlencoded' -d 'a=1'

# ⑤ 非回调路径被 404（新域名不暴露业务页面）
curl -i https://pay.example.com/

# ⑥ 80 跳转只对支付域名生效
curl -i http://pay.example.com/api/v1/payment/callback/wechat   # 期望 301 → https
curl -I http://120.48.13.190/                                    # 期望仍是 kiosk 200
```

全部通过后：把 `PAYMENT_NOTIFY_BASE_URL=https://pay.example.com` 写入生产 `services/api/.env`（见 env 清单草案），`pm2 restart` 并确认启动门禁通过。最终「验签通过」只能由 1 分钱 live 冒烟（W-F）证明。

## 7. 待确认项

| # | 事项 |
|---|---|
| 1 | 域名与备案：用新域名还是已备案域名子域过渡；备案完成时间 |
| 2 | 证书路径选 A（certbot）还是 B（百度云证书）；免费证书有效期政策 |
| 3 | 该域名是否会挂百度云 CDN/WAF；如挂，须验证不改写 POST body（建议直连源站） |
| 4 | 服务器 nginx 实际版本（决定 `http2 on;` 写法）与现有配置文件组织方式（conf.d vs sites-enabled） |
| 5 | 回调域名是否复用为后续 kiosk/admin https 域名，或支付独立子域 |

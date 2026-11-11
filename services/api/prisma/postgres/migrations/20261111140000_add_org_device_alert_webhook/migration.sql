-- 机构设备告警通知地址（加密后的群机器人地址）。空 = 未配置，不推送、不报错。
ALTER TABLE "Organization" ADD COLUMN "deviceAlertWebhookEnc" TEXT;

-- AlterTable: EndUser 增加微信小程序 openid 字段
-- 仅服务端使用；前端不得持有；不存 sessionKey；null = 未绑定微信。
-- PostgreSQL 的 UNIQUE INDEX 原生允许多个 NULL，无需 WHERE 部分索引。
ALTER TABLE "EndUser" ADD COLUMN "wxOpenId" TEXT;
CREATE UNIQUE INDEX "EndUser_wxOpenId_key" ON "EndUser"("wxOpenId");

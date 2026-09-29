-- 机构账号：管理员登记联系人手机号（尚未本人短信自证），以及机构联系人手机的变更时间（24 小时冷却）。
ALTER TABLE "User" ADD COLUMN "phoneRegisteredByAdminAt" DATETIME;
ALTER TABLE "Organization" ADD COLUMN "contactPhoneChangedAt" DATETIME;

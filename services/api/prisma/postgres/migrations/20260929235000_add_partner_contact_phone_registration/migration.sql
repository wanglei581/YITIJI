-- 机构账号：管理员登记联系人手机号（尚未本人短信自证），以及机构联系人手机的变更时间（24 小时冷却）。
ALTER TABLE "User" ADD COLUMN "phoneRegisteredByAdminAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN "contactPhoneChangedAt" TIMESTAMP(3);

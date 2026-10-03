-- FileObject hard deletion must not discard failed physical deletions.
CREATE TABLE "StorageDeletion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "storageKey" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "StorageDeletion_storageKey_key" ON "StorageDeletion"("storageKey");

-- Reject late writes from requests/jobs authenticated before the closure started.
CREATE TRIGGER "PrintTask_closed_member_insert" BEFORE INSERT ON "PrintTask"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "PrintTask_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "PrintTask"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "ScanTask_closed_member_insert" BEFORE INSERT ON "ScanTask"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "ScanTask_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "ScanTask"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "Order_closed_member_insert" BEFORE INSERT ON "Order"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "Order_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "Order"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "OrderSubmissionLedger_closed_member_insert" BEFORE INSERT ON "OrderSubmissionLedger"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "OrderSubmissionLedger_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "OrderSubmissionLedger"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "FileObject_closed_member_insert" BEFORE INSERT ON "FileObject"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "FileObject_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "FileObject"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "DocumentProcessTask_closed_member_insert" BEFORE INSERT ON "DocumentProcessTask"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "DocumentProcessTask_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "DocumentProcessTask"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "ContractReviewTask_closed_member_insert" BEFORE INSERT ON "ContractReviewTask"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "ContractReviewTask_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "ContractReviewTask"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "AiResumeResult_closed_member_insert" BEFORE INSERT ON "AiResumeResult"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "AiResumeResult_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "AiResumeResult"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "JobAiSession_closed_member_insert" BEFORE INSERT ON "JobAiSession"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "JobAiSession_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "JobAiSession"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "AiServiceLog_closed_member_insert" BEFORE INSERT ON "AiServiceLog"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "AiServiceLog_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "AiServiceLog"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "AiUsageRecord_closed_member_insert" BEFORE INSERT ON "AiUsageRecord"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "AiUsageRecord_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "AiUsageRecord"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "UserAiConsent_closed_member_insert" BEFORE INSERT ON "UserAiConsent"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "UserAiConsent_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "UserAiConsent"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "MemberLegalConsent_closed_member_insert" BEFORE INSERT ON "MemberLegalConsent"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "MemberLegalConsent_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "MemberLegalConsent"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "UserDataRequest_closed_member_insert" BEFORE INSERT ON "UserDataRequest"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "UserDataRequest_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "UserDataRequest"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "Favorite_closed_member_insert" BEFORE INSERT ON "Favorite"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "Favorite_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "Favorite"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "JobApplication_closed_member_insert" BEFORE INSERT ON "JobApplication"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "JobApplication_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "JobApplication"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "BenefitGrant_closed_member_insert" BEFORE INSERT ON "BenefitGrant"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "BenefitGrant_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "BenefitGrant"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "BenefitClaim_closed_member_insert" BEFORE INSERT ON "BenefitClaim"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "BenefitClaim_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "BenefitClaim"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "RedemptionRecord_closed_member_insert" BEFORE INSERT ON "RedemptionRecord"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "RedemptionRecord_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "RedemptionRecord"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "MockInterviewSession_closed_member_insert" BEFORE INSERT ON "MockInterviewSession"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "MockInterviewSession_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "MockInterviewSession"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "BrowseLog_closed_member_insert" BEFORE INSERT ON "BrowseLog"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "BrowseLog_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "BrowseLog"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "ExternalJumpLog_closed_member_insert" BEFORE INSERT ON "ExternalJumpLog"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "ExternalJumpLog_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "ExternalJumpLog"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "MemberNotification_closed_member_insert" BEFORE INSERT ON "MemberNotification"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "MemberNotification_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "MemberNotification"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "BroadcastReadState_closed_member_insert" BEFORE INSERT ON "BroadcastReadState"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "BroadcastReadState_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "BroadcastReadState"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "FeedbackTicket_closed_member_insert" BEFORE INSERT ON "FeedbackTicket"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "FeedbackTicket_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "FeedbackTicket"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "AdvisorSession_closed_member_insert" BEFORE INSERT ON "AdvisorSession"
WHEN NEW."endUserId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "AdvisorSession_closed_member_bind" BEFORE UPDATE OF "endUserId" ON "AdvisorSession"
WHEN NEW."endUserId" IS NOT NULL AND NEW."endUserId" IS NOT OLD."endUserId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."endUserId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "FileObject_closed_owner_insert" BEFORE INSERT ON "FileObject"
WHEN NEW."ownerType"='user' AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."ownerId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "EndUser_closed_identity_write" BEFORE UPDATE ON "EndUser"
WHEN OLD."status" IN ('closing','anonymized')
AND (NEW."phoneHash" IS NOT OLD."phoneHash" OR NEW."phoneEnc" IS NOT OLD."phoneEnc" OR NEW."wxOpenId" IS NOT OLD."wxOpenId" OR NEW."nickname" IS NOT OLD."nickname")
AND NOT (OLD."status"='closing' AND NEW."status"='anonymized' AND NEW."phoneHash" LIKE 'anonymized:%' AND NEW."phoneEnc" LIKE 'anonymized:%' AND NEW."wxOpenId" IS NULL AND NEW."nickname" IS NULL)
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;

CREATE TRIGGER "FileObject_closed_owner_bind" BEFORE UPDATE OF "ownerId", "ownerType" ON "FileObject"
WHEN NEW."ownerType"='user' AND (NEW."ownerId" IS NOT OLD."ownerId" OR NEW."ownerType" IS NOT OLD."ownerType")
AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."ownerId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "EndUser_closed_status_revive" BEFORE UPDATE OF "status" ON "EndUser"
WHEN (OLD."status" IN ('closing','anonymized') AND NEW."status" NOT IN ('closing','anonymized'))
OR (OLD."status"='anonymized' AND NEW."status"<>'anonymized')
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;

CREATE TRIGGER "UserNotification_closed_member_insert" BEFORE INSERT ON "UserNotification"
WHEN NEW."memberId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."memberId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "UserNotification_closed_member_bind" BEFORE UPDATE OF "memberId" ON "UserNotification"
WHEN NEW."memberId" IS NOT NULL AND NEW."memberId" IS NOT OLD."memberId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."memberId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;

CREATE TRIGGER "KioskSession_closed_member_insert" BEFORE INSERT ON "KioskSession"
WHEN NEW."memberId" IS NOT NULL AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."memberId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;
CREATE TRIGGER "KioskSession_closed_member_bind" BEFORE UPDATE OF "memberId" ON "KioskSession"
WHEN NEW."memberId" IS NOT NULL AND NEW."memberId" IS NOT OLD."memberId" AND EXISTS (SELECT 1 FROM "EndUser" WHERE "id"=NEW."memberId" AND "status" IN ('closing','anonymized'))
BEGIN SELECT RAISE(ABORT, 'MEMBER_CLOSED_WRITE_FORBIDDEN'); END;

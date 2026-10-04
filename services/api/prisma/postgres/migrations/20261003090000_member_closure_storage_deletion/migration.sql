-- FileObject hard deletion must not discard failed physical deletions.
CREATE TABLE "StorageDeletion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "storageKey" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "StorageDeletion_storageKey_key" ON "StorageDeletion"("storageKey");

-- Reject late writes from requests/jobs authenticated before closure, while allowing
-- the executor to update existing retained rows and clear their member association.
CREATE FUNCTION reject_closed_member_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE member_status TEXT;
BEGIN
  IF TG_OP='UPDATE' AND NEW."endUserId" IS NOT DISTINCT FROM OLD."endUserId" THEN RETURN NEW; END IF;
  -- Lock even active accounts: serialize an in-flight insert against entering closing.
  SELECT "status" INTO member_status FROM "EndUser" WHERE "id"=NEW."endUserId" FOR SHARE;
  IF member_status IN ('closing','anonymized') THEN
    RAISE EXCEPTION 'MEMBER_CLOSED_WRITE_FORBIDDEN';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "PrintTask_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "PrintTask" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "ScanTask_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "ScanTask" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "Order_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "Order" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "OrderSubmissionLedger_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "OrderSubmissionLedger" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "FileObject_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "FileObject" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "DocumentProcessTask_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "DocumentProcessTask" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "ContractReviewTask_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "ContractReviewTask" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "AiResumeResult_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "AiResumeResult" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "JobAiSession_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "JobAiSession" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "AiServiceLog_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "AiServiceLog" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "AiUsageRecord_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "AiUsageRecord" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "UserAiConsent_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "UserAiConsent" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "MemberLegalConsent_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "MemberLegalConsent" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "UserDataRequest_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "UserDataRequest" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "Favorite_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "Favorite" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "JobApplication_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "JobApplication" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "BenefitGrant_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "BenefitGrant" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "BenefitClaim_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "BenefitClaim" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "RedemptionRecord_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "RedemptionRecord" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "MockInterviewSession_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "MockInterviewSession" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "BrowseLog_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "BrowseLog" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "ExternalJumpLog_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "ExternalJumpLog" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "MemberNotification_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "MemberNotification" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "BroadcastReadState_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "BroadcastReadState" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "FeedbackTicket_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "FeedbackTicket" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE TRIGGER "AdvisorSession_closed_member_write" BEFORE INSERT OR UPDATE OF "endUserId" ON "AdvisorSession" FOR EACH ROW EXECUTE FUNCTION reject_closed_member_write();
CREATE FUNCTION reject_closed_identity_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" IN ('closing','anonymized') AND
    (NEW."phoneHash" IS DISTINCT FROM OLD."phoneHash" OR NEW."phoneEnc" IS DISTINCT FROM OLD."phoneEnc" OR NEW."wxOpenId" IS DISTINCT FROM OLD."wxOpenId" OR NEW."nickname" IS DISTINCT FROM OLD."nickname") AND NOT
    (OLD."status"='closing' AND NEW."status"='anonymized' AND NEW."phoneHash" LIKE 'anonymized:%' AND NEW."phoneEnc" LIKE 'anonymized:%' AND NEW."wxOpenId" IS NULL AND NEW."nickname" IS NULL) THEN
    RAISE EXCEPTION 'MEMBER_CLOSED_WRITE_FORBIDDEN';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "EndUser_closed_identity_write" BEFORE UPDATE ON "EndUser" FOR EACH ROW EXECUTE FUNCTION reject_closed_identity_write();
CREATE FUNCTION reject_closed_file_owner_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE member_status TEXT;
BEGIN
  IF TG_OP='UPDATE' AND NEW."ownerId" IS NOT DISTINCT FROM OLD."ownerId" AND NEW."ownerType" IS NOT DISTINCT FROM OLD."ownerType" THEN RETURN NEW; END IF;
  IF NEW."ownerType"='user' THEN SELECT "status" INTO member_status FROM "EndUser" WHERE "id"=NEW."ownerId" FOR SHARE; END IF;
  IF member_status IN ('closing','anonymized') THEN
    RAISE EXCEPTION 'MEMBER_CLOSED_WRITE_FORBIDDEN';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "FileObject_closed_owner_insert" BEFORE INSERT OR UPDATE OF "ownerId", "ownerType" ON "FileObject" FOR EACH ROW EXECUTE FUNCTION reject_closed_file_owner_write();


CREATE FUNCTION reject_closed_legacy_member_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE member_status TEXT;
BEGIN
  IF TG_OP='UPDATE' AND NEW."memberId" IS NOT DISTINCT FROM OLD."memberId" THEN RETURN NEW; END IF;
  SELECT "status" INTO member_status FROM "EndUser" WHERE "id"=NEW."memberId" FOR SHARE;
  IF member_status IN ('closing','anonymized') THEN RAISE EXCEPTION 'MEMBER_CLOSED_WRITE_FORBIDDEN'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "UserNotification_closed_member_write" BEFORE INSERT OR UPDATE OF "memberId" ON "UserNotification" FOR EACH ROW EXECUTE FUNCTION reject_closed_legacy_member_write();
CREATE TRIGGER "KioskSession_closed_member_write" BEFORE INSERT OR UPDATE OF "memberId" ON "KioskSession" FOR EACH ROW EXECUTE FUNCTION reject_closed_legacy_member_write();

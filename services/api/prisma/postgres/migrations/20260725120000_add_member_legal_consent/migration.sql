-- G6: MemberLegalConsent — login agreement snapshot linked to LegalDocVersion
CREATE TABLE "MemberLegalConsent" (
    "id" TEXT NOT NULL,
    "endUserId" TEXT NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "privacyVersion" TEXT NOT NULL,
    "termsDocVersionId" TEXT,
    "privacyDocVersionId" TEXT,
    "source" TEXT NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberLegalConsent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MemberLegalConsent_endUserId_createdAt_idx"
  ON "MemberLegalConsent"("endUserId", "createdAt");

ALTER TABLE "MemberLegalConsent"
  ADD CONSTRAINT "MemberLegalConsent_endUserId_fkey"
  FOREIGN KEY ("endUserId") REFERENCES "EndUser"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

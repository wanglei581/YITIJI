-- G6: MemberLegalConsent — login agreement snapshot linked to LegalDocVersion
CREATE TABLE "MemberLegalConsent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endUserId" TEXT NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "privacyVersion" TEXT NOT NULL,
    "termsDocVersionId" TEXT,
    "privacyDocVersionId" TEXT,
    "source" TEXT NOT NULL,
    "ipAddress" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemberLegalConsent_endUserId_fkey"
      FOREIGN KEY ("endUserId") REFERENCES "EndUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "MemberLegalConsent_endUserId_createdAt_idx"
  ON "MemberLegalConsent"("endUserId", "createdAt");

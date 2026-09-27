-- Organization-scoped official channel reads share OnlinePlatformDirectory with legacy entries.
ALTER TABLE "Organization" ADD COLUMN "verifiedOfficialDomainsJson" TEXT NOT NULL DEFAULT '[]';

CREATE INDEX "OnlinePlatformDirectory_org_category_archive_status_order_idx"
  ON "OnlinePlatformDirectory"("organizationId", "category", "archivedAt", "status", "displayOrder");

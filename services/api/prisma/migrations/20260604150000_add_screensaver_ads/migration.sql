-- CreateTable
CREATE TABLE "AdAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationSec" INTEGER NOT NULL DEFAULT 8,
    "source" TEXT NOT NULL DEFAULT 'uploaded',
    "aiGenerationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "AdPlaylist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "AdPlaylistItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playlistId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdPlaylistItem_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "AdPlaylist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AdPlaylistItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "AdAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TerminalScreensaverConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "terminalId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "idleTimeoutSec" INTEGER NOT NULL DEFAULT 180,
    "playlistId" TEXT,
    "updatedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TerminalScreensaverConfig_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "AdPlaylist" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AdAsset_storageKey_key" ON "AdAsset"("storageKey");

-- CreateIndex
CREATE INDEX "AdAsset_status_idx" ON "AdAsset"("status");

-- CreateIndex
CREATE INDEX "AdAsset_type_idx" ON "AdAsset"("type");

-- CreateIndex
CREATE INDEX "AdAsset_deletedAt_idx" ON "AdAsset"("deletedAt");

-- CreateIndex
CREATE INDEX "AdPlaylist_status_idx" ON "AdPlaylist"("status");

-- CreateIndex
CREATE INDEX "AdPlaylistItem_playlistId_idx" ON "AdPlaylistItem"("playlistId");

-- CreateIndex
CREATE INDEX "AdPlaylistItem_assetId_idx" ON "AdPlaylistItem"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "AdPlaylistItem_playlistId_assetId_key" ON "AdPlaylistItem"("playlistId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "TerminalScreensaverConfig_terminalId_key" ON "TerminalScreensaverConfig"("terminalId");

-- CreateIndex
CREATE INDEX "TerminalScreensaverConfig_playlistId_idx" ON "TerminalScreensaverConfig"("playlistId");

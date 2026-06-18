-- P1: member notifications + feedback tickets.
-- Additive only. These tables are scoped to service/tool notifications and
-- device/file/general feedback. They must not model recruiting workflow state.

CREATE TABLE "MemberNotification" (
  "id" TEXT NOT NULL,
  "endUserId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'system',
  "relatedType" TEXT,
  "relatedId" TEXT,
  "isRead" BOOLEAN NOT NULL DEFAULT false,
  "readAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemberNotification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MemberNotification_endUserId_isRead_createdAt_idx"
  ON "MemberNotification"("endUserId", "isRead", "createdAt");
CREATE INDEX "MemberNotification_endUserId_createdAt_idx"
  ON "MemberNotification"("endUserId", "createdAt");
CREATE INDEX "MemberNotification_deletedAt_idx"
  ON "MemberNotification"("deletedAt");

CREATE TABLE "SystemBroadcast" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'system',
  "deletedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SystemBroadcast_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SystemBroadcast_deletedAt_createdAt_idx"
  ON "SystemBroadcast"("deletedAt", "createdAt");

CREATE TABLE "BroadcastReadState" (
  "id" TEXT NOT NULL,
  "endUserId" TEXT NOT NULL,
  "broadcastId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "dismissedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BroadcastReadState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BroadcastReadState_endUserId_broadcastId_key"
  ON "BroadcastReadState"("endUserId", "broadcastId");
CREATE INDEX "BroadcastReadState_endUserId_idx" ON "BroadcastReadState"("endUserId");
CREATE INDEX "BroadcastReadState_broadcastId_idx" ON "BroadcastReadState"("broadcastId");

CREATE TABLE "FeedbackTicket" (
  "id" TEXT NOT NULL,
  "endUserId" TEXT NOT NULL,
  "terminalId" TEXT,
  "relatedPrintTaskId" TEXT,
  "category" TEXT NOT NULL,
  "title" TEXT,
  "content" TEXT NOT NULL,
  "contactPhoneEnc" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeedbackTicket_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FeedbackTicket_endUserId_createdAt_idx"
  ON "FeedbackTicket"("endUserId", "createdAt");
CREATE INDEX "FeedbackTicket_status_createdAt_idx"
  ON "FeedbackTicket"("status", "createdAt");
CREATE INDEX "FeedbackTicket_category_createdAt_idx"
  ON "FeedbackTicket"("category", "createdAt");

CREATE TABLE "FeedbackReply" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "senderType" TEXT NOT NULL,
  "actorId" TEXT,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeedbackReply_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FeedbackReply_ticketId_createdAt_idx"
  ON "FeedbackReply"("ticketId", "createdAt");
CREATE INDEX "FeedbackReply_actorId_idx" ON "FeedbackReply"("actorId");

ALTER TABLE "MemberNotification"
  ADD CONSTRAINT "MemberNotification_endUserId_fkey"
  FOREIGN KEY ("endUserId") REFERENCES "EndUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BroadcastReadState"
  ADD CONSTRAINT "BroadcastReadState_endUserId_fkey"
  FOREIGN KEY ("endUserId") REFERENCES "EndUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BroadcastReadState"
  ADD CONSTRAINT "BroadcastReadState_broadcastId_fkey"
  FOREIGN KEY ("broadcastId") REFERENCES "SystemBroadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FeedbackTicket"
  ADD CONSTRAINT "FeedbackTicket_endUserId_fkey"
  FOREIGN KEY ("endUserId") REFERENCES "EndUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FeedbackReply"
  ADD CONSTRAINT "FeedbackReply_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "FeedbackTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FeedbackReply"
  ADD CONSTRAINT "FeedbackReply_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

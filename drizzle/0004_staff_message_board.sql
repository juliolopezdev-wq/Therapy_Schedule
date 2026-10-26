CREATE TABLE IF NOT EXISTS `staffMessages` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `authorUserId` integer NOT NULL,
  `title` text NOT NULL,
  `body` text NOT NULL,
  `channel` text DEFAULT 'general' NOT NULL,
  `priority` text DEFAULT 'normal' NOT NULL,
  `requiresAcknowledgement` integer DEFAULT 0 NOT NULL,
  `pinned` integer DEFAULT 0 NOT NULL,
  `resolvedAt` integer,
  `resolvedByUserId` integer,
  `archivedAt` integer,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL
);

CREATE TABLE IF NOT EXISTS `staffMessageAcknowledgements` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `messageId` integer NOT NULL,
  `userId` integer NOT NULL,
  `createdAt` integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `staffMessageAcknowledgements_message_user_unique`
  ON `staffMessageAcknowledgements` (`messageId`, `userId`);

CREATE INDEX IF NOT EXISTS `staffMessages_active_created_idx`
  ON `staffMessages` (`archivedAt`, `createdAt`);

CREATE TABLE IF NOT EXISTS `staffDirectMessages` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `senderUserId` integer NOT NULL,
  `recipientUserId` integer NOT NULL,
  `body` text NOT NULL,
  `readAt` integer,
  `createdAt` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `staffDirectMessages_participants_created_idx`
  ON `staffDirectMessages` (`senderUserId`, `recipientUserId`, `createdAt`);

CREATE INDEX IF NOT EXISTS `staffDirectMessages_recipient_read_idx`
  ON `staffDirectMessages` (`recipientUserId`, `readAt`, `createdAt`);

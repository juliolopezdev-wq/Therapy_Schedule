ALTER TABLE `patients` ADD COLUMN `mrn` text;
--> statement-breakpoint
ALTER TABLE `patients` ADD COLUMN `previousAdmissionId` integer;
--> statement-breakpoint
ALTER TABLE `patients` ADD COLUMN `isRoomPlaceholder` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `patients` ADD COLUMN `archivedAt` integer;
--> statement-breakpoint
ALTER TABLE `patients` ADD COLUMN `archivedByUserId` integer;
--> statement-breakpoint
ALTER TABLE `patients` ADD COLUMN `archiveReason` text;
--> statement-breakpoint
UPDATE `patients` SET `isRoomPlaceholder` = 1 WHERE lower(trim(`name`)) = 'available' AND `isDischarged` = 0;

ALTER TABLE `patients` ADD COLUMN `admissionDate` text;
--> statement-breakpoint
ALTER TABLE `patients` ADD COLUMN `weeklyMinuteTarget` integer NOT NULL DEFAULT 900;

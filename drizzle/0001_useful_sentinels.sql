CREATE TABLE `boardHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date` datetime NOT NULL,
	`snapshot` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `boardHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `patients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`roomNumber` varchar(32) NOT NULL,
	`name` varchar(128) NOT NULL,
	`notes` text,
	`isDischarged` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `patients_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `statusFlags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`patientId` int NOT NULL,
	`flagType` enum('DC','Name Alert','Weekend','In-Service','Appointment') NOT NULL,
	`date` datetime NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `statusFlags_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(64) NOT NULL,
	`color` varchar(7) NOT NULL DEFAULT '#6366f1',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `teams_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `therapists` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`name` varchar(128) NOT NULL,
	`teamId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `therapists_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `therapySessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`patientId` int NOT NULL,
	`therapistId` int,
	`therapyType` enum('PT','OT','SLP','Eval') NOT NULL,
	`startTime` datetime NOT NULL,
	`endTime` datetime NOT NULL,
	`durationMinutes` int NOT NULL,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `therapySessions_id` PRIMARY KEY(`id`)
);

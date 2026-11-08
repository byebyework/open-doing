CREATE TABLE `registration_codes` (
	`id` char(36) NOT NULL,
	`code` varchar(255) COLLATE utf8mb4_bin NOT NULL,
	`max_uses` int NOT NULL DEFAULT 10,
	`used_count` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `registration_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `registration_codes_code_unique` UNIQUE(`code`)
);

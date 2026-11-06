ALTER TABLE `users` ADD `nickname` varchar(50);--> statement-breakpoint
ALTER TABLE `users` ADD `gender` varchar(255) COLLATE utf8mb4_bin;--> statement-breakpoint
ALTER TABLE `users` ADD `email` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `phone` varchar(20);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_email_unique` UNIQUE(`email`);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_phone_unique` UNIQUE(`phone`);
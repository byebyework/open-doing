CREATE TABLE `comments` (
	`id` char(36) NOT NULL,
	`task_id` char(36) NOT NULL,
	`author_id` char(36) NOT NULL,
	`content` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `comments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`type` varchar(255) COLLATE utf8mb4_bin NOT NULL,
	`read` boolean NOT NULL DEFAULT false,
	`team_id` char(36),
	`project_id` char(36),
	`task_id` char(36),
	`actor_id` char(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `notifications_user_task_type_unique` UNIQUE(`user_id`,`task_id`,`type`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` char(36) NOT NULL,
	`team_id` char(36),
	`owner_id` char(36),
	`name` varchar(255) COLLATE utf8mb4_bin NOT NULL,
	`slug` varchar(255) COLLATE utf8mb4_bin NOT NULL,
	`description` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `projects_id` PRIMARY KEY(`id`),
	CONSTRAINT `projects_team_id_slug_unique` UNIQUE(`team_id`,`slug`),
	CONSTRAINT `projects_owner_id_slug_unique` UNIQUE(`owner_id`,`slug`),
	CONSTRAINT `projects_team_or_owner_check` CHECK((`projects`.`team_id` IS NOT NULL) <> (`projects`.`owner_id` IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `subtasks` (
	`id` char(36) NOT NULL,
	`task_id` char(36) NOT NULL,
	`title` varchar(500) NOT NULL,
	`completed` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`completed_at` timestamp,
	CONSTRAINT `subtasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` char(36) NOT NULL,
	`project_id` char(36),
	`space_type` varchar(255) COLLATE utf8mb4_bin NOT NULL,
	`title` varchar(500) NOT NULL,
	`description` text,
	`status` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT 'todo',
	`assignee_id` char(36),
	`due_date` date,
	`created_by_id` char(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `team_invites` (
	`id` char(36) NOT NULL,
	`team_id` char(36) NOT NULL,
	`invitee_id` char(36) NOT NULL,
	`invited_by_id` char(36) NOT NULL,
	`status` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT 'pending',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`responded_at` timestamp,
	`pending_scope` varchar(255) GENERATED ALWAYS AS (case when status = 'pending' then 'pending' else null end) VIRTUAL,
	CONSTRAINT `team_invites_id` PRIMARY KEY(`id`),
	CONSTRAINT `team_invites_pending_team_invitee_unique` UNIQUE(`team_id`,`invitee_id`,`pending_scope`)
);
--> statement-breakpoint
CREATE TABLE `team_join_requests` (
	`id` char(36) NOT NULL,
	`team_id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`status` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT 'pending',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`responded_at` timestamp,
	`responded_by_id` char(36),
	`pending_scope` varchar(255) GENERATED ALWAYS AS (case when status = 'pending' then 'pending' else null end) VIRTUAL,
	CONSTRAINT `team_join_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `team_join_requests_pending_team_user_unique` UNIQUE(`team_id`,`user_id`,`pending_scope`)
);
--> statement-breakpoint
CREATE TABLE `team_memberships` (
	`id` char(36) NOT NULL,
	`team_id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`role` varchar(255) COLLATE utf8mb4_bin NOT NULL,
	`joined_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `team_memberships_id` PRIMARY KEY(`id`),
	CONSTRAINT `team_memberships_team_id_user_id_unique` UNIQUE(`team_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` char(36) NOT NULL,
	`name` varchar(255) COLLATE utf8mb4_bin NOT NULL,
	`slug` varchar(255) COLLATE utf8mb4_bin NOT NULL,
	`join_code` varchar(255) COLLATE utf8mb4_bin NOT NULL,
	`join_code_enabled` boolean NOT NULL DEFAULT true,
	`owner_id` char(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `teams_id` PRIMARY KEY(`id`),
	CONSTRAINT `teams_slug_unique` UNIQUE(`slug`),
	CONSTRAINT `teams_join_code_unique` UNIQUE(`join_code`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` char(36) NOT NULL,
	`uid` varchar(255) COLLATE utf8mb4_bin NOT NULL,
	`username` varchar(255) COLLATE utf8mb4_bin NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`due_soon_reminder_enabled` boolean NOT NULL DEFAULT true,
	`overdue_reminder_enabled` boolean NOT NULL DEFAULT true,
	`language` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT 'zh',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_uid_unique` UNIQUE(`uid`),
	CONSTRAINT `users_username_unique` UNIQUE(`username`)
);
--> statement-breakpoint
ALTER TABLE `comments` ADD CONSTRAINT `comments_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `comments` ADD CONSTRAINT `comments_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_team_id_teams_id_fk` FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_team_id_teams_id_fk` FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subtasks` ADD CONSTRAINT `subtasks_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_assignee_id_users_id_fk` FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_created_by_id_users_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_invites` ADD CONSTRAINT `team_invites_team_id_teams_id_fk` FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_invites` ADD CONSTRAINT `team_invites_invitee_id_users_id_fk` FOREIGN KEY (`invitee_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_invites` ADD CONSTRAINT `team_invites_invited_by_id_users_id_fk` FOREIGN KEY (`invited_by_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_join_requests` ADD CONSTRAINT `team_join_requests_team_id_teams_id_fk` FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_join_requests` ADD CONSTRAINT `team_join_requests_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_join_requests` ADD CONSTRAINT `team_join_requests_responded_by_id_users_id_fk` FOREIGN KEY (`responded_by_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_memberships` ADD CONSTRAINT `team_memberships_team_id_teams_id_fk` FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_memberships` ADD CONSTRAINT `team_memberships_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `teams` ADD CONSTRAINT `teams_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `notifications_user_id_read_idx` ON `notifications` (`user_id`,`read`);--> statement-breakpoint
CREATE INDEX `projects_owner_id_idx` ON `projects` (`owner_id`);--> statement-breakpoint
CREATE INDEX `tasks_assignee_id_idx` ON `tasks` (`assignee_id`);--> statement-breakpoint
CREATE INDEX `tasks_status_due_date_idx` ON `tasks` (`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `tasks_space_type_idx` ON `tasks` (`space_type`);--> statement-breakpoint
CREATE INDEX `team_join_requests_user_id_idx` ON `team_join_requests` (`user_id`);--> statement-breakpoint
CREATE INDEX `team_memberships_user_id_idx` ON `team_memberships` (`user_id`);
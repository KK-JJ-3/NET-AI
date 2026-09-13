-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(64) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `role` ENUM('admin', 'viewer', 'auditor') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `users_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `devices` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `type` ENUM('router', 'switch', 'firewall', 'access_point', 'server') NOT NULL,
    `ip_address` VARCHAR(45) NOT NULL,
    `status` ENUM('up', 'degraded', 'down') NOT NULL DEFAULT 'up',
    `location` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `interfaces` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `device_id` INTEGER NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `status` ENUM('up', 'degraded', 'down') NOT NULL DEFAULT 'up',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `telemetry` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `device_id` INTEGER NOT NULL,
    `interface_id` INTEGER NULL,
    `recorded_at` DATETIME(3) NOT NULL,
    `latency_ms` DOUBLE NOT NULL,
    `packet_loss_pct` DOUBLE NOT NULL,
    `jitter_ms` DOUBLE NOT NULL,
    `utilization_pct` DOUBLE NOT NULL,
    `cpu_pct` DOUBLE NOT NULL,
    `memory_pct` DOUBLE NOT NULL,
    `availability` BOOLEAN NOT NULL DEFAULT true,
    `scenario_label` ENUM('normal', 'congestion', 'device_failure') NOT NULL,

    INDEX `telemetry_device_id_recorded_at_idx`(`device_id`, `recorded_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `faults` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `device_id` INTEGER NOT NULL,
    `fault_type` ENUM('congestion', 'device_failure') NOT NULL,
    `status` ENUM('predicted', 'confirmed', 'resolved') NOT NULL,
    `severity` ENUM('low', 'medium', 'high', 'critical') NOT NULL,
    `started_at` DATETIME(3) NOT NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `predictions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `device_id` INTEGER NOT NULL,
    `fault_type` ENUM('congestion', 'device_failure') NOT NULL,
    `risk_score` DOUBLE NOT NULL,
    `severity` ENUM('low', 'medium', 'high', 'critical') NOT NULL,
    `predicted_window_minutes` INTEGER NOT NULL,
    `explanation_text` TEXT NOT NULL,
    `contributing_features` JSON NOT NULL,
    `status` ENUM('pending', 'confirmed', 'false_positive') NOT NULL DEFAULT 'pending',
    `predicted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prediction_outcomes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `prediction_id` INTEGER NOT NULL,
    `fault_id` INTEGER NULL,
    `outcome` ENUM('confirmed', 'false_positive') NOT NULL,
    `evaluated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notes` VARCHAR(255) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `alerts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `prediction_id` INTEGER NULL,
    `device_id` INTEGER NOT NULL,
    `message` VARCHAR(255) NOT NULL,
    `severity` ENUM('low', 'medium', 'high', 'critical') NOT NULL,
    `acknowledged` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `interfaces` ADD CONSTRAINT `interfaces_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `telemetry` ADD CONSTRAINT `telemetry_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `telemetry` ADD CONSTRAINT `telemetry_interface_id_fkey` FOREIGN KEY (`interface_id`) REFERENCES `interfaces`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `faults` ADD CONSTRAINT `faults_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `predictions` ADD CONSTRAINT `predictions_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prediction_outcomes` ADD CONSTRAINT `prediction_outcomes_prediction_id_fkey` FOREIGN KEY (`prediction_id`) REFERENCES `predictions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prediction_outcomes` ADD CONSTRAINT `prediction_outcomes_fault_id_fkey` FOREIGN KEY (`fault_id`) REFERENCES `faults`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `alerts` ADD CONSTRAINT `alerts_prediction_id_fkey` FOREIGN KEY (`prediction_id`) REFERENCES `predictions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `alerts` ADD CONSTRAINT `alerts_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

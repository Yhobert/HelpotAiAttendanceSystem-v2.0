-- HelportAI Attendance System Database Schema
-- Run this SQL script in phpMyAdmin or MySQL command line

CREATE DATABASE IF NOT EXISTS helportai_attendance CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE helportai_attendance;

-- Users table for authentication
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('user', 'admin') DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Attendance logs table
CREATE TABLE IF NOT EXISTS attendance_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id VARCHAR(50),
    employee_name VARCHAR(255),
    qr_text TEXT NOT NULL,
    log_date DATE NOT NULL,
    log_in_time TIME,
    log_out_time TIME,
    scan_type VARCHAR(20) DEFAULT 'camera',
    snapshot LONGTEXT,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_employee_id (employee_id),
    INDEX idx_log_date (log_date),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Default logins (passwords set via password_hash in PHP; re-seed with api/ensure_local_admin.php if needed)
-- Admin / Admin@123  |  User / User@123
INSERT INTO users (username, password, role) VALUES 
('Admin', '$2y$10$/fGWLLBEkv2ePDYQ6htpn.gY4BQ.1kFHrRotTvyNuvnCc5V1RCCmG', 'admin'),
('User', '$2y$10$SYO4.ANeUMpqNUTCbpn0JO7pP2BfgPFCRV7y/Dov0kGR72fvZsqJG', 'user')
ON DUPLICATE KEY UPDATE password = VALUES(password), role = VALUES(role);

-- -----------------------------------------------------------------------------
-- Upgrade: ensure attendance_logs exists and has snapshot (safe on re-run)
-- Skips if column/table already match. Run after USE helportai_attendance;
-- -----------------------------------------------------------------------------
SET @db := DATABASE();
SET @snap_missing := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'attendance_logs' AND COLUMN_NAME = 'snapshot'
);
SET @sql_snap := IF(
    @snap_missing = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'attendance_logs') > 0,
    'ALTER TABLE attendance_logs ADD COLUMN snapshot LONGTEXT NULL AFTER scan_type',
    'SELECT 1'
);
PREPARE stmt_snap FROM @sql_snap;
EXECUTE stmt_snap;
DEALLOCATE PREPARE stmt_snap;

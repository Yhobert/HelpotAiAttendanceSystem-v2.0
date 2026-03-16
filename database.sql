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

-- Insert a default admin user (username: admin, password: admin123)
-- Password is hashed using password_hash() PHP function
INSERT INTO users (username, password, role) VALUES 
('admin', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin')
ON DUPLICATE KEY UPDATE username=username;


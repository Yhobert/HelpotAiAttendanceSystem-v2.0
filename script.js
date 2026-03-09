# HelportAI Attendance System - Database Setup Guide

This guide will help you set up the database connection for your attendance system using XAMPP.

## Prerequisites
- XAMPP installed and running
- Apache and MySQL services started in XAMPP Control Panel

## Step 1: Create the Database

1. Open phpMyAdmin by navigating to: `http://localhost/phpmyadmin`
2. Click on "SQL" tab
3. Copy and paste the contents of `database.sql` file, or run:
   ```sql
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
   ```
4. Click "Go" to execute

## Step 2: Configure Database Connection

1. Open `config.php` file
2. Verify the database credentials match your XAMPP setup:
   ```php
   define('DB_HOST', 'localhost');
   define('DB_USER', 'root');
   define('DB_PASS', '');  // Default XAMPP password is empty
   define('DB_NAME', 'helportai_attendance');
   ```
3. If you've changed your MySQL root password, update `DB_PASS` accordingly

## Step 3: Create Default Admin User (Optional)

You can create a default admin user by running this SQL in phpMyAdmin:

```sql
USE helportai_attendance;
INSERT INTO users (username, password, role) VALUES 
('admin', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin')
ON DUPLICATE KEY UPDATE username=username;
```

**Default Admin Credentials:**
- Username: `admin`
- Password: `admin123`

**⚠️ IMPORTANT:** Change the default admin password after first login for security!

## Step 4: Test the System

1. Make sure Apache and MySQL are running in XAMPP Control Panel
2. Navigate to: `http://localhost/att.System/`
3. You should see the login modal
4. Try logging in with the default admin credentials or create a new account

## Step 5: Verify Database Connection

If you encounter connection errors:

1. **Check XAMPP Services:**
   - Ensure Apache is running (green)
   - Ensure MySQL is running (green)

2. **Check Database Exists:**
   - Open phpMyAdmin
   - Verify `helportai_attendance` database exists

3. **Check File Permissions:**
   - Ensure PHP files in `api/` folder are readable
   - Ensure `config.php` is readable

4. **Check PHP Error Logs:**
   - Check `C:\xampp\php\logs\php_error_log` for detailed error messages

## API Endpoints

The system uses the following API endpoints:

- `api/login.php` - User authentication
- `api/signup.php` - User registration
- `api/logout.php` - User logout
- `api/check_session.php` - Check if user is logged in
- `api/save_log.php` - Save attendance log entry
- `api/get_logs.php` - Retrieve attendance logs
- `api/clear_logs.php` - Clear all logs (admin only)
- `api/export_csv.php` - Export logs as CSV (admin only)

## Troubleshooting

### "Database connection failed" error
- Verify MySQL is running in XAMPP
- Check database credentials in `config.php`
- Ensure database `helportai_attendance` exists

### "Not authenticated" error
- Clear browser cookies
- Try logging in again
- Check PHP session configuration

### "Unauthorized" error on admin functions
- Verify your user role is set to 'admin' in the database
- Log out and log back in

## Security Notes

1. **Change Default Passwords:** Always change default admin password
2. **Database Password:** If using in production, set a strong MySQL password
3. **File Permissions:** Ensure `config.php` is not publicly accessible (already in root, but be cautious)
4. **HTTPS:** For production, use HTTPS to protect credentials

## Support

If you encounter issues:
1. Check browser console (F12) for JavaScript errors
2. Check PHP error logs in XAMPP
3. Verify all files are in the correct directory structure



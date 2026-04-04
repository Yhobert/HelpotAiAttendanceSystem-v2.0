<?php
// Database configuration for HelportAI Attendance System
// Update these values according to your XAMPP setup

define('DB_HOST', 'localhost');
define('DB_USER', 'root');
define('DB_PASS', '');
define('DB_NAME', 'helportai_attendance');

// Google Apps Script Web App URL (Deploy → Web app → copy URL ending in /exec)
// Leave empty to disable Sheet sync from PHP. Same URL as in apps-script/Code.gs deployment.
define('APPS_SCRIPT_WEBAPP_URL', 'https://script.google.com/macros/s/AKfycby0MUHEFWMTyqqHMENnPRnkfmMM6H-m_QYen9EUfGWMTn92SH4nQHW3GAss-gGMCbes/exec');

// Session configuration (settings only, don't start session here)
// Each API file will start its own session when needed
ini_set('session.cookie_httponly', 1);
ini_set('session.use_only_cookies', 1);
ini_set('session.cookie_samesite', 'Lax');

// Create database connection
function getDBConnection() {
    try {
        $conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
        
        if ($conn->connect_error) {
            throw new Exception("Connection failed: " . $conn->connect_error);
        }
        
        $conn->set_charset("utf8mb4");
        return $conn;
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Database connection failed']);
        exit;
    }
}

// Helper function to send JSON response
function sendJSON($data, $statusCode = 200) {
    http_response_code($statusCode);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

// Helper function to validate session
function validateSession() {
    session_start();
    if (!isset($_SESSION['user_id']) || !isset($_SESSION['username']) || !isset($_SESSION['role'])) {
        sendJSON(['success' => false, 'error' => 'Not authenticated'], 401);
    }
    return [
        'user_id' => $_SESSION['user_id'],
        'username' => $_SESSION['username'],
        'role' => $_SESSION['role']
    ];
}

?>


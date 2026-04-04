<?php
require_once '../config.php';

// Start session if not already started
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

header('Content-Type: application/json');

$debug = [
    'session_status' => session_status(),
    'session_id' => session_id(),
    'session_data' => $_SESSION,
    'cookie_params' => session_get_cookie_params(),
    'has_user_id' => isset($_SESSION['user_id']),
    'user_id' => $_SESSION['user_id'] ?? null,
    'username' => $_SESSION['username'] ?? null,
    'role' => $_SESSION['role'] ?? null
];

echo json_encode($debug, JSON_PRETTY_PRINT);
?>



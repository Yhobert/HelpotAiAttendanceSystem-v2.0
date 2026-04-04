<?php
require_once '../config.php';

// Start session if not already started
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

if (isset($_SESSION['user_id']) && isset($_SESSION['username']) && isset($_SESSION['role'])) {
    sendJSON([
        'success' => true,
        'authenticated' => true,
        'user' => [
            'id' => $_SESSION['user_id'],
            'username' => $_SESSION['username'],
            'role' => $_SESSION['role']
        ]
    ]);
} else {
    sendJSON([
        'success' => true,
        'authenticated' => false
    ]);
}
?>


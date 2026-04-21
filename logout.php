<?php
require_once '../config.php';

// Start session if not already started
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

session_destroy();

sendJSON(['success' => true, 'message' => 'Logged out successfully']);
?>


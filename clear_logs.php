<?php
require_once '../config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendJSON(['success' => false, 'error' => 'Method not allowed'], 405);
}

// Start session if not already started
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

if (!isset($_SESSION['user_id'])) {
    sendJSON(['success' => false, 'error' => 'Not authenticated'], 401);
}

// Only admin can clear logs
if ($_SESSION['role'] !== 'admin') {
    sendJSON(['success' => false, 'error' => 'Unauthorized. Admin access required.'], 403);
}

$conn = getDBConnection();

$stmt = $conn->prepare("DELETE FROM attendance_logs");
if ($stmt->execute()) {
    $stmt->close();
    $conn->close();
    sendJSON(['success' => true, 'message' => 'All logs cleared']);
} else {
    $stmt->close();
    $conn->close();
    sendJSON(['success' => false, 'error' => 'Failed to clear logs']);
}
?>


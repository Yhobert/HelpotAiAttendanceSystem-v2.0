<?php
/**
 * Localhost only: ensures default accounts exist with known passwords.
 * Admin / Admin@123  |  User / User@123
 * Remove or protect this file in production.
 */
require_once '../config.php';

$ip = $_SERVER['REMOTE_ADDR'] ?? '';
$local = $ip === '127.0.0.1' || $ip === '::1' || $ip === '::ffff:127.0.0.1';
if (!$local) {
    sendJSON(['success' => false, 'error' => 'This endpoint is only available from localhost.'], 403);
}

$conn = getDBConnection();
$accounts = [
    ['Admin', 'Admin@123', 'admin'],
    ['User', 'User@123', 'user'],
];
foreach ($accounts as $row) {
    [$u, $plain, $role] = $row;
    $hash = password_hash($plain, PASSWORD_DEFAULT);
    $stmt = $conn->prepare(
        'INSERT INTO users (username, password, role) VALUES (?, ?, ?) ' .
        'ON DUPLICATE KEY UPDATE password = VALUES(password), role = VALUES(role)'
    );
    $stmt->bind_param('sss', $u, $hash, $role);
    $stmt->execute();
    $stmt->close();
}
$conn->close();

sendJSON([
    'success' => true,
    'message' => 'Accounts ready: Admin/Admin@123, User/User@123',
]);

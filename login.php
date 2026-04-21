<?php
require_once '../config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendJSON(['success' => false, 'error' => 'Method not allowed'], 405);
}

// Start session first, before any output
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

$data = json_decode(file_get_contents('php://input'), true);
$username = isset($data['username']) ? trim($data['username']) : '';
$password = isset($data['password']) ? $data['password'] : '';

if (empty($username) || empty($password)) {
    sendJSON(['success' => false, 'error' => 'Username and password are required']);
}

$conn = getDBConnection();
$stmt = $conn->prepare("SELECT id, username, password, role FROM users WHERE LOWER(username) = LOWER(?)");
$stmt->bind_param("s", $username);
$stmt->execute();
$result = $stmt->get_result();

if ($result->num_rows === 0) {
    $stmt->close();
    $conn->close();
    sendJSON(['success' => false, 'error' => 'Invalid credentials']);
}

$user = $result->fetch_assoc();

// Verify password
if (!password_verify($password, $user['password'])) {
    $stmt->close();
    $conn->close();
    sendJSON(['success' => false, 'error' => 'Invalid credentials']);
}

// Set session variables
$_SESSION['user_id'] = $user['id'];
$_SESSION['username'] = $user['username'];
$_SESSION['role'] = $user['role'];

// Regenerate session ID for security
session_regenerate_id(true);

$stmt->close();
$conn->close();

sendJSON([
    'success' => true,
    'user' => [
        'id' => $user['id'],
        'username' => $user['username'],
        'role' => $user['role']
    ]
]);


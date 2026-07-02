<?php
require_once '../config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendJSON(['success' => false, 'error' => 'Method not allowed'], 405);
}

// Start session if not already started (for consistency)
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

$data = json_decode(file_get_contents('php://input'), true);
$username = isset($data['username']) ? trim($data['username']) : '';
$password = isset($data['password']) ? $data['password'] : '';
$role = isset($data['role']) ? $data['role'] : 'user';

if (empty($username) || empty($password)) {
    sendJSON(['success' => false, 'error' => 'Username and password are required']);
}

// Validate role
if (!in_array($role, ['user', 'admin'])) {
    $role = 'user';
}

// Validate username length
if (strlen($username) < 3 || strlen($username) > 50) {
    sendJSON(['success' => false, 'error' => 'Username must be between 3 and 50 characters']);
}

// Validate password length
if (strlen($password) < 3) {
    sendJSON(['success' => false, 'error' => 'Password must be at least 3 characters']);
}

$conn = getDBConnection();

// Check if username already exists
$stmt = $conn->prepare("SELECT id FROM users WHERE username = ?");
$stmt->bind_param("s", $username);
$stmt->execute();
$result = $stmt->get_result();

if ($result->num_rows > 0) {
    $stmt->close();
    $conn->close();
    sendJSON(['success' => false, 'error' => 'Username already exists']);
}

$stmt->close();

// Hash password
$hashedPassword = password_hash($password, PASSWORD_DEFAULT);

// Insert new user
$stmt = $conn->prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)");
$stmt->bind_param("sss", $username, $hashedPassword, $role);

if ($stmt->execute()) {
    $userId = $conn->insert_id;
    $stmt->close();
    $conn->close();
    
    sendJSON([
        'success' => true,
        'message' => 'Sign up successful! Please log in.',
        'user' => [
            'id' => $userId,
            'username' => $username,
            'role' => $role
        ]
    ]);
} else {
    $stmt->close();
    $conn->close();
    sendJSON(['success' => false, 'error' => 'Failed to create account']);
}
?>


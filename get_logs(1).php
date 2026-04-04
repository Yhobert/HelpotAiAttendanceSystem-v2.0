<?php
require_once '../config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    sendJSON(['success' => false, 'error' => 'Method not allowed'], 405);
}

// Start session if not already started
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

if (!isset($_SESSION['user_id'])) {
    sendJSON(['success' => false, 'error' => 'Not authenticated'], 401);
}

$limit = isset($_GET['limit']) ? intval($_GET['limit']) : 200;
$limit = min($limit, 500); // Max 500 entries

$conn = getDBConnection();

$stmt = $conn->prepare("SELECT id, employee_id, employee_name, qr_text, log_date, log_in_time, log_out_time, scan_type, snapshot, timestamp FROM attendance_logs ORDER BY timestamp DESC LIMIT ?");
$stmt->bind_param("i", $limit);
$stmt->execute();
$result = $stmt->get_result();

$logs = [];
while ($row = $result->fetch_assoc()) {
    $logs[] = [
        'id' => $row['id'],
        'text' => $row['qr_text'],
        'employee_id' => $row['employee_id'],
        'employee_name' => $row['employee_name'],
        'date' => $row['log_date'],
        'logIn' => $row['log_in_time'],
        'logOut' => $row['log_out_time'] ? $row['log_out_time'] : '',
        'type' => $row['scan_type'],
        'snapshot' => $row['snapshot'],
        'timestamp' => intval($row['timestamp'])
    ];
}

$stmt->close();
$conn->close();

sendJSON([
    'success' => true,
    'logs' => $logs
]);
?>


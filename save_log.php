<?php
require_once '../config.php';
require_once __DIR__ . '/apps_script_client.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendJSON(['success' => false, 'error' => 'Method not allowed'], 405);
}

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

if (!isset($_SESSION['user_id'])) {
    sendJSON(['success' => false, 'error' => 'Not authenticated'], 401);
}

$data = json_decode(file_get_contents('php://input'), true);
$text = isset($data['text']) ? trim($data['text']) : '';
$type = isset($data['type']) ? $data['type'] : 'camera';
$snapshotRaw = isset($data['snapshot']) ? $data['snapshot'] : null;
$snapshot = ($snapshotRaw !== null && $snapshotRaw !== '') ? (string) $snapshotRaw : '';
// Avoid oversized payloads (MySQL max_allowed_packet / UI freeze)
if (strlen($snapshot) > 480000) {
    $snapshot = '';
}

$mode = isset($data['attendanceMode']) ? $data['attendanceMode'] : 'auto';
if (!in_array($mode, ['auto', 'in', 'out'], true)) {
    $mode = 'auto';
}

if (empty($text)) {
    sendJSON(['success' => false, 'error' => 'QR text is required']);
}

$employeeId = '';
$employeeName = '';

if (preg_match('/^\d+\s*[-:]\s*[A-Za-z]/', $text)) {
    $parts = preg_split('/[-:]/', $text);
    $employeeId = trim($parts[0]);
    $employeeName = isset($parts[1]) ? trim($parts[1]) : '';
} elseif (preg_match('/[A-Za-z].*[-:]\s*\d+$/', $text)) {
    $parts = preg_split('/[-:]/', $text);
    $employeeName = trim($parts[0]);
    $employeeId = isset($parts[1]) ? trim($parts[1]) : '';
} elseif (preg_match('/[A-Za-z]/', $text) && !preg_match('/\d{6,}/', $text)) {
    $employeeName = $text;
} elseif (preg_match('/^\d+$/', $text)) {
    $employeeId = $text;
}

$logDate = date('Y-m-d');
$now = date('H:i:s');
$timestamp = (int) (time() * 1000);
$timestampBind = (string) $timestamp;

$conn = getDBConnection();

function row_is_open_login($row) {
    if (!$row) {
        return false;
    }
    $i = $row['log_in_time'];
    $o = $row['log_out_time'];
    $hasIn = $i !== null && $i !== '' && $i !== '00:00:00';
    $hasOut = $o !== null && $o !== '' && $o !== '00:00:00';
    return $hasIn && !$hasOut;
}

$stmt = null;
$action = 'logged in';
$logoutPairLogIn = '';

if ($mode === 'in') {
    $logOut = '';
    $stmt = $conn->prepare("INSERT INTO attendance_logs (employee_id, employee_name, qr_text, log_date, log_in_time, log_out_time, scan_type, snapshot, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $stmt->bind_param("sssssssss", $employeeId, $employeeName, $text, $logDate, $now, $logOut, $type, $snapshot, $timestampBind);
    $action = 'logged in';
} elseif ($mode === 'out') {
    $stmtFind = $conn->prepare("SELECT id, log_in_time, log_out_time FROM attendance_logs WHERE qr_text = ? AND log_date = ? ORDER BY timestamp ASC");
    $stmtFind->bind_param("ss", $text, $logDate);
    $stmtFind->execute();
    $res = $stmtFind->get_result();
    $openId = null;
    while ($r = $res->fetch_assoc()) {
        if (row_is_open_login($r)) {
            // LIFO: match Apps Script — pair logout with the latest open login that day
            $openId = (int) $r['id'];
            $logoutPairLogIn = isset($r['log_in_time']) ? (string) $r['log_in_time'] : '';
        }
    }
    $stmtFind->close();

    if ($openId) {
        $stmt = $conn->prepare("UPDATE attendance_logs SET log_out_time = ?, snapshot = ?, timestamp = ? WHERE id = ?");
        $stmt->bind_param("sssi", $now, $snapshot, $timestampBind, $openId);
        $action = 'logged out';
    } else {
        $logIn = '';
        $stmt = $conn->prepare("INSERT INTO attendance_logs (employee_id, employee_name, qr_text, log_date, log_in_time, log_out_time, scan_type, snapshot, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->bind_param("sssssssss", $employeeId, $employeeName, $text, $logDate, $logIn, $now, $type, $snapshot, $timestampBind);
        $action = 'logged out';
    }
} else {
    // auto: same toggle as original API (latest row per QR + date)
    $stmtLast = $conn->prepare("SELECT id, log_in_time, log_out_time FROM attendance_logs WHERE qr_text = ? AND log_date = ? ORDER BY timestamp DESC LIMIT 1");
    $stmtLast->bind_param("ss", $text, $logDate);
    $stmtLast->execute();
    $result = $stmtLast->get_result();
    $existing = $result->fetch_assoc();
    $stmtLast->close();

    if ($existing) {
        if (empty($existing['log_out_time'])) {
            $logoutPairLogIn = isset($existing['log_in_time']) ? (string) $existing['log_in_time'] : '';
            $stmt = $conn->prepare("UPDATE attendance_logs SET log_out_time = ?, snapshot = ?, timestamp = ? WHERE id = ?");
            $stmt->bind_param("sssi", $now, $snapshot, $timestampBind, $existing['id']);
            $action = 'logged out';
        } else {
            $logOut = '';
            $stmt = $conn->prepare("INSERT INTO attendance_logs (employee_id, employee_name, qr_text, log_date, log_in_time, log_out_time, scan_type, snapshot, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
            $stmt->bind_param("sssssssss", $employeeId, $employeeName, $text, $logDate, $now, $logOut, $type, $snapshot, $timestampBind);
            $action = 'logged in';
        }
    } else {
        $logOut = '';
        $stmt = $conn->prepare("INSERT INTO attendance_logs (employee_id, employee_name, qr_text, log_date, log_in_time, log_out_time, scan_type, snapshot, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->bind_param("sssssssss", $employeeId, $employeeName, $text, $logDate, $now, $logOut, $type, $snapshot, $timestampBind);
        $action = 'logged in';
    }
}

if ($stmt && $stmt->execute()) {
    if ($action === 'logged in') {
        helport_apps_script_sync_row($employeeId, $employeeName, $text, $logDate, $now, '');
    } elseif ($action === 'logged out') {
        helport_apps_script_sync_row($employeeId, $employeeName, $text, $logDate, $logoutPairLogIn, $now);
    }
    $stmt->close();
    $conn->close();
    sendJSON([
        'success' => true,
        'action' => $action,
        'employee_name' => $employeeName
    ]);
}

if ($stmt) {
    $stmt->close();
}
$conn->close();
sendJSON(['success' => false, 'error' => 'Failed to save log entry']);
?>

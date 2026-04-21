<?php
require_once '../config.php';

function helport_time_empty_cell($t) {
    $t = trim((string) ($t ?? ''));
    return $t === '' || $t === '00:00:00';
}

/** 12-hour time for CSV; blank if no punch / placeholder. */
function helport_csv_time($t) {
    if (helport_time_empty_cell($t)) {
        return '';
    }
    $t = trim((string) $t);
    $ts = strtotime('2000-01-01 ' . $t);
    if ($ts === false) {
        return $t;
    }
    return date('g:i:s A', $ts);
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo 'Method not allowed';
    exit;
}

// Start session if not already started
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo 'Not authenticated';
    exit;
}

// Only admin can export
if ($_SESSION['role'] !== 'admin') {
    http_response_code(403);
    echo 'Unauthorized. Admin access required.';
    exit;
}

$conn = getDBConnection();

$stmt = $conn->prepare("SELECT employee_id, employee_name, qr_text, log_date, log_in_time, log_out_time, scan_type FROM attendance_logs ORDER BY timestamp DESC");
$stmt->execute();
$result = $stmt->get_result();

// Set headers for CSV download
header('Content-Type: text/csv; charset=utf-8');
header('Content-Disposition: attachment; filename="attendance-log-' . date('Y-m-d') . '.csv"');

// Output BOM for UTF-8
echo "\xEF\xBB\xBF";

// Output CSV header
$output = fopen('php://output', 'w');
fputcsv($output, ['EID', 'Name', 'Date', 'Log In', 'Log Out', 'Type']);

// Output data
while ($row = $result->fetch_assoc()) {
    $eid = $row['employee_id'] ? $row['employee_id'] : '';
    $name = $row['employee_name'] ? $row['employee_name'] : '';
    
    // If both are empty, try to extract from qr_text
    if (empty($eid) && empty($name)) {
        $text = $row['qr_text'];
        if (preg_match('/^\d+\s*[-:]\s*[A-Za-z]/', $text)) {
            $parts = preg_split('/[-:]/', $text);
            $eid = trim($parts[0]);
            $name = isset($parts[1]) ? trim($parts[1]) : '';
        } elseif (preg_match('/[A-Za-z].*[-:]\s*\d+$/', $text)) {
            $parts = preg_split('/[-:]/', $text);
            $name = trim($parts[0]);
            $eid = isset($parts[1]) ? trim($parts[1]) : '';
        } else {
            $name = $text;
        }
    }
    
    fputcsv($output, [
        $eid,
        $name,
        $row['log_date'],
        helport_csv_time($row['log_in_time']),
        helport_csv_time($row['log_out_time']),
        $row['scan_type']
    ]);
}

$stmt->close();
$conn->close();
fclose($output);
exit;


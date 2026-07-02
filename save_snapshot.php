<?php
/**
 * Save snapshot image to designated folder on local disk.
 * Folder: snapshots/ (inside the project directory)
 * Subfolders by date: snapshots/YYYY-MM-DD/
 */

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}

$image = isset($_POST['image']) ? trim($_POST['image']) : '';
$label = isset($_POST['label']) ? preg_replace('/[^a-zA-Z0-9,_\-]/', '_', trim($_POST['label'])) : 'scan';
$date  = isset($_POST['date']) ? trim($_POST['date']) : date('Y-m-d');
$time  = isset($_POST['time']) ? trim($_POST['time']) : date('H-i-s');

if ($image === '') {
    echo json_encode(['success' => false, 'error' => 'No image data']);
    exit;
}

// Parse data URL (e.g. data:image/jpeg;base64,...)
if (!preg_match('/^data:image\/(\w+);base64,(.+)$/', $image, $m)) {
    echo json_encode(['success' => false, 'error' => 'Invalid image format']);
    exit;
}

$ext = strtolower($m[1]);
if ($ext === 'jpeg') $ext = 'jpg';
$raw = base64_decode($m[2], true);
if ($raw === false) {
    echo json_encode(['success' => false, 'error' => 'Invalid base64']);
    exit;
}

// Designated folder: snapshots inside project directory
$baseDir = __DIR__ . DIRECTORY_SEPARATOR . 'snapshots';

// Optional: subfolder by date (e.g. 3/3/2025 -> 2025-03-03)
$dateNorm = date('Y-m-d', strtotime($date));
$saveDir = $baseDir . DIRECTORY_SEPARATOR . $dateNorm;

if (!is_dir($saveDir)) {
    if (!is_dir($baseDir)) {
        if (!@mkdir($baseDir, 0755, true)) {
            echo json_encode(['success' => false, 'error' => 'Cannot create snapshots folder']);
            exit;
        }
    }
    if (!@mkdir($saveDir, 0755, true)) {
        echo json_encode(['success' => false, 'error' => 'Cannot create date folder']);
        exit;
    }
}

// Unique filename: date_time_label_counter.jpg
$safeTime = preg_replace('/[^0-9\-]/', '-', $time);
$baseName = $dateNorm . '_' . $safeTime . '_' . $label;
$baseName = substr($baseName, 0, 100);
$path = $saveDir . DIRECTORY_SEPARATOR . $baseName . '.' . $ext;
$counter = 0;
while (file_exists($path)) {
    $counter++;
    $path = $saveDir . DIRECTORY_SEPARATOR . $baseName . '_' . $counter . '.' . $ext;
}

if (@file_put_contents($path, $raw) === false) {
    echo json_encode(['success' => false, 'error' => 'Failed to write file']);
    exit;
}

echo json_encode([
    'success' => true,
    'path'    => str_replace(__DIR__ . DIRECTORY_SEPARATOR, '', $path),
    'file'    => basename($path)
]);

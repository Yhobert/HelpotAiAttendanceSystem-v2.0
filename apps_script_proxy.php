<?php
/**
 * Forwards attendance JSON to Google Apps Script Web App.
 * URL: config.php → APPS_SCRIPT_WEBAPP_URL (avoids browser CORS on script.google.com).
 */
header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/apps_script_client.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}

$raw = file_get_contents('php://input');
if ($raw === false || $raw === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Empty body']);
    exit;
}

$result = helport_apps_script_forward_raw_body($raw);
$resp = $result['body'];
$eff = isset($result['effective_url']) ? $result['effective_url'] : '';

if (!$result['ok'] && $result['error'] !== '') {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Proxy request failed: ' . $result['error']]);
    exit;
}

$code = $result['http'];
if ($code === 503) {
    http_response_code(503);
    echo $resp;
    exit;
}

// Valid JSON from Apps Script (doPost/doGet) — accept even if upstream HTTP is quirky
$t = trim((string) $resp);
if ($t !== '' && ($t[0] === '{' || $t[0] === '[')) {
    $try = json_decode($t, true);
    if (json_last_error() === JSON_ERROR_NONE && is_array($try) && array_key_exists('success', $try)) {
        http_response_code(200);
        echo $t;
        exit;
    }
}

$redirectedToLogin = ($eff !== '' && stripos($eff, 'accounts.google.com') !== false);
$looksLikeHtml = (stripos($resp, '<!DOCTYPE') !== false || stripos($resp, '<html') !== false);
if ($looksLikeHtml || $redirectedToLogin) {
    http_response_code(502);
    $hint = 'Apps Script returned a web page instead of JSON. ';
    if ($redirectedToLogin) {
        $hint .= 'The request was redirected to Google sign-in — redeploy the Web app with Who has access: Anyone (not "Only myself"). ';
    } else {
        $hint .= 'Redeploy: Execute as Me, Who has access Anyone, copy the new /exec URL into config.php APPS_SCRIPT_WEBAPP_URL. ';
    }
    $hint .= 'Open the /exec URL in a private window; you should see JSON, not a login page.';
    echo json_encode([
        'success' => false,
        'error' => $hint,
        'effective_url' => $eff,
    ]);
    exit;
}

if ($code < 200 || $code >= 300) {
    http_response_code(502);
    echo json_encode([
        'success' => false,
        'error' => 'Apps Script HTTP ' . $code,
        'raw' => function_exists('mb_substr') ? mb_substr($resp, 0, 400) : substr($resp, 0, 400),
    ]);
    exit;
}

http_response_code(200);
echo $resp;

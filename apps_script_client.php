<?php
/**
 * Google Apps Script Web App client (shared by apps_script_proxy.php and save_log.php).
 * Set APPS_SCRIPT_WEBAPP_URL in config.php to your deployment /exec URL.
 */
require_once dirname(__DIR__) . '/config.php';

function helport_date_ymd_to_sheet($ymd) {
    if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $ymd, $m)) {
        return $m[2] . '-' . $m[3] . '-' . $m[1];
    }
    return $ymd;
}

function helport_sheet_eid($employeeId, $qrText, $employeeName = '') {
    $id = trim((string) $employeeId);
    if ($id !== '') {
        return $id;
    }
    if (preg_match('/[0-9]{5,}/', (string) $qrText, $m)) {
        return $m[0];
    }
    $n = strtolower(trim((string) $employeeName));
    $n = preg_replace('/\s+/', ' ', $n);
    if ($n !== '') {
        $prefix = 'NAME:';
        $max = 48;
        $slice = function_exists('mb_substr') ? mb_substr($n, 0, $max) : substr($n, 0, $max);
        return $prefix . $slice;
    }
    return '';
}

/**
 * POST JSON to Apps Script (Code.gs doPost). Each save appends one row (one row per tap).
 */
function helport_apps_script_sync_row($employeeId, $employeeName, $qrText, $logDateYmd, $logInTime, $logOutTime) {
    if (!defined('APPS_SCRIPT_WEBAPP_URL') || APPS_SCRIPT_WEBAPP_URL === '') {
        return;
    }
    $eid = helport_sheet_eid($employeeId, $qrText, $employeeName);
    $li = trim((string) $logInTime);
    $lo = trim((string) $logOutTime);
    if ($eid === '' || ($li === '' && $lo === '')) {
        return;
    }
    $payload = [
        'eid' => $eid,
        'name' => trim((string) $employeeName),
        'date' => helport_date_ymd_to_sheet($logDateYmd),
        'logIn' => $li,
        'logOut' => $lo,
    ];
    helport_apps_script_forward_raw_body(json_encode($payload));
}

/**
 * Forward raw JSON string to Web App; returns ['ok'=>bool,'http'=>int,'body'=>string,'error'=>string].
 */
function helport_apps_script_forward_raw_body($raw) {
    $out = ['ok' => false, 'http' => 0, 'body' => '', 'error' => '', 'effective_url' => ''];
    if (!defined('APPS_SCRIPT_WEBAPP_URL') || APPS_SCRIPT_WEBAPP_URL === '') {
        $out['body'] = json_encode(['success' => false, 'error' => 'Apps Script URL not configured (config.php → APPS_SCRIPT_WEBAPP_URL)']);
        $out['http'] = 503;
        return $out;
    }
    $url = trim((string) APPS_SCRIPT_WEBAPP_URL);
    if ($url === '') {
        $out['body'] = json_encode(['success' => false, 'error' => 'Apps Script URL empty after trim']);
        $out['http'] = 503;
        return $out;
    }

    if (function_exists('curl_init')) {
        // Google Apps Script: first POST goes to script.google.com → 302 to script.googleusercontent.com/macros/echo?...
        // The echo URL is meant to be followed with GET (Google ties your POST body to user_content_key). If we set
        // CURLOPT_POSTREDIR to re-POST after redirect, echo often returns HTML / 405 instead of doPost JSON.
        // See: https://dev.to/googleworkspace/youre-probably-using-curl-wrong-with-your-google-apps-script-web-app-1ed8

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $raw,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Accept: application/json, */*',
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            // Intentionally no CURLOPT_POSTREDIR — default POST→GET on 302 is what Google's web app expects.
            CURLOPT_MAXREDIRS => 10,
            CURLOPT_TIMEOUT => 45,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_ENCODING => '',
            CURLOPT_USERAGENT => 'HelportAI-Attendance/1.0 (PHP cURL; server-side Google Apps Script proxy)',
        ]);
        $resp = curl_exec($ch);
        $out['http'] = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $out['effective_url'] = (string) curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
        $err = curl_error($ch);
        curl_close($ch);
        if ($resp === false) {
            $out['error'] = $err;
            return $out;
        }
        $out['body'] = $resp;
        $out['ok'] = ($out['http'] >= 200 && $out['http'] < 300);
        return $out;
    }

    $ctx = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\n",
            'content' => $raw,
            'timeout' => 45,
            'follow_location' => 1,
        ],
    ]);
    $resp = @file_get_contents($url, false, $ctx);
    if ($resp === false) {
        $out['error'] = 'file_get_contents failed (enable curl extension)';
        return $out;
    }
    $out['body'] = $resp;
    $out['http'] = 200;
    $out['ok'] = true;
    return $out;
}

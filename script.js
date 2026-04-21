const startBtn=document.getElementById('startBtn'),
      stopBtn=document.getElementById('stopBtn'),
      video=document.getElementById('video'),
      overlay=document.getElementById('overlay'),
      ctx=overlay.getContext('2d', { willReadFrequently: true }),
      status=document.getElementById('status'),
      lastResult=document.getElementById('lastResult'),
      logEl=document.getElementById('log'),
      fileInput=document.getElementById('fileInput'),
      attendanceModeSelect=document.getElementById('attendanceModeSelect'),
      chooseSnapshotFolderBtn=document.getElementById('chooseSnapshotFolder'),
      snapshotFolderLabel=document.getElementById('snapshotFolderLabel'),
      clearLogBtn=document.getElementById('clearLog'),
      exportCsvBtn=document.getElementById('exportCsv');

const tabScannerBtn=document.getElementById('tabScannerBtn');
const tabLatestBtn=document.getElementById('tabLatestBtn');
const tabScanner=document.getElementById('tabScanner');
const tabLatest=document.getElementById('tabLatest');
const latestSnapshotImg=document.getElementById('latestSnapshotImg');
const latestSnapshotEmpty=document.getElementById('latestSnapshotEmpty');
const latestMeta=document.getElementById('latestMeta');
const latestQr=document.getElementById('latestQr');

let snapshotDirHandle = null;
let snapshotDirHandleName = null;

let stream=null, rafId=null, barcodeDetector=null, fallbackJsQR=null, scanning=false;
const LOG_KEY='qr-scanner-log-v3';
const AGENT_TAP_INTERVAL_MS = 5 * 60 * 1000;
/** Decode QR at most every N animation frames (higher = fewer false triggers). */
const QR_DECODE_FRAME_STRIDE = 4;
const SNAPSHOT_SERVER_MAX_LEN = 400000;

function trimSnapshotForServer(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return '';
    if (dataUrl.length <= SNAPSHOT_SERVER_MAX_LEN) return dataUrl;
    return '';
}

function formatDisplayDateFromIso(iso) {
    if (!iso || typeof iso !== 'string') return iso || '';
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return iso;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

function serverRowToLocal(row) {
    const text = String(row.text || row.qr_text || '').trim();
    const parsed = parseQrText(text);
    const rawDate = String(row.log_date || row.dateKey || row.date || '').trim();
    const dateIso = rawDate.slice(0, 10);
    const ts = Number(row.timestamp);
    const snap = row.snapshot && String(row.snapshot).startsWith('data:') ? String(row.snapshot) : '';
    const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(dateIso);
    return {
        employeeKey: toAgentKey(parsed.eid, parsed.name, text),
        dateKey: dateOk ? dateIso : getLocalDateTimeParts().dateIso,
        text,
        type: row.type || row.scan_type || 'camera',
        date: dateOk ? formatDisplayDateFromIso(dateIso) : (rawDate || new Date().toLocaleDateString()),
        logIn: normalizeStoredTime(row.logIn || row.log_in_time || ''),
        logOut: normalizeStoredTime(row.logOut || row.log_out_time || ''),
        timestamp: ts || Date.now(),
        saved: snap ? 'server' : (row.saved || ''),
        snapshotData: snap,
        eid: parsed.eid || row.employee_id || '',
        name: parsed.name || row.employee_name || '',
        nickname: parsed.nickname || ''
    };
}

async function pushScanToServer(row, attendanceMode, snapshotDataUrl) {
    if (typeof window.helportIsServerAuthed !== 'function' || !window.helportIsServerAuthed()) return null;
    const snap = trimSnapshotForServer(snapshotDataUrl);
    const clock = getLocalClockForServer();
    const body = {
        text: row.text,
        type: row.type || 'camera',
        attendanceMode: attendanceMode || 'auto',
        employeeId: String(row.eid || '').trim(),
        employeeName: String(row.name || '').trim(),
        clientDate: clock.clientDate,
        clientTime: clock.clientTime
    };
    if (snap) body.snapshot = snap;
    try {
        const r = await fetch(window.helportApiUrl('save_log.php'), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.success) console.warn('Server attendance:', j.error || r.status);
        return j;
    } catch (e) {
        console.warn('Server attendance sync failed', e);
        return null;
    }
}

function logMergeKey(e) {
    const t = normalizeQrText(e.text);
    const dk = String(e.dateKey || '').slice(0, 10);
    const li = String(e.logIn || '').trim();
    const lo = String(e.logOut || '').trim();
    if (li && lo) return `pair|${t}|${dk}|${li}|${lo}`;
    return `tap|${Number(e.timestamp)}|${t}|${li}|${lo}`;
}

async function pullServerLogsAndMerge() {
    if (typeof window.helportIsServerAuthed !== 'function' || !window.helportIsServerAuthed()) return;
    try {
        const r = await fetch(window.helportApiUrl('get_logs.php') + '?limit=500', { credentials: 'same-origin' });
        const j = await r.json().catch(() => ({}));
        if (!j.success || !Array.isArray(j.logs)) return;
        const local = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
        const seen = new Set(local.map(logMergeKey));
        for (const srv of j.logs) {
            const mapped = serverRowToLocal(srv);
            const k = logMergeKey(mapped);
            if (seen.has(k)) continue;
            seen.add(k);
            local.push(mapped);
        }
        local.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        localStorage.setItem(LOG_KEY, JSON.stringify(local));
        renderLog();
        updateLatestSnapshotView();
    } catch (e) {
        console.warn('Pull server logs failed', e);
    }
}

function updateLogStorageHint() {
    const el = document.getElementById('logStorageHint');
    if (!el) return;
    if (typeof window.helportIsServerAuthed === 'function' && window.helportIsServerAuthed()) {
        el.textContent = 'Local cache + MySQL (signed in)';
    } else {
        el.textContent = 'Stored locally in this browser';
    }
}

function setSnapshotFolderPromptState() {
    const hasChosenFolder = !!snapshotDirHandle;
    if (chooseSnapshotFolderBtn) {
        chooseSnapshotFolderBtn.classList.toggle('snapshot-required', !hasChosenFolder);
    }
    if (snapshotFolderLabel) {
        snapshotFolderLabel.classList.toggle('snapshot-warning', !hasChosenFolder);
        if (!hasChosenFolder) {
            snapshotFolderLabel.textContent = 'No folder selected. Click "Choose Snapshot Folder".';
        } else if (snapshotDirHandleName) {
            snapshotFolderLabel.textContent = `Saving to folder: ${snapshotDirHandleName}`;
        }
    }
}

// Google Sheet sync: browser → api/apps_script_proxy.php → Apps Script URL in config.php (APPS_SCRIPT_WEBAPP_URL)

function pad2(n){return String(n).padStart(2,'0');}
function getLocalDateTimeParts(d=new Date()){
    const yyyy = d.getFullYear();
    const mm = pad2(d.getMonth()+1);
    const dd = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mi = pad2(d.getMinutes());
    const ss = pad2(d.getSeconds());
    return { dateIso: `${yyyy}-${mm}-${dd}`, timeIso: `${hh}-${mi}-${ss}` };
}

/** YYYY-MM-DD and HH:mm:ss in the user's local timezone (for MySQL + Apps Script; avoids server TZ drift). */
function getLocalClockForServer(d = new Date()) {
    const yyyy = d.getFullYear();
    const mm = pad2(d.getMonth() + 1);
    const dd = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mi = pad2(d.getMinutes());
    const ss = pad2(d.getSeconds());
    return { clientDate: `${yyyy}-${mm}-${dd}`, clientTime: `${hh}:${mi}:${ss}` };
}

/** Missing / placeholder times from DB or partial rows */
function isTimeEmpty(t) {
    const s = String(t || '').trim();
    return !s || s === '00:00:00' || s === '00:00';
}

/** Normalize stored HH:mm:ss for UI (hide midnight placeholder). */
function normalizeStoredTime(t) {
    return isTimeEmpty(t) ? '' : String(t).trim();
}

/** 12-hour display for a HH:mm:ss value; empty if no real time. */
function formatTimeDisplay12h(t) {
    if (isTimeEmpty(t)) return '';
    const m = String(t).trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (!m) return String(t);
    const d = new Date(2000, 0, 1, parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
    if (isNaN(d.getTime())) return String(t);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
}

/** CSV cell: 12h time or blank (never 00:00:00 for incomplete). */
function formatTimeForCsv(t) {
    return formatTimeDisplay12h(t);
}

function normalizeQrText(qrText) {
    return String(qrText || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
}

function toAgentKey(eid, name, text) {
    const base = String(eid || name || normalizeQrText(text) || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
    return base.replace(/[^a-z0-9 ]/g, '');
}

/** Same calendar day as dateKey (YYYY-MM-DD) — avoids using yesterday’s taps for today’s auto in/out. */
function latestEntryForAgentOnDate(log, employeeKey, dateKeyIso) {
    const dk = String(dateKeyIso || '');
    const list = log.filter(e =>
        toAgentKey(e.eid, e.name, e.text) === employeeKey && String(e.dateKey || '') === dk
    );
    if (!list.length) return null;
    return list.reduce((a, b) => ((b.timestamp || 0) > (a.timestamp || 0) ? b : a));
}

function parseQrText(qrText) {
    const raw = normalizeQrText(qrText);

    // Extract nickname first (supports "Nickname: X" anywhere / on new lines)
    let nickname = '';
    const nickMatch = raw.match(/nickname\s*[:=]\s*([^\n\r-]{1,80})/i);
    if (nickMatch && nickMatch[1]) nickname = nickMatch[1].trim();

    // Remove nickname part for better EID/Name parsing
    const withoutNick = raw.replace(/nickname\s*[:=][\s\S]*$/i, '').trim();

    // Split on "-" and ":" (QR format: Name - EID - Nickname: X)
    const parts = withoutNick
        .split(/[-:]/)
        .map(p => p.trim())
        .filter(Boolean);

    // Find EID: any digit sequence 5+ chars (incl. leading zeros like 012345)
    let eid = '';
    const eidMatch = withoutNick.match(/[0-9]{5,}/);
    if (eidMatch) eid = eidMatch[0];

    // Pick a name candidate (the non-numeric part, prefer first part with letters)
    let name = '';
    const digitOnly = /^[0-9]+$/;
    const letterPart = parts.find(p => /[A-Za-z]/.test(p) && !digitOnly.test(p));
    if (letterPart) name = letterPart;

    // If format is "Name - EID", parts[0]=name parts[1]=eid
    if (!name && parts.length) name = parts[0];
    if (!eid && parts.length) {
        const maybeEid = parts.find(p => /^[0-9]{5,}$/.test(p));
        if (maybeEid) eid = maybeEid;
    }

    // If nickname not provided, derive from name
    if (!nickname) nickname = extractNicknameFromQR(raw);

    return { eid, name, nickname, raw };
}

async function chooseSnapshotFolder() {
    if (!('showDirectoryPicker' in window)) {
        alert('Folder picker is not supported in this browser. Snapshots will be saved to server folder: snapshots/');
        return;
    }
    if (!window.isSecureContext) {
        alert('Folder picker requires a secure context. Open this system using localhost (e.g. http://localhost/att.System/) in Chrome/Edge.');
        return;
    }
    try {
        // Needs HTTPS or localhost on supported browsers (Chrome/Edge)
        snapshotDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        snapshotDirHandleName = snapshotDirHandle && snapshotDirHandle.name ? snapshotDirHandle.name : 'Selected folder';

        // Ask permission immediately so saving won't silently fail later
        const perm = await snapshotDirHandle.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
            snapshotDirHandle = null;
            snapshotDirHandleName = null;
            alert('Folder permission was not granted. Snapshots will be saved to server folder: snapshots/');
            setSnapshotFolderPromptState();
            return;
        }

        setSnapshotFolderPromptState();
    } catch (err) {
        // user cancelled or browser blocked
        if (err && err.name === 'AbortError') return;
        console.warn('Folder picker error:', err);
        alert('Folder picker failed. Use Chrome/Edge on localhost/https. Snapshots will be saved to server folder: snapshots/');
        setSnapshotFolderPromptState();
    }
}

if (chooseSnapshotFolderBtn) {
    chooseSnapshotFolderBtn.addEventListener('click', chooseSnapshotFolder);
}
setSnapshotFolderPromptState();

async function initBarcodeDetector(){
    if('BarcodeDetector' in window){
        const f = await window.BarcodeDetector.getSupportedFormats().catch(()=>[]);
        if(f.includes('qr_code')) barcodeDetector = new BarcodeDetector({formats:['qr_code']});
    }
    if(!barcodeDetector) await loadJsQR();
}

function loadJsQR(){
    if(fallbackJsQR) return Promise.resolve();
    return new Promise((res,rej)=>{
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
        s.onload = ()=>{fallbackJsQR = window.jsQR; res()};
        s.onerror = rej; 
        document.head.appendChild(s);
    });
}

async function startCamera(){
    if(scanning) return;
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
        status.textContent='Camera API unavailable';
        alert('Camera needs a modern browser and a secure context (https or localhost).');
        return;
    }
    await initBarcodeDetector();
    const constraintAttempts = [
        { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        { video: { facingMode: 'environment' } },
        { video: { facingMode: { ideal: 'user' } } },
        { video: { width: { ideal: 1280 }, height: { ideal: 720 } } },
        { video: true }
    ];
    let lastErr = null;
    stream = null;
    for(const c of constraintAttempts){
        try{
            stream = await navigator.mediaDevices.getUserMedia(c);
            break;
        }catch(e){
            lastErr = e;
        }
    }
    if(!stream){
        status.textContent='Camera unavailable';
        const msg = lastErr && lastErr.message ? lastErr.message : 'Permission denied or no camera found';
        alert('Unable to access camera: ' + msg + '\n\nOn desktop there is often no "rear" camera — allow access when prompted, or try another browser.');
        return;
    }
    try{
        video.srcObject = stream;
        video.style.display = '';
        video.setAttribute('playsinline', '');
        await video.play();
        overlay.width = video.videoWidth || 640;
        overlay.height = video.videoHeight || 360;
        scanning = true;
        status.textContent='Scanning...';
        tick();
    }catch(e){
        status.textContent='Camera unavailable';
        if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
        alert('Unable to start video: ' + (e && e.message ? e.message : 'unknown error'));
    }
}

function stopCamera(){
    scanning=false;
    status.textContent='Camera is Off';
    if(rafId) cancelAnimationFrame(rafId);
    if(stream){stream.getTracks().forEach(t=>t.stop()); stream=null;}
    if(overlay.width && overlay.height) ctx.clearRect(0,0,overlay.width,overlay.height);
}

let scanFrameCounter = 0;
async function tick(){
    if(!scanning) return;
    if(video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA){
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
        ctx.drawImage(video,0,0,overlay.width,overlay.height);

        // Run QR decode every Nth frame — fewer duplicate reads while QR stays in view.
        scanFrameCounter++;
        const doDecode = (scanFrameCounter % QR_DECODE_FRAME_STRIDE === 0);

        if(doDecode && barcodeDetector){
            try{
                const b = await createImageBitmap(overlay);
                const r = await barcodeDetector.detect(b);
                if(r && r.length){drawBoxes(r.map(e=>e.boundingBox)); handleResult(r[0].rawValue,'camera');}
                else clearOverlay();
                b.close();
            }catch(err){if(!fallbackJsQR) await loadJsQR();}
        } else if(doDecode && fallbackJsQR){
            const i = ctx.getImageData(0,0,overlay.width,overlay.height);
            const c = fallbackJsQR(i.data,i.width,i.height);
            if(c){drawPolygon(c.location); handleResult(c.data,'camera');} else clearOverlay();
        }
    }
    rafId=requestAnimationFrame(tick);
}

function drawBoxes(b){ctx.strokeStyle='#00ffcc'; ctx.lineWidth=Math.max(2,overlay.width/400); b.forEach(x=>{ctx.beginPath(); ctx.rect(x.x,x.y,x.width,x.height); ctx.stroke();});}
function drawPolygon(l){ctx.strokeStyle='#00ffcc'; ctx.lineWidth=Math.max(2,overlay.width/400); ctx.beginPath(); ctx.moveTo(l.topLeftCorner.x,l.topLeftCorner.y); ctx.lineTo(l.topRightCorner.x,l.topRightCorner.y); ctx.lineTo(l.bottomRightCorner.x,l.bottomRightCorner.y); ctx.lineTo(l.bottomLeftCorner.x,l.bottomLeftCorner.y); ctx.closePath(); ctx.stroke();}
function clearOverlay(){ctx.clearRect(0,0,overlay.width,overlay.height);}

let lastSeen=null;
/** Max width for snapshot JPEG — full-res toDataURL() blocks the main thread and causes lag. */
const SNAPSHOT_MAX_WIDTH = 960;
const SAME_QR_DEBOUNCE_MS = 2200;

function handleResult(t, type) {
    if (!t) return;
    const now = new Date();

    // Same QR text: ignore for a few seconds (camera calls this many times per second while QR is visible)
    if (lastSeen && lastSeen.text === t && (now - lastSeen.time) < SAME_QR_DEBOUNCE_MS) return;
    lastSeen = { text: t, time: now };
    lastResult.textContent = t;
    status.textContent = 'Detected';

    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 360;
    const scale = Math.min(1, SNAPSHOT_MAX_WIDTH / vw);
    const w = Math.max(1, Math.round(vw * scale));
    const h = Math.max(1, Math.round(vh * scale));

    const snapshotCanvas = document.createElement('canvas');
    snapshotCanvas.width = w;
    snapshotCanvas.height = h;
    const snapCtx = snapshotCanvas.getContext('2d');
    snapCtx.drawImage(video, 0, 0, w, h);
    const snapshotData = snapshotCanvas.toDataURL('image/jpeg', 0.72);

    void saveLogItem({
        text: t,
        type: type,
        snapshot: snapshotData
    }).catch(() => {});
}

// Extract nickname from QR text (preferred), with sensible fallbacks.
function extractNicknameFromQR(qrText) {
    const raw = String(qrText || '').trim();
    if (!raw) return 'employee';

    // If QR includes nickname in parentheses: "... (NICKNAME)"
    const paren = raw.match(/\(([^)]+)\)/);
    if (paren && paren[1]) return paren[1].trim();

    // If QR includes "Nickname: X"
    const nick = raw.match(/nickname\s*[:=]\s*([A-Za-z][A-Za-z0-9 _-]{1,50})/i);
    if (nick && nick[1]) return nick[1].trim();

    // Common format: "ID - LAST, FIRST" => use FIRST as nickname
    const afterDash = raw.split(/[-:]/).slice(1).join('-').trim();
    const namePart = afterDash || raw;
    if (namePart.includes(',')) {
        const parts = namePart.split(',');
        if (parts[1]) return parts[1].trim().split(/\s+/)[0];
    }

    // Fallback: first word from namePart
    const firstWord = namePart.trim().split(/\s+/)[0];
    return firstWord || 'employee';
}

// 🗣️ Speak employee nickname with a friendly voice
let lastSpeakRequestId = 0;
function speakEmployeeAction(nickname, action = "logged in") {
    if (!('speechSynthesis' in window)) return;
    const requestId = ++lastSpeakRequestId;
    const safeNick = String(nickname || 'employee').trim() || 'employee';

    const doSpeak = () => {
        if (requestId !== lastSpeakRequestId) return;
        const greetingsIn = [
            `Hello ${nickname} Glad to see you today. Have a great shift!`,
            `Good to see you ${nickname}!`,
            `Nice to see you, ${nickname} you look so fresh today!`,
            `Good Morning Sangre ${nickname}!`
        ];
        const greetingsOut = [
            `Goodbye ${safeNick}!`,
            `Take care ${safeNick}!`,
            `Great job today, ${safeNick}!`,
            `See you tomorrow, ${safeNick}!`
        ];
        const messageText = action === "logged out"
            ? greetingsOut[Math.floor(Math.random() * greetingsOut.length)]
            : greetingsIn[Math.floor(Math.random() * greetingsIn.length)];

        window.speechSynthesis.cancel();
        const msg = new SpeechSynthesisUtterance(messageText);
        msg.lang = "en-US";
        msg.pitch = 1.25;
        msg.rate = 0.95;
        msg.volume = 1;

        const voices = window.speechSynthesis.getVoices();
        const femaleUS = voices.find(v =>
            (v.lang === "en-US" || v.lang.startsWith("en-US")) &&
            (v.name.toLowerCase().includes("female") || v.name.toLowerCase().includes("samantha") || v.name.toLowerCase().includes("zira") || v.name.toLowerCase().includes("woman") || v.name.toLowerCase().includes("google"))
        );
        const anyFemale = voices.find(v => v.lang.startsWith("en") && (v.name.toLowerCase().includes("female") || v.name.toLowerCase().includes("samantha") || v.name.toLowerCase().includes("zira") || v.name.toLowerCase().includes("woman")));
        const enUS = voices.find(v => v.lang === "en-US" || v.lang.startsWith("en-US"));
        msg.voice = femaleUS || anyFemale || enUS || (voices.length ? voices[0] : null);

        window.speechSynthesis.speak(msg);
    };

    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
        doSpeak();
    } else {
        const handler = () => {
            window.speechSynthesis.onvoiceschanged = null;
            doSpeak();
        };
        window.speechSynthesis.onvoiceschanged = handler;
    }
}

async function saveLogItem(d) {
    let log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    const clock = getLocalClockForServer();
    const today = new Date().toLocaleDateString();
    const now = clock.clientTime;
    const nowTs = Date.now();

    const text = (d.text || "").trim();
    const parsed = parseQrText(text);
    let eid = parsed.eid || "";
    let name = parsed.name || "";
    let nickname = parsed.nickname || "";

    const employeeKey = toAgentKey(eid, name, text);
    const dateKey = getLocalDateTimeParts().dateIso;

    // Same agent + same day: block only if their *latest* tap today was within 5 minutes.
    const latestToday = latestEntryForAgentOnDate(log, employeeKey, dateKey);
    if (latestToday && latestToday.timestamp && (nowTs - latestToday.timestamp) < AGENT_TAP_INTERVAL_MS) {
        const minsLeft = Math.ceil((AGENT_TAP_INTERVAL_MS - (nowTs - latestToday.timestamp)) / 60000);
        status.textContent = `Please wait ${minsLeft} minute(s) before next tap`;
        alert(`Same agent scanned too soon. Please wait ${minsLeft} minute(s).`);
        return;
    }

    const mode = (attendanceModeSelect && attendanceModeSelect.value) || 'auto';
    let action = 'logged in';
    let logIn = '';
    let logOut = '';

    if (mode === 'in') {
        logIn = now;
        action = 'logged in';
    } else if (mode === 'out') {
        logOut = now;
        action = 'logged out';
    } else {
        // Auto: use latest tap *today only*. After a full in+out (or a lone logout), next tap is always a new login.
        const last = latestEntryForAgentOnDate(log, employeeKey, dateKey);
        const lastWasIn = !!(last && last.logIn && !last.logOut);
        if (lastWasIn) {
            logOut = now;
            action = 'logged out';
        } else {
            logIn = now;
            action = 'logged in';
        }
    }

    const row = {
        employeeKey,
        dateKey,
        text,
        type: d.type || 'camera',
        date: today,
        logIn,
        logOut,
        timestamp: nowTs,
        saved: '',
        eid,
        name,
        nickname
    };
    log.unshift(row);

    // Google Sheet: pair with the latest open login *today* before this tap (if any).
    const openLoginsBefore = action === 'logged out'
        ? log.filter(e =>
            toAgentKey(e.eid, e.name, e.text) === employeeKey &&
            String(e.dateKey || '') === dateKey &&
            !!e.logIn &&
            !e.logOut &&
            e.timestamp < row.timestamp
        )
        : [];
    const previousLogin =
        openLoginsBefore.length > 0
            ? openLoginsBefore.reduce((a, b) => ((b.timestamp || 0) > (a.timestamp || 0) ? b : a))
            : null;
    const sheetDate = toSheetDateMMDDYYYY(dateKey);
    const sheetEid = sheetEidForSync(eid, name, text);
    const hasTap = !!(row.logIn || row.logOut);
    const fullPair = action === 'logged out' && previousLogin && row.logOut;
    // Running File: one sheet row per QR tap (login row, then logout row, or one row with both if paired).
    const sheetSyncPayload = sheetEid && sheetDate && hasTap
        ? {
              eid: sheetEid,
              name: name || '',
              date: sheetDate,
              logIn: fullPair ? (previousLogin.logIn || '') : (row.logIn || ''),
              logOut: fullPair ? (row.logOut || '') : (row.logOut || '')
          }
        : null;

    speakEmployeeAction(nickname, action);

    const lightEl = document.getElementById('videoStatusLight');
    if (lightEl) {
        lightEl.classList.remove('login', 'logout');
        lightEl.classList.add(action === 'logged out' ? 'logout' : 'login');
    }

    log.sort((a, b) => b.timestamp - a.timestamp);
    localStorage.setItem(LOG_KEY, JSON.stringify(log));

    const serverRes = await pushScanToServer(row, mode, d.snapshot);
    // When signed in, save_log.php already posts to Apps Script — skip browser proxy or we get duplicate sheet rows.
    const sheetSyncedByServer =
        typeof window.helportIsServerAuthed === 'function' &&
        window.helportIsServerAuthed() &&
        serverRes &&
        serverRes.success === true;

    // Save snapshot to disk (async). Sheet sync MUST run in .finally so it still fires if snapshot fails/rejects.
    if (d.snapshot) {
        const label = (name || '').trim() || 'employee';
        const refId = row.timestamp;
        saveSnapshotToDisk(d.snapshot, label)
            .then(savedPath => {
                if (savedPath) {
                    const updated = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
                    const item = updated.find(x => x.timestamp === refId);
                    if (item) {
                        item.saved = savedPath;
                        localStorage.setItem(LOG_KEY, JSON.stringify(updated));
                    }
                }
                updateLatestSnapshotView();
            })
            .catch(() => {})
            .finally(() => {
                if (sheetSyncPayload && !sheetSyncedByServer) void syncAttendanceToGoogleSheets(sheetSyncPayload);
            });
        d.snapshot = null;
    } else if (sheetSyncPayload && !sheetSyncedByServer) {
        void syncAttendanceToGoogleSheets(sheetSyncPayload);
    }

    requestAnimationFrame(() => {
        renderLog();
        updateLatestSnapshotView();
    });
}

function toSheetDateMMDDYYYY(dateIso) {
    const s = String(dateIso || '').trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return s;
    return `${m[2]}-${m[3]}-${m[1]}`;
}

/** Stable id for Sheet row key (EID, digits in QR, or NAME:… fallback). */
function sheetEidForSync(eid, name, qrText) {
    const id = String(eid || '').trim();
    if (id) return id;
    const t = String(qrText || '');
    const digits = t.match(/[0-9]{5,}/);
    if (digits) return digits[0];
    const n = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (n) return 'NAME:' + n.substring(0, 48);
    return '';
}

async function syncAttendanceToGoogleSheets(payload) {
    if (!payload || !payload.eid) return;
    if (!payload.date || (!payload.logIn && !payload.logOut)) return;
    try {
        // Same-origin PHP proxy (URL is set in api/apps_script_proxy.php)
        const r = await fetch(window.helportApiUrl('apps_script_proxy.php'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const txt = await r.text();
        if (!r.ok) {
            console.warn('Google Sheet sync failed', r.status, txt);
            return;
        }
        try {
            const j = JSON.parse(txt);
            if (j && j.success === false) console.warn('Google Sheet sync', j.error || j);
        } catch (_) {}
    } catch (e) {
        console.warn('Google Sheet sync error', e);
    }
}

function dataUrlToBlob(dataUrl) {
    const parts = String(dataUrl || '').split(',');
    if (parts.length < 2) return null;
    const meta = parts[0];
    const b64 = parts[1];
    const mime = (meta.match(/data:([^;]+);base64/) || [])[1] || 'image/jpeg';
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

async function saveSnapshotToDisk(dataUrl, label) {
    const safeLabel = String(label || 'scan')
        .replace(/[\\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 80);

    // Filename format requested: "Date, Time and the name of the employee"
    // Use LOCAL time (not UTC) for accuracy.
    const ts = new Date();
    const { dateIso, timeIso } = getLocalDateTimeParts(ts);
    const baseFileName = `${dateIso}, ${timeIso}, ${safeLabel}.jpg`;

    // Save to user-chosen folder only (local disk via File System Access API)
    if (snapshotDirHandle) {
        try {
            const perm = await snapshotDirHandle.queryPermission({ mode: 'readwrite' });
            if (perm !== 'granted') {
                const req = await snapshotDirHandle.requestPermission({ mode: 'readwrite' });
                if (req !== 'granted') throw new Error('permission');
            }
            const blob = dataUrlToBlob(dataUrl);
            if (!blob) throw new Error('blob');

            let fileName = baseFileName;
            const dot = fileName.lastIndexOf('.');
            const base = dot >= 0 ? fileName.slice(0, dot) : fileName;
            const ext = dot >= 0 ? fileName.slice(dot) : '';
            for (let n = 2; n < 50; n++) {
                try {
                    await snapshotDirHandle.getFileHandle(fileName, { create: false });
                    fileName = `${base} (${n})${ext}`;
                } catch (_) {
                    break;
                }
            }

            const fileHandle = await snapshotDirHandle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            return snapshotDirHandleName ? `${snapshotDirHandleName}/${fileName}` : fileName;
        } catch (_) {
            console.warn('Snapshot save failed. Choose folder via "Choose Snapshot Folder" (Chrome/Edge on localhost).');
        }
    }
    return '';
}

function buildPairedSessions(rawLog) {
    const events = Array.isArray(rawLog) ? [...rawLog] : [];
    events.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    const grouped = new Map();

    for (const entry of events) {
        const employeeKey = String(
            entry.employeeKey || entry.eid || entry.name || entry.text || ''
        ).trim().toLowerCase();
        const dateKey = String(entry.dateKey || '').trim();
        const groupKey = `${employeeKey}|${dateKey}`;

        if (!grouped.has(groupKey)) grouped.set(groupKey, []);
        const sessions = grouped.get(groupKey);

        const hasLogIn = !!entry.logIn;
        const hasLogOut = !!entry.logOut;

        if (hasLogIn && hasLogOut) {
            sessions.push({
                ...entry,
                logIn: entry.logIn,
                logOut: entry.logOut
            });
            continue;
        }

        if (hasLogIn) {
            // Record every login tap as its own session row.
            sessions.push({
                ...entry,
                logIn: entry.logIn,
                logOut: ''
            });
            continue;
        }

        if (hasLogOut) {
            // Pair with the oldest open login session for this agent/date.
            const openSession = sessions.find(s => s.logIn && !s.logOut);
            if (openSession) {
                openSession.logOut = entry.logOut;
                if (!openSession.saved && entry.saved) openSession.saved = entry.saved;
                // Sort key: most recent scan (logout) so the row rises to the top of the log.
                openSession.timestamp = Math.max(
                    openSession.timestamp || 0,
                    entry.timestamp || 0
                );
            } else {
                // No open login available: keep logout tap as standalone row.
                sessions.push({
                    ...entry,
                    logIn: '',
                    logOut: entry.logOut
                });
            }
        }
    }

    const rows = [];
    for (const sessions of grouped.values()) rows.push(...sessions);
    rows.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return rows;
}

function renderLog() {
    const rawLog = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    const log = buildPairedSessions(rawLog);

    logEl.innerHTML = log.map(i => {
        return `
        <div class="entry">
            <div><strong>${escapeHtml(i.text)}</strong></div>
            <small>
                Date: ${i.date}
                • <span class="time-in"><span class="indicator in"></span> Time In: ${formatTimeDisplay12h(i.logIn) || '—'}</span>
                • <span class="time-out"><span class="indicator out"></span> Time Out: ${formatTimeDisplay12h(i.logOut) || '—'}</span>
                • ${i.type}
            </small>
        </div>
    `}).join('');
}

function updateLatestSnapshotView(){
    if (!latestSnapshotImg || !latestMeta || !latestQr) return;
    const log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    log.sort((a,b)=> (b.timestamp||0) - (a.timestamp||0));
    const latest = log[0];

    [latestMeta, latestQr].forEach(el=>{
        if(!el) return;
        el.classList.remove('animate-in');
        void el.offsetWidth;
        el.classList.add('animate-in');
    });

    latestSnapshotImg.style.display = 'none';
    if (latestSnapshotEmpty) latestSnapshotEmpty.style.display = 'flex';

    const snapUrl = (latest && (latest.snapshotData || (latest.snapshot && String(latest.snapshot).startsWith('data:') ? latest.snapshot : ''))) || '';

    if (!latest) {
        latestMeta.innerHTML = `<div><span class="k">Status:</span> <span class="v">No scan yet</span></div>`;
        latestQr.textContent = '';
        return;
    }

    if (snapUrl) {
        latestSnapshotImg.src = snapUrl;
        latestSnapshotImg.style.display = '';
        if (latestSnapshotEmpty) latestSnapshotEmpty.style.display = 'none';
    }

    latestMeta.innerHTML = [
        `<div><span class="k">Name:</span> <span class="v">${escapeHtml(latest.name || '')}</span></div>`,
        `<div><span class="k">Nickname:</span> <span class="v">${escapeHtml(latest.nickname || '')}</span></div>`,
        `<div><span class="k">EID:</span> <span class="v">${escapeHtml(latest.eid || '')}</span></div>`,
        `<div><span class="k">Date:</span> <span class="v">${escapeHtml(latest.date || '')}</span></div>`,
        `<div><span class="k">Log In:</span> <span class="v">${escapeHtml(formatTimeDisplay12h(latest.logIn) || '—')}</span></div>`,
        `<div><span class="k">Log Out:</span> <span class="v">${escapeHtml(formatTimeDisplay12h(latest.logOut) || '—')}</span></div>`,
        `<div><span class="k">Saved:</span> <span class="v">${escapeHtml(latest.saved || '—')}</span></div>`
    ].join('');
    latestQr.textContent = latest.text || '';
}

function setActiveTab(tab){
    const scannerOn = tab === 'scanner';
    if (tabScannerBtn) tabScannerBtn.classList.toggle('active', scannerOn);
    if (tabLatestBtn) tabLatestBtn.classList.toggle('active', !scannerOn);
    if (tabScanner) tabScanner.classList.toggle('active', scannerOn);
    if (tabLatest) tabLatest.classList.toggle('active', !scannerOn);
    if (!scannerOn) updateLatestSnapshotView();
}
if (tabScannerBtn) tabScannerBtn.addEventListener('click', ()=>setActiveTab('scanner'));
if (tabLatestBtn) tabLatestBtn.addEventListener('click', ()=>setActiveTab('latest'));

function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}

const scanImageBtn = document.getElementById('scanImageBtn');
if (scanImageBtn) scanImageBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async e=>{
    const f = e.target.files && e.target.files[0]; if(!f) return;
    const img = new Image();
    img.onload = async ()=>{
        overlay.width = img.naturalWidth; overlay.height = img.naturalHeight;
        ctx.drawImage(img,0,0,overlay.width,overlay.height);
        if(!barcodeDetector && !fallbackJsQR) await loadJsQR();
        if(barcodeDetector){
            try{
                const b = await createImageBitmap(overlay);
                const r = await barcodeDetector.detect(b);
                if(r && r.length) handleResult(r[0].rawValue,'image'); else alert('No QR found'); b.close();
            }catch(e){}
        } else if(fallbackJsQR){
            const d = ctx.getImageData(0,0,overlay.width,overlay.height);
            const c = fallbackJsQR(d.data,d.width,d.height);
            if(c) handleResult(c.data,'image'); else alert('No QR found');
        }
    };
    img.onerror=()=>alert('Invalid image');
    img.src=URL.createObjectURL(f);
});

function isAdmin() {
    try {
        if (window.helportUser && window.helportUser.role === 'admin') return true;
        const session = localStorage.getItem('helportai_session');
        return session ? (JSON.parse(session).role === 'admin') : false;
    } catch (_) { return false; }
}

/** Build CSV from localStorage scan log (works when MySQL is down). Returns true if a file was downloaded. */
function exportLocalScanLogCsv() {
    const rawLog = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    const log = buildPairedSessions(rawLog);
    if (!log.length) {
        alert('No scan entries in this browser to export.');
        return false;
    }

    const csvRows = ['EID,Nickname,Name,Date,Log In,Log Out,Save'];

    log.forEach(r => {
        const text = r.text || '';
        const p = (r.eid || r.name || r.nickname) ? {
            eid: r.eid || '',
            name: r.name || '',
            nickname: r.nickname || extractNicknameFromQR(text)
        } : parseQrText(text);

        const eid = p.eid || '';
        const name = p.name || '';
        const nickname = p.nickname || '';

        const row = [
            `"${eid.replace(/"/g, '""')}"`,
            `"${nickname.replace(/"/g, '""')}"`,
            `"${name.replace(/"/g, '""')}"`,
            `"${r.date}"`,
            `"${formatTimeForCsv(r.logIn).replace(/"/g, '""')}"`,
            `"${formatTimeForCsv(r.logOut).replace(/"/g, '""')}"`,
            `"${(r.saved || '').replace(/"/g, '""')}"`
        ].join(',');

        csvRows.push(row);
    });

    const csvContent = '\uFEFF' + csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'attendance-log-local.csv';
    a.click();
    URL.revokeObjectURL(url);
    return true;
}

startBtn.addEventListener('click',startCamera);
stopBtn.addEventListener('click',stopCamera);
clearLogBtn.addEventListener('click', async () => {
    if (!isAdmin()) return;
    if (!confirm('Clear all attendance records?')) return;
    if (typeof window.helportIsServerAuthed === 'function' && window.helportIsServerAuthed()) {
        try {
            const r = await fetch(window.helportApiUrl('clear_logs.php'), { method: 'POST', credentials: 'same-origin' });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || !j.success) {
                alert(j.error || 'Could not clear server log');
                return;
            }
        } catch (e) {
            alert('Could not clear server log');
            return;
        }
    }
    localStorage.removeItem(LOG_KEY);
    renderLog();
    updateLatestSnapshotView();
});
exportCsvBtn.addEventListener('click', async () => {
    if (!isAdmin()) return;
    if (typeof window.helportIsServerAuthed === 'function' && window.helportIsServerAuthed()) {
        try {
            const r = await fetch(window.helportApiUrl('export_csv.php'), { credentials: 'same-origin' });
            const ct = (r.headers.get('Content-Type') || '').toLowerCase();
            if (r.ok && ct.includes('csv')) {
                const blob = await r.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'attendance-log-server.csv';
                a.click();
                URL.revokeObjectURL(url);
                return;
            }
            let detail = 'Start MySQL in XAMPP Control Panel, then try again.';
            try {
                const t = await r.text();
                const j = JSON.parse(t);
                if (j && j.error) detail = j.error;
            } catch (_) {}
            if (confirm('Server export failed (' + detail + ')\n\nExport the scan log stored in this browser instead?')) {
                exportLocalScanLogCsv();
            }
        } catch (e) {
            if (confirm('Could not reach the server.\n\nExport the scan log stored in this browser instead?')) {
                exportLocalScanLogCsv();
            }
        }
        return;
    }

    exportLocalScanLogCsv();
});

renderLog();
updateLatestSnapshotView();
updateLogStorageHint();

window.addEventListener('helport-auth-change', () => {
    updateLogStorageHint();
    void pullServerLogsAndMerge();
});

window.addEventListener('pagehide',()=>stopCamera());
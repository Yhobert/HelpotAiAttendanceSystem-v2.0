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

function normalizeQrText(qrText) {
    return String(qrText || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
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
            if (snapshotFolderLabel) snapshotFolderLabel.textContent = 'Using server folder: snapshots/';
            return;
        }

        if (snapshotFolderLabel) snapshotFolderLabel.textContent = `Saving to folder: ${snapshotDirHandleName}`;
    } catch (err) {
        // user cancelled or browser blocked
        if (err && err.name === 'AbortError') return;
        console.warn('Folder picker error:', err);
        alert('Folder picker failed. Use Chrome/Edge on localhost/https. Snapshots will be saved to server folder: snapshots/');
    }
}

if (chooseSnapshotFolderBtn) {
    chooseSnapshotFolderBtn.addEventListener('click', chooseSnapshotFolder);
}

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
    await initBarcodeDetector();
    const f = 'environment';
    try{
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: f, width: { ideal: 1280 }, height: { ideal: 720 } } });
        video.srcObject = stream;
        video.style.display = '';
        await video.play();
        overlay.width = video.videoWidth || 640;
        overlay.height = video.videoHeight || 360;
        scanning = true;
        status.textContent='Scanning...';
        tick();
    }catch(e){
        status.textContent='Camera unavailable';
        alert('Unable to access camera');
    }
}

function stopCamera(){
    scanning=false;
    status.textContent='Camera is Off';
    if(rafId) cancelAnimationFrame(rafId);
    if(stream){stream.getTracks().forEach(t=>t.stop()); stream=null;}
    if(overlay.width && overlay.height) ctx.clearRect(0,0,overlay.width,overlay.height);
}

async function tick(){
    if(!scanning) return;
    if(video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA){
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
        ctx.drawImage(video,0,0,overlay.width,overlay.height);

        if(barcodeDetector){
            try{
                const b = await createImageBitmap(overlay);
                const r = await barcodeDetector.detect(b);
                if(r && r.length){drawBoxes(r.map(e=>e.boundingBox)); handleResult(r[0].rawValue,'camera');}
                else clearOverlay();
                b.close();
            }catch(err){if(!fallbackJsQR) await loadJsQR();}
        } else if(fallbackJsQR){
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
function handleResult(t, type) {
    if (!t) return;
    const now = new Date();

    // Avoid rapid duplicate scans (within 2.5 seconds)
    if (lastSeen && lastSeen.text === t && (now - lastSeen.time) < 2500) return;
    lastSeen = { text: t, time: now };
    lastResult.textContent = t;
    status.textContent = 'Detected';

    // 📸 Capture a fresh snapshot every scan
    const snapshotCanvas = document.createElement('canvas');
    snapshotCanvas.width = video.videoWidth;
    snapshotCanvas.height = video.videoHeight;
    const snapCtx = snapshotCanvas.getContext('2d');
    snapCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
    const snapshotData = snapshotCanvas.toDataURL('image/jpeg', 0.9); // better quality

    // Save scan result with the latest snapshot
    saveLogItem({
        text: t,
        type: type,
        snapshot: snapshotData
    });
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
function speakEmployeeAction(qrText, action = "logged in") {
    if (!('speechSynthesis' in window)) return;

    const doSpeak = () => {
        const nickname = extractNicknameFromQR(qrText);
        const greetingsIn = [
            `Hello ${nickname} focus on your target!, not on your workmate!`,
            `Good day ${nickname} naligo kaba bago pumasok?!`,
            `Nice to see you, ${nickname}you look so fresh today!`,
            `Hi young stunna${nickname}!`
        ];
        const greetingsOut = [
            `Goodbye ${nickname}!`,
            `Take care ${nickname}!`,
            `Great job today, ${nickname}!`,
            `See you tomorrow, ${nickname}!`
        ];
        const messageText = action === "logged out"
            ? greetingsOut[Math.floor(Math.random() * greetingsOut.length)]
            : greetingsIn[Math.floor(Math.random() * greetingsIn.length)];

        window.speechSynthesis.cancel();
        const msg = new SpeechSynthesisUtterance(messageText);
        msg.lang = "en-PH";
        msg.pitch = 3;
        msg.rate = 1;
        msg.volume = 1;

        const voices = window.speechSynthesis.getVoices();
        const isFemale = v => v.name.toLowerCase().includes("female") || v.name.toLowerCase().includes("samantha") || v.name.toLowerCase().includes("zira") || v.name.toLowerCase().includes("woman") || v.name.toLowerCase().includes("philippines") || v.name.toLowerCase().includes("filipina");
        const femalePH = voices.find(v => (v.lang === "en-PH" || v.lang.startsWith("en-PH")) && isFemale(v));
        const anyPH = voices.find(v => v.lang === "en-PH" || v.lang.startsWith("en-PH"));
        const femaleUS = voices.find(v => (v.lang === "en-US" || v.lang.startsWith("en-US")) && isFemale(v));
        const anyFemale = voices.find(v => v.lang.startsWith("en") && isFemale(v));
        const enUS = voices.find(v => v.lang === "en-US" || v.lang.startsWith("en-US"));
        msg.voice = femalePH || anyPH || femaleUS || anyFemale || enUS || (voices.length ? voices[0] : null);

        window.speechSynthesis.speak(msg);
    };

    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
        doSpeak();
    } else {
        window.speechSynthesis.onvoiceschanged = () => {
            doSpeak();
        };
    }
}

function saveLogItem(d) {
    let log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    const today = new Date().toLocaleDateString();
    const now = new Date().toLocaleTimeString();

    const text = (d.text || "").trim();
    const parsed = parseQrText(text);
    let eid = parsed.eid || "";
    let name = parsed.name || "";
    let nickname = parsed.nickname || "";

    const employeeKey = (eid || name || text).toString().trim().toLowerCase();
    const dateKey = getLocalDateTimeParts().dateIso;

    const mode = (attendanceModeSelect && attendanceModeSelect.value) || 'auto';
    let action = 'logged in';

    // One-lane update: single row per employee per day (always update that row)
    let row = log.find(e => (e.employeeKey || '').toLowerCase() === employeeKey && (e.dateKey || e.date) === (dateKey || today));
    if (!row) {
        row = {
            employeeKey,
            dateKey,
            text,
            type: d.type || 'camera',
            date: today,
            logIn: '',
            logOut: '',
            timestamp: Date.now(),
            saved: '',
            eid,
            name,
            nickname
        };
        log.unshift(row);
    }

    // refresh common fields (do NOT store snapshot in memory/localStorage - saves to disk only)
    row.text = text;
    row.type = d.type || row.type || 'camera';
    row.eid = eid;
    row.name = name;
    row.nickname = nickname;
    row.timestamp = Date.now();

    if (mode === 'in') {
        row.logIn = now;
        row.logOut = '';
        action = 'logged in';
    } else if (mode === 'out') {
        row.logOut = now;
        action = 'logged out';
    } else {
        if (!row.logIn) {
            row.logIn = now;
            row.logOut = '';
            action = 'logged in';
        } else {
            row.logOut = now;
            action = 'logged out';
        }
    }

    speakEmployeeAction(text, action);

    const lightEl = document.getElementById('videoStatusLight');
    if (lightEl) {
        lightEl.classList.remove('login', 'logout');
        lightEl.classList.add(action === 'logged out' ? 'logout' : 'login');
    }

    log.sort((a, b) => b.timestamp - a.timestamp);
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, 200)));

    // Save snapshot to disk only (never store base64 in localStorage to avoid lag)
    if (d.snapshot) {
        const label = (name || '').trim() || 'employee';
        const refId = `${employeeKey}__${dateKey}`;
        saveSnapshotToDisk(d.snapshot, label)
            .then(savedPath => {
                if (!savedPath) return;
                const updated = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
                const item = updated.find(x => `${(x.employeeKey||'')}__${(x.dateKey||x.date)}` === refId);
                if (item) {
                    item.saved = savedPath;
                    localStorage.setItem(LOG_KEY, JSON.stringify(updated.slice(0, 200)));
                }
                updateLatestSnapshotView();
            })
            .catch(() => {});
        // Drop snapshot reference immediately to free memory
        d.snapshot = null;
    }

    renderLog();
    updateLatestSnapshotView();
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

function renderLog() {
    const log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    log.sort((a, b) => b.timestamp - a.timestamp);

    logEl.innerHTML = log.map(i => {
        const hasLogIn = !!i.logIn;
        const hasLogOut = !!i.logOut;
        return `
        <div class="entry">
            <div><strong>${escapeHtml(i.text)}</strong></div>
            <small>
                Date: ${i.date}
                • <span class="time-in"><span class="indicator in"></span> Time In: ${i.logIn || '—'}</span>
                • <span class="time-out"><span class="indicator out"></span> Time Out: ${i.logOut || '—'}</span>
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

    if (!latest) {
        latestMeta.innerHTML = `<div><span class="k">Status:</span> <span class="v">No scan yet</span></div>`;
        latestQr.textContent = '';
        return;
    }

    latestMeta.innerHTML = [
        `<div><span class="k">Name:</span> <span class="v">${escapeHtml(latest.name || '')}</span></div>`,
        `<div><span class="k">Nickname:</span> <span class="v">${escapeHtml(latest.nickname || '')}</span></div>`,
        `<div><span class="k">EID:</span> <span class="v">${escapeHtml(latest.eid || '')}</span></div>`,
        `<div><span class="k">Date:</span> <span class="v">${escapeHtml(latest.date || '')}</span></div>`,
        `<div><span class="k">Log In:</span> <span class="v">${escapeHtml(latest.logIn || '—')}</span></div>`,
        `<div><span class="k">Log Out:</span> <span class="v">${escapeHtml(latest.logOut || '—')}</span></div>`,
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
        const session = localStorage.getItem('helportai_session');
        return session ? (JSON.parse(session).role === 'admin') : false;
    } catch (_) { return false; }
}

startBtn.addEventListener('click',startCamera);
stopBtn.addEventListener('click',stopCamera);
clearLogBtn.addEventListener('click', () => {
    if (!isAdmin()) return;
    localStorage.removeItem(LOG_KEY);
    renderLog();
});
exportCsvBtn.addEventListener('click', () => {
    if (!isAdmin()) return;
    const log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    if (!log.length) {
        alert('No entries');
        return;
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

        // User requested: swap what goes to EID and Name columns
        // CSV: EID col = eid, Name col = name (QR format: Name, EID, Nickname)
        const row = [
            `"${eid.replace(/"/g, '""')}"`,
            `"${nickname.replace(/"/g, '""')}"`,
            `"${name.replace(/"/g, '""')}"`,
            `"${r.date}"`,
            `"${r.logIn}"`,
            `"${r.logOut}"`,
            `"${(r.saved || '').replace(/"/g, '""')}"`
        ].join(',');

        csvRows.push(row);
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'attendance-log.csv';
    a.click();
    URL.revokeObjectURL(url);
});

renderLog();
updateLatestSnapshotView();
window.addEventListener('pagehide',()=>stopCamera());

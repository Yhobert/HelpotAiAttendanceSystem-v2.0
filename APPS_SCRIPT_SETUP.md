# Google Apps Script ↔ HelportAI Attendance

## What is connected

| Path | What it does |
|------|----------------|
| **Browser** (`script.js`) | On **logout** (paired Log In + Log Out), POSTs JSON to `api/apps_script_proxy.php` |
| **PHP** (`api/save_log.php`) | After a **logout** is saved in MySQL, POSTs the same JSON via `api/apps_script_client.php` |
| **Proxy** (`api/apps_script_proxy.php`) | Forwards JSON to your Web App (avoids CORS on `script.google.com`) |

## One URL for everything

Edit **`config.php`** in the project root:

```php
define('APPS_SCRIPT_WEBAPP_URL', 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec');
```

- Paste your **Web app** URL (must end with `/exec`).
- Leave it as `''` to turn off server-side Sheet sync (browser proxy will also report “not configured”).

The old duplicate URL in `script.js` was removed; the proxy always uses `config.php`.

## Your spreadsheet

- **Spreadsheet:** [Running File](https://docs.google.com/spreadsheets/d/1cR3sASwxxccTvmakC-gn2rXMGKT43XAAG7VJQzZPbAA/edit) — ID is set in **`apps-script/Code.gs`** as `SPREADSHEET_ID`.
- **Tab:** `Running File` (`SHEET_NAME_PREFERRED`); if missing, falls back to `Sheet1` then the first sheet.
- **Row 1 (A–E):** `EID` | `Name` | `Date` | `LogIn` | `LogOut`
- **Date** values in the sheet use **MM-DD-YYYY** (e.g. `03-25-2026`).

## Apps Script project setup

1. Open [script.google.com](https://script.google.com) → **New project**.
2. Replace the editor contents with **`apps-script/Code.gs`** from this repo → **Save**.
3. **Deploy → New deployment** → type **Web app**:
   - **Execute as:** *Me*
   - **Who has access:** *Anyone* (required so PHP/browser are not redirected to a Google sign-in page)
4. Copy the **Web app URL** → put it in **`config.php`** as `APPS_SCRIPT_WEBAPP_URL`.
5. **Test:** open the Web App URL in a browser (GET). You should see JSON like `HelportAI Apps Script is reachable`.

## When rows are written (Running File)

- **Every login tap** → **new row** (LogIn only). Two logins in a row → **two rows**.
- **Logout tap** → fills **LogOut** on the **last open row** for that EID+date (row that has LogIn but no LogOut yet = LIFO). If there is no open row → **new row** (logout only), so two logouts in a row → **two rows**.
- **Paired POST** (LogIn+LogOut in one request) → closes that last open row with both times, or **appends** one full row if none open.

Row 1: **EID | Name | Date | LogIn | LogOut**.

## Redeploying

Any change to `Code.gs` needs a **new deployment** (or “Manage deployments” → new version). Update **`config.php`** if Google gives you a **new** `/exec` URL.

## Troubleshooting: 502 / “web page instead of JSON”

If deployment is **Execute as: Me** and **Who has access: Anyone** but PHP still fails: the server must **not** force **POST after redirect** to `script.googleusercontent.com/macros/echo`. Google expects the 302 from `script.google.com` to be followed with **GET** (your POST body is tied to the redirect). This project’s `api/apps_script_client.php` follows that behavior. Also use the plain URL `https://script.google.com/macros/s/…/exec` (avoid `/u/0/` copies from the address bar if they misbehave).

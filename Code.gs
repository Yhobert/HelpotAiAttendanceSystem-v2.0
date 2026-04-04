// Web App: Deploy with Execute as "Me", Who has access "Anyone"
// Running File rules:
// - Each LOGIN tap → new row (LogIn only). Two logins same day → two rows.
// - Each LOGOUT tap: if an “open” row exists (LogIn yes, LogOut empty), fill LogOut on that row (same row as last open login = LIFO). Else new row (LogOut only).
// - Paired POST (LogIn+LogOut together): same as closing the last open row, or append one full row if none open.

var SPREADSHEET_ID = '1cR3sASwxxccTvmakC-gn2rXMGKT43XAAG7VJQzZPbAA';
var SHEET_NAME_PREFERRED = 'Running File';

function getTargetSheet_(ss) {
  var sheet = ss.getSheetByName(SHEET_NAME_PREFERRED);
  if (sheet) return sheet;
  sheet = ss.getSheetByName('Sheet1');
  if (sheet) return sheet;
  return ss.getSheets()[0];
}

// Columns A–E: EID | Name | Date | LogIn | LogOut

function doGet() {
  return jsonOut({
    success: true,
    message: 'HelportAI Apps Script is reachable',
    spreadsheetId: SPREADSHEET_ID,
    sheet: SHEET_NAME_PREFERRED
  });
}

function cellAsText_(cell) {
  if (cell === null || cell === undefined) return '';
  if (Object.prototype.toString.call(cell) === '[object Date]' && !isNaN(cell.getTime())) {
    return Utilities.formatDate(cell, Session.getScriptTimeZone(), 'HH:mm:ss');
  }
  return String(cell).trim();
}

function rowsMatchingEidDate_(values, eid, date) {
  var hits = [];
  var i;
  for (i = 1; i < values.length; i++) {
    var row = values[i];
    if (normEid(row[0]) === eid && normDate(row[2]) === date) {
      hits.push({ rowNum: i + 1, data: row });
    }
  }
  return hits;
}

function isOpenSession_(hit) {
  var exIn = cellAsText_(hit.data[3]);
  var exOut = cellAsText_(hit.data[4]);
  return exIn !== '' && exOut === '';
}

/** Bottom-most open row for this EID+date (last login without logout yet). */
function findLastOpenSession_(hits) {
  var last = null;
  var k;
  for (k = 0; k < hits.length; k++) {
    if (isOpenSession_(hits[k])) last = hits[k];
  }
  return last;
}

function doPost(e) {
  var out = { success: false, error: 'Unknown error' };
  try {
    var raw = '{}';
    if (e && e.postData && e.postData.contents) {
      raw = e.postData.contents;
    }
    var data = JSON.parse(raw);

    var eid = normEid(data.eid);
    var name = String(data.name || '').trim();
    var date = normDate(data.date);
    var logIn = String(data.logIn || '').trim();
    var logOut = String(data.logOut || '').trim();

    if (!eid || !date) {
      out = { success: false, error: 'Missing required fields (eid, date)' };
    } else if (!logIn && !logOut) {
      out = { success: false, error: 'Need at least one of logIn or logOut' };
    } else {
      var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      var sheet = getTargetSheet_(ss);
      if (!sheet) {
        out = { success: false, error: 'No sheet found in spreadsheet' };
      } else {
        var values = sheet.getDataRange().getValues();
        var hits = rowsMatchingEidDate_(values, eid, date);
        var open = findLastOpenSession_(hits);
        var exName;
        var dispName;
        var exIn;

        if (logIn && logOut) {
          // Paired: close last open login row, or append one complete row
          if (open) {
            exName = String(open.data[1] != null ? open.data[1] : '').trim();
            dispName = name || exName;
            sheet.getRange(open.rowNum, 1, 1, 5).setValues([[eid, dispName, date, logIn, logOut]]);
            out = { success: true, action: 'closed_session', row: open.rowNum };
          } else {
            sheet.appendRow([eid, name || '', date, logIn, logOut]);
            out = { success: true, action: 'appended_pair', row: sheet.getLastRow() };
          }
        } else if (logIn && !logOut) {
          // Always a new row — never overwrite a previous login on the same row
          sheet.appendRow([eid, name || '', date, logIn, '']);
          out = { success: true, action: 'appended_login', row: sheet.getLastRow() };
        } else {
          // Logout only: pair with last open row, or new row if double-logout / orphan
          if (open) {
            exName = String(open.data[1] != null ? open.data[1] : '').trim();
            exIn = cellAsText_(open.data[3]);
            dispName = name || exName;
            sheet.getRange(open.rowNum, 1, 1, 5).setValues([[eid, dispName, date, exIn, logOut]]);
            out = { success: true, action: 'closed_session', row: open.rowNum };
          } else {
            sheet.appendRow([eid, name || '', date, '', logOut]);
            out = { success: true, action: 'appended_logout_only', row: sheet.getLastRow() };
          }
        }
      }
    }
  } catch (err) {
    out = { success: false, error: String(err && err.message ? err.message : err) };
  }
  return jsonOut(out);
}

function normEid(v) {
  return String(v || '').trim();
}

function normDate(v) {
  if (!v) {
    return '';
  }
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'MM-dd-yyyy');
  }
  return String(v).trim();
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

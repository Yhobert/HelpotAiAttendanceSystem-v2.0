// Web App: Deploy with Execute as "Me", Who has access "Anyone"

var SPREADSHEET_ID = '1cR3sASwxxccTvmakC-gn2rXMGKT43XAAG7VJQzZPbAA';
var SHEET_NAME_PREFERRED = 'Running File';

function getTargetSheet_(ss) {
  var sheet = ss.getSheetByName(SHEET_NAME_PREFERRED);
  if (sheet) return sheet;
  sheet = ss.getSheetByName('Sheet1');
  if (sheet) return sheet;
  return ss.getSheets()[0];
}

// Fixed time extraction helper to ensure times aren't dropped or left blank
function cellAsText_(cell) {
  if (cell === null || cell === undefined) return '';
  if (Object.prototype.toString.call(cell) === '[object Date]') {
    return Utilities.formatDate(cell, Session.getScriptTimeZone(), "HH:mm:ss");
  }
  return String(cell).trim();
}

function doGet() {
  return jsonOut({
    success: true,
    message: 'HelportAI Apps Script is reachable',
    spreadsheetId: SPREADSHEET_ID,
    sheet: SHEET_NAME_PREFERRED
  });
}

function doPost(e) {
  var out = { success: false, error: 'Unknown error' };
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut({ success: false, error: 'No post data received' });
    }
    
    var raw = e.postData.contents;
    var data = JSON.parse(raw);
    
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = getTargetSheet_(ss);
    
    // Safely extract properties whether sent by local JS or PHP payload formats
    var eid    = String(data.employee_id || data.eid || '').trim();
    var name   = String(data.employee_name || data.name || '').trim();
    var date   = String(data.log_date || data.date || '').trim();
    var logIn  = String(data.log_in_time || data.login || data.logIn || '').trim();
    var logOut = String(data.log_out_time || data.logout || data.logOut || '').trim();
    
    if (!eid) {
      return jsonOut({ success: false, error: 'Missing employee_id (eid)' });
    }
    
    // Look for an existing open session row for this employee on this specific date
    var rows = sheet.getDataRange().getValues();
    var open = null;
    
    for (var i = rows.length - 1; i >= 1; i--) {
      var rEid  = String(rows[i][0]).trim();
      var rDate = String(rows[i][2]).trim();
      var rIn   = String(rows[i][3]).trim();
      var rOut  = String(rows[i][4]).trim();
      
      if (rEid === eid && rDate === date) {
        // Find a row that has a login timestamp but no logout timestamp yet
        if (rIn !== '' && rOut === '') {
          open = { rowNum: i + 1, data: rows[i] };
          break;
        }
      }
    }
    
    var exName, exIn, dispName;
    
    if (logIn && logOut) {
      // Both times sent together
      if (open) {
        exName = String(open.data[1] != null ? open.data[1] : '').trim();
        exIn = cellAsText_(open.data[3]);
        dispName = name || exName;
        sheet.getRange(open.rowNum, 1, 1, 5).setValues([[eid, dispName, date, exIn || logIn, logOut]]);
        out = { success: true, action: 'closed_session', row: open.rowNum };
      } else {
        sheet.appendRow([eid, name || '', date, logIn, logOut]);
        out = { success: true, action: 'appended_pair', row: sheet.getLastRow() };
      }
    } else if (logIn && !logOut) {
      // Login tap only
      sheet.appendRow([eid, name || '', date, logIn, '']);
      out = { success: true, action: 'appended_login', row: sheet.getLastRow() };
    } else {
      // Logout tap only
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
  } catch (err) {
    out = { success: false, error: err.toString() };
  }
  
  return jsonOut(out);
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
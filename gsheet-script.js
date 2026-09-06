/**
 * ============================================================
 * BENGALI HOMEOPATHIC CLINIC — GOOGLE APPS SCRIPT BACKEND
 * ============================================================
 * 
 * INSTRUCTIONS:
 * 1. Create a new Google Sheet (e.g. "Bengali Homeo Clinic DB").
 * 2. Click Extensions > Apps Script in the Google Sheet menu.
 * 3. Delete any code in the editor and paste this entire file.
 * 4. Click "Deploy" (top right) > "New deployment".
 * 5. Select type: "Web app".
 * 6. Set Description: "Clinic API".
 * 7. Set "Execute as": "Me".
 * 8. Set "Who has access": "Anyone" (allows your clinic app to read & save).
 * 9. Click "Deploy", authorize permissions when prompted, and COPY the Web app URL.
 */

function setupSheets(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Patients Sheet
  var pSheet = ss.getSheetByName('Patients');
  if (!pSheet) {
    pSheet = ss.insertSheet('Patients');
    pSheet.appendRow(['id', 'patient_id', 'name', 'age', 'gender', 'phone', 'address', 'created_at']);
    pSheet.getRange('A1:H1').setFontWeight('bold').setBackground('#e0f2fe');
  }

  // 2. Prescriptions Sheet
  var rxSheet = ss.getSheetByName('Prescriptions');
  if (!rxSheet) {
    rxSheet = ss.insertSheet('Prescriptions');
    rxSheet.appendRow(['id', 'rx_id', 'patient_id', 'complaints', 'diagnosis', 'notes', 'created_at']);
    rxSheet.getRange('A1:G1').setFontWeight('bold').setBackground('#ede9fe');
  }

  // 3. Medicines Sheet
  var medSheet = ss.getSheetByName('Medicines');
  if (!medSheet) {
    medSheet = ss.insertSheet('Medicines');
    medSheet.appendRow(['prescription_id', 'medicine_name', 'dosage', 'frequency', 'duration']);
    medSheet.getRange('A1:E1').setFontWeight('bold').setBackground('#fef3c7');
  }

  return { pSheet: pSheet, rxSheet: rxSheet, medSheet: medSheet };
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getPatientsData(sheets) {
  var pSheet = sheets.pSheet;
  var rxSheet = sheets.rxSheet;
  var pData = pSheet.getDataRange().getValues();
  if (pData.length <= 1) return [];

  var rxData = rxSheet.getDataRange().getValues();
  // Map of patient_id (code) or id -> latest rx date
  var lastVisitMap = {};
  for (var r = 1; r < rxData.length; r++) {
    var pRef = String(rxData[r][2]); // patient_id
    var rxDate = rxData[r][6];
    if (!lastVisitMap[pRef] || new Date(rxDate) > new Date(lastVisitMap[pRef])) {
      lastVisitMap[pRef] = rxDate;
    }
  }

  var patients = [];
  for (var i = 1; i < pData.length; i++) {
    var row = pData[i];
    var id = Number(row[0]);
    var pCode = String(row[1]);
    var created = row[7] ? String(row[7]) : new Date().toISOString();
    var lastVisit = lastVisitMap[pCode] || lastVisitMap[String(id)] || created;

    patients.push({
      id: id,
      patient_id: pCode,
      name: String(row[2] || ''),
      age: row[3] !== '' ? Number(row[3]) : null,
      gender: String(row[4] || ''),
      phone: String(row[5] || ''),
      address: String(row[6] || ''),
      created_at: created,
      last_visit_date: lastVisit
    });
  }

  // Sort latest first
  patients.sort(function(a, b) { return b.id - a.id; });
  return patients;
}

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheets = setupSheets(ss);
    var p = e.parameter || {};
    var action = p.action || 'get_all';

    if (action === 'get_all') {
      var allPatients = getPatientsData(sheets);
      return jsonResponse(allPatients);
    }

    if (action === 'search') {
      var query = (p.q || '').toLowerCase().trim();
      var showAll = p.all === 'true';
      var allPatients = getPatientsData(sheets);

      if (!query) {
        return jsonResponse(showAll ? allPatients : allPatients.slice(0, 25));
      }

      var filtered = allPatients.filter(function(pt) {
        return pt.patient_id.toLowerCase().indexOf(query) !== -1 ||
               pt.name.toLowerCase().indexOf(query) !== -1 ||
               pt.phone.toLowerCase().indexOf(query) !== -1;
      });
      return jsonResponse(filtered.slice(0, 50));
    }

    if (action === 'stats') {
      var all = getPatientsData(sheets);
      var rxData = sheets.rxSheet.getDataRange().getValues();
      var totalPrescriptions = Math.max(0, rxData.length - 1);

      var todayStr = new Date().toDateString();
      var todayCount = all.filter(function(pt) {
        return new Date(pt.created_at).toDateString() === todayStr;
      }).length;

      return jsonResponse({
        totalPatients: all.length,
        totalPrescriptions: totalPrescriptions,
        todayPatients: todayCount
      });
    }

    if (action === 'get_patient') {
      var pid = p.id;
      var all = getPatientsData(sheets);
      var patient = null;
      for (var i = 0; i < all.length; i++) {
        if (String(all[i].id) === String(pid) || all[i].patient_id === String(pid)) {
          patient = all[i];
          break;
        }
      }
      if (!patient) return jsonResponse({ error: 'Patient not found' });

      // Fetch prescriptions
      var rxData = sheets.rxSheet.getDataRange().getValues();
      var prescriptions = [];
      for (var r = 1; r < rxData.length; r++) {
        var rxRow = rxData[r];
        if (String(rxRow[2]) === String(patient.id) || String(rxRow[2]) === patient.patient_id) {
          prescriptions.push({
            id: Number(rxRow[0]),
            rx_id: String(rxRow[1]),
            patient_id: patient.id,
            complaints: String(rxRow[3] || ''),
            diagnosis: String(rxRow[4] || ''),
            notes: String(rxRow[5] || ''),
            created_at: String(rxRow[6])
          });
        }
      }
      prescriptions.sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      patient.prescriptions = prescriptions;
      return jsonResponse(patient);
    }

    if (action === 'get_rx') {
      var rxId = p.rxId;
      var rxData = sheets.rxSheet.getDataRange().getValues();
      var rx = null;
      for (var r = 1; r < rxData.length; r++) {
        if (String(rxData[r][1]) === String(rxId) || String(rxData[r][0]) === String(rxId)) {
          rx = {
            id: Number(rxData[r][0]),
            rx_id: String(rxData[r][1]),
            patient_id: rxData[r][2],
            complaints: String(rxData[r][3] || ''),
            diagnosis: String(rxData[r][4] || ''),
            notes: String(rxData[r][5] || ''),
            created_at: String(rxData[r][6])
          };
          break;
        }
      }
      if (!rx) return jsonResponse({ error: 'Prescription not found' });

      // Find patient
      var all = getPatientsData(sheets);
      var pt = null;
      for (var k = 0; k < all.length; k++) {
        if (String(all[k].id) === String(rx.patient_id) || all[k].patient_id === String(rx.patient_id)) {
          pt = all[k];
          break;
        }
      }

      // Medicines
      var medData = sheets.medSheet.getDataRange().getValues();
      var medicines = [];
      for (var m = 1; m < medData.length; m++) {
        if (String(medData[m][0]) === String(rx.id) || String(medData[m][0]) === rx.rx_id) {
          medicines.push({
            prescription_id: rx.id,
            medicine_name: String(medData[m][1] || ''),
            dosage: String(medData[m][2] || ''),
            frequency: String(medData[m][3] || ''),
            duration: String(medData[m][4] || '')
          });
        }
      }

      // Find previous visit before this rx
      var prevVisit = null;
      for (var j = 1; j < rxData.length; j++) {
        if ((String(rxData[j][2]) === String(rx.patient_id) || String(rxData[j][2]) === (pt && pt.patient_id)) &&
            new Date(rxData[j][6]) < new Date(rx.created_at)) {
          if (!prevVisit || new Date(rxData[j][6]) > new Date(prevVisit)) {
            prevVisit = String(rxData[j][6]);
          }
        }
      }

      return jsonResponse({
        id: rx.id,
        rx_id: rx.rx_id,
        patient_id: pt ? pt.id : rx.patient_id,
        patient_code: pt ? pt.patient_id : '',
        name: pt ? pt.name : '',
        age: pt ? pt.age : '',
        gender: pt ? pt.gender : '',
        phone: pt ? pt.phone : '',
        address: pt ? pt.address : '',
        complaints: rx.complaints,
        diagnosis: rx.diagnosis,
        notes: rx.notes,
        created_at: rx.created_at,
        previous_visit_date: prevVisit,
        medicines: medicines
      });
    }

    return jsonResponse({ error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ error: err.toString() });
  }
}

function doPost(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheets = setupSheets(ss);
    var body = {};
    if (e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
    var action = body.action;

    if (action === 'create_patient') {
      var pSheet = sheets.pSheet;
      var lastRow = pSheet.getLastRow();
      var nextId = 1;
      if (lastRow > 1) {
        var ids = pSheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (var i = 0; i < ids.length; i++) {
          if (Number(ids[i][0]) >= nextId) nextId = Number(ids[i][0]) + 1;
        }
      }

      var padId = String(nextId);
      while (padId.length < 5) padId = '0' + padId;
      var patientIdCode = 'PAT-' + padId;
      var nowIso = new Date().toISOString();

      pSheet.appendRow([
        nextId,
        patientIdCode,
        body.name ? String(body.name).trim() : '',
        body.age ? Number(body.age) : '',
        body.gender || '',
        body.phone || '',
        body.address || '',
        nowIso
      ]);

      return jsonResponse({
        id: nextId,
        patient_id: patientIdCode,
        name: body.name,
        age: body.age,
        gender: body.gender,
        phone: body.phone,
        address: body.address,
        created_at: nowIso,
        last_visit_date: nowIso
      });
    }

    if (action === 'update_patient') {
      var pSheet = sheets.pSheet;
      var pData = pSheet.getDataRange().getValues();
      var targetId = String(body.id || body.patient_id);
      var rowIndex = -1;

      for (var r = 1; r < pData.length; r++) {
        if (String(pData[r][0]) === targetId || String(pData[r][1]) === targetId) {
          rowIndex = r + 1; // 1-indexed row in sheet
          break;
        }
      }

      if (rowIndex === -1) return jsonResponse({ error: 'Patient not found' });

      if (body.name !== undefined) pSheet.getRange(rowIndex, 3).setValue(String(body.name).trim());
      if (body.age !== undefined) pSheet.getRange(rowIndex, 4).setValue(body.age ? Number(body.age) : '');
      if (body.gender !== undefined) pSheet.getRange(rowIndex, 5).setValue(body.gender || '');
      if (body.phone !== undefined) pSheet.getRange(rowIndex, 6).setValue(body.phone || '');
      if (body.address !== undefined) pSheet.getRange(rowIndex, 7).setValue(body.address || '');

      return jsonResponse({ success: true, message: 'Patient updated' });
    }

    if (action === 'delete_patient') {
      var pSheet = sheets.pSheet;
      var pData = pSheet.getDataRange().getValues();
      var targetId = String(body.id || body.patient_id);
      var rowIndex = -1;

      for (var r = 1; r < pData.length; r++) {
        if (String(pData[r][0]) === targetId || String(pData[r][1]) === targetId) {
          rowIndex = r + 1;
          break;
        }
      }

      if (rowIndex === -1) return jsonResponse({ error: 'Patient not found' });
      pSheet.deleteRow(rowIndex);

      return jsonResponse({ success: true, message: 'Patient deleted' });
    }

    if (action === 'create_rx') {
      var rxSheet = sheets.rxSheet;
      var medSheet = sheets.medSheet;

      var lastRow = rxSheet.getLastRow();
      var nextRxNum = 1;
      if (lastRow > 1) {
        var rxIds = rxSheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (var i = 0; i < rxIds.length; i++) {
          if (Number(rxIds[i][0]) >= nextRxNum) nextRxNum = Number(rxIds[i][0]) + 1;
        }
      }

      var padRx = String(nextRxNum);
      while (padRx.length < 5) padRx = '0' + padRx;
      var rxCode = 'RX-' + padRx;
      var nowIso = new Date().toISOString();

      rxSheet.appendRow([
        nextRxNum,
        rxCode,
        body.patient_id,
        body.complaints || '',
        body.diagnosis || '',
        body.notes || '',
        nowIso
      ]);

      if (Array.isArray(body.medicines)) {
        for (var m = 0; m < body.medicines.length; m++) {
          var med = body.medicines[m];
          if (med.medicine_name && med.medicine_name.trim()) {
            medSheet.appendRow([
              nextRxNum,
              med.medicine_name.trim(),
              med.dosage || '',
              med.frequency || '',
              med.duration || ''
            ]);
          }
        }
      }

      return jsonResponse({
        id: nextRxNum,
        rx_id: rxCode,
        patient_id: body.patient_id,
        complaints: body.complaints,
        diagnosis: body.diagnosis,
        notes: body.notes,
        created_at: nowIso
      });
    }

    return jsonResponse({ error: 'Unknown POST action' });
  } catch (err) {
    return jsonResponse({ error: err.toString() });
  }
}

// ============================================================
// PRESCRIPTION SLIP — CLINICAL NOTES & ADVICE SCRIPT
// ============================================================

async function loadPrescription() {
    const params = new URLSearchParams(window.location.search);
    const rxId = params.get('rx');
    const patientId = params.get('patientId');

    if (!rxId && !patientId) {
        document.getElementById('opdCard').innerHTML =
            '<div style="text-align:center;padding:4rem;font-size:14px;color:#c0392b;">Please select a patient from the dashboard to print the prescription.</div>';
        return;
    }

    const token = localStorage.getItem('clinic_auth_token') || params.get('token');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

    let patient = null;
    let rxData = null;

    try {
        if (rxId) {
            const res = await fetch(`/api/prescriptions/${rxId}`, { headers });
            if (res.status === 401) throw new Error('Doctor login required to print OPD slip.');
            if (!res.ok) throw new Error('Prescription record not found');
            rxData = await res.json();
            patient = {
                name: rxData.name,
                patient_id: rxData.patient_code,
                age: rxData.age,
                gender: rxData.gender,
                phone: rxData.phone,
                address: rxData.address,
                created_at: rxData.created_at
            };
        } else {
            const res = await fetch(`/api/patients/${patientId}`, { headers });
            if (res.status === 401) throw new Error('Doctor login required to print OPD slip.');
            if (!res.ok) throw new Error('Patient record not found');
            patient = await res.json();
        }

        renderPrescription(patient, rxData);
    } catch (err) {
        document.getElementById('opdCard').innerHTML =
            `<div style="text-align:center;padding:4rem;font-size:14px;color:#c0392b;">
                ${err.message}<br><br>
                <a href="/" style="display:inline-block;padding:8px 16px;background:#0d6efd;color:white;text-decoration:none;border-radius:8px;font-weight:600;">
                    ← Back to Doctor Dashboard
                </a>
            </div>`;
    }
}

function renderPrescription(patient, rxData) {
    const now = new Date((rxData && rxData.created_at) || patient.created_at || Date.now());

    // Patient Fields
    document.getElementById('pName').textContent = (patient.name || '--').toUpperCase();
    document.getElementById('pAge').textContent = patient.age ? `${patient.age} Yrs.` : '--';
    document.getElementById('pGender').textContent = patient.gender || '--';
    document.getElementById('pMobile').textContent = patient.phone || '--';

    // Visit Date with Day (e.g. 05/09/2026, Saturday)
    const visitDateStr = now.toLocaleDateString('en-GB', {
        day: '2-digit', month: '2-digit', year: 'numeric'
    });
    const dayStr = now.toLocaleDateString('en-US', { weekday: 'long' });
    document.getElementById('pVisitDate').textContent = `${visitDateStr} (${dayStr})`;

    // Last Visit Date
    let lastVisitDate = null;
    if (rxData && rxData.previous_visit_date) {
        lastVisitDate = rxData.previous_visit_date;
    } else if (!rxData && patient.prescriptions && patient.prescriptions.length > 0) {
        lastVisitDate = patient.prescriptions[0].created_at;
    } else {
        lastVisitDate = patient.last_visit_date || patient.created_at;
    }

    let lastVisitDisplay = '--';
    if (lastVisitDate) {
        const lvd = new Date(lastVisitDate);
        if (!isNaN(lvd.getTime())) {
            lastVisitDisplay = lvd.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
        }
    }
    const pLastVisitEl = document.getElementById('pLastVisitDate');
    if (pLastVisitEl) pLastVisitEl.textContent = lastVisitDisplay;

    // Patient ID
    document.getElementById('pUniqueId').textContent = patient.patient_id;

    // Patient Address (Only Patient's address; if empty, leaves dashed line for pen writing)
    const pAddr = (patient.address && patient.address.trim()) || '';
    document.getElementById('pAddress').textContent = pAddr;

    // If prescription had complaints or diagnosis, show in Clinical Notes column
    if (rxData && ((rxData.complaints && rxData.complaints.trim()) || (rxData.diagnosis && rxData.diagnosis.trim()))) {
        const compEl = document.getElementById('printedComplaints');
        let html = '';
        if (rxData.diagnosis && rxData.diagnosis.trim()) {
            html += `<strong>DIAGNOSIS:</strong> ${rxData.diagnosis}<br><br>`;
        }
        if (rxData.complaints && rxData.complaints.trim()) {
            html += `<strong>CHIEF COMPLAINTS:</strong> ${rxData.complaints}`;
        }
        compEl.innerHTML = html;
        compEl.style.display = 'block';
    }

    // If prescription had prescribed medicines, render under ℞
    if (rxData && Array.isArray(rxData.medicines) && rxData.medicines.length > 0) {
        const medContainer = document.getElementById('printedMedicinesList');
        if (medContainer) {
            medContainer.innerHTML = `
                <div class="printed-meds-table">
                    ${rxData.medicines.map((m, idx) => `
                        <div class="printed-med-row">
                            <span class="med-num">${idx + 1}.</span>
                            <span class="med-title">${m.medicine_name}</span>
                            ${m.dosage ? `<span class="med-dose">— ${m.dosage}</span>` : ''}
                            ${m.frequency ? `<span class="med-freq">(${m.frequency})</span>` : ''}
                            ${m.duration ? `<span class="med-dur">for ${m.duration}</span>` : ''}
                        </div>
                    `).join('')}
                </div>
            `;
            medContainer.style.display = 'block';
        }
    }

    // If prescription had special advice/diet notes
    if (rxData && rxData.notes && rxData.notes.trim()) {
        const notesContainer = document.getElementById('printedAdviceNotes');
        if (notesContainer) {
            notesContainer.innerHTML = `<strong>ADVICE / INSTRUCTIONS:</strong> ${rxData.notes}`;
            notesContainer.style.display = 'block';
        }
    }
}

// Run on load
loadPrescription();

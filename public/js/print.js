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

    let patient = null;
    let rxData = null;

    try {
        if (rxId) {
            const res = await fetch(`/api/prescriptions/${rxId}`);
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
            const res = await fetch(`/api/patients/${patientId}`);
            if (!res.ok) throw new Error('Patient record not found');
            patient = await res.json();
        }

        renderPrescription(patient, rxData);
    } catch (err) {
        document.getElementById('opdCard').innerHTML =
            `<div style="text-align:center;padding:4rem;font-size:14px;color:#c0392b;">${err.message}</div>`;
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
    let lastVisitDisplay = 'First Visit';
    if (rxData && rxData.previous_visit_date) {
        const lvd = new Date(rxData.previous_visit_date);
        lastVisitDisplay = lvd.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } else if (!rxData && patient.prescriptions && patient.prescriptions.length > 0) {
        const lvd = new Date(patient.prescriptions[0].created_at);
        lastVisitDisplay = lvd.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
    const pLastVisitEl = document.getElementById('pLastVisitDate');
    if (pLastVisitEl) pLastVisitEl.textContent = lastVisitDisplay;

    // Patient ID
    document.getElementById('pUniqueId').textContent = patient.patient_id;

    // Patient Address (Only Patient's address; if empty, leaves dashed line for pen writing)
    const pAddr = (patient.address && patient.address.trim()) || '';
    document.getElementById('pAddress').textContent = pAddr;

    // If prescription had complaints, show in Clinical Notes column
    if (rxData && rxData.complaints && rxData.complaints.trim()) {
        const compEl = document.getElementById('printedComplaints');
        compEl.innerHTML = `<strong>CHIEF COMPLAINTS:</strong> ${rxData.complaints}`;
        compEl.style.display = 'block';
    }
}

// Run on load
loadPrescription();

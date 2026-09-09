// ============================================================
// PRESCRIPTION SLIP — CLINICAL NOTES & ADVICE SCRIPT
// ============================================================

let currentLoadedPatient = null;
let currentLoadedRx = null;
let isBlankPadMode = false;

async function loadPrescription() {
    const params = new URLSearchParams(window.location.search);
    const rxId = params.get('rx');
    const patientId = params.get('patientId');
    const urlToken = params.get('token');
    const mode = params.get('mode');

    // Save token if provided in URL for seamless access
    if (urlToken) {
        try { localStorage.setItem('clinic_auth_token', urlToken); } catch (e) {}
    }
    const token = (typeof localStorage !== 'undefined' && localStorage.getItem('clinic_auth_token')) || urlToken || '';
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

    // 1. Check instant local cache for 0ms rendering
    let renderedFromCache = false;
    try {
        const rawCache = localStorage.getItem('clinic_print_data');
        if (rawCache) {
            const cached = JSON.parse(rawCache);
            const isRecent = (Date.now() - (cached.timestamp || 0)) < (4 * 60 * 60 * 1000); // 4 hours
            if (isRecent) {
                const rxMatch = rxId && cached.rx && (cached.rx.rx_id === rxId || String(cached.rx.id) === String(rxId));
                const ptMatch = patientId && cached.patient && (cached.patient.patient_id === patientId || String(cached.patient.id) === String(patientId));
                const generalMatch = !rxId && !patientId && (cached.rx || cached.patient);

                if (rxMatch || ptMatch || generalMatch) {
                    currentLoadedPatient = cached.patient || null;
                    currentLoadedRx = cached.rx || null;
                    renderPrescription(cached.patient, cached.rx, false);
                    renderedFromCache = true;
                }
            }
        }
    } catch (e) {
        console.warn('Cache read error:', e);
    }

    // 2. If explicit mode=blank requested and no cache was loaded
    if (mode === 'blank' && !renderedFromCache) {
        renderBlankPenPad();
        return;
    }

    // 3. Show subtle loading indicator only if not already rendered from cache
    const loadingEl = document.getElementById('opdLoadingMsg');
    if (!renderedFromCache && (rxId || patientId)) {
        if (loadingEl) loadingEl.style.display = 'block';
    }

    // 4. Fetch fresh details from API in background or if cache missed
    try {
        if (rxId) {
            const res = await fetch(`/api/prescriptions/${encodeURIComponent(rxId)}`, { headers });
            if (res.ok) {
                const rxData = await res.json();
                currentLoadedRx = rxData;
                const patient = {
                    name: rxData.name,
                    patient_id: rxData.patient_code || rxData.patient_id,
                    age: rxData.age,
                    gender: rxData.gender,
                    phone: rxData.phone,
                    address: rxData.address,
                    created_at: rxData.created_at,
                    last_visit_date: rxData.previous_visit_date,
                    prescriptions: (currentLoadedPatient && currentLoadedPatient.prescriptions) || []
                };
                currentLoadedPatient = patient;
                renderPrescription(patient, rxData, false);
            }
        } else if (patientId) {
            const res = await fetch(`/api/patients/${encodeURIComponent(patientId)}`, { headers });
            if (res.ok) {
                const patient = await res.json();
                currentLoadedPatient = patient;
                currentLoadedRx = null;
                renderPrescription(patient, null, false);
            }
        } else if (!renderedFromCache) {
            // No parameters & no cache -> show blank pad mode ready for pen writing
            renderBlankPenPad();
        }
    } catch (err) {
        console.error('Fetch error in print slip:', err);
        if (!renderedFromCache && !currentLoadedPatient) {
            renderBlankPenPad();
        }
    } finally {
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

// ── Render Filled Patient Prescription or OPD Slip ──
function renderPrescription(patient, rxData, forceBlank = false) {
    if (!patient && !rxData) {
        renderBlankPenPad();
        return;
    }
    isBlankPadMode = false;
    updateBlankToggleButton(false);

    const now = new Date((rxData && rxData.created_at) || (patient && patient.created_at) || Date.now());

    // Patient Fields
    const pName = (patient && patient.name) || (rxData && rxData.name) || '';
    const pAge = (patient && patient.age) || (rxData && rxData.age) || '';
    const pGender = (patient && patient.gender) || (rxData && rxData.gender) || '';
    const pMobile = (patient && patient.phone) || (rxData && rxData.phone) || '';
    const pId = (patient && patient.patient_id) || (rxData && (rxData.patient_code || rxData.patient_id)) || '';
    const pAddress = (patient && patient.address) || (rxData && rxData.address) || '';

    document.getElementById('pName').innerHTML = pName ? pName.toUpperCase() : '<span class="blank-line blank-line-lg"></span>';
    document.getElementById('pAge').innerHTML = pAge ? `${pAge} Yrs.` : '<span class="blank-line blank-line-sm"></span>';
    document.getElementById('pGender').innerHTML = pGender || '<span class="blank-line blank-line-sm"></span>';
    document.getElementById('pMobile').innerHTML = pMobile || '<span class="blank-line blank-line-md"></span>';
    document.getElementById('pUniqueId').innerHTML = pId || '<span class="blank-line blank-line-md"></span>';
    document.getElementById('pAddress').innerHTML = pAddress ? pAddress : '<span class="blank-line blank-line-full"></span>';

    // Visit Date with Day (e.g. 09/09/2026, Wednesday)
    const visitDateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const dayStr = now.toLocaleDateString('en-US', { weekday: 'long' });
    document.getElementById('pVisitDate').textContent = `${visitDateStr} (${dayStr})`;

    // Last Visit Date calculation as per last prescription
    let lastVisitDate = null;
    let isFirstVisit = false;

    if (rxData && rxData.previous_visit_date) {
        lastVisitDate = rxData.previous_visit_date;
    } else if (patient && Array.isArray(patient.prescriptions) && patient.prescriptions.length > 0) {
        if (rxData) {
            // Find the most recent prescription strictly before this rx
            const olderRxs = patient.prescriptions.filter(r => new Date(r.created_at) < new Date(rxData.created_at));
            if (olderRxs.length > 0) {
                lastVisitDate = olderRxs[0].created_at;
            } else {
                isFirstVisit = true;
            }
        } else {
            // Patient OPD blank slip: use their most recent prescription date
            lastVisitDate = patient.prescriptions[0].created_at;
        }
    } else if (patient && patient.last_visit_date) {
        const pCreated = new Date(patient.created_at).getTime();
        const pLast = new Date(patient.last_visit_date).getTime();
        if (pLast > pCreated) {
            lastVisitDate = patient.last_visit_date;
        } else {
            isFirstVisit = true;
        }
    } else {
        isFirstVisit = true;
    }

    let lastVisitDisplay = isFirstVisit ? 'First Visit' : '<span class="blank-line blank-line-md"></span>';
    if (lastVisitDate) {
        const lvd = new Date(lastVisitDate);
        if (!isNaN(lvd.getTime())) {
            lastVisitDisplay = lvd.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
        }
    }
    const pLastVisitEl = document.getElementById('pLastVisitDate');
    if (pLastVisitEl) pLastVisitEl.innerHTML = lastVisitDisplay;

    // Clinical Notes: Diagnosis and Chief Complaints
    const compEl = document.getElementById('printedComplaints');
    if (compEl) {
        if (rxData && ((rxData.complaints && rxData.complaints.trim()) || (rxData.diagnosis && rxData.diagnosis.trim()))) {
            let html = '';
            if (rxData.diagnosis && rxData.diagnosis.trim()) {
                html += `<strong>DIAGNOSIS:</strong> ${escapeHtml(rxData.diagnosis)}<br><br>`;
            }
            if (rxData.complaints && rxData.complaints.trim()) {
                html += `<strong>CHIEF COMPLAINTS:</strong> ${escapeHtml(rxData.complaints)}`;
            }
            compEl.innerHTML = html;
            compEl.style.display = 'block';
        } else {
            compEl.innerHTML = '';
            compEl.style.display = 'none';
        }
    }

    // Prescribed Medicines List
    const medContainer = document.getElementById('printedMedicinesList');
    if (medContainer) {
        if (rxData && Array.isArray(rxData.medicines) && rxData.medicines.length > 0) {
            medContainer.innerHTML = `
                <div class="printed-meds-table">
                    ${rxData.medicines.map((m, idx) => `
                        <div class="printed-med-row">
                            <span class="med-num">${idx + 1}.</span>
                            <span class="med-title">${escapeHtml(m.medicine_name)}</span>
                            ${m.dosage ? `<span class="med-dose">— ${escapeHtml(m.dosage)}</span>` : ''}
                            ${m.frequency ? `<span class="med-freq">(${escapeHtml(m.frequency)})</span>` : ''}
                            ${m.duration ? `<span class="med-dur">for ${escapeHtml(m.duration)}</span>` : ''}
                        </div>
                    `).join('')}
                </div>
            `;
            medContainer.style.display = 'block';
        } else {
            medContainer.innerHTML = '';
            medContainer.style.display = 'none';
        }
    }

    // Special Instructions / Advice Notes
    const notesContainer = document.getElementById('printedAdviceNotes');
    if (notesContainer) {
        if (rxData && rxData.notes && rxData.notes.trim()) {
            notesContainer.innerHTML = `<strong>ADVICE / INSTRUCTIONS:</strong> ${escapeHtml(rxData.notes)}`;
            notesContainer.style.display = 'block';
        } else {
            notesContainer.innerHTML = '';
            notesContainer.style.display = 'none';
        }
    }
}

// ── Render Clean Blank OPD Pad for Pen Writing ──
function renderBlankPenPad() {
    isBlankPadMode = true;
    updateBlankToggleButton(true);

    const now = new Date();
    const visitDateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const dayStr = now.toLocaleDateString('en-US', { weekday: 'long' });

    document.getElementById('pName').innerHTML = '<span class="blank-line blank-line-lg"></span>';
    document.getElementById('pAge').innerHTML = '<span class="blank-line blank-line-sm"></span>';
    document.getElementById('pGender').innerHTML = '<span class="blank-line blank-line-sm"></span>';
    document.getElementById('pMobile').innerHTML = '<span class="blank-line blank-line-md"></span>';
    document.getElementById('pVisitDate').textContent = `${visitDateStr} (${dayStr})`;
    document.getElementById('pLastVisitDate').innerHTML = '<span class="blank-line blank-line-md"></span>';
    document.getElementById('pUniqueId').innerHTML = '<span class="blank-line blank-line-md"></span>';
    document.getElementById('pAddress').innerHTML = '<span class="blank-line blank-line-full"></span>';

    const compEl = document.getElementById('printedComplaints');
    if (compEl) { compEl.innerHTML = ''; compEl.style.display = 'none'; }

    const medContainer = document.getElementById('printedMedicinesList');
    if (medContainer) { medContainer.innerHTML = ''; medContainer.style.display = 'none'; }

    const notesContainer = document.getElementById('printedAdviceNotes');
    if (notesContainer) { notesContainer.innerHTML = ''; notesContainer.style.display = 'none'; }
}

function updateBlankToggleButton(isBlank) {
    const btn = document.getElementById('blankToggleBtn');
    if (btn) {
        if (isBlank) {
            btn.textContent = '📋 Filled Prescription';
            btn.style.background = '#2563eb';
        } else {
            btn.textContent = '📝 Blank Pen Pad';
            btn.style.background = '#d97706';
        }
    }
}

function toggleBlankPadMode() {
    if (isBlankPadMode) {
        if (currentLoadedPatient || currentLoadedRx) {
            renderPrescription(currentLoadedPatient, currentLoadedRx, false);
        } else {
            loadPrescription();
        }
    } else {
        renderBlankPenPad();
    }
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Run on load
loadPrescription();

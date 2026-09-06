// ============================================================
// VIBRANT MEDICAL CLINIC DASHBOARD SCRIPT
// ============================================================

function showToast(msg, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = 'toast show' + (isError ? ' error' : '');
    setTimeout(() => toast.className = 'toast', 3500);
}

async function api(url, options = {}) {
    const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}

function getInitials(name) {
    if (!name) return 'PT';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// Avatar color palettes
const avatarGradients = [
    'linear-gradient(135deg, #0288d1, #0097a7)', // Ocean Cyan
    'linear-gradient(135deg, #2e7d32, #43a047)', // Emerald Green
    'linear-gradient(135deg, #6a1b9a, #8e24aa)', // Royal Purple
    'linear-gradient(135deg, #e65100, #f57c00)', // Sunset Orange
    'linear-gradient(135deg, #1565c0, #1e88e5)', // Sapphire Blue
    'linear-gradient(135deg, #c2185b, #d81b60)', // Crimson Pink
    'linear-gradient(135deg, #00695c, #00897b)'  // Deep Teal
];

function getAvatarStyle(name) {
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) hash += name.charCodeAt(i);
    const grad = avatarGradients[Math.abs(hash) % avatarGradients.length];
    return `background: ${grad}; color: white;`;
}

function formatVisitDate(dateStr) {
    if (!dateStr) return '—';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
        return dateStr;
    }
}

// ===== DOM References =====
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const searchResults = document.getElementById('searchResults');
const resultsTitle = document.getElementById('resultsTitle');
const resultsCount = document.getElementById('resultsCount');
const patientDetail = document.getElementById('patientDetail');
const newPatientBtn = document.getElementById('newPatientBtn');
const patientModal = document.getElementById('patientModal');
const cancelPatientBtn = document.getElementById('cancelPatientBtn');
const cancelPatientBtn2 = document.getElementById('cancelPatientBtn2');
const patientForm = document.getElementById('patientForm');
const detailNewRxBtn = document.getElementById('detailNewRxBtn');
const printBlankPadBtn = document.getElementById('printBlankPadBtn');
const editPatientBtn = document.getElementById('editPatientBtn');
const editPatientModal = document.getElementById('editPatientModal');
const editPatientForm = document.getElementById('editPatientForm');
const cancelEditPatientBtn = document.getElementById('cancelEditPatientBtn');
const cancelEditPatientBtn2 = document.getElementById('cancelEditPatientBtn2');
const deletePatientBtn = document.getElementById('deletePatientBtn');
const statCardPatients = document.getElementById('statCardPatients');
const viewAllSearchBtn = document.getElementById('viewAllSearchBtn');
const filterRecentBtn = document.getElementById('filterRecentBtn');
const filterAllBtn = document.getElementById('filterAllBtn');

let currentPatient = null;
let searchTimeout = null;
let currentViewMode = 'recent'; // 'recent' or 'all'

// ===== Update Live Date & Time =====
function updateDateBadge() {
    const el = document.getElementById('liveDateText');
    if (!el) return;
    const now = new Date();
    const options = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' };
    el.textContent = now.toLocaleDateString('en-IN', options);
}

// ===== Load Stats =====
async function loadStats() {
    try {
        const stats = await api('/api/patients/stats');
        document.getElementById('statPatients').textContent = stats.totalPatients || 0;
        document.getElementById('statPrescriptions').textContent = stats.totalPrescriptions || 0;
        document.getElementById('statToday').textContent = stats.todayPatients || 0;
    } catch (e) {
        // quiet fallback
    }
}

// ===== Load & Render Patients =====
async function doSearch(forceAll = false) {
    const q = searchInput.value.trim();

    if (forceAll) {
        currentViewMode = 'all';
    } else if (q) {
        currentViewMode = 'search';
    }

    // Update active tab styling
    if (filterRecentBtn && filterAllBtn) {
        if (currentViewMode === 'all') {
            filterAllBtn.classList.add('active-tab');
            filterRecentBtn.classList.remove('active-tab');
        } else if (currentViewMode === 'recent') {
            filterRecentBtn.classList.add('active-tab');
            filterAllBtn.classList.remove('active-tab');
        } else {
            filterRecentBtn.classList.remove('active-tab');
            filterAllBtn.classList.remove('active-tab');
        }
    }

    try {
        let url;
        if (q) {
            url = `/api/patients/search?q=${encodeURIComponent(q)}`;
        } else if (currentViewMode === 'all') {
            url = `/api/patients?all=true`;
        } else {
            url = `/api/patients/search`;
        }

        const patients = await api(url);

        resultsCount.textContent = `${patients.length} Patient${patients.length === 1 ? '' : 's'}`;
        if (q) {
            resultsTitle.textContent = `Search Results for "${q}"`;
        } else if (currentViewMode === 'all') {
            resultsTitle.textContent = `All Registered Patients`;
        } else {
            resultsTitle.textContent = `Recent Patients Directory`;
        }

        if (patients.length === 0) {
            searchResults.innerHTML = `
                <div class="empty-state-vibrant">
                    <div class="empty-icon-circle">🔍</div>
                    <h4>No patients found ${q ? `for "${q}"` : 'in database'}</h4>
                    <p>${q ? 'Would you like to register this patient now?' : 'Register your first patient to begin.'}</p>
                    <button class="btn btn-emerald btn-lg" onclick="openModalWithName('${(q || '').replace(/'/g, "\\'")}')">
                        + Register ${q ? `"${q}"` : 'New Patient'}
                    </button>
                </div>`;
            return;
        }

        searchResults.innerHTML = patients.map(p => `
            <div class="patient-card-vibrant" onclick="loadPatient('${p.patient_id}')">
                <div class="card-top-row">
                    <div class="patient-profile">
                        <div class="vibrant-avatar" style="${getAvatarStyle(p.name)}">
                            ${getInitials(p.name)}
                        </div>
                        <div>
                            <h4 class="patient-name">${p.name}</h4>
                            <div class="patient-meta-badges">
                                ${p.age ? `<span class="badge-pill badge-age">🎂 ${p.age} Yrs</span>` : ''}
                                ${p.gender ? `<span class="badge-pill badge-gender">⚧ ${p.gender}</span>` : ''}
                                ${p.phone ? `<span class="badge-pill badge-phone">📞 ${p.phone}</span>` : ''}
                                <span class="badge-pill badge-date">📅 Last Visit: ${formatVisitDate(p.last_visit_date || p.created_at)}</span>
                            </div>
                        </div>
                    </div>
                    <span class="id-badge-sharp">${p.patient_id}</span>
                </div>

                ${p.address ? `
                    <div class="card-address-row">
                        <span class="addr-pin">📍</span>
                        <span class="addr-text">${p.address}</span>
                    </div>
                ` : ''}

                <div class="card-actions-bar">
                    <button class="btn-rx-quick" onclick="event.stopPropagation(); window.location.href='/prescription.html?patientId=${p.patient_id}';" title="Write New Prescription for ${p.name}">
                        📝 New Prescription
                    </button>
                    <button class="btn btn-print-quick" onclick="event.stopPropagation(); window.open('/print.html?patientId=${p.patient_id}', '_blank');" title="Print Blank Pad">
                        🖨️ Print OPD Card
                    </button>
                    <button class="btn btn-edit-quick" onclick="event.stopPropagation(); openEditModal('${p.patient_id}');" title="Edit Patient Details">
                        ✏️ Edit
                    </button>
                    <button class="btn btn-delete-quick" onclick="event.stopPropagation(); deletePatient('${p.patient_id}', '${(p.name || '').replace(/'/g, "\\'")}');" title="Delete Patient Record">
                        🗑️ Delete
                    </button>
                </div>
            </div>
        `).join('');
    } catch (err) {
        showToast(err.message, true);
    }
}

function showAllPatients() {
    searchInput.value = '';
    currentViewMode = 'all';
    doSearch(true);
    const dirEl = document.getElementById('directorySection');
    if (dirEl) dirEl.scrollIntoView({ behavior: 'smooth' });
}

function showRecentPatients() {
    searchInput.value = '';
    currentViewMode = 'recent';
    doSearch();
}

// Instant debounced search
searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(doSearch, 250);
});

searchBtn.addEventListener('click', () => doSearch());
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        currentViewMode = 'recent';
        doSearch();
    });
}

if (viewAllSearchBtn) viewAllSearchBtn.addEventListener('click', showAllPatients);
if (filterAllBtn) filterAllBtn.addEventListener('click', showAllPatients);
if (filterRecentBtn) filterRecentBtn.addEventListener('click', showRecentPatients);
if (statCardPatients) statCardPatients.addEventListener('click', showAllPatients);

// ===== Load Selected Patient Details =====
async function loadPatient(patientId) {
    try {
        const data = await api(`/api/patients/${patientId}`);
        currentPatient = data;

        document.getElementById('detailName').textContent = data.name;
        document.getElementById('detailPatientId').textContent = data.patient_id;
        document.getElementById('detailAvatar').textContent = getInitials(data.name);
        document.getElementById('detailAvatar').style = getAvatarStyle(data.name);

        document.getElementById('detailAge').textContent = data.age ? data.age + ' Yrs' : '—';
        document.getElementById('detailGender').textContent = data.gender || '—';
        document.getElementById('detailPhone').textContent = data.phone || '—';
        document.getElementById('detailAddress').textContent = data.address || '—';
        const lastVisit = (data.prescriptions && data.prescriptions.length > 0 ? data.prescriptions[0].created_at : null)
            || data.last_visit_date
            || data.created_at;
        const detailLastVisitEl = document.getElementById('detailLastVisit');
        if (detailLastVisitEl) detailLastVisitEl.textContent = formatVisitDate(lastVisit);

        // History
        const rxHistory = document.getElementById('rxHistory');
        if (data.prescriptions && data.prescriptions.length > 0) {
            rxHistory.innerHTML = data.prescriptions.map(rx => `
                <div class="rx-history-card">
                    <div class="rx-card-info">
                        <span class="rx-pill">${rx.rx_id}</span>
                        <span class="rx-diag">${rx.diagnosis || rx.complaints || 'Prescription Entry'}</span>
                    </div>
                    <div class="flex gap-1" style="align-items:center;">
                        <span class="rx-date-text">📅 ${new Date(rx.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                        <button class="btn btn-emerald btn-sm" onclick="event.stopPropagation(); window.open('/print.html?rx=${rx.rx_id}', '_blank')">
                            🖨️ Print Slip
                        </button>
                    </div>
                </div>
            `).join('');
        } else {
            rxHistory.innerHTML = `
                <div class="empty-history-box">
                    <p>No past prescriptions recorded yet for ${data.name}. Click "Write New Prescription" to create one or "Print OPD Card" to generate a blank slip.</p>
                </div>`;
        }

        patientDetail.classList.remove('hidden');
        patientDetail.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
        showToast(err.message, true);
    }
}

// ===== Action Buttons =====
if (detailNewRxBtn) {
    detailNewRxBtn.addEventListener('click', () => {
        if (currentPatient) {
            window.location.href = `/prescription.html?patientId=${currentPatient.patient_id}`;
        }
    });
}

if (printBlankPadBtn) {
    printBlankPadBtn.addEventListener('click', () => {
        if (currentPatient) {
            window.open(`/print.html?patientId=${currentPatient.patient_id}`, '_blank');
        }
    });
}

// ===== New Patient Modal =====
function openModal() {
    patientModal.classList.add('active');
    setTimeout(() => patientForm.name.focus(), 100);
}

function openModalWithName(name) {
    openModal();
    if (name) patientForm.name.value = name;
}

function closeModal() {
    patientModal.classList.remove('active');
}

newPatientBtn.addEventListener('click', openModal);
cancelPatientBtn.addEventListener('click', closeModal);
cancelPatientBtn2.addEventListener('click', closeModal);
patientModal.addEventListener('click', e => {
    if (e.target === patientModal) closeModal();
});

patientForm.addEventListener('submit', async e => {
    e.preventDefault();
    const form = new FormData(patientForm);
    const body = Object.fromEntries(form.entries());

    try {
        const patient = await api('/api/patients', {
            method: 'POST',
            body: JSON.stringify(body)
        });
        showToast(`✓ Registered ${patient.name} (${patient.patient_id}) successfully!`);
        closeModal();
        patientForm.reset();

        // Refresh stats and directory
        loadStats();
        await loadPatient(patient.patient_id);
        await doSearch();
    } catch (err) {
        showToast(err.message, true);
    }
});

// ===== Edit Patient Modal =====
async function openEditModal(patientId) {
    try {
        const patient = await api(`/api/patients/${patientId}`);
        document.getElementById('editPatientId').value = patient.patient_id;
        document.getElementById('editPatientIdBadge').textContent = patient.patient_id;
        document.getElementById('editPatientName').value = patient.name || '';
        document.getElementById('editPatientAge').value = patient.age || '';
        document.getElementById('editPatientGender').value = patient.gender || '';
        document.getElementById('editPatientPhone').value = patient.phone || '';
        document.getElementById('editPatientAddress').value = patient.address || '';

        editPatientModal.classList.add('active');
        setTimeout(() => document.getElementById('editPatientName').focus(), 100);
    } catch (err) {
        showToast(err.message, true);
    }
}

function closeEditModal() {
    if (editPatientModal) editPatientModal.classList.remove('active');
}

if (editPatientBtn) {
    editPatientBtn.addEventListener('click', () => {
        if (currentPatient) {
            openEditModal(currentPatient.patient_id);
        }
    });
}

if (cancelEditPatientBtn) cancelEditPatientBtn.addEventListener('click', closeEditModal);
if (cancelEditPatientBtn2) cancelEditPatientBtn2.addEventListener('click', closeEditModal);

if (editPatientModal) {
    editPatientModal.addEventListener('click', e => {
        if (e.target === editPatientModal) closeEditModal();
    });
}

if (editPatientForm) {
    editPatientForm.addEventListener('submit', async e => {
        e.preventDefault();
        const patientId = document.getElementById('editPatientId').value;
        const body = {
            name: document.getElementById('editPatientName').value.trim(),
            age: document.getElementById('editPatientAge').value ? parseInt(document.getElementById('editPatientAge').value, 10) : null,
            gender: document.getElementById('editPatientGender').value,
            phone: document.getElementById('editPatientPhone').value.trim() || null,
            address: document.getElementById('editPatientAddress').value.trim() || null
        };

        try {
            const updated = await api(`/api/patients/${patientId}`, {
                method: 'PUT',
                body: JSON.stringify(body)
            });

            showToast(`✓ Patient ${updated.patient_id} (${updated.name}) details updated!`);
            closeEditModal();

            // Refresh current patient view if active
            if (currentPatient && currentPatient.patient_id === updated.patient_id) {
                await loadPatient(updated.patient_id);
            }
            // Refresh directory list
            await doSearch();
        } catch (err) {
            showToast(err.message, true);
        }
    });
}

// ===== Delete Patient =====
async function deletePatient(patientId, patientName) {
    const confirmDelete = confirm(`Are you sure you want to delete patient:\n\n${patientName} (${patientId})?\n\nThis will permanently remove their records.`);
    if (!confirmDelete) return;

    try {
        await api(`/api/patients/${patientId}`, { method: 'DELETE' });
        showToast(`✓ Patient ${patientId} (${patientName}) deleted.`);

        if (currentPatient && (currentPatient.patient_id === patientId || currentPatient.id === patientId)) {
            patientDetail.classList.add('hidden');
            currentPatient = null;
        }

        loadStats();
        await doSearch();
    } catch (err) {
        showToast(err.message, true);
    }
}

if (deletePatientBtn) {
    deletePatientBtn.addEventListener('click', () => {
        if (currentPatient) {
            deletePatient(currentPatient.patient_id, currentPatient.name);
        }
    });
}

// ===== Init on Page Load =====
updateDateBadge();
loadStats();
doSearch();


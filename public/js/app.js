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
    const token = localStorage.getItem('clinic_auth_token');
    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(options.headers || {})
    };
    const res = await fetch(url, {
        ...options,
        headers
    });
    if (res.status === 401) {
        localStorage.removeItem('clinic_auth_token');
        showLockScreen('Session expired. Please enter Doctor PIN.');
        throw new Error('Doctor authentication required');
    }
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
const tableContainer = document.getElementById('tableContainer');
const patientsTableBody = document.getElementById('patientsTableBody');
const resultsTitle = document.getElementById('resultsTitle');
const resultsCount = document.getElementById('resultsCount');
const patientDetail = document.getElementById('patientDetail');
const newPatientBtn = document.getElementById('newPatientBtn');
const patientModal = document.getElementById('patientModal');
const cancelPatientBtn = document.getElementById('cancelPatientBtn');
const cancelPatientBtn2 = document.getElementById('cancelPatientBtn2');
const patientForm = document.getElementById('patientForm');
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
const viewTableBtn = document.getElementById('viewTableBtn');
const viewCardsBtn = document.getElementById('viewCardsBtn');

// Multi-field filters
const filterName = document.getElementById('filterName');
const filterId = document.getElementById('filterId');
const filterVillage = document.getElementById('filterVillage');
const filterPhone = document.getElementById('filterPhone');
const sortOrderSelect = document.getElementById('sortOrderSelect');

let currentPatient = null;
let searchTimeout = null;
let currentViewMode = 'recent'; // 'recent' or 'all'
let loadedPatients = [];
let activeLayout = 'table'; // default to table view
let currentSortColumn = 'visit';
let currentSortDirection = 'desc';

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
}

function extractIdNum(id) {
    if (!id) return 0;
    const match = String(id).match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
}

// ===== Body Scroll Lock Manager (Prevents Background Window Scrolling Behind Modals) =====
function lockBodyScroll() {
    document.body.classList.add('modal-open');
    document.body.style.overflow = 'hidden';
}

function unlockBodyScroll() {
    const hasActiveModal = document.querySelector('.modal-overlay.active');
    const lockModal = document.getElementById('doctorLockModal');
    const isLockActive = lockModal && !lockModal.classList.contains('hidden');

    if (!hasActiveModal && !isLockActive) {
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
    }
}

// ===== Layout Switching =====
function setViewLayout(layout) {
    activeLayout = layout;
    if (layout === 'table') {
        if (tableContainer) tableContainer.classList.remove('hidden');
        if (searchResults) searchResults.classList.add('hidden');
        if (viewTableBtn) viewTableBtn.classList.add('active');
        if (viewCardsBtn) viewCardsBtn.classList.remove('active');
    } else {
        if (tableContainer) tableContainer.classList.add('hidden');
        if (searchResults) searchResults.classList.remove('hidden');
        if (viewCardsBtn) viewCardsBtn.classList.add('active');
        if (viewTableBtn) viewTableBtn.classList.remove('active');
    }
}

if (viewTableBtn) viewTableBtn.addEventListener('click', () => setViewLayout('table'));
if (viewCardsBtn) viewCardsBtn.addEventListener('click', () => setViewLayout('cards'));

// ===== Multi-Field Filter Helpers =====
function clearSpecificFilter(fieldId) {
    const el = document.getElementById(fieldId);
    if (el) {
        el.value = '';
        const wrap = el.closest('.filter-input-wrap');
        if (wrap) wrap.classList.remove('has-val');
    }
    applySortingAndRender();
}

function resetAllDirectoryFilters() {
    [filterName, filterId, filterVillage, filterPhone, searchInput].forEach(el => {
        if (el) {
            el.value = '';
            const wrap = el.closest('.filter-input-wrap');
            if (wrap) wrap.classList.remove('has-val');
        }
    });
    if (sortOrderSelect) sortOrderSelect.value = 'visit_desc';
    currentSortColumn = 'visit';
    currentSortDirection = 'desc';
    applySortingAndRender();
}

// Table Header Column Sorting
function handleThSort(column) {
    if (currentSortColumn === column) {
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        currentSortColumn = column;
        currentSortDirection = (column === 'name' || column === 'village' || column === 'id') ? 'asc' : 'desc';
    }

    const sortVal = `${column}_${currentSortDirection}`;
    if (sortOrderSelect) sortOrderSelect.value = sortVal;
    applySortingAndRender();
}

function updateSortIcons() {
    const sortHeaders = document.querySelectorAll('.sortable-th');
    sortHeaders.forEach(th => {
        const col = th.getAttribute('data-sort');
        const iconSpan = th.querySelector('.sort-icon');
        if (col === currentSortColumn) {
            th.classList.add('sort-active');
            if (iconSpan) iconSpan.textContent = currentSortDirection === 'asc' ? '▲' : '▼';
        } else {
            th.classList.remove('sort-active');
            if (iconSpan) iconSpan.textContent = '↕';
        }
    });
}

// ===== Filter, Sort & Render Engine =====
function applySortingAndRender() {
    const nameQ = (filterName ? filterName.value : '').trim().toLowerCase();
    const idQ = (filterId ? filterId.value : '').trim().toLowerCase();
    const villageQ = (filterVillage ? filterVillage.value : '').trim().toLowerCase();
    const phoneQ = (filterPhone ? filterPhone.value : '').trim().toLowerCase();
    const globalQ = (searchInput ? searchInput.value : '').trim().toLowerCase();

    // Toggle has-val on filter inputs for clear button visibility
    [
        { el: filterName, val: nameQ },
        { el: filterId, val: idQ },
        { el: filterVillage, val: villageQ },
        { el: filterPhone, val: phoneQ }
    ].forEach(({ el, val }) => {
        if (!el) return;
        const wrap = el.closest('.filter-input-wrap');
        if (wrap) wrap.classList.toggle('has-val', !!val);
    });

    // 1. Filter
    let filtered = loadedPatients.filter(p => {
        if (nameQ && !(p.name || '').toLowerCase().includes(nameQ)) return false;
        if (idQ && !(p.patient_id || '').toLowerCase().includes(idQ)) return false;
        if (villageQ && !(p.address || '').toLowerCase().includes(villageQ)) return false;
        if (phoneQ && !(p.phone || '').toLowerCase().includes(phoneQ)) return false;
        if (globalQ) {
            const mName = (p.name || '').toLowerCase().includes(globalQ);
            const mId = (p.patient_id || '').toLowerCase().includes(globalQ);
            const mVillage = (p.address || '').toLowerCase().includes(globalQ);
            const mPhone = (p.phone || '').toLowerCase().includes(globalQ);
            if (!mName && !mId && !mVillage && !mPhone) return false;
        }
        return true;
    });

    // 2. Sort
    const sortVal = sortOrderSelect ? sortOrderSelect.value : `${currentSortColumn}_${currentSortDirection}`;
    const [col, dir] = sortVal.split('_');
    currentSortColumn = col;
    currentSortDirection = dir;

    filtered.sort((a, b) => {
        let cmp = 0;
        switch (col) {
            case 'id':
                cmp = extractIdNum(a.patient_id) - extractIdNum(b.patient_id);
                break;
            case 'name':
                cmp = (a.name || '').localeCompare(b.name || '');
                break;
            case 'age':
                cmp = (Number(a.age) || 0) - (Number(b.age) || 0);
                break;
            case 'village':
                cmp = (a.address || '').localeCompare(b.address || '');
                break;
            case 'phone':
                cmp = (a.phone || '').localeCompare(b.phone || '');
                break;
            case 'visit':
            default:
                const dateA = new Date(a.last_visit_date || a.created_at || 0).getTime();
                const dateB = new Date(b.last_visit_date || b.created_at || 0).getTime();
                cmp = dateA - dateB;
                break;
        }
        return dir === 'desc' ? -cmp : cmp;
    });

    updateSortIcons();

    // 3. Update counter & title
    if (resultsCount) {
        resultsCount.textContent = `${filtered.length} Patient${filtered.length === 1 ? '' : 's'}`;
    }

    // 4. Render Table
    renderPatientsTable(filtered);

    // 5. Render Cards
    renderPatientsCards(filtered);
}

function renderPatientsTable(patients) {
    if (!patientsTableBody) return;

    if (patients.length === 0) {
        patientsTableBody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 3rem 1.5rem; color: #64748b;">
                    <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">🔍</div>
                    <div style="font-size: 1.05rem; font-weight: 700; color: #1e293b; margin-bottom: 0.25rem;">No matching patients found</div>
                    <div style="font-size: 0.85rem; margin-bottom: 1rem;">Try adjusting your search filters or clear your search criteria</div>
                    <button type="button" class="btn btn-sapphire btn-sm" onclick="resetAllDirectoryFilters()">
                        ✕ Clear All Filters
                    </button>
                </td>
            </tr>`;
        return;
    }

    patientsTableBody.innerHTML = patients.map(p => `
        <tr class="patient-table-row ${currentPatient && currentPatient.patient_id === p.patient_id ? 'row-selected' : ''}" 
            data-id="${p.patient_id}" 
            onclick="loadPatient('${p.patient_id}')">
            <td>
                <span class="pt-id-badge">${p.patient_id}</span>
            </td>
            <td>
                <div class="pt-name-cell">
                    <div class="pt-avatar-sm" style="${getAvatarStyle(p.name)}">
                        ${getInitials(p.name)}
                    </div>
                    <div>
                        <div class="pt-name-text">${escapeHtml(p.name)}</div>
                        <div class="pt-meta-text">Reg: ${formatVisitDate(p.created_at)}</div>
                    </div>
                </div>
            </td>
            <td>
                <div class="pt-age-text">${p.age ? `${p.age} Yrs` : '--'}</div>
                <div class="pt-meta-text">${p.gender || '--'}</div>
            </td>
            <td>
                <div class="pt-village-cell" title="${escapeHtml(p.address || '')}">
                    ${p.address ? `📍 ${escapeHtml(p.address)}` : '<span style="color:#94a3b8;">--</span>'}
                </div>
            </td>
            <td>
                ${p.phone ? `
                    <a href="tel:${p.phone}" class="pt-phone-link" onclick="event.stopPropagation()">
                        📞 ${p.phone}
                    </a>
                ` : '<span style="color:#94a3b8;">--</span>'}
            </td>
            <td>
                <span class="pt-visit-badge">📅 ${formatVisitDate(p.last_visit_date || p.created_at)}</span>
            </td>
            <td class="table-actions-cell">
                <div class="table-actions-wrap">
                    <button type="button" class="btn-tbl btn-tbl-view" onclick="event.stopPropagation(); loadPatient('${p.patient_id}');" title="View Patient Records">
                        👁️ View
                    </button>
                    <button type="button" class="btn-tbl btn-tbl-print" onclick="event.stopPropagation(); openPatientPrintSlip('${p.patient_id}');" title="Print OPD Card">
                        🖨️ Print
                    </button>
                    <button type="button" class="btn-tbl btn-tbl-edit" onclick="event.stopPropagation(); openEditModal('${p.patient_id}');" title="Edit Patient Details">
                        ✏️ Edit
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function renderPatientsCards(patients) {
    if (!searchResults) return;

    if (patients.length === 0) {
        searchResults.innerHTML = `
            <div class="empty-state-vibrant" style="grid-column: 1/-1;">
                <div class="empty-icon-circle">🔍</div>
                <h4>No patients match your search</h4>
                <p>Try clearing or changing your search filters.</p>
                <button class="btn btn-sapphire btn-lg" onclick="resetAllDirectoryFilters()">
                    ✕ Clear All Filters
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
                        <h4 class="patient-name">${escapeHtml(p.name)}</h4>
                        <div class="patient-meta-badges">
                            ${p.age ? `<span class="badge-pill badge-age">🎂 ${p.age} Yrs</span>` : ''}
                            ${p.gender ? `<span class="badge-pill badge-gender">⚧ ${p.gender}</span>` : ''}
                            ${p.phone ? `<span class="badge-pill badge-phone">📞 ${p.phone}</span>` : ''}
                            <span class="badge-pill badge-date">📅 Visit: ${formatVisitDate(p.last_visit_date || p.created_at)}</span>
                        </div>
                    </div>
                </div>
                <span class="id-badge-sharp">${p.patient_id}</span>
            </div>

            ${p.address ? `
                <div class="card-address-row">
                    <span class="addr-pin">📍</span>
                    <span class="addr-text">${escapeHtml(p.address)}</span>
                </div>
            ` : ''}

            <div class="card-actions-bar">
                <button class="btn btn-print-quick" onclick="event.stopPropagation(); openPatientPrintSlip('${p.patient_id}');" title="Print Blank Pad">
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
}

// ===== Update Live Date & Time =====
function updateDateBadge() {
    const el = document.getElementById('liveDateText');
    if (!el) return;
    const now = new Date();
    const options = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' };
    el.textContent = now.toLocaleDateString('en-IN', options);
}

// ===== Compute & Update Stats from Patient Array in 0ms =====
function updateStatsFromList(list) {
    if (!Array.isArray(list)) return;
    const todayStr = new Date().toDateString();
    let todayCount = 0;
    let rxCount = 0;
    list.forEach(p => {
        if (p.created_at) {
            try {
                if (new Date(p.created_at).toDateString() === todayStr) todayCount++;
            } catch (e) {}
        }
        if (Array.isArray(p.prescriptions)) {
            rxCount += p.prescriptions.length;
        } else if (p.last_visit_date && p.last_visit_date !== p.created_at) {
            rxCount++;
        }
    });

    const statPts = document.getElementById('statPatients');
    const statRx = document.getElementById('statPrescriptions');
    const statToday = document.getElementById('statToday');
    if (statPts) statPts.textContent = list.length;
    if (statRx) statRx.textContent = rxCount;
    if (statToday) statToday.textContent = todayCount;
}

// ===== Load Stats =====
async function loadStats() {
    if (loadedPatients.length > 0) {
        updateStatsFromList(loadedPatients);
        return;
    }
    try {
        const stats = await api('/api/patients/stats');
        document.getElementById('statPatients').textContent = stats.totalPatients || 0;
        document.getElementById('statPrescriptions').textContent = stats.totalPrescriptions || 0;
        document.getElementById('statToday').textContent = stats.todayPatients || 0;
    } catch (e) {}
}

// ===== Load & Search Patients (Instant Local Filter + Background Sync) =====
async function doSearch(forceRemote = false) {
    const q = searchInput ? searchInput.value.trim() : '';

    if (q) {
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

    // FAST-PATH: Filter and sort in browser RAM (0ms latency!)
    if (!forceRemote && loadedPatients.length > 0) {
        if (q) {
            if (resultsTitle) resultsTitle.textContent = `Search Results for "${q}"`;
        } else if (currentViewMode === 'all') {
            if (resultsTitle) resultsTitle.textContent = `All Registered Patients`;
        } else {
            if (resultsTitle) resultsTitle.textContent = `Recent Patients Directory`;
        }
        applySortingAndRender();
        return;
    }

    try {
        const patients = await api('/api/patients?all=true');
        loadedPatients = Array.isArray(patients) ? patients : [];
        try {
            localStorage.setItem('clinic_cached_patients', JSON.stringify(loadedPatients));
        } catch (e) {}

        updateStatsFromList(loadedPatients);

        if (q) {
            if (resultsTitle) resultsTitle.textContent = `Search Results for "${q}"`;
        } else if (currentViewMode === 'all') {
            if (resultsTitle) resultsTitle.textContent = `All Registered Patients`;
        } else {
            if (resultsTitle) resultsTitle.textContent = `Recent Patients Directory`;
        }

        applySortingAndRender();
    } catch (err) {
        showToast(err.message, true);
    }
}

function showAllPatients() {
    currentViewMode = 'all';
    setViewLayout('table');
    doSearch(true);
    const dirEl = document.getElementById('directorySection');
    if (dirEl) dirEl.scrollIntoView({ behavior: 'smooth' });
}

function showRecentPatients() {
    currentViewMode = 'recent';
    doSearch();
}

// Debounced live input on global search
if (searchInput) {
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            if (loadedPatients.length > 0 && currentViewMode === 'all') {
                applySortingAndRender();
            } else {
                doSearch();
            }
        }, 200);
    });
    searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
}

if (searchBtn) searchBtn.addEventListener('click', () => doSearch());

if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        currentViewMode = 'recent';
        doSearch();
    });
}

// Multi-field live input event listeners
[filterName, filterId, filterVillage, filterPhone].forEach(input => {
    if (input) {
        input.addEventListener('input', () => {
            if (currentViewMode !== 'all' && input.value.trim().length > 0 && loadedPatients.length <= 25) {
                // If searching specific fields and not all patients loaded, load all for complete results
                showAllPatients();
            } else {
                applySortingAndRender();
            }
        });
        input.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                input.value = '';
                applySortingAndRender();
            }
        });
    }
});

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
        const lastVisit = data.last_visit_date || (data.prescriptions && data.prescriptions[0] ? data.prescriptions[0].created_at : data.created_at);
        const detailLastVisitEl = document.getElementById('detailLastVisit');
        if (detailLastVisitEl) detailLastVisitEl.textContent = formatVisitDate(lastVisit);

        // Highlight selected row in table
        document.querySelectorAll('.patient-table-row').forEach(row => {
            row.classList.toggle('row-selected', row.getAttribute('data-id') === data.patient_id);
        });

        // History
        const rxHistory = document.getElementById('rxHistory');
        if (data.prescriptions && data.prescriptions.length > 0) {
            rxHistory.innerHTML = data.prescriptions.map(rx => `
                <div class="rx-history-card-enhanced">
                    <div class="rx-card-top">
                        <div class="rx-id-group">
                            <span class="rx-code-pill">${rx.rx_id}</span>
                            <span class="rx-date-pill">📅 Visit: ${formatVisitDate(rx.created_at)}</span>
                            ${rx.next_visit_date ? `<span class="rx-next-pill">⏭️ Next Visit: ${formatVisitDate(rx.next_visit_date)}</span>` : ''}
                            ${rx.previous_visit_date ? `<span class="rx-prev-pill">⏮️ Last Visit: ${formatVisitDate(rx.previous_visit_date)}</span>` : ''}
                        </div>
                        <div class="rx-card-actions" style="display: flex; gap: 0.4rem; align-items: center;">
                            <button class="btn btn-emerald btn-sm" onclick="event.stopPropagation(); openRxPrintSlip('${rx.rx_id}')" title="Print this OPD Prescription Slip">
                                🖨️ Print Slip
                            </button>
                            <button class="btn btn-tbl-delete btn-sm" onclick="event.stopPropagation(); handleDeletePrescription('${rx.rx_id}')" title="Delete this prescription">
                                🗑️ Delete
                            </button>
                        </div>
                    </div>

                    ${(rx.complaints || rx.diagnosis || rx.tests) ? `
                        <div class="rx-clinical-row">
                            ${rx.diagnosis ? `<div><strong>Diagnosis:</strong> <span class="rx-diag-text">${escapeHtml(rx.diagnosis)}</span></div>` : ''}
                            ${rx.complaints ? `<div><strong>Chief Complaints:</strong> <span class="rx-comp-text">${escapeHtml(rx.complaints)}</span></div>` : ''}
                            ${rx.tests ? `<div><strong>Recommended Tests:</strong> <span class="rx-test-text">🧪 ${escapeHtml(rx.tests)}</span></div>` : ''}
                        </div>
                    ` : ''}

                    <!-- Prescribed Medicines -->
                    <div class="rx-medicines-box">
                        <div class="rx-meds-heading">℞ Prescribed Medicines (${(rx.medicines && rx.medicines.length) || 0}):</div>
                        ${(rx.medicines && rx.medicines.length > 0) ? `
                            <div class="rx-meds-grid">
                                ${rx.medicines.map(m => `
                                    <div class="rx-med-chip">
                                        <div class="med-name-badge">💊 ${escapeHtml(m.medicine_name)}</div>
                                        <div class="med-dosage-text">
                                            ${m.dosage ? `<span>${escapeHtml(m.dosage)}</span>` : ''}
                                            ${m.frequency ? `<span>· ${escapeHtml(m.frequency)}</span>` : ''}
                                            ${m.duration ? `<span>· for ${escapeHtml(m.duration)}</span>` : ''}
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        ` : `
                            <div class="rx-no-digital-meds">
                                ✍️ Notes and medicines written with pen on printed OPD card
                            </div>
                        `}
                    </div>

                    ${rx.notes ? `
                        <div class="rx-notes-row">
                            <strong>Advice / Diet:</strong> ${escapeHtml(rx.notes)}
                        </div>
                    ` : ''}
                </div>
            `).join('');
        } else {
            rxHistory.innerHTML = `
                <div class="empty-history-box">
                    <div class="empty-history-icon">💊</div>
                    <p class="empty-history-title">No past prescriptions recorded yet for ${escapeHtml(data.name)}.</p>
                    <p class="empty-history-desc">Click below to prescribe medicines or print a blank OPD slip.</p>
                    <div class="flex gap-1" style="justify-content: center;">
                        <button class="btn btn-emerald btn-lg" onclick="openAddRxModal()">
                            💊 + Write First Prescription
                        </button>
                    </div>
                </div>`;
        }

        patientDetail.classList.remove('hidden');
        patientDetail.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
        showToast(err.message, true);
    }
}

// ===== Print OPD & Prescription Helpers (Instant Local Cache + Network Token) =====
function openPatientPrintSlip(patientId) {
    const pt = (currentPatient && (currentPatient.patient_id === patientId || String(currentPatient.id) === String(patientId)))
        ? currentPatient
        : (loadedPatients.find(p => p.patient_id === patientId || String(p.id) === String(patientId)) || currentPatient);

    const token = localStorage.getItem('clinic_auth_token') || '';
    if (pt) {
        localStorage.setItem('clinic_print_data', JSON.stringify({
            patient: pt,
            rx: null,
            timestamp: Date.now()
        }));
    }
    const targetId = (pt && pt.patient_id) || patientId;
    window.open(`/print.html?patientId=${encodeURIComponent(targetId)}&token=${encodeURIComponent(token)}`, '_blank');
}

function openRxPrintSlip(rxId) {
    const token = localStorage.getItem('clinic_auth_token') || '';
    let foundRx = null;
    if (currentPatient && Array.isArray(currentPatient.prescriptions)) {
        foundRx = currentPatient.prescriptions.find(r => r.rx_id === rxId || String(r.id) === String(rxId));
    }
    if (currentPatient && foundRx) {
        // Calculate prior visit before this rx
        const older = currentPatient.prescriptions.filter(r => new Date(r.created_at) < new Date(foundRx.created_at));
        const prevVisitDate = older.length > 0 ? older[0].created_at : null;

        localStorage.setItem('clinic_print_data', JSON.stringify({
            patient: currentPatient,
            rx: {
                ...foundRx,
                name: currentPatient.name,
                patient_code: currentPatient.patient_id,
                age: currentPatient.age,
                gender: currentPatient.gender,
                phone: currentPatient.phone,
                address: currentPatient.address,
                previous_visit_date: foundRx.previous_visit_date || prevVisitDate
            },
            timestamp: Date.now()
        }));
    }
    window.open(`/print.html?rx=${encodeURIComponent(rxId)}&token=${encodeURIComponent(token)}`, '_blank');
}

// ===== Delete Prescription Handler =====
async function handleDeletePrescription(rxId) {
    if (!rxId) return;
    const confirmed = window.confirm(`Are you sure you want to permanently delete prescription ${rxId}?\nThis action cannot be undone.`);
    if (!confirmed) return;

    try {
        await api(`/api/prescriptions/${encodeURIComponent(rxId)}`, {
            method: 'DELETE'
        });
        showToast(`🗑️ Prescription ${rxId} deleted.`);

        if (currentPatient) {
            // Remove from patient prescriptions
            if (Array.isArray(currentPatient.prescriptions)) {
                currentPatient.prescriptions = currentPatient.prescriptions.filter(
                    r => r.rx_id !== rxId && String(r.id) !== String(rxId)
                );
            }

            // Recalculate last_visit_date and next_visit_date
            if (currentPatient.prescriptions && currentPatient.prescriptions.length > 0) {
                currentPatient.last_visit_date = currentPatient.prescriptions[0].created_at;
                currentPatient.next_visit_date = currentPatient.prescriptions[0].next_visit_date || null;
            } else {
                currentPatient.last_visit_date = currentPatient.created_at;
                currentPatient.next_visit_date = null;
            }

            // Sync with loadedPatients cache
            const idx = loadedPatients.findIndex(p => p.patient_id === currentPatient.patient_id || String(p.id) === String(currentPatient.id));
            if (idx !== -1) {
                loadedPatients[idx].last_visit_date = currentPatient.last_visit_date;
                loadedPatients[idx].next_visit_date = currentPatient.next_visit_date;
                try { localStorage.setItem('clinic_cached_patients', JSON.stringify(loadedPatients)); } catch (_) {}
                applySortingAndRender();
            }

            // Re-render patient details immediately
            loadPatient(currentPatient.patient_id);
        }
    } catch (err) {
        showToast(err.message, true);
    }
}

// ===== Action Buttons =====
if (printBlankPadBtn) {
    printBlankPadBtn.addEventListener('click', () => {
        if (currentPatient) {
            openPatientPrintSlip(currentPatient.patient_id);
        } else {
            window.open('/print.html?mode=blank', '_blank');
        }
    });
}

// ===== New Patient Modal =====
function openModal() {
    patientModal.classList.add('active');
    lockBodyScroll();
    setTimeout(() => patientForm.name.focus(), 100);
}

function openModalWithName(name) {
    openModal();
    if (name) patientForm.name.value = name;
}

function closeModal() {
    patientModal.classList.remove('active');
    unlockBodyScroll();
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

        // Immediately update memory and localStorage cache (0ms!)
        loadedPatients.unshift(patient);
        try { localStorage.setItem('clinic_cached_patients', JSON.stringify(loadedPatients)); } catch (err) {}
        updateStatsFromList(loadedPatients);
        applySortingAndRender();

        loadPatient(patient.patient_id);
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
        lockBodyScroll();
        setTimeout(() => document.getElementById('editPatientName').focus(), 100);
    } catch (err) {
        showToast(err.message, true);
    }
}

function closeEditModal() {
    if (editPatientModal) editPatientModal.classList.remove('active');
    unlockBodyScroll();
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

            showToast(`✓ Patient ${updated.patient_id || patientId} details updated!`);
            closeEditModal();

            // Immediately update patient in memory (0ms!)
            const idx = loadedPatients.findIndex(p => p.patient_id === patientId || String(p.id) === String(patientId));
            if (idx !== -1) {
                loadedPatients[idx] = { ...loadedPatients[idx], ...body };
                try { localStorage.setItem('clinic_cached_patients', JSON.stringify(loadedPatients)); } catch (err) {}
                applySortingAndRender();
            }

            // Refresh current patient view if active
            loadPatient(patientId);
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

        // Immediately remove from memory (0ms!)
        loadedPatients = loadedPatients.filter(p => p.patient_id !== patientId && String(p.id) !== String(patientId));
        try { localStorage.setItem('clinic_cached_patients', JSON.stringify(loadedPatients)); } catch (err) {}
        updateStatsFromList(loadedPatients);
        applySortingAndRender();
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

// ===== Add Prescription Modal & Medicine Prescribing =====
const prescriptionModal = document.getElementById('prescriptionModal');

function openAddRxModal() {
    if (!currentPatient) {
        showToast('Please select a patient first to write a prescription.', true);
        return;
    }

    const modalAvatar = document.getElementById('rxModalAvatar');
    const modalName = document.getElementById('rxModalPatientName');
    const modalId = document.getElementById('rxModalPatientId');
    const modalSub = document.getElementById('rxModalPatientSub');
    const rxPatientId = document.getElementById('rxPatientId');
    const rxPrevDate = document.getElementById('rxPreviousVisitDate');
    const todayDateEl = document.getElementById('rxModalTodayDate');
    const lastVisitText = document.getElementById('rxModalLastVisitText');
    const lastVisitPill = document.getElementById('rxModalLastVisitPill');

    if (modalAvatar) {
        modalAvatar.textContent = getInitials(currentPatient.name);
        modalAvatar.style = getAvatarStyle(currentPatient.name);
    }
    if (modalName) modalName.textContent = currentPatient.name;
    if (modalId) modalId.textContent = currentPatient.patient_id;
    if (modalSub) {
        modalSub.textContent = `${currentPatient.age ? currentPatient.age + ' Yrs, ' : ''}${currentPatient.gender || ''} · ${currentPatient.address || ''}`;
    }
    if (rxPatientId) rxPatientId.value = currentPatient.patient_id;

    if (todayDateEl) {
        todayDateEl.textContent = new Date().toLocaleDateString('en-IN', {
            weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
        });
    }

    // Determine last visit date as per last prescription created
    let prevDate = null;
    if (currentPatient.prescriptions && currentPatient.prescriptions.length > 0) {
        prevDate = currentPatient.prescriptions[0].created_at;
    }

    if (prevDate) {
        if (rxPrevDate) rxPrevDate.value = prevDate;
        if (lastVisitText) lastVisitText.textContent = formatVisitDate(prevDate);
        if (lastVisitPill) lastVisitPill.className = 'visit-date-pill pill-last';
    } else {
        if (rxPrevDate) rxPrevDate.value = '';
        if (lastVisitText) lastVisitText.textContent = 'First Visit (No prior Rx)';
        if (lastVisitPill) lastVisitPill.className = 'visit-date-pill pill-today';
    }

    // Reset inputs
    const compEl = document.getElementById('rxComplaints');
    const diagEl = document.getElementById('rxDiagnosis');
    const testsEl = document.getElementById('rxTests');
    const notesEl = document.getElementById('rxNotes');
    const nextVisitEl = document.getElementById('rxNextVisitDate');
    if (compEl) compEl.value = '';
    if (diagEl) diagEl.value = '';
    if (testsEl) testsEl.value = '';
    if (notesEl) notesEl.value = '';
    if (nextVisitEl) nextVisitEl.value = '';
    updateNextVisitDisplay();

    // Clear and add 2 initial medicine rows
    const medContainer = document.getElementById('medicinesListContainer');
    if (medContainer) {
        medContainer.innerHTML = '';
        addMedicineRow('', '4 pills', '3 times daily', '7 Days');
        addMedicineRow('', '10 drops', 'Morning & Evening', '15 Days');
    }

    if (prescriptionModal) prescriptionModal.classList.add('active');
    lockBodyScroll();
}

function closeAddRxModal() {
    if (prescriptionModal) prescriptionModal.classList.remove('active');
    unlockBodyScroll();
}

if (prescriptionModal) {
    prescriptionModal.addEventListener('click', e => {
        if (e.target === prescriptionModal) closeAddRxModal();
    });
}

// ============================================================
// MASTER MEDICINE CATALOG & AUTOCOMPLETE SYSTEM
// ============================================================

let cachedMedicinesCatalog = [];

async function loadMedicinesCatalog() {
    try {
        const meds = await api('/api/medicines');
        cachedMedicinesCatalog = Array.isArray(meds) ? meds : [];
        updateMedicineDatalist();
        const countEl = document.getElementById('navMedicineCount');
        if (countEl) countEl.textContent = cachedMedicinesCatalog.length;
    } catch (e) {
        console.warn('Could not load medicines catalog:', e.message);
    }
}

function updateMedicineDatalist() {
    const datalist = document.getElementById('medicineDatalist');
    if (!datalist) return;
    const options = [];
    cachedMedicinesCatalog.forEach(m => {
        // Base medicine name
        options.push(`<option value="${escapeHtml(m.name)}">${m.indication ? `— ${escapeHtml(m.indication)}` : ''}</option>`);
        // Expanded with common powers/potencies
        const potencies = Array.isArray(m.common_potencies) ? m.common_potencies : (m.common_potencies ? String(m.common_potencies).split(',') : []);
        potencies.forEach(p => {
            const cleanP = p.trim();
            if (cleanP) {
                options.push(`<option value="${escapeHtml(m.name)} ${escapeHtml(cleanP)}">Power: ${escapeHtml(cleanP)}</option>`);
            }
        });
    });
    datalist.innerHTML = options.join('');
}

function addMedicineRow(name = '', power = '200C', dosage = '4 pills', frequency = '3 times daily', duration = '7 Days') {
    const container = document.getElementById('medicinesListContainer');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'medicine-row-card';
    row.innerHTML = `
        <input type="text" class="med-input med-input-name" placeholder="Medicine Name (e.g. Arnica Montana)" value="${escapeHtml(name)}" list="medicineDatalist" autocomplete="off">
        <input type="text" class="med-input med-input-power" placeholder="Power (e.g. 200C)" value="${escapeHtml(power)}" list="powerDatalist" autocomplete="off">
        <input type="text" class="med-input med-input-dosage" placeholder="Dose (e.g. 4 pills)" value="${escapeHtml(dosage)}">
        <input type="text" class="med-input med-input-frequency" placeholder="Frequency (e.g. 3 times daily)" value="${escapeHtml(frequency)}">
        <input type="text" class="med-input med-input-duration" placeholder="Duration (e.g. 7 Days)" value="${escapeHtml(duration)}">
        <button type="button" class="btn-del-med" onclick="this.closest('.medicine-row-card').remove()" title="Remove Medicine">✕</button>
    `;
    container.appendChild(row);

    const nameInput = row.querySelector('.med-input-name');
    const powerInput = row.querySelector('.med-input-power');

    if (nameInput) {
        nameInput.addEventListener('input', () => {
            let val = nameInput.value.trim();
            if (!val) return;

            // Check if user selected suggestion with power attached (e.g. "Arnica Montana 200C")
            const powerRegex = /\b(Q|30C|200C|1M|10M|50M|CM|3X|6X|12X|30X|200X|0\/1|0\/2|0\/3|0\/6)\b/i;
            const match = val.match(powerRegex);
            if (match) {
                const detectedPower = match[0].toUpperCase();
                const cleanMedName = val.replace(powerRegex, '').trim();
                nameInput.value = cleanMedName;
                if (powerInput) powerInput.value = detectedPower;
                val = cleanMedName;
            }

            const matched = cachedMedicinesCatalog.find(m => m.name.toLowerCase() === val.toLowerCase());
            if (matched) {
                const dosageInput = row.querySelector('.med-input-dosage');
                const freqInput = row.querySelector('.med-input-frequency');
                const durInput = row.querySelector('.med-input-duration');
                if (dosageInput && matched.default_dosage) dosageInput.value = matched.default_dosage;
                if (freqInput && matched.default_frequency) freqInput.value = matched.default_frequency;
                if (durInput && matched.default_duration) durInput.value = matched.default_duration;
                if (powerInput && (!powerInput.value || powerInput.value === '200C') && Array.isArray(matched.common_potencies) && matched.common_potencies[0]) {
                    powerInput.value = matched.common_potencies[0];
                }
            }
        });
        if (!name) nameInput.focus();
    }
}

function applyQuickPotency(potency) {
    const rows = document.querySelectorAll('#medicinesListContainer .medicine-row-card');
    if (rows.length === 0) {
        addMedicineRow('', potency);
        return;
    }
    const lastRow = rows[rows.length - 1];
    const powerInput = lastRow.querySelector('.med-input-power');
    if (powerInput) {
        powerInput.value = potency;
        powerInput.focus();
    }
}

// ── Master Catalog Modal Handlers ──
function openMedicineCatalogModal() {
    const modal = document.getElementById('medicineCatalogModal');
    if (modal) modal.classList.add('active');
    lockBodyScroll();
    renderMedicineCatalog(cachedMedicinesCatalog);
    const searchInput = document.getElementById('catalogSearchInput');
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
    }
}

function closeMedicineCatalogModal() {
    const modal = document.getElementById('medicineCatalogModal');
    if (modal) modal.classList.remove('active');
    unlockBodyScroll();
}

function renderMedicineCatalog(list) {
    const tbody = document.getElementById('medicineCatalogTableBody');
    const countText = document.getElementById('catalogCountText');
    if (!tbody) return;

    if (!Array.isArray(list) || list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #94a3b8; padding: 2rem;">No medicines found in database.</td></tr>`;
        if (countText) countText.textContent = '0 medicines in database';
        return;
    }

    if (countText) countText.textContent = `Showing ${list.length} medicines in database`;

    tbody.innerHTML = list.map(m => {
        const potencies = Array.isArray(m.common_potencies) ? m.common_potencies : (m.common_potencies ? String(m.common_potencies).split(',') : []);
        const potencyBadges = potencies.map(p => `<span class="med-potency-badge">${escapeHtml(p.trim())}</span>`).join('');
        return `
            <tr>
                <td>
                    <strong style="color: #1e293b; font-size: 0.92rem;">${escapeHtml(m.name)}</strong>
                </td>
                <td>
                    ${potencyBadges || '<span style="color:#94a3b8;">--</span>'}
                </td>
                <td>
                    <div style="font-weight: 600; color: #0f172a;">${escapeHtml(m.default_dosage || '4 pills')}</div>
                    <div style="font-size: 0.75rem; color: #64748b;">${escapeHtml(m.default_frequency || '3 times daily')} · for ${escapeHtml(m.default_duration || '7 Days')}</div>
                </td>
                <td>
                    <span style="font-size: 0.8rem; color: #475569;">${escapeHtml(m.indication || '--')}</span>
                </td>
                <td style="text-align: center;">
                    <button type="button" class="btn-del-catalog-med" onclick="deleteMedicineFromCatalog('${escapeHtml(m.name).replace(/'/g, "\\'")}')" title="Delete Medicine">
                        🗑️ Delete
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function filterMedicineCatalog() {
    const q = (document.getElementById('catalogSearchInput')?.value || '').trim().toLowerCase();
    if (!q) {
        renderMedicineCatalog(cachedMedicinesCatalog);
        return;
    }
    const filtered = cachedMedicinesCatalog.filter(m => {
        const nameM = (m.name || '').toLowerCase().includes(q);
        const indM = (m.indication || '').toLowerCase().includes(q);
        const potM = Array.isArray(m.common_potencies) ? m.common_potencies.some(p => p.toLowerCase().includes(q)) : false;
        return nameM || indM || potM;
    });
    renderMedicineCatalog(filtered);
}

// ── Add Medicine Modal Handlers ──
function openAddMedicineModal() {
    const modal = document.getElementById('addMedicineModal');
    if (modal) modal.classList.add('active');
    lockBodyScroll();
    const nameInput = document.getElementById('newMedName');
    if (nameInput) {
        nameInput.value = '';
        nameInput.focus();
    }
}

function closeAddMedicineModal() {
    const modal = document.getElementById('addMedicineModal');
    if (modal) modal.classList.remove('active');
    unlockBodyScroll();
}

async function handleSaveNewMedicine(event) {
    event.preventDefault();
    const btn = document.getElementById('saveNewMedBtn');
    const name = document.getElementById('newMedName')?.value.trim();
    if (!name) return;

    const rawPotencies = document.getElementById('newMedPotencies')?.value || '30C, 200C, 1M, Q';
    const potencies = rawPotencies.split(',').map(p => p.trim()).filter(Boolean);
    const dosage = document.getElementById('newMedDosage')?.value.trim() || '4 pills';
    const frequency = document.getElementById('newMedFrequency')?.value.trim() || '3 times daily';
    const duration = document.getElementById('newMedDuration')?.value.trim() || '7 Days';
    const indication = document.getElementById('newMedIndication')?.value.trim() || '';

    try {
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Saving...';
        }

        const newMed = await api('/api/medicines', {
            method: 'POST',
            body: JSON.stringify({
                name,
                common_potencies: potencies,
                default_dosage: dosage,
                default_frequency: frequency,
                default_duration: duration,
                indication
            })
        });

        // Add to local cache immediately
        cachedMedicinesCatalog.push(newMed);
        cachedMedicinesCatalog.sort((a, b) => a.name.localeCompare(b.name));
        updateMedicineDatalist();

        const countEl = document.getElementById('navMedicineCount');
        if (countEl) countEl.textContent = cachedMedicinesCatalog.length;

        showToast(`✅ Medicine "${name}" added to database!`);
        closeAddMedicineModal();
        renderMedicineCatalog(cachedMedicinesCatalog);

        // If prescription modal has empty medicine row, auto-fill it
        const emptyNameInput = document.querySelector('#medicinesListContainer .medicine-row-card:last-child .med-input-name');
        if (emptyNameInput && !emptyNameInput.value) {
            emptyNameInput.value = name;
            const parentRow = emptyNameInput.closest('.medicine-row-card');
            if (parentRow) {
                const dosageInput = parentRow.querySelector('.med-input-dosage');
                const freqInput = parentRow.querySelector('.med-input-frequency');
                const durInput = parentRow.querySelector('.med-input-duration');
                if (dosageInput) dosageInput.value = dosage;
                if (freqInput) freqInput.value = frequency;
                if (durInput) durInput.value = duration;
            }
        }
    } catch (err) {
        showToast(err.message, true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '✓ Save Medicine to Database';
        }
    }
}

async function deleteMedicineFromCatalog(name) {
    if (!confirm(`Are you sure you want to delete "${name}" from the clinic database?`)) return;

    try {
        await api(`/api/medicines/${encodeURIComponent(name)}`, { method: 'DELETE' });
        cachedMedicinesCatalog = cachedMedicinesCatalog.filter(m => m.name.toLowerCase() !== name.toLowerCase());
        updateMedicineDatalist();
        const countEl = document.getElementById('navMedicineCount');
        if (countEl) countEl.textContent = cachedMedicinesCatalog.length;
        renderMedicineCatalog(cachedMedicinesCatalog);
        showToast(`🗑️ Medicine "${name}" removed from database.`);
    } catch (err) {
        showToast(err.message, true);
    }
}

function appendRxTest(testName) {
    const el = document.getElementById('rxTests');
    if (!el) return;
    const current = el.value.trim();
    if (!current) {
        el.value = testName;
    } else {
        const tests = current.split(',').map(t => t.trim().toLowerCase());
        if (!tests.includes(testName.toLowerCase())) {
            el.value = current + ', ' + testName;
        }
    }
    el.focus();
}

function setNextVisitDays(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const input = document.getElementById('rxNextVisitDate');
    if (input) {
        input.value = dateStr;
        updateNextVisitDisplay();
    }
}

function clearNextVisit() {
    const input = document.getElementById('rxNextVisitDate');
    if (input) {
        input.value = '';
        updateNextVisitDisplay();
    }
}

function updateNextVisitDisplay() {
    const input = document.getElementById('rxNextVisitDate');
    const display = document.getElementById('rxNextVisitCalculated');
    if (!input || !display) return;
    if (!input.value) {
        display.textContent = '';
        return;
    }
    const parts = input.value.split('-');
    if (parts.length < 3) {
        display.textContent = '';
        return;
    }
    const [y, m, d] = parts.map(Number);
    const targetDate = new Date(y, m - 1, d);
    if (isNaN(targetDate.getTime())) {
        display.textContent = '';
        return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffTime = targetDate.getTime() - today.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    let relStr = '';
    if (diffDays === 7) relStr = 'in 1 week';
    else if (diffDays === 14 || diffDays === 15) relStr = 'in 15 days';
    else if (diffDays >= 28 && diffDays <= 31) relStr = 'in 1 month';
    else if (diffDays >= 58 && diffDays <= 62) relStr = 'in 2 months';
    else if (diffDays > 0) relStr = `in ${diffDays} days`;
    else if (diffDays === 0) relStr = 'Today';
    else relStr = `${Math.abs(diffDays)} days ago`;

    const formatted = targetDate.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    display.textContent = `✓ ${formatted} (${relStr})`;
}

async function savePrescriptionData() {
    const patientId = document.getElementById('rxPatientId')?.value || currentPatient?.patient_id;
    if (!patientId) throw new Error('No patient selected.');

    const complaints = document.getElementById('rxComplaints')?.value.trim() || '';
    const diagnosis = document.getElementById('rxDiagnosis')?.value.trim() || '';
    const tests = document.getElementById('rxTests')?.value.trim() || '';
    const nextVisitDate = document.getElementById('rxNextVisitDate')?.value.trim() || null;
    const notes = document.getElementById('rxNotes')?.value.trim() || '';
    const previousVisitDate = document.getElementById('rxPreviousVisitDate')?.value || null;

    const medicineRows = document.querySelectorAll('#medicinesListContainer .medicine-row-card');
    const medicines = [];
    medicineRows.forEach(row => {
        const name = row.querySelector('.med-input-name')?.value.trim() || '';
        const power = row.querySelector('.med-input-power')?.value.trim() || '';
        const dosage = row.querySelector('.med-input-dosage')?.value.trim() || '';
        const frequency = row.querySelector('.med-input-frequency')?.value.trim() || '';
        const duration = row.querySelector('.med-input-duration')?.value.trim() || '';
        if (name) {
            const fullName = power ? `${name} ${power}` : name;
            medicines.push({
                medicine_name: fullName,
                power: power,
                dosage,
                frequency,
                duration
            });
        }
    });

    const body = {
        patient_id: patientId,
        complaints,
        diagnosis,
        tests,
        next_visit_date: nextVisitDate,
        notes,
        medicines,
        previous_visit_date: previousVisitDate
    };

    const newRx = await api('/api/prescriptions', {
        method: 'POST',
        body: JSON.stringify(body)
    });

    return newRx;
}

async function handleSavePrescription(event) {
    if (event) event.preventDefault();
    const saveBtn = document.getElementById('saveRxBtn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }

    try {
        const newRx = await savePrescriptionData();
        showToast(`✓ Prescription ${newRx.rx_id} saved successfully!`);
        closeAddRxModal();

        // Update in-memory patient & cache immediately (0ms!)
        if (currentPatient) {
            currentPatient.last_visit_date = newRx.created_at || new Date().toISOString();
            if (newRx.next_visit_date) {
                currentPatient.next_visit_date = newRx.next_visit_date;
            }
            if (!currentPatient.prescriptions) currentPatient.prescriptions = [];
            currentPatient.prescriptions.unshift(newRx);

            const idx = loadedPatients.findIndex(p => p.patient_id === currentPatient.patient_id || String(p.id) === String(currentPatient.id));
            if (idx !== -1) {
                loadedPatients[idx].last_visit_date = currentPatient.last_visit_date;
                if (newRx.next_visit_date) {
                    loadedPatients[idx].next_visit_date = newRx.next_visit_date;
                }
                try { localStorage.setItem('clinic_cached_patients', JSON.stringify(loadedPatients)); } catch (e) {}
                applySortingAndRender();
            }
            loadPatient(currentPatient.patient_id);
        }
        updateStatsFromList(loadedPatients);
    } catch (err) {
        showToast(err.message, true);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = '✓ Save Prescription';
        }
    }
}

async function handleSaveAndPrintPrescription(event) {
    if (event) event.preventDefault();
    const printBtn = document.getElementById('saveAndPrintRxBtn');
    if (printBtn) {
        printBtn.disabled = true;
        printBtn.textContent = 'Saving & Opening Print...';
    }

    try {
        const newRx = await savePrescriptionData();
        showToast(`✓ Prescription ${newRx.rx_id} saved! Opening OPD slip...`);
        closeAddRxModal();

        // Update in-memory patient & cache immediately (0ms!)
        if (currentPatient) {
            currentPatient.last_visit_date = newRx.created_at || new Date().toISOString();
            if (!currentPatient.prescriptions) currentPatient.prescriptions = [];
            currentPatient.prescriptions.unshift(newRx);

            const idx = loadedPatients.findIndex(p => p.patient_id === currentPatient.patient_id || String(p.id) === String(currentPatient.id));
            if (idx !== -1) {
                loadedPatients[idx].last_visit_date = currentPatient.last_visit_date;
                try { localStorage.setItem('clinic_cached_patients', JSON.stringify(loadedPatients)); } catch (e) {}
                applySortingAndRender();
            }
        }
        updateStatsFromList(loadedPatients);

        // Extract medicines for immediate print display
        const medicineRows = document.querySelectorAll('#medicinesListContainer .medicine-row-card');
        const meds = [];
        medicineRows.forEach(row => {
            const name = row.querySelector('.med-input-name')?.value.trim() || '';
            const dosage = row.querySelector('.med-input-dosage')?.value.trim() || '';
            const frequency = row.querySelector('.med-input-frequency')?.value.trim() || '';
            const duration = row.querySelector('.med-input-duration')?.value.trim() || '';
            if (name) meds.push({ medicine_name: name, dosage, frequency, duration });
        });
        const prevVisitDate = document.getElementById('rxPreviousVisitDate')?.value || null;

        const token = localStorage.getItem('clinic_auth_token') || '';
        localStorage.setItem('clinic_print_data', JSON.stringify({
            patient: currentPatient,
            rx: {
                ...newRx,
                medicines: (newRx.medicines && newRx.medicines.length > 0) ? newRx.medicines : meds,
                name: currentPatient ? currentPatient.name : '',
                patient_code: currentPatient ? currentPatient.patient_id : '',
                age: currentPatient ? currentPatient.age : '',
                gender: currentPatient ? currentPatient.gender : '',
                phone: currentPatient ? currentPatient.phone : '',
                address: currentPatient ? currentPatient.address : '',
                previous_visit_date: prevVisitDate
            },
            timestamp: Date.now()
        }));

        // Open print slip in new tab with token query fallback
        window.open(`/print.html?rx=${encodeURIComponent(newRx.rx_id)}&token=${encodeURIComponent(token)}`, '_blank');

        if (currentPatient) {
            loadPatient(currentPatient.patient_id);
        }
    } catch (err) {
        showToast(err.message, true);
    } finally {
        if (printBtn) {
            printBtn.disabled = false;
            printBtn.textContent = '🖨️ Save & Print OPD Slip';
        }
    }
}

// ===== Doctor Security & Lock Screen =====
const doctorLockModal = document.getElementById('doctorLockModal');
const doctorPinInput = document.getElementById('doctorPinInput');
const lockErrorMsg = document.getElementById('lockErrorMsg');
const rememberDeviceCheck = document.getElementById('rememberDeviceCheck');

function showLockScreen(errMsg = null) {
    if (doctorLockModal) {
        doctorLockModal.classList.remove('hidden');
        lockBodyScroll();
        if (errMsg) {
            lockErrorMsg.textContent = errMsg;
            lockErrorMsg.style.display = 'flex';
        } else {
            lockErrorMsg.style.display = 'none';
        }
        if (doctorPinInput) {
            doctorPinInput.value = '';
            setTimeout(() => doctorPinInput.focus(), 150);
        }
    }
}

function hideLockScreen() {
    if (doctorLockModal) {
        doctorLockModal.classList.add('hidden');
        unlockBodyScroll();
        if (lockErrorMsg) lockErrorMsg.style.display = 'none';
        if (doctorPinInput) doctorPinInput.value = '';
    }
}

function togglePinVisibility() {
    if (!doctorPinInput) return;
    const isPass = doctorPinInput.type === 'password';
    doctorPinInput.type = isPass ? 'text' : 'password';
    const btn = document.getElementById('togglePasswordVisibility');
    if (btn) btn.textContent = isPass ? '🔒' : '👁️';
}

function appendPin(num) {
    if (!doctorPinInput) return;
    doctorPinInput.value += num;
    doctorPinInput.focus();
}

function clearPin() {
    if (!doctorPinInput) return;
    doctorPinInput.value = '';
    doctorPinInput.focus();
}

function backspacePin() {
    if (!doctorPinInput) return;
    doctorPinInput.value = doctorPinInput.value.slice(0, -1);
    doctorPinInput.focus();
}

// ── Appointments Management ──
let cachedAppointments = [];
let activeApptStatusFilter = 'all';

async function loadAppointments(showRefreshToast = false) {
    const token = localStorage.getItem('clinic_auth_token');
    if (!token) return;

    try {
        const res = await fetch('/api/appointments', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        cachedAppointments = await res.json();
        updateAppointmentsBadgeAndStats();
        renderAppointmentsTable();
        if (showRefreshToast) {
            showToast('✓ Appointments refreshed');
        }
    } catch (err) {
        console.error('Failed to load appointments:', err);
    }
}

function updateAppointmentsBadgeAndStats() {
    const pendingCount = cachedAppointments.filter(a => a.status === 'Pending').length;
    const navBadge = document.getElementById('navAppointmentCount');
    if (navBadge) navBadge.textContent = pendingCount;

    const statCount = document.getElementById('statAppointmentsCount');
    if (statCount) statCount.textContent = cachedAppointments.length;

    const statPending = document.getElementById('statAppointmentsPending');
    if (statPending) statPending.textContent = pendingCount;
}

function openAppointmentsModal() {
    const modal = document.getElementById('appointmentsManagerModal');
    if (modal) modal.classList.add('active');
    lockBodyScroll();
    loadAppointments();
    const searchInput = document.getElementById('apptSearchInput');
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
    }
}

function closeAppointmentsModal() {
    const modal = document.getElementById('appointmentsManagerModal');
    if (modal) modal.classList.remove('active');
    unlockBodyScroll();
}

function setApptStatusFilter(status) {
    activeApptStatusFilter = status;
    document.querySelectorAll('.appt-status-tabs .appt-tab').forEach(btn => {
        if (btn.getAttribute('data-status') === status) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    filterAppointments();
}

function clearApptDateFilter() {
    const dateInput = document.getElementById('apptDateFilter');
    if (dateInput) {
        dateInput.value = '';
        filterAppointments();
    }
}

function filterAppointments() {
    const search = (document.getElementById('apptSearchInput')?.value || '').toLowerCase().trim();
    const dateVal = document.getElementById('apptDateFilter')?.value || '';

    const filtered = cachedAppointments.filter(appt => {
        if (activeApptStatusFilter !== 'all' && appt.status !== activeApptStatusFilter) {
            return false;
        }
        if (dateVal && appt.preferred_date !== dateVal) {
            return false;
        }
        if (search) {
            const ref = (appt.reference_no || '').toLowerCase();
            const name = (appt.name || '').toLowerCase();
            const mobile = (appt.mobile || '').toLowerCase();
            const address = (appt.address || '').toLowerCase();
            const ptId = (appt.patient_id || '').toLowerCase();
            const type = (appt.patient_type || '').toLowerCase();
            const reason = (appt.reason || '').toLowerCase();
            if (!ref.includes(search) && !name.includes(search) && !mobile.includes(search) && !address.includes(search) && !ptId.includes(search) && !type.includes(search) && !reason.includes(search)) {
                return false;
            }
        }
        return true;
    });

    renderAppointmentsTable(filtered);
}

function renderAppointmentsTable(list = null) {
    const tbody = document.getElementById('appointmentsTableBody');
    const countText = document.getElementById('apptCountText');
    if (!tbody) return;

    const items = list !== null ? list : cachedAppointments;

    if (countText) {
        const pending = cachedAppointments.filter(a => a.status === 'Pending').length;
        countText.textContent = `Showing ${items.length} of ${cachedAppointments.length} appointments (${pending} Pending)`;
    }

    if (!Array.isArray(items) || items.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; color: #94a3b8; padding: 2.5rem;">
                    <div style="font-size: 1.5rem; margin-bottom: 0.5rem;">📅</div>
                    <div>No appointments found matching your criteria.</div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = items.map(appt => {
        const statusClass = `appt-status-${(appt.status || 'pending').toLowerCase()}`;
        const cleanPhone = escapeHtml(appt.mobile || '');
        const refNo = escapeHtml(appt.reference_no || '');
        const isExisting = appt.patient_type === 'existing';
        
        return `
            <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 0.75rem;">
                    <span class="appt-ref-badge">${refNo}</span>
                    <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px;">
                        ${new Date(appt.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                </td>
                <td style="padding: 0.75rem;">
                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <strong style="color: #0f172a; font-size: 0.95rem;">${escapeHtml(appt.name)}</strong>
                        ${isExisting 
                            ? `<span style="background: #e0f2fe; color: #0369a1; font-size: 0.72rem; font-weight: 700; padding: 1px 6px; border-radius: 4px; border: 1px solid #bae6fd;">🔄 PT: ${escapeHtml(appt.patient_id || 'ID')}</span>` 
                            : `<span style="background: #f0fdf4; color: #15803d; font-size: 0.72rem; font-weight: 700; padding: 1px 6px; border-radius: 4px; border: 1px solid #bbf7d0;">🌱 New</span>`
                        }
                    </div>
                    ${(appt.age || appt.gender) ? `
                        <div style="color: #64748b; font-size: 0.8rem; margin-top: 2px;">
                            ${appt.age ? `Age: <strong>${appt.age}</strong>` : ''} ${appt.gender ? `&nbsp;|&nbsp; Gender: <strong>${escapeHtml(appt.gender)}</strong>` : ''}
                        </div>
                    ` : ''}
                    ${appt.address ? `<div style="color: #0f766e; font-size: 0.78rem; margin-top: 2px; font-weight: 500;">📍 ${escapeHtml(appt.address)}</div>` : ''}
                </td>
                <td style="padding: 0.75rem;">
                    <a href="tel:${cleanPhone}" style="color: #0369a1; text-decoration: none; font-weight: 600;">
                        📞 ${cleanPhone}
                    </a>
                    <div style="margin-top: 3px;">
                        <a href="https://wa.me/91${cleanPhone}?text=Hello%20${encodeURIComponent(appt.name)}%2C%20regarding%20your%20appointment%20${encodeURIComponent(refNo)}%20at%20Bangali%20Homeopathic%20Clinic..." 
                           target="_blank" style="color: #15803d; font-size: 0.75rem; text-decoration: none; font-weight: 600;">
                           💬 WhatsApp
                        </a>
                    </div>
                </td>
                <td style="padding: 0.75rem;">
                    <strong style="color: #1e293b; font-size: 0.9rem;">${escapeHtml(appt.preferred_date)}</strong>
                </td>
                <td style="padding: 0.75rem;">
                    <div style="color: #334155; font-size: 0.85rem; max-width: 220px; word-break: break-word;">
                        ${escapeHtml(appt.reason)}
                    </div>
                </td>
                <td style="padding: 0.75rem;">
                    <select class="appt-status-select ${statusClass}" onchange="handleUpdateApptStatus('${refNo}', this.value)">
                        <option value="Pending" ${appt.status === 'Pending' ? 'selected' : ''}>⏳ Pending</option>
                        <option value="Confirmed" ${appt.status === 'Confirmed' ? 'selected' : ''}>✅ Confirmed</option>
                        <option value="Completed" ${appt.status === 'Completed' ? 'selected' : ''}>🩺 Completed</option>
                        <option value="Cancelled" ${appt.status === 'Cancelled' ? 'selected' : ''}>🚫 Cancelled</option>
                    </select>
                </td>
                <td style="padding: 0.75rem; text-align: center; white-space: nowrap;">
                    <button type="button" class="btn-convert-appt" onclick="convertAppointmentToPatient('${refNo}')" title="Register this appointment as an OPD Patient">
                        🩺 Convert to OPD
                    </button>
                    <button type="button" class="btn-del-catalog-med" onclick="handleDeleteAppointment('${refNo}')" title="Delete appointment" style="margin-left: 4px;">
                        🗑️
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

async function handleUpdateApptStatus(refNo, newStatus) {
    const token = localStorage.getItem('clinic_auth_token');
    if (!token) return;

    try {
        const res = await fetch(`/api/appointments/${encodeURIComponent(refNo)}/status`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: newStatus })
        });
        if (!res.ok) throw new Error('Failed to update status');

        const appt = cachedAppointments.find(a => a.reference_no === refNo);
        if (appt) appt.status = newStatus;
        updateAppointmentsBadgeAndStats();
        filterAppointments();
        showToast(`✓ Appointment ${refNo} marked as ${newStatus}`);
    } catch (err) {
        showToast('❌ Failed to update status: ' + err.message);
    }
}

async function handleDeleteAppointment(refNo) {
    if (!confirm(`Are you sure you want to delete appointment ${refNo}?`)) return;

    const token = localStorage.getItem('clinic_auth_token');
    if (!token) return;

    try {
        const res = await fetch(`/api/appointments/${encodeURIComponent(refNo)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to delete');

        cachedAppointments = cachedAppointments.filter(a => a.reference_no !== refNo);
        updateAppointmentsBadgeAndStats();
        filterAppointments();
        showToast(`✓ Appointment ${refNo} deleted`);
    } catch (err) {
        showToast('❌ Failed to delete: ' + err.message);
    }
}

async function convertAppointmentToPatient(refNo) {
    let appt = cachedAppointments.find(a => a.reference_no === refNo);

    // If not found in cache, fetch directly
    if (!appt) {
        const token = localStorage.getItem('clinic_auth_token');
        if (token) {
            try {
                const res = await fetch(`/api/appointments?q=${encodeURIComponent(refNo)}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const list = await res.json();
                    if (Array.isArray(list) && list.length > 0) {
                        appt = list[0];
                    }
                }
            } catch (_) {}
        }
    }

    if (!appt) {
        showToast('❌ Could not find appointment details.');
        return;
    }

    closeAppointmentsModal();

    const pForm = document.getElementById('patientForm');
    if (pForm) pForm.reset();

    // Open Modal
    const modal = document.getElementById('patientModal');
    if (modal) modal.classList.add('active');

    // Populate all fields reliably
    const nameInput = document.getElementById('patientName') || (pForm ? pForm.elements['name'] : null);
    const ageInput = document.getElementById('patientAge') || (pForm ? pForm.elements['age'] : null);
    const genderSelect = document.getElementById('patientGender') || (pForm ? pForm.elements['gender'] : null);
    const phoneInput = document.getElementById('patientPhone') || (pForm ? pForm.elements['phone'] : null);
    const addressInput = document.getElementById('patientAddress') || (pForm ? pForm.elements['address'] : null);

    if (nameInput) nameInput.value = appt.name || '';
    if (ageInput) ageInput.value = appt.age || '';
    if (genderSelect) genderSelect.value = appt.gender || 'Male';
    if (phoneInput) phoneInput.value = appt.mobile || '';
    if (addressInput) addressInput.value = appt.address || (appt.reason ? `Appt: ${refNo} | ${appt.reason}` : '');

    setTimeout(() => {
        if (nameInput) {
            nameInput.focus();
            nameInput.select();
        }
    }, 100);

    showToast(`✓ Pre-filled patient form for ${appt.name} (${refNo})`);
}

async function handleDoctorLogin(event) {
    if (event) event.preventDefault();
    const pin = (doctorPinInput ? doctorPinInput.value : '').trim();
    if (!pin) {
        showLockError('Please enter Doctor PIN or Password.');
        return;
    }

    const remember = rememberDeviceCheck ? rememberDeviceCheck.checked : true;
    const submitBtn = document.getElementById('unlockBtn');
    const submitBtnText = document.getElementById('unlockBtnText');

    if (submitBtn) submitBtn.disabled = true;
    if (submitBtnText) submitBtnText.textContent = 'Verifying...';

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin, remember })
        });
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Incorrect PIN or Password');
        }

        // Store token in localStorage
        localStorage.setItem('clinic_auth_token', data.token);
        hideLockScreen();
        showToast('✓ Welcome back, Dr. Bakshi!');

        // Refresh dashboard data
        loadStats();
        loadMedicinesCatalog();
        loadAppointments();
        doSearch();
    } catch (err) {
        showLockError(err.message);
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (submitBtnText) submitBtnText.textContent = '🔓 Unlock OPD Dashboard';
    }
}

function showLockError(msg) {
    if (lockErrorMsg) {
        lockErrorMsg.textContent = msg;
        lockErrorMsg.style.display = 'flex';
        lockErrorMsg.style.animation = 'none';
        lockErrorMsg.offsetHeight; // Trigger reflow for animation restart
        lockErrorMsg.style.animation = 'lockShake 0.35s ease';
    }
    if (doctorPinInput) {
        doctorPinInput.classList.add('input-error');
        doctorPinInput.focus();
        doctorPinInput.select();
    }
}

function clearLockError() {
    if (lockErrorMsg) {
        lockErrorMsg.textContent = '';
        lockErrorMsg.style.display = 'none';
    }
    if (doctorPinInput) {
        doctorPinInput.classList.remove('input-error');
    }
}

function appendPin(digit) {
    if (!doctorPinInput) return;
    clearLockError();
    if (doctorPinInput.value.length < 16) {
        doctorPinInput.value += digit;
    }
    doctorPinInput.focus();
}

function togglePinVisibility() {
    if (!doctorPinInput) return;
    const isPass = doctorPinInput.type === 'password';
    doctorPinInput.type = isPass ? 'text' : 'password';
    const btn = document.getElementById('togglePasswordVisibility');
    if (btn) btn.textContent = isPass ? '🙈' : '👁️';
}

function lockClinicApp() {
    localStorage.removeItem('clinic_auth_token');
    showToast('✓ Logged out successfully');
    showLockScreen('You have logged out. Enter Doctor PIN to log back in.');
}

async function initAuthAndApp() {
    updateDateBadge();
    const token = localStorage.getItem('clinic_auth_token');
    if (!token) {
        showLockScreen();
        return;
    }

    // 1. Instant 0ms render from browser localStorage cache
    try {
        const cachedRaw = localStorage.getItem('clinic_cached_patients');
        if (cachedRaw) {
            const cachedList = JSON.parse(cachedRaw);
            if (Array.isArray(cachedList) && cachedList.length > 0) {
                loadedPatients = cachedList;
                applySortingAndRender();
                updateStatsFromList(cachedList);
            }
        }
    } catch (e) {}

    try {
        const res = await fetch('/api/auth/verify', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            localStorage.removeItem('clinic_auth_token');
            showLockScreen('Session expired. Please enter Doctor PIN.');
            return;
        }
        hideLockScreen();
        loadMedicinesCatalog();
        loadAppointments();
        // 2. Fetch fresh updates from server in background
        doSearch(true);
    } catch {
        // In case of temporary offline/network hiccup, proceed if token is cached
        hideLockScreen();
        loadMedicinesCatalog();
        loadAppointments();
        doSearch(true);
    }
}

// ── Backdrop Clicks & Escape Key to Close Modals Cleanly ──
const apptsModal = document.getElementById('appointmentsManagerModal');
if (apptsModal) {
    apptsModal.addEventListener('click', e => {
        if (e.target === apptsModal) closeAppointmentsModal();
    });
}
const medCatModal = document.getElementById('medicineCatalogModal');
if (medCatModal) {
    medCatModal.addEventListener('click', e => {
        if (e.target === medCatModal) closeMedicineCatalogModal();
    });
}
const addMedModal = document.getElementById('addMedicineModal');
if (addMedModal) {
    addMedModal.addEventListener('click', e => {
        if (e.target === addMedModal) closeAddMedicineModal();
    });
}

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        const addMed = document.getElementById('addMedicineModal');
        if (addMed && addMed.classList.contains('active')) {
            closeAddMedicineModal();
            return;
        }
        const medCat = document.getElementById('medicineCatalogModal');
        if (medCat && medCat.classList.contains('active')) {
            closeMedicineCatalogModal();
            return;
        }
        const appts = document.getElementById('appointmentsManagerModal');
        if (appts && appts.classList.contains('active')) {
            closeAppointmentsModal();
            return;
        }
        if (prescriptionModal && prescriptionModal.classList.contains('active')) {
            closeAddRxModal();
            return;
        }
        if (editPatientModal && editPatientModal.classList.contains('active')) {
            closeEditModal();
            return;
        }
        if (patientModal && patientModal.classList.contains('active')) {
            closeModal();
            return;
        }
    }
});

// ===== Dark Mode Theme Manager =====
function toggleDarkMode() {
    const isDark = document.body.classList.toggle('dark-mode');
    document.documentElement.classList.toggle('dark-mode', isDark);
    try {
        localStorage.setItem('clinic_theme', isDark ? 'dark' : 'light');
        localStorage.setItem('clinic_admin_theme', isDark ? 'dark' : 'light');
    } catch (_) {}
    updateThemeToggleUI(isDark);
    showToast(isDark ? '🌙 Dark Mode Enabled' : '☀️ Light Mode Enabled');
}

function updateThemeToggleUI(isDark) {
    const btn = document.getElementById('darkModeToggleBtn');
    if (!btn) return;
    if (isDark) {
        btn.innerHTML = '☀️ <span class="theme-toggle-text">Light Mode</span>';
        btn.setAttribute('title', 'Switch to Light Mode');
    } else {
        btn.innerHTML = '🌙 <span class="theme-toggle-text">Dark Mode</span>';
        btn.setAttribute('title', 'Switch to Dark Mode');
    }
}

function initTheme() {
    let isDark = false;
    try {
        const saved = localStorage.getItem('clinic_theme') || localStorage.getItem('clinic_admin_theme');
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        isDark = saved === 'dark' || (!saved && prefersDark);
    } catch (_) {}

    if (isDark) {
        document.body.classList.add('dark-mode');
        document.documentElement.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
        document.documentElement.classList.remove('dark-mode');
    }
    updateThemeToggleUI(isDark);
}

// Initialize theme immediately
initTheme();

// If lock screen is displayed on initial page load, freeze body scroll immediately
if (doctorLockModal && !doctorLockModal.classList.contains('hidden')) {
    lockBodyScroll();
}

// ===== Init on Page Load =====
initAuthAndApp();



// ===== Utility =====
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
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// ===== State =====
let patientData = null;
let medCounter = 0;

// ===== Load Patient Info =====
async function loadPatient() {
    const params = new URLSearchParams(window.location.search);
    const patientId = params.get('patientId');
    if (!patientId) {
        showToast('No patient selected!', true);
        return;
    }

    try {
        patientData = await api(`/api/patients/${patientId}`);
        document.getElementById('rxPatientName').textContent = patientData.name;
        document.getElementById('rxPatientId').textContent = patientData.patient_id;
        document.getElementById('rxPatientAvatar').textContent = getInitials(patientData.name);

        const meta = [];
        if (patientData.age) meta.push(patientData.age + ' yrs');
        if (patientData.gender) meta.push(patientData.gender);
        if (patientData.phone) meta.push('📞 ' + patientData.phone);
        document.getElementById('rxPatientMeta').textContent = meta.join(' · ');

        const addrEl = document.getElementById('rxPatientAddress');
        if (addrEl) {
            addrEl.textContent = patientData.address ? '🏠 Address: ' + patientData.address : '🏠 Address: Not recorded';
        }
    } catch (err) {
        showToast(err.message, true);
    }
}

// ===== Options for Complaint (Chips) =====
const complaintsInput = document.getElementById('complaintsInput');
const complaintChips = document.querySelectorAll('.complaint-chip');
const clearComplaintsBtn = document.getElementById('clearComplaintsBtn');

complaintChips.forEach(chip => {
    chip.addEventListener('click', () => {
        chip.classList.toggle('active');
        updateComplaintsText();
    });
});

function updateComplaintsText() {
    const selected = [];
    document.querySelectorAll('.complaint-chip.active').forEach(chip => {
        selected.push(chip.dataset.val);
    });

    // Merge with any custom text that was typed
    const currentText = complaintsInput.value.trim();
    // Get all chip values to identify existing chips
    const allChipValues = Array.from(complaintChips).map(c => c.dataset.val);
    
    // Extract non-chip custom parts if doctor typed extra things
    const parts = currentText ? currentText.split(',').map(s => s.trim()).filter(Boolean) : [];
    const customParts = parts.filter(p => !allChipValues.includes(p));

    const combined = [...selected, ...customParts];
    complaintsInput.value = combined.join(', ');
}

if (clearComplaintsBtn) {
    clearComplaintsBtn.addEventListener('click', () => {
        document.querySelectorAll('.complaint-chip.active').forEach(chip => chip.classList.remove('active'));
        complaintsInput.value = '';
    });
}

// ===== Medicine Rows =====
function addMedicineRow() {
    medCounter++;
    const tbody = document.getElementById('medicinesBody');
    const tr = document.createElement('tr');
    tr.id = `medRow-${medCounter}`;
    tr.innerHTML = `
        <td>${medCounter}</td>
        <td>
            <input type="text" 
                   class="med-name-input" 
                   list="commonRemedies" 
                   name="med_name_${medCounter}" 
                   placeholder="e.g. Nux Vomica 200C / Arnica 30C / Q" 
                   autocomplete="off" 
                   required>
        </td>
        <td><input type="text" name="med_dosage_${medCounter}" placeholder="e.g. 4 pills / 10 drops"></td>
        <td><input type="text" name="med_freq_${medCounter}" placeholder="e.g. BD (Twice daily)"></td>
        <td><input type="text" name="med_dur_${medCounter}" placeholder="e.g. 7 days / 15 days"></td>
        <td style="text-align:center;">
            <button type="button" class="btn btn-danger btn-icon btn-sm" onclick="removeMed(${medCounter})" title="Remove row">✕</button>
        </td>
    `;
    tbody.appendChild(tr);
}

function removeMed(id) {
    const row = document.getElementById(`medRow-${id}`);
    if (row) row.remove();
    renumberRows();
}

function renumberRows() {
    const rows = document.querySelectorAll('#medicinesBody tr');
    rows.forEach((row, i) => {
        row.querySelector('td:first-child').textContent = i + 1;
    });
}

document.getElementById('addMedBtn').addEventListener('click', addMedicineRow);

// Start with 2 spacious medicine rows for convenient entry
addMedicineRow();
addMedicineRow();

// ===== Form Submit =====
document.getElementById('prescriptionForm').addEventListener('submit', async e => {
    e.preventDefault();

    if (!patientData) {
        showToast('No patient loaded!', true);
        return;
    }

    // Collect medicines from the table
    const rows = document.querySelectorAll('#medicinesBody tr');
    const medicines = [];
    rows.forEach(row => {
        const inputs = row.querySelectorAll('input');
        if (inputs[0].value.trim()) {
            medicines.push({
                medicine_name: inputs[0].value.trim(),
                dosage: inputs[1].value.trim(),
                frequency: inputs[2].value.trim(),
                duration: inputs[3].value.trim()
            });
        }
    });

    const form = e.target;
    const body = {
        patient_id: patientData.id,
        complaints: form.complaints ? form.complaints.value.trim() : '',
        diagnosis: form.diagnosis.value.trim(),
        notes: form.notes.value.trim(),
        medicines
    };

    try {
        const result = await api('/api/prescriptions', {
            method: 'POST',
            body: JSON.stringify(body)
        });
        showToast(`✓ Prescription ${result.rx_id} saved successfully!`);

        // If medicines were empty, open in pen mode
        const mode = medicines.length === 0 ? 'pen' : 'typed';
        setTimeout(() => {
            window.open(`/print.html?rx=${result.rx_id}&mode=${mode}`, '_blank');
            window.location = '/';
        }, 400);
    } catch (err) {
        showToast(err.message, true);
    }
});

// ===== Print Slip (Write with Pen) Button =====
const printPenSlipBtn = document.getElementById('printPenSlipBtn');
if (printPenSlipBtn) {
    printPenSlipBtn.addEventListener('click', async () => {
        if (!patientData) {
            showToast('No patient loaded!', true);
            return;
        }

        const form = document.getElementById('prescriptionForm');
        const complaintsVal = form.complaints ? form.complaints.value.trim() : '';
        const diagnosisVal = form.diagnosis ? form.diagnosis.value.trim() : '';
        const notesVal = form.notes ? form.notes.value.trim() : '';

        // If doctor entered complaints or notes, save a record
        if (complaintsVal || diagnosisVal || notesVal) {
            try {
                const result = await api('/api/prescriptions', {
                    method: 'POST',
                    body: JSON.stringify({
                        patient_id: patientData.id,
                        complaints: complaintsVal,
                        diagnosis: diagnosisVal,
                        notes: notesVal,
                        medicines: []
                    })
                });
                window.open(`/print.html?rx=${result.rx_id}&mode=pen`, '_blank');
                window.location = '/';
            } catch (err) {
                // If save fails, still open blank pad for patient
                window.open(`/print.html?patientId=${patientData.patient_id}&mode=pen`, '_blank');
            }
        } else {
            // Directly open blank prescription slip for pen writing
            window.open(`/print.html?patientId=${patientData.patient_id}&mode=pen`, '_blank');
        }
    });
}

// ===== Init =====
loadPatient();

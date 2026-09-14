// ============================================================
// BANGALI HOMEOPATHIC CLINIC — PUBLIC PATIENT SCRIPT
// Handles validation, booking, reference number modal & print
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    initDatePicker();
    initMobileNav();
    initBookingForm();
    initPublicTheme();
});

// ── 0. Theme Manager (Dark / Light Mode) ──
function togglePublicTheme() {
    const isDark = document.body.classList.toggle('dark-mode');
    document.documentElement.classList.toggle('dark-mode', isDark);
    try {
        localStorage.setItem('clinic_theme', isDark ? 'dark' : 'light');
        localStorage.setItem('clinic_admin_theme', isDark ? 'dark' : 'light');
    } catch (_) {}
    updatePublicThemeToggleUI(isDark);
}

function updatePublicThemeToggleUI(isDark) {
    const btn = document.getElementById('publicThemeToggleBtn');
    if (!btn) return;
    if (isDark) {
        btn.innerHTML = '☀️ <span class="theme-label">Light</span>';
        btn.setAttribute('title', 'Switch to Light Mode');
    } else {
        btn.innerHTML = '🌙 <span class="theme-label">Dark</span>';
        btn.setAttribute('title', 'Switch to Dark Mode');
    }
}

function initPublicTheme() {
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
    updatePublicThemeToggleUI(isDark);
}

// Immediately initialize theme state on load
initPublicTheme();

// ── 1. Restrict Preferred Date to Today & Future ──
function initDatePicker() {
    const dateInput = document.getElementById('preferredDate');
    if (!dateInput) return;

    const now = new Date();
    // Offset for IST (UTC+5:30)
    const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    const yyyy = ist.getUTCFullYear();
    const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(ist.getUTCDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;

    dateInput.min = todayStr;
    // Default to tomorrow or today
    dateInput.value = todayStr;
}

// ── 2. Mobile Nav Hamburger Toggle ──
function initMobileNav() {
    const toggleBtn = document.getElementById('mobileNavToggle');
    const navLinks = document.getElementById('patientNavLinks');
    if (!toggleBtn || !navLinks) return;

    toggleBtn.addEventListener('click', () => {
        navLinks.classList.toggle('mobile-open');
    });

    // Close mobile menu on clicking any link
    navLinks.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            navLinks.classList.remove('mobile-open');
        });
    });
}

// ── 3. Appointment Booking Form Submission ──
// ── 3. Patient Type Selection & Booking Form Handler ──
let currentPatientType = 'new';

function setPatientType(type) {
    currentPatientType = type;
    const btnNew = document.getElementById('btnTypeNew');
    const btnExisting = document.getElementById('btnTypeExisting');
    const newSection = document.getElementById('newPatientSection');
    const existingSection = document.getElementById('existingPatientSection');
    const typeInput = document.getElementById('patientTypeInput');

    if (typeInput) typeInput.value = type;

    if (type === 'existing') {
        if (btnExisting) btnExisting.classList.add('active');
        if (btnNew) btnNew.classList.remove('active');
        if (newSection) newSection.style.display = 'none';
        if (existingSection) existingSection.style.display = 'block';
    } else {
        if (btnNew) btnNew.classList.add('active');
        if (btnExisting) btnExisting.classList.remove('active');
        if (newSection) newSection.style.display = 'block';
        if (existingSection) existingSection.style.display = 'none';
    }
    clearErrors();
}

function initBookingForm() {
    const form = document.getElementById('appointmentBookingForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Clear previous errors
        clearErrors();

        const patientType = (document.getElementById('patientTypeInput')?.value || currentPatientType || 'new');
        const isExisting = (patientType === 'existing');

        const ptIdInput = document.getElementById('existingPatientId');
        const nameInput = document.getElementById('patientFullName');
        const ageInput = document.getElementById('patientAge');
        const genderInput = document.getElementById('patientGender');
        const mobileInput = document.getElementById('patientMobile');
        const dateInput = document.getElementById('preferredDate');
        const addressInput = document.getElementById('patientAddress');
        const reasonInput = document.getElementById('patientReason');
        const submitBtn = document.getElementById('submitBookingBtn');
        const submitBtnText = document.getElementById('submitBtnText');

        const rawMobile = (mobileInput?.value || '').trim();
        const preferredDate = (dateInput?.value || '').trim();
        const reason = (reasonInput?.value || '').trim();

        let ptId = '';
        let name = '';
        let age = null;
        let gender = '';
        let address = '';

        let hasError = false;

        if (isExisting) {
            ptId = (ptIdInput?.value || '').trim();
            if (!ptId) {
                showError('existingPatientId', 'Please enter your Patient ID (PT ID from your prescription slip).');
                hasError = true;
            }
        } else {
            name = (nameInput?.value || '').trim();
            age = parseInt(ageInput?.value, 10);
            gender = (genderInput?.value || '').trim();
            address = (addressInput?.value || '').trim();

            // Validation 1: Full Name
            if (!name || name.length < 2) {
                showError('patientFullName', 'Please enter your full name (at least 2 letters).');
                hasError = true;
            }

            // Validation 2: Age
            if (isNaN(age) || age < 1 || age > 120) {
                showError('patientAge', 'Please enter a valid age between 1 and 120.');
                hasError = true;
            }

            // Validation 3: Gender
            if (!gender || !['Male', 'Female', 'Other'].includes(gender)) {
                showError('patientGender', 'Please select a gender.');
                hasError = true;
            }

            // Validation 4: Address (Compulsory)
            if (!address || address.length < 2) {
                showError('patientAddress', 'Address is compulsory. Please enter your Village / City / District.');
                hasError = true;
            }
        }

        // Mobile Number (Required for both)
        const cleanMobile = rawMobile.replace(/[\s\-+]/g, '').slice(-10);
        if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
            showError('patientMobile', 'Please enter a valid 10-digit mobile number (starting with 6, 7, 8, or 9).');
            hasError = true;
        }

        // Preferred Date (Required for both)
        if (!preferredDate) {
            showError('preferredDate', 'Please select your preferred consultation date.');
            hasError = true;
        } else if (preferredDate < dateInput.min) {
            showError('preferredDate', 'Appointment date cannot be in the past.');
            hasError = true;
        }

        // Note: Symptoms / Problems is OPTIONAL for both!

        if (hasError) return;

        // Prevent duplicate submissions
        if (submitBtn) submitBtn.disabled = true;
        if (submitBtnText) submitBtnText.textContent = 'Submitting Request...';

        try {
            const res = await fetch('/api/appointments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    patient_type: patientType,
                    patient_id: ptId,
                    name,
                    age,
                    gender,
                    mobile: cleanMobile,
                    address,
                    preferred_date: preferredDate,
                    reason
                })
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Failed to submit appointment request.');
            }

            // Success: Display Confirmation Screen
            displayConfirmation({
                reference_no: data.reference_no,
                patient_type: data.appointment.patient_type || patientType,
                patient_id: data.appointment.patient_id || ptId,
                name: data.appointment.name || name,
                age: data.appointment.age || age,
                gender: data.appointment.gender || gender,
                mobile: data.appointment.mobile || cleanMobile,
                address: data.appointment.address || address,
                preferred_date: data.appointment.preferred_date || preferredDate,
                reason: data.appointment.reason || reason
            });

            // Reset form
            form.reset();
            setPatientType('new');
            initDatePicker();

        } catch (err) {
            alert('❌ ' + err.message);
        } finally {
            if (submitBtn) submitBtn.disabled = false;
            if (submitBtnText) submitBtnText.textContent = 'Book Appointment';
        }
    });
}

function showError(fieldId, msg) {
    const input = document.getElementById(fieldId);
    if (!input) return;
    input.classList.add('has-error');

    let errorEl = input.nextElementSibling;
    if (!errorEl || !errorEl.classList.contains('field-error-msg')) {
        errorEl = input.parentElement.querySelector('.field-error-msg');
    }
    if (errorEl) {
        errorEl.textContent = msg;
        errorEl.style.display = 'block';
    }
    input.focus();
}

function clearErrors() {
    document.querySelectorAll('.form-input-patient, .form-select-patient, .form-textarea-patient').forEach(el => {
        el.classList.remove('has-error');
    });
    document.querySelectorAll('.field-error-msg').forEach(el => {
        el.textContent = '';
        el.style.display = 'none';
    });
}

// ── 4. Confirmation Screen Display ──
function displayConfirmation(data) {
    const modal = document.getElementById('confirmModal');
    if (!modal) return;

    const isExisting = (data.patient_type === 'existing');

    document.getElementById('confRefNumber').textContent = data.reference_no;

    const catEl = document.getElementById('confPatientCategory');
    if (catEl) catEl.textContent = isExisting ? '🩺 Existing Patient (Follow-up)' : '🌱 New Patient';

    const ptIdRow = document.getElementById('confPtIdRow');
    const ptIdEl = document.getElementById('confPtId');
    if (ptIdRow && ptIdEl) {
        if (isExisting && data.patient_id) {
            ptIdEl.textContent = data.patient_id;
            ptIdRow.style.display = 'flex';
        } else {
            ptIdRow.style.display = 'none';
        }
    }

    const nameRow = document.getElementById('confNameRow');
    if (nameRow) {
        if (data.name) {
            document.getElementById('confPatientName').textContent = data.name;
            nameRow.style.display = 'flex';
        } else {
            nameRow.style.display = isExisting ? 'none' : 'flex';
        }
    }

    const demoRow = document.getElementById('confDemographicsRow');
    if (demoRow) {
        if (data.age && data.gender) {
            document.getElementById('confPatientDemographics').textContent = `${data.age} yrs / ${data.gender}`;
            demoRow.style.display = 'flex';
        } else {
            demoRow.style.display = 'none';
        }
    }

    document.getElementById('confPatientMobile').textContent = data.mobile;

    const addrRow = document.getElementById('confAddressRow');
    if (addrRow) {
        if (data.address) {
            document.getElementById('confAddress').textContent = data.address;
            addrRow.style.display = 'flex';
        } else {
            addrRow.style.display = isExisting ? 'none' : 'flex';
            document.getElementById('confAddress').textContent = 'Not specified';
        }
    }

    document.getElementById('confPreferredDate').textContent = formatDateReadable(data.preferred_date);
    document.getElementById('confReason').textContent = data.reason || 'General Follow-up / Consultation';

    modal.classList.add('active');
    document.body.classList.add('modal-open');
    document.body.style.overflow = 'hidden';

    // Scroll card to top
    const card = modal.querySelector('.confirm-card');
    if (card) card.scrollTop = 0;
}

function closeConfirmationModal() {
    const modal = document.getElementById('confirmModal');
    if (modal) modal.classList.remove('active');
    document.body.classList.remove('modal-open');
    document.body.style.overflow = '';
}

// Close on clicking backdrop or Escape key
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('confirmModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeConfirmationModal();
        });
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeConfirmationModal();
    });
});

function printAppointmentSlip() {
    window.print();
}

function formatDateReadable(dateStr) {
    if (!dateStr) return '--';
    try {
        const [y, m, d] = dateStr.split('-');
        const date = new Date(y, m - 1, d);
        return date.toLocaleDateString('en-IN', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch {
        return dateStr;
    }
}

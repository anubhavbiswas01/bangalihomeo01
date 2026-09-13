// ============================================================
// BANGALI HOMEOPATHIC CLINIC — PUBLIC PATIENT SCRIPT
// Handles validation, booking, reference number modal & print
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    initDatePicker();
    initMobileNav();
    initBookingForm();
});

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
function initBookingForm() {
    const form = document.getElementById('appointmentBookingForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Clear previous errors
        clearErrors();

        // Gather form fields
        const nameInput = document.getElementById('patientFullName');
        const ageInput = document.getElementById('patientAge');
        const genderInput = document.getElementById('patientGender');
        const mobileInput = document.getElementById('patientMobile');
        const dateInput = document.getElementById('preferredDate');
        const reasonInput = document.getElementById('patientReason');
        const submitBtn = document.getElementById('submitBookingBtn');
        const submitBtnText = document.getElementById('submitBtnText');

        const name = (nameInput.value || '').trim();
        const age = parseInt(ageInput.value, 10);
        const gender = (genderInput.value || '').trim();
        const rawMobile = (mobileInput.value || '').trim();
        const preferredDate = (dateInput.value || '').trim();
        const reason = (reasonInput.value || '').trim();

        let hasError = false;

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

        // Validation 4: Mobile (Indian 10-digit format)
        const cleanMobile = rawMobile.replace(/[\s\-+]/g, '').slice(-10);
        if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
            showError('patientMobile', 'Please enter a valid 10-digit mobile number (starting with 6, 7, 8, or 9).');
            hasError = true;
        }

        // Validation 5: Preferred Date
        if (!preferredDate) {
            showError('preferredDate', 'Please select your preferred consultation date.');
            hasError = true;
        } else if (preferredDate < dateInput.min) {
            showError('preferredDate', 'Appointment date cannot be in the past.');
            hasError = true;
        }

        // Validation 6: Reason for Visit
        if (!reason || reason.length < 3) {
            showError('patientReason', 'Please briefly describe your symptoms or reason for consultation.');
            hasError = true;
        }

        if (hasError) return;

        // Prevent duplicate submissions
        if (submitBtn) submitBtn.disabled = true;
        if (submitBtnText) submitBtnText.textContent = 'Submitting Request...';

        try {
            const res = await fetch('/api/appointments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    age,
                    gender,
                    mobile: cleanMobile,
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
                name: data.appointment.name,
                age: data.appointment.age,
                gender: data.appointment.gender,
                mobile: data.appointment.mobile,
                preferred_date: data.appointment.preferred_date,
                reason: data.appointment.reason
            });

            // Reset form
            form.reset();
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

    document.getElementById('confRefNumber').textContent = data.reference_no;
    document.getElementById('confPatientName').textContent = data.name;
    document.getElementById('confPatientDemographics').textContent = `${data.age} yrs / ${data.gender}`;
    document.getElementById('confPatientMobile').textContent = data.mobile;
    document.getElementById('confPreferredDate').textContent = formatDateReadable(data.preferred_date);
    document.getElementById('confReason').textContent = data.reason;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Scroll card to top
    const card = modal.querySelector('.confirm-card');
    if (card) card.scrollTop = 0;
}

function closeConfirmationModal() {
    const modal = document.getElementById('confirmModal');
    if (modal) modal.classList.remove('active');
    document.body.style.overflow = '';
}

// Close on clicking backdrop
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('confirmModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeConfirmationModal();
        });
    }
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

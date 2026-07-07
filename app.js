/* ═══════════════════════════════════════════════════════════════
   FlexSpace — Application Logic (Full-Stack)
   Vanilla JS • Fetch API • Session-based Auth • GSAP animations
   ═══════════════════════════════════════════════════════════════ */

// ─────────────────────────────────────────────
//  API HELPERS
// ─────────────────────────────────────────────

const API = {
  async get(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    return res.json();
  },
  async post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    });
    const data = await res.json();
    data._status = res.status;
    return data;
  },
  async del(url) {
    const res = await fetch(url, {
      method: 'DELETE',
      credentials: 'same-origin'
    });
    const data = await res.json();
    data._status = res.status;
    return data;
  }
};


// ─────────────────────────────────────────────
//  THEME TOGGLE (Light / Dark)
// ─────────────────────────────────────────────

function initThemeToggle() {
  const toggle = document.getElementById('themeToggle');
  const sunIcon = document.getElementById('themeIconSun');
  const moonIcon = document.getElementById('themeIconMoon');
  if (!toggle || !sunIcon || !moonIcon) return;

  // Load saved theme
  const saved = localStorage.getItem('flexspace-theme');
  if (saved === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    sunIcon.style.display = 'none';
    moonIcon.style.display = 'block';
  }

  toggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    if (current === 'light') {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('flexspace-theme', 'dark');
      sunIcon.style.display = 'block';
      moonIcon.style.display = 'none';
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('flexspace-theme', 'light');
      sunIcon.style.display = 'none';
      moonIcon.style.display = 'block';
    }
  });
}

/** Check if light mode is active */
function isLightMode() {
  return document.documentElement.getAttribute('data-theme') === 'light';
}


// ─────────────────────────────────────────────
//  DATE HELPERS
// ─────────────────────────────────────────────

/** Get a YYYY-MM-DD date string for today or tomorrow */
function getDateKey(dayLabel) {
  const d = new Date();
  if (dayLabel === 'tomorrow') d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

/** Get a human-readable date string */
function getDateDisplay(dayLabel) {
  const d = new Date();
  if (dayLabel === 'tomorrow') d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

/** Format hour for display */
function formatHour(h) {
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:00 ${suffix}`;
}

/** Format a YYYY-MM-DD date to a readable string */
function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}


// ─────────────────────────────────────────────
//  APPLICATION STATE
// ─────────────────────────────────────────────
const state = {
  user: null,               // Current logged-in user
  facilities: [],           // Facility groups from API
  activeFacility: null,     // Currently selected facility (parent)
  activeUnit: null,         // Currently selected sub-unit (or parent if no units)
  activeDay: 'today',       // 'today' | 'tomorrow'
  selectedSlot: null,       // { start, end, label } or null
  slots: []                 // Current slot data from API
};


// ─────────────────────────────────────────────
//  DOM REFERENCES
// ─────────────────────────────────────────────
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  navbar:          $('#navbar'),
  navLinks:        $('#navLinks'),
  hamburger:       $('#hamburger'),
  navAuthButtons:  $('#navAuthButtons'),
  navUserMenu:     $('#navUserMenu'),
  userAvatarBtn:   $('#userAvatarBtn'),
  userAvatarInitial: $('#userAvatarInitial'),
  userNameDisplay: $('#userNameDisplay'),
  userDropdown:    $('#userDropdown'),
  navDashboardLink:$('#navDashboardLink'),
  facilitiesGrid:  $('#facilitiesGrid'),
  scheduleHeader:  $('#scheduleHeader'),
  scheduleEye:     $('#scheduleEyebrow'),
  dayTabs:         $('#dayTabs'),
  tabToday:        $('#tabToday'),
  tabTomorrow:     $('#tabTomorrow'),
  slotsGrid:       $('#slotsGrid'),
  slotsLegend:     $('#slotsLegend'),
  btnBack:         $('#btnBack'),
  // Booking confirmation modal
  modalOverlay:    $('#modalOverlay'),
  modalClose:      $('#modalClose'),
  modalMeta:       $('#modalMeta'),
  btnConfirmBooking: $('#btnConfirmBooking'),
  // Unit selection modal
  unitModalOverlay:$('#unitModalOverlay'),
  unitModalClose:  $('#unitModalClose'),
  unitModalIcon:   $('#unitModalIcon'),
  unitModalTitle:  $('#unitModalTitle'),
  unitModalMeta:   $('#unitModalMeta'),
  unitSelector:    $('#unitSelector'),
  // Login modal
  loginModalOverlay:  $('#loginModalOverlay'),
  loginModalClose:    $('#loginModalClose'),
  loginForm:          $('#loginForm'),
  loginEmail:         $('#loginEmail'),
  loginPassword:      $('#loginPassword'),
  loginError:         $('#loginError'),
  // Register modal
  registerModalOverlay: $('#registerModalOverlay'),
  registerModalClose:   $('#registerModalClose'),
  registerForm:         $('#registerForm'),
  registerName:         $('#registerName'),
  registerFlatNo:       $('#registerFlatNo'),
  registerEmail:        $('#registerEmail'),
  registerPassword:     $('#registerPassword'),
  registerError:        $('#registerError'),
  // Dashboard
  dashboardSection: $('#dashboard'),
  dashboardGrid:    $('#dashboardGrid'),
  dashboardEmpty:   $('#dashboardEmpty'),
  // Toast
  toast:         $('#toast'),
  toastMsg:      $('#toastMsg'),
  toastError:    $('#toastError'),
  toastErrorMsg: $('#toastErrorMsg'),
  // QR Gate Pass modal
  qrModalOverlay:  $('#qrModalOverlay'),
  qrModalClose:    $('#qrModalClose'),
  qrImage:         $('#qrImage'),
  qrModalTitle:    $('#qrModalTitle'),
  qrModalMeta:     $('#qrModalMeta'),
  qrPassDetails:   $('#qrPassDetails'),
  // Live badge
  liveBadge:       $('#liveBadge')
};


// ─────────────────────────────────────────────
//  AUTH — Login / Register / Logout / Session
// ─────────────────────────────────────────────

async function checkAuth() {
  try {
    const data = await API.get('/api/auth/me');
    state.user = data.user;
    updateAuthUI();
  } catch {
    state.user = null;
    updateAuthUI();
  }
}

function updateAuthUI() {
  if (state.user) {
    dom.navAuthButtons.style.display = 'none';
    dom.navUserMenu.style.display = 'block';
    dom.navDashboardLink.style.display = 'list-item';
    dom.userAvatarInitial.textContent = state.user.name.charAt(0).toUpperCase();
    const flatDisplay = state.user.flat_no ? ` (${state.user.flat_no})` : '';
    dom.userNameDisplay.textContent = state.user.name + flatDisplay;
  } else {
    dom.navAuthButtons.style.display = 'flex';
    dom.navUserMenu.style.display = 'none';
    dom.navDashboardLink.style.display = 'none';
    dom.dashboardSection.style.display = 'none';
  }
}

async function handleLogin(e) {
  e.preventDefault();
  dom.loginError.style.display = 'none';

  const email = dom.loginEmail.value.trim();
  const password = dom.loginPassword.value;

  if (!email || !password) {
    showFormError(dom.loginError, 'Please fill in all fields.');
    return;
  }

  const data = await API.post('/api/auth/login', { email, password });

  if (data._status === 200) {
    state.user = data.user;
    updateAuthUI();
    closeAllModals();
    dom.loginForm.reset();

    // If admin, redirect to admin dashboard
    if (data.user.role === 'admin') {
      window.location.href = '/admin';
      return;
    }

    showToast(`Welcome back, ${data.user.name}!`);
  } else {
    showFormError(dom.loginError, data.error || 'Login failed.');
  }
}

async function handleRegister(e) {
  e.preventDefault();
  dom.registerError.style.display = 'none';

  const name = dom.registerName.value.trim();
  const flat_no = dom.registerFlatNo ? dom.registerFlatNo.value.trim() : '';
  const email = dom.registerEmail.value.trim();
  const password = dom.registerPassword.value;

  if (!name || !flat_no || !email || !password) {
    showFormError(dom.registerError, 'Please fill in all fields.');
    return;
  }

  if (password.length < 6) {
    showFormError(dom.registerError, 'Password must be at least 6 characters.');
    return;
  }

  const data = await API.post('/api/auth/register', { name, email, password, flat_no });

  if (data._status === 201) {
    state.user = data.user;
    updateAuthUI();
    closeAllModals();
    showToast(`Welcome to FlexSpace, ${data.user.name}!`);
    dom.registerForm.reset();
  } else {
    showFormError(dom.registerError, data.error || 'Registration failed.');
  }
}

async function handleLogout() {
  await API.post('/api/auth/logout', {});
  state.user = null;
  updateAuthUI();
  closeUserDropdown();
  dom.dashboardSection.style.display = 'none';
  showToast('Logged out successfully.');
}

function showFormError(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
}


// ─────────────────────────────────────────────
//  FACILITIES — Fetch & Render Cards
// ─────────────────────────────────────────────

async function loadFacilities() {
  try {
    const data = await API.get('/api/facilities');
    state.facilities = data.facilities || [];
    renderFacilityCards();
  } catch (err) {
    console.error('Failed to load facilities:', err);
  }
}

function renderFacilityCards() {
  dom.facilitiesGrid.innerHTML = state.facilities.map((f) => {
    const unitsBadge = f.units.length > 0
      ? `<div class="facility-card__units-badge">
           <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
           ${f.units.length} ${f.units.length === 1 ? 'unit' : 'units'} available
         </div>`
      : '';

    return `
    <article class="facility-card" data-facility-id="${f.id}" id="card-${f.id}">
      <div class="facility-card__image-wrap">
        <img src="${f.image}" alt="${f.name}" class="facility-card__image" loading="lazy" />
      </div>
      <div class="facility-card__body">
        <h3 class="facility-card__name">${f.emoji} ${f.name}</h3>
        <p class="facility-card__desc">${f.description}</p>
        ${unitsBadge}
        <button class="facility-card__cta" data-facility-id="${f.id}" aria-label="View schedule for ${f.name}">
          View Schedule
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
        </button>
      </div>
    </article>
  `}).join('');

  // Attach click handlers
  $$('.facility-card__cta').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fId = parseInt(btn.dataset.facilityId, 10);
      handleFacilityClick(fId);
    });
  });

  $$('.facility-card').forEach((card) => {
    card.addEventListener('click', () => {
      const fId = parseInt(card.dataset.facilityId, 10);
      handleFacilityClick(fId);
    });
  });

  // Attach spotlight mousemove listeners to dynamically rendered cards
  initSpotlightCards();
}


// ─────────────────────────────────────────────
//  FACILITY CLICK — Sub-unit selection flow
// ─────────────────────────────────────────────

function handleFacilityClick(facilityId) {
  const facility = state.facilities.find(f => f.id === facilityId);
  if (!facility) return;

  state.activeFacility = facility;

  if (facility.units.length > 0) {
    // Show sub-unit selection modal
    openUnitModal(facility);
  } else {
    // No sub-units — open schedule directly with parent facility
    state.activeUnit = facility;
    openSchedule();
  }
}

function openUnitModal(facility) {
  dom.unitModalIcon.textContent = facility.emoji;
  dom.unitModalTitle.textContent = `Select a ${getUnitLabel(facility.name)}`;
  dom.unitModalMeta.textContent = `Choose which ${getUnitLabel(facility.name).toLowerCase()} you'd like to book`;

  dom.unitSelector.innerHTML = facility.units.map(unit => {
    const shortName = unit.name.split(' — ').pop();
    return `
      <button class="unit-btn" data-unit-id="${unit.id}">
        <span class="unit-name">${shortName}</span>
        <span class="unit-sub">${facility.name}</span>
      </button>
    `;
  }).join('');

  // Attach handlers
  dom.unitSelector.querySelectorAll('.unit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const unitId = parseInt(btn.dataset.unitId, 10);
      const unit = facility.units.find(u => u.id === unitId);
      if (unit) {
        state.activeUnit = unit;
        closeModal(dom.unitModalOverlay);
        openSchedule();
      }
    });
  });

  openModalOverlay(dom.unitModalOverlay);

  // Animate unit buttons
  requestAnimationFrame(() => {
    if (window.gsap) {
      gsap.fromTo('.unit-btn',
        { opacity: 0, y: 15, scale: 0.95 },
        { opacity: 1, y: 0, scale: 1, stagger: 0.06, duration: 0.4, ease: 'power3.out' }
      );
    }
  });
}

function getUnitLabel(facilityName) {
  if (facilityName.includes('Badminton')) return 'Court';
  if (facilityName.includes('Table Tennis')) return 'Board';
  if (facilityName.includes('Snooker')) return 'Board';
  return 'Unit';
}


// ─────────────────────────────────────────────
//  SCHEDULE — Open / Close
// ─────────────────────────────────────────────

function openSchedule() {
  state.activeDay = 'today';
  state.selectedSlot = null;

  const displayName = state.activeUnit.parent_id
    ? `${state.activeFacility.emoji} ${state.activeUnit.name}`
    : `${state.activeFacility.emoji} ${state.activeFacility.name}`;

  // Update header
  dom.scheduleEye.textContent = displayName;

  // Show schedule UI
  dom.scheduleHeader.style.display = 'flex';
  dom.dayTabs.style.display = 'flex';
  dom.slotsGrid.style.display = 'grid';
  dom.slotsLegend.style.display = 'flex';

  // Reset day tabs
  dom.tabToday.classList.add('active');
  dom.tabTomorrow.classList.remove('active');
  dom.tabToday.textContent = `Today · ${getDateDisplay('today')}`;
  dom.tabTomorrow.textContent = `Tomorrow · ${getDateDisplay('tomorrow')}`;

  fetchAndRenderSlots();
  scrollToSection('schedule');
}

function closeSchedule() {
  state.activeFacility = null;
  state.activeUnit = null;
  state.selectedSlot = null;

  dom.scheduleHeader.style.display = 'none';
  dom.dayTabs.style.display = 'none';
  dom.slotsGrid.style.display = 'none';
  dom.slotsLegend.style.display = 'none';

  scrollToSection('facilities');
}


// ─────────────────────────────────────────────
//  TIME SLOTS — Fetch & Render
// ─────────────────────────────────────────────

async function fetchAndRenderSlots() {
  if (!state.activeUnit) return;

  const date = getDateKey(state.activeDay);

  // Show loading state
  dom.slotsGrid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--text-muted);">Loading slots...</div>';

  try {
    const data = await API.get(`/api/facilities/${state.activeUnit.id}/slots?date=${date}`);
    state.slots = data.slots || [];
    renderSlots();
  } catch (err) {
    console.error('Failed to load slots:', err);
    dom.slotsGrid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:40px; color:#ef4444;">Failed to load slots. Please try again.</div>';
  }
}

function renderSlots() {
  dom.slotsGrid.innerHTML = state.slots.map((slot) => {
    const isBooked = !slot.available;
    const isSelected = state.selectedSlot && state.selectedSlot.start === slot.start;

    let classes = 'slot';
    if (isBooked) classes += ' slot--booked';
    else if (isSelected) classes += ' slot--selected';

    let bookedByHTML = '';
    if (isBooked && slot.booked_by) {
      bookedByHTML = `<p class="slot__booked-by">by ${slot.booked_by}</p>`;
    }

    return `
      <div class="${classes}" data-start="${slot.start}" data-end="${slot.end}" data-label="${slot.label}" role="button" tabindex="0" aria-label="${slot.label} ${isBooked ? 'Booked' : 'Available'}">
        <p class="slot__time">${slot.label}</p>
        <p class="slot__status">${isBooked ? 'Booked' : (isSelected ? 'Selected' : 'Available')}</p>
        ${bookedByHTML}
      </div>
    `;
  }).join('');

  // Attach slot click handlers
  $$('.slot:not(.slot--booked)').forEach((el) => {
    el.addEventListener('click', () => selectSlot(el));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSlot(el); }
    });
  });

  // Animate slots in
  requestAnimationFrame(() => {
    if (window.gsap) {
      gsap.fromTo('.slot',
        { opacity: 0, y: 20, scale: 0.95 },
        { opacity: 1, y: 0, scale: 1, stagger: 0.04, duration: 0.45, ease: 'power3.out' }
      );
    }
  });
}

function selectSlot(el) {
  // Check if user is logged in
  if (!state.user) {
    openModalOverlay(dom.loginModalOverlay);
    showToastError('Please log in to book a slot.');
    return;
  }

  const start = parseInt(el.dataset.start, 10);
  const end   = parseInt(el.dataset.end, 10);
  const label = el.dataset.label;

  state.selectedSlot = { start, end, label };

  // Update visual state
  $$('.slot').forEach(s => s.classList.remove('slot--selected'));
  el.classList.add('slot--selected');
  el.querySelector('.slot__status').textContent = 'Selected';

  // Subtle GSAP pop animation
  if (window.gsap) {
    gsap.fromTo(el, { scale: 0.95 }, { scale: 1, duration: 0.35, ease: 'elastic.out(1, 0.5)' });
  }

  // Open booking confirmation modal after brief pause
  setTimeout(() => openBookingModal(), 250);
}


// ─────────────────────────────────────────────
//  BOOKING CONFIRMATION MODAL
// ─────────────────────────────────────────────

function openBookingModal() {
  if (!state.activeUnit || !state.selectedSlot) return;

  const displayName = state.activeUnit.parent_id
    ? state.activeUnit.name
    : state.activeFacility.name;

  dom.modalMeta.textContent = `${displayName} · ${state.selectedSlot.label} · ${getDateDisplay(state.activeDay)}`;
  openModalOverlay(dom.modalOverlay);
}

async function handleBookingConfirm() {
  if (!state.activeUnit || !state.selectedSlot || !state.user) return;

  const date = getDateKey(state.activeDay);

  // Disable button during request
  dom.btnConfirmBooking.disabled = true;
  dom.btnConfirmBooking.querySelector('span').textContent = 'Booking...';

  const data = await API.post('/api/bookings', {
    facility_id: state.activeUnit.id,
    date: date,
    start_time: state.selectedSlot.start,
    end_time: state.selectedSlot.end
  });

  dom.btnConfirmBooking.disabled = false;
  dom.btnConfirmBooking.querySelector('span').textContent = 'Confirm Booking';

  if (data._status === 201) {
    state.selectedSlot = null;
    closeModal(dom.modalOverlay);
    fetchAndRenderSlots();
    showToast(data.message || 'Booking confirmed!');
  } else {
    closeModal(dom.modalOverlay);
    showToastError(data.error || 'Booking failed. Please try again.');
    fetchAndRenderSlots(); // Refresh to show current state
  }
}


// ─────────────────────────────────────────────
//  USER DASHBOARD
// ─────────────────────────────────────────────

async function loadDashboard() {
  if (!state.user) return;

  dom.dashboardSection.style.display = 'block';

  try {
    const data = await API.get('/api/bookings/me');
    const bookings = data.bookings || [];

    if (bookings.length === 0) {
      dom.dashboardGrid.style.display = 'none';
      dom.dashboardEmpty.style.display = 'block';
    } else {
      dom.dashboardGrid.style.display = 'grid';
      dom.dashboardEmpty.style.display = 'none';
      renderDashboardBookings(bookings);
    }
  } catch (err) {
    console.error('Failed to load bookings:', err);
  }

  scrollToSection('dashboard');
}

function renderDashboardBookings(bookings) {
  dom.dashboardGrid.innerHTML = bookings.map(b => `
    <div class="booking-card" data-booking-id="${b.id}">
      <div class="booking-card__header">
        <div class="booking-card__facility">
          <span class="booking-card__emoji">${b.facility_emoji}</span>
          <span class="booking-card__name">${b.facility_name}</span>
        </div>
        <span class="booking-card__status booking-card__status--confirmed">Confirmed</span>
      </div>
      <div class="booking-card__details">
        <div class="booking-card__detail">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          ${formatDate(b.date)}
        </div>
        <div class="booking-card__detail">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${b.label}
        </div>
      </div>
      <div class="booking-card__actions">
        <button class="btn btn-outline btn-sm btn-qr" data-qr-id="${b.id}" data-qr-facility="${b.facility_emoji} ${b.facility_name}" data-qr-date="${b.date}" data-qr-label="${b.label}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="3" height="3"/><line x1="21" y1="14" x2="21" y2="14.01"/><line x1="21" y1="21" x2="21" y2="21.01"/><line x1="14" y1="21" x2="14" y2="21.01"/></svg>
          Gate Pass
        </button>
        <button class="btn btn-danger btn-sm" data-cancel-id="${b.id}">
          Cancel Booking
        </button>
      </div>
    </div>
  `).join('');

  // Attach cancel handlers
  dom.dashboardGrid.querySelectorAll('[data-cancel-id]').forEach(btn => {
    btn.addEventListener('click', () => cancelMyBooking(parseInt(btn.dataset.cancelId, 10)));
  });

  // Attach QR gate pass handlers
  dom.dashboardGrid.querySelectorAll('.btn-qr').forEach(btn => {
    btn.addEventListener('click', () => {
      const bookingId = btn.dataset.qrId;
      const facility  = btn.dataset.qrFacility;
      const dateStr   = btn.dataset.qrDate;
      const label     = btn.dataset.qrLabel;
      openQRModal(bookingId, facility, dateStr, label);
    });
  });

  // Animate cards
  requestAnimationFrame(() => {
    if (window.gsap) {
      gsap.fromTo('.booking-card',
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, stagger: 0.08, duration: 0.5, ease: 'power3.out' }
      );
    }
  });
}

async function cancelMyBooking(bookingId) {
  if (!confirm('Are you sure you want to cancel this booking?')) return;

  const data = await API.del(`/api/bookings/${bookingId}`);

  if (data._status === 200) {
    showToast('Booking cancelled.');
    loadDashboard();
  } else {
    showToastError(data.error || 'Failed to cancel booking.');
  }
}


// ─────────────────────────────────────────────
//  QR GATE PASS MODAL
// ─────────────────────────────────────────────
function openQRModal(bookingId, facilityName, dateStr, timeLabel) {
  dom.qrModalMeta.textContent = `${facilityName}`;
  dom.qrImage.src = `/api/bookings/${bookingId}/qr`;
  dom.qrImage.alt = `Gate Pass QR — ${facilityName}`;

  dom.qrPassDetails.innerHTML = `
    <div class="qr-detail-row">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      <span>${formatDate(dateStr)}</span>
    </div>
    <div class="qr-detail-row">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span>${timeLabel}</span>
    </div>
  `;

  openModalOverlay(dom.qrModalOverlay);

  // GSAP pulse animation on QR image border
  requestAnimationFrame(() => {
    if (window.gsap) {
      gsap.fromTo('.qr-image-wrap',
        { boxShadow: '0 0 0px rgba(168, 85, 247, 0.3)' },
        {
          boxShadow: '0 0 28px rgba(168, 85, 247, 0.5)',
          repeat: -1,
          yoyo: true,
          duration: 1.5,
          ease: 'sine.inOut'
        }
      );
    }
  });
}


// ─────────────────────────────────────────────
//  MODAL MANAGEMENT
// ─────────────────────────────────────────────

function openModalOverlay(overlay) {
  overlay.classList.add('visible');
  document.body.style.overflow = 'hidden';
}

function closeModal(overlay) {
  overlay.classList.remove('visible');
  document.body.style.overflow = '';

  // If closing booking modal, deselect slot
  if (overlay === dom.modalOverlay && state.selectedSlot) {
    state.selectedSlot = null;
    if (state.activeUnit) renderSlots();
  }
}

function closeAllModals() {
  [dom.modalOverlay, dom.unitModalOverlay, dom.loginModalOverlay, dom.registerModalOverlay, dom.qrModalOverlay].forEach(m => {
    m.classList.remove('visible');
  });
  document.body.style.overflow = '';
}

function closeUserDropdown() {
  dom.userDropdown.classList.remove('open');
}


// ─────────────────────────────────────────────
//  TOASTS
// ─────────────────────────────────────────────

function showToast(message) {
  dom.toastMsg.textContent = message;
  dom.toast.classList.add('show');
  setTimeout(() => dom.toast.classList.remove('show'), 3500);
}

function showToastError(message) {
  dom.toastErrorMsg.textContent = message;
  dom.toastError.classList.add('show');
  setTimeout(() => dom.toastError.classList.remove('show'), 4000);
}


// ─────────────────────────────────────────────
//  3D ORB — Canvas Animated Background
// ─────────────────────────────────────────────

function initOrbCanvas() {
  const canvas = document.getElementById('orbCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let W, H, cx, cy, frame = 0;
  const particles = [];
  const PARTICLE_COUNT = 60;

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    W = canvas.width  = Math.min(500, rect.width * 0.6);
    H = canvas.height = W;
    cx = W / 2;
    cy = H / 2;
  }

  // Create orbiting particles
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push({
      angle: Math.random() * Math.PI * 2,
      radius: 80 + Math.random() * 120,
      speed: 0.003 + Math.random() * 0.008,
      size: 1 + Math.random() * 2.5,
      opacity: 0.2 + Math.random() * 0.6,
      offsetY: (Math.random() - 0.5) * 60
    });
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    frame++;

    const light = isLightMode();

    // ── Core orb glow (pulsing) ──
    const pulse = Math.sin(frame * 0.015) * 0.1 + 0.9;
    const orbR = (W * 0.28) * pulse;

    // Outer glow
    const glow = ctx.createRadialGradient(cx, cy, orbR * 0.3, cx, cy, orbR * 1.6);
    glow.addColorStop(0, light ? 'rgba(139, 92, 246, 0.2)' : 'rgba(168, 85, 247, 0.15)');
    glow.addColorStop(0.5, light ? 'rgba(99, 102, 241, 0.08)' : 'rgba(99, 102, 241, 0.06)');
    glow.addColorStop(1, 'rgba(59, 130, 246, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Main orb gradient
    const grad = ctx.createRadialGradient(cx - orbR * 0.25, cy - orbR * 0.25, orbR * 0.1, cx, cy, orbR);
    grad.addColorStop(0, light ? 'rgba(139, 92, 246, 0.5)' : 'rgba(200, 140, 255, 0.55)');
    grad.addColorStop(0.4, light ? 'rgba(99, 102, 241, 0.3)' : 'rgba(140, 100, 240, 0.35)');
    grad.addColorStop(0.7, light ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.2)');
    grad.addColorStop(1, 'rgba(59, 130, 246, 0)');

    ctx.beginPath();
    ctx.arc(cx, cy, orbR, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Inner bright core
    const core = ctx.createRadialGradient(cx - orbR * 0.15, cy - orbR * 0.15, 0, cx, cy, orbR * 0.5);
    core.addColorStop(0, light ? 'rgba(139, 92, 246, 0.2)' : 'rgba(255, 255, 255, 0.25)');
    core.addColorStop(1, light ? 'rgba(139, 92, 246, 0)' : 'rgba(255, 255, 255, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, orbR * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = core;
    ctx.fill();

    // ── Orbiting particles ──
    particles.forEach(p => {
      p.angle += p.speed;
      const px = cx + Math.cos(p.angle) * p.radius;
      const py = cy + Math.sin(p.angle) * p.radius * 0.45 + p.offsetY;
      const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);

      // Fade particles that are behind the orb
      const behindOrb = Math.sin(p.angle) > 0.2 ? 0.3 : 1;
      const alpha = p.opacity * behindOrb * Math.max(0.3, 1 - dist / (W * 0.5));

      ctx.beginPath();
      ctx.arc(px, py, p.size, 0, Math.PI * 2);
      ctx.fillStyle = light ? `rgba(139, 92, 246, ${alpha})` : `rgba(200, 170, 255, ${alpha})`;
      ctx.fill();
    });

    // ── Orbiting ring ──
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(frame * 0.003);
    ctx.scale(1, 0.35);
    ctx.beginPath();
    ctx.arc(0, 0, orbR * 1.3, 0, Math.PI * 2);
    const ringAlpha = 0.08 + Math.sin(frame * 0.02) * 0.04;
    ctx.strokeStyle = light ? `rgba(139, 92, 246, ${ringAlpha + 0.06})` : `rgba(168, 85, 247, ${ringAlpha})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener('resize', resize);
  draw();
}


// ─────────────────────────────────────────────
//  GSAP ANIMATIONS
// ─────────────────────────────────────────────
function initGSAPAnimations() {
  if (!window.gsap) return;

  gsap.registerPlugin(ScrollTrigger);

  // ── Hero entrance timeline ──
  const heroTL = gsap.timeline({ delay: 0.3 });

  heroTL
    .to('#heroTagline',  { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out' }, 0)
    .fromTo('#heroTitle',
      { opacity: 0, y: 40 },
      { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out' }, 0.15)
    .fromTo('#heroSubtitle',
      { opacity: 0, y: 30 },
      { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out' }, 0.35)
    .fromTo('#heroActions',
      { opacity: 0, y: 25 },
      { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.5)
    .fromTo('#heroStats',
      { opacity: 0, y: 25 },
      { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.65);

  // ── Counter animation ──
  $$('.stat-number').forEach((el) => {
    const target = parseInt(el.dataset.count, 10);
    gsap.to(el, {
      textContent: target,
      duration: 2,
      delay: 1,
      ease: 'power2.out',
      snap: { textContent: 1 },
      onUpdate() { el.textContent = Math.round(parseFloat(el.textContent)); }
    });
  });

  // ── Facility cards scroll-triggered entrance ──
  gsap.fromTo('.facility-card',
    { opacity: 0, y: 50, scale: 0.97 },
    {
      opacity: 1, y: 0, scale: 1,
      stagger: 0.15,
      duration: 0.7,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: '#facilitiesGrid',
        start: 'top 80%',
        once: true
      }
    }
  );
}


// ─────────────────────────────────────────────
//  NAVIGATION HELPERS
// ─────────────────────────────────────────────

/** Smooth scroll to a section */
function scrollToSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const offset = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-height'), 10) || 72;
  const top = el.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top, behavior: 'smooth' });
}

/** Navbar scroll effect */
function initNavbarScroll() {
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        dom.navbar.classList.toggle('scrolled', window.scrollY > 40);
        ticking = false;
      });
      ticking = true;
    }
  });
}

/** Active nav link based on scroll position */
function initActiveNavLink() {
  const sections = ['hero', 'facilities', 'schedule', 'dashboard'];
  const links = $$('.nav-link');
  const offset = 200;

  window.addEventListener('scroll', () => {
    let current = 'hero';
    sections.forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.offsetParent !== null && el.getBoundingClientRect().top <= offset) {
        current = id;
      }
    });
    links.forEach(link => {
      link.classList.toggle('active', link.dataset.section === current);
    });
  });
}

/** Mobile hamburger toggle */
function initHamburger() {
  dom.hamburger.addEventListener('click', () => {
    dom.hamburger.classList.toggle('open');
    dom.navLinks.classList.toggle('mobile-open');
  });

  // Close on link click
  $$('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      dom.hamburger.classList.remove('open');
      dom.navLinks.classList.remove('mobile-open');
    });
  });
}


// ─────────────────────────────────────────────
//  EVENT BINDING
// ─────────────────────────────────────────────
function bindEvents() {
  // Day tab switching
  dom.tabToday.addEventListener('click', () => switchDay('today'));
  dom.tabTomorrow.addEventListener('click', () => switchDay('tomorrow'));

  // Back button
  dom.btnBack.addEventListener('click', closeSchedule);

  // Booking confirmation modal
  dom.modalClose.addEventListener('click', () => closeModal(dom.modalOverlay));
  dom.modalOverlay.addEventListener('click', (e) => {
    if (e.target === dom.modalOverlay) closeModal(dom.modalOverlay);
  });
  dom.btnConfirmBooking.addEventListener('click', handleBookingConfirm);

  // Unit selection modal
  dom.unitModalClose.addEventListener('click', () => closeModal(dom.unitModalOverlay));
  dom.unitModalOverlay.addEventListener('click', (e) => {
    if (e.target === dom.unitModalOverlay) closeModal(dom.unitModalOverlay);
  });

  // Login modal
  dom.loginModalClose.addEventListener('click', () => closeModal(dom.loginModalOverlay));
  dom.loginModalOverlay.addEventListener('click', (e) => {
    if (e.target === dom.loginModalOverlay) closeModal(dom.loginModalOverlay);
  });
  dom.loginForm.addEventListener('submit', handleLogin);

  // Register modal
  dom.registerModalClose.addEventListener('click', () => closeModal(dom.registerModalOverlay));
  dom.registerModalOverlay.addEventListener('click', (e) => {
    if (e.target === dom.registerModalOverlay) closeModal(dom.registerModalOverlay);
  });
  dom.registerForm.addEventListener('submit', handleRegister);

  // QR Gate Pass modal
  dom.qrModalClose.addEventListener('click', () => {
    closeModal(dom.qrModalOverlay);
    // Kill any running GSAP animation on the QR wrap
    if (window.gsap) gsap.killTweensOf('.qr-image-wrap');
  });
  dom.qrModalOverlay.addEventListener('click', (e) => {
    if (e.target === dom.qrModalOverlay) {
      closeModal(dom.qrModalOverlay);
      if (window.gsap) gsap.killTweensOf('.qr-image-wrap');
    }
  });

  // Auth navigation buttons
  $('#btnOpenLogin').addEventListener('click', () => {
    openModalOverlay(dom.loginModalOverlay);
  });
  $('#btnOpenRegister').addEventListener('click', () => {
    openModalOverlay(dom.registerModalOverlay);
  });

  // Switch between login/register modals
  $('#switchToRegister').addEventListener('click', () => {
    closeModal(dom.loginModalOverlay);
    setTimeout(() => openModalOverlay(dom.registerModalOverlay), 200);
  });
  $('#switchToLogin').addEventListener('click', () => {
    closeModal(dom.registerModalOverlay);
    setTimeout(() => openModalOverlay(dom.loginModalOverlay), 200);
  });

  // User avatar dropdown
  dom.userAvatarBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dom.userDropdown.classList.toggle('open');
  });

  // Close dropdown on outside click
  document.addEventListener('click', () => {
    closeUserDropdown();
  });

  // Logout
  $('#btnLogout').addEventListener('click', handleLogout);

  // Dashboard link
  $('#dropdownDashboard').addEventListener('click', (e) => {
    e.preventDefault();
    closeUserDropdown();
    loadDashboard();
  });

  dom.navDashboardLink.querySelector('a').addEventListener('click', (e) => {
    e.preventDefault();
    loadDashboard();
  });

  // Global Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });
}

function switchDay(day) {
  state.activeDay = day;
  state.selectedSlot = null;

  dom.tabToday.classList.toggle('active', day === 'today');
  dom.tabTomorrow.classList.toggle('active', day === 'tomorrow');

  fetchAndRenderSlots();
}


// ─────────────────────────────────────────────
//  SPOTLIGHT CARD — Mouse-tracking reveal effect
// ─────────────────────────────────────────────
function initSpotlightCards() {
  const cards = $$('.facility-card');
  cards.forEach((card) => {
    // Prevent duplicate listeners by marking
    if (card._spotlightBound) return;
    card._spotlightBound = true;

    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty('--mouse-x', `${x}px`);
      card.style.setProperty('--mouse-y', `${y}px`);
    });

    card.addEventListener('mouseleave', () => {
      // Reset to center so the pseudo-element fades gracefully
      card.style.setProperty('--mouse-x', '50%');
      card.style.setProperty('--mouse-y', '50%');
    });
  });
}



// ─────────────────────────────────────────────
//  REAL-TIME SLOTS — SSE (Server-Sent Events)
// ─────────────────────────────────────────────
function initLiveSlots() {
  // Graceful check — SSE not supported in all environments
  if (typeof EventSource === 'undefined') return;

  let evtSource = null;

  function connect() {
    evtSource = new EventSource('/api/stream/slots');

    evtSource.onopen = () => {
      // Show the live badge when connected
      if (dom.liveBadge) dom.liveBadge.style.display = 'inline-flex';
    };

    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.updated) {
          // Only re-fetch if the schedule view is currently visible
          if (dom.scheduleHeader && dom.scheduleHeader.style.display !== 'none' && state.activeUnit) {
            fetchAndRenderSlots();
          }
        }
      } catch (err) {
        console.warn('[SSE] Failed to parse message:', err);
      }
    };

    evtSource.onerror = () => {
      // Hide live badge on error
      if (dom.liveBadge) dom.liveBadge.style.display = 'none';
      // EventSource auto-reconnects, but close if readyState is CLOSED
      if (evtSource.readyState === EventSource.CLOSED) {
        evtSource.close();
        // Retry connection after 5 seconds
        setTimeout(connect, 5000);
      }
    };
  }

  connect();
}


// ─────────────────────────────────────────────
//  INITIALISATION
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initThemeToggle();
  bindEvents();
  initNavbarScroll();
  initActiveNavLink();
  initHamburger();
  initOrbCanvas();
  initLiveSlots();

  // Check auth session
  await checkAuth();

  // Load facilities from API (also initialises spotlight cards)
  await loadFacilities();

  // Wait for GSAP to load (deferred script)
  const gsapReady = setInterval(() => {
    if (window.gsap && window.ScrollTrigger) {
      clearInterval(gsapReady);
      initGSAPAnimations();
    }
  }, 50);
});

// Expose scroll function globally for inline onclick handlers
window.scrollToSection = scrollToSection;

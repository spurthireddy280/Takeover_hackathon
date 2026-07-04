/* ═══════════════════════════════════════════════════════════════
   FlexSpace — Admin Dashboard Logic
   ═══════════════════════════════════════════════════════════════ */

const API = {
  async get(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    return res.json();
  },
  async del(url) {
    const res = await fetch(url, { method: 'DELETE', credentials: 'same-origin' });
    const data = await res.json();
    data._status = res.status;
    return data;
  }
};

// ─── State ───
let currentDate = new Date().toISOString().split('T')[0];

// ─── DOM ───
const $ = (sel) => document.querySelector(sel);

const dom = {
  adminWrapper:  $('#adminWrapper'),
  adminDenied:   $('#adminDenied'),
  datePicker:    $('#adminDatePicker'),
  tableBody:     $('#adminTableBody'),
  tableWrap:     $('#adminTableWrap'),
  adminEmpty:    $('#adminEmpty'),
  statTotal:     $('#statTotal'),
  statFacilities:$('#statFacilities'),
  statUsers:     $('#statUsers'),
  toast:         $('#toast'),
  toastMsg:      $('#toastMsg'),
};

// ─── Auth Check ───
async function checkAdminAuth() {
  try {
    const data = await API.get('/api/auth/me');
    if (data.user && data.user.role === 'admin') {
      dom.adminWrapper.style.display = 'block';
      dom.adminDenied.style.display = 'none';
      return true;
    } else {
      dom.adminWrapper.style.display = 'none';
      dom.adminDenied.style.display = 'flex';
      return false;
    }
  } catch {
    dom.adminWrapper.style.display = 'none';
    dom.adminDenied.style.display = 'flex';
    return false;
  }
}

// ─── Load Bookings ───
async function loadBookings() {
  try {
    const data = await API.get(`/api/admin/bookings?date=${currentDate}`);
    const bookings = data.bookings || [];

    // Update stats
    dom.statTotal.textContent = bookings.length;
    const facilities = new Set(bookings.map(b => b.facility_name));
    dom.statFacilities.textContent = facilities.size;
    const users = new Set(bookings.map(b => b.user_email));
    dom.statUsers.textContent = users.size;

    if (bookings.length === 0) {
      dom.tableWrap.style.display = 'none';
      dom.adminEmpty.style.display = 'block';
    } else {
      dom.tableWrap.style.display = 'block';
      dom.adminEmpty.style.display = 'none';
      renderTable(bookings);
    }
  } catch (err) {
    console.error('Failed to load bookings:', err);
  }
}

function renderTable(bookings) {
  dom.tableBody.innerHTML = bookings.map((b, i) => {
    const bookedAt = b.created_at
      ? new Date(b.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '—';

    return `
      <tr>
        <td>${i + 1}</td>
        <td class="facility-cell">${b.facility_emoji} ${b.facility_name}</td>
        <td>${b.label}</td>
        <td>${b.user_name}</td>
        <td>${b.user_email}</td>
        <td>${bookedAt}</td>
        <td>
          <button class="cancel-btn" data-booking-id="${b.id}" title="Cancel this booking">
            Cancel
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Attach cancel handlers
  dom.tableBody.querySelectorAll('.cancel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      cancelBooking(parseInt(btn.dataset.bookingId, 10));
    });
  });
}

async function cancelBooking(bookingId) {
  if (!confirm('Are you sure you want to cancel this booking?')) return;

  const data = await API.del(`/api/admin/bookings/${bookingId}`);

  if (data._status === 200) {
    showToast('Booking cancelled successfully.');
    loadBookings();
  } else {
    showToast(data.error || 'Failed to cancel booking.');
  }
}

// ─── Date Navigation ───
function setDate(dateStr) {
  currentDate = dateStr;
  dom.datePicker.value = dateStr;
  loadBookings();
}

function shiftDate(days) {
  const d = new Date(currentDate + 'T00:00:00');
  d.setDate(d.getDate() + days);
  setDate(d.toISOString().split('T')[0]);
}

// ─── Toast ───
function showToast(message) {
  dom.toastMsg.textContent = message;
  dom.toast.classList.add('show');
  setTimeout(() => dom.toast.classList.remove('show'), 3500);
}

// ─── Theme Toggle ───
function initThemeToggle() {
  const toggle = document.getElementById('themeToggle');
  const sunIcon = document.getElementById('themeIconSun');
  const moonIcon = document.getElementById('themeIconMoon');
  if (!toggle || !sunIcon || !moonIcon) return;

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

// ─── Init ───
document.addEventListener('DOMContentLoaded', async () => {
  initThemeToggle();

  // Set initial date
  dom.datePicker.value = currentDate;

  // Check auth
  const isAdmin = await checkAdminAuth();
  if (!isAdmin) return;

  // Load bookings
  loadBookings();

  // Date picker change
  dom.datePicker.addEventListener('change', () => {
    currentDate = dom.datePicker.value;
    loadBookings();
  });

  // Navigation buttons
  $('#btnPrevDay').addEventListener('click', () => shiftDate(-1));
  $('#btnNextDay').addEventListener('click', () => shiftDate(1));
  $('#btnToday').addEventListener('click', () => {
    setDate(new Date().toISOString().split('T')[0]);
  });
});

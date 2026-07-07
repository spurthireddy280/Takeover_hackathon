/**
 * FlexSpace — Express Backend (Serverless Entry Point)
 * Replaces the Flask/SQLite backend with Node.js/Express + PostgreSQL.
 * Designed for Vercel serverless deployment with Neon PostgreSQL.
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const cookieSession = require('cookie-session');
const QRCode = require('qrcode');

// ─── App Setup ───────────────────────────────────────────

const app = express();

app.use(express.json());

app.use(cookieSession({
  name: 'flexspace-session',
  keys: [process.env.SESSION_SECRET || 'flexspace-dev-secret-key-change-in-production'],
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
  sameSite: 'lax',
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production'
}));

// ─── PostgreSQL Pool ─────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ─── Static Files ────────────────────────────────────────

app.use(express.static(path.join(__dirname, '..')));

// ─── Helper: Format hour to 12h AM/PM ───────────────────

function formatHour(h) {
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:00 ${suffix}`;
}

// ─── Auth Middleware ─────────────────────────────────────

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

async function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
  const user = result.rows[0];
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}


// ═══════════════════════════════════════════════════════════
//  AUTH API
// ═══════════════════════════════════════════════════════════

app.post('/api/auth/register', async (req, res) => {
  try {
    const data = req.body;
    if (!data) return res.status(400).json({ error: 'Invalid request body' });

    const name = (data.name || '').trim();
    const email = (data.email || '').trim().toLowerCase();
    const password = data.password || '';
    const flat_no = (data.flat_no || '').trim().toUpperCase();

    // Validation
    const errors = [];
    if (!name || name.length < 2) errors.push('Name must be at least 2 characters.');
    if (!email || !email.includes('@')) errors.push('A valid email is required.');
    if (password.length < 6) errors.push('Password must be at least 6 characters.');
    if (!flat_no) errors.push('Flat number is required.');

    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join(' ') });
    }

    // Check duplicate email
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // Create user
    const pw_hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, role, flat_no) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [name, email, pw_hash, 'resident', flat_no]
    );
    const userId = result.rows[0].id;

    // Auto-login after registration
    req.session.userId = userId;
    req.session.userRole = 'resident';

    return res.status(201).json({
      message: 'Account created successfully!',
      user: { id: userId, name, email, role: 'resident', flat_no }
    });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const data = req.body;
    if (!data) return res.status(400).json({ error: 'Invalid request body' });

    const email = (data.email || '').trim().toLowerCase();
    const password = data.password || '';

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Set session
    req.session.userId = user.id;
    req.session.userRole = user.role;

    return res.json({
      message: 'Login successful!',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        flat_no: user.flat_no || ''
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session = null;
  return res.json({ message: 'Logged out successfully.' });
});

app.get('/api/auth/me', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
    const user = result.rows[0];
    if (!user) {
      req.session = null;
      return res.json({ user: null });
    }

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        flat_no: user.flat_no || ''
      }
    });
  } catch (err) {
    console.error('Auth/me error:', err);
    return res.json({ user: null });
  }
});


// ═══════════════════════════════════════════════════════════
//  FACILITIES API
// ═══════════════════════════════════════════════════════════

app.get('/api/facilities', async (req, res) => {
  try {
    const parents = await pool.query(
      'SELECT * FROM facilities WHERE parent_id IS NULL ORDER BY id'
    );

    const facilities = [];
    for (const p of parents.rows) {
      const children = await pool.query(
        'SELECT * FROM facilities WHERE parent_id = $1 ORDER BY id',
        [p.id]
      );
      facilities.push({
        ...p,
        units: children.rows
      });
    }

    return res.json({ facilities });
  } catch (err) {
    console.error('Facilities error:', err);
    return res.status(500).json({ error: 'Failed to load facilities.' });
  }
});

app.get('/api/facilities/:id/slots', async (req, res) => {
  try {
    const facilityId = parseInt(req.params.id, 10);

    // --- ADD THIS SAFEGUARD ---
    if (isNaN(facilityId)) {
      return res.status(400).json({ error: 'Invalid facility ID', slots: [] });
    }
    // --------------------------

    const dateStr = req.query.date || new Date().toISOString().split('T')[0];

    // Verify facility exists
    const facResult = await pool.query('SELECT * FROM facilities WHERE id = $1', [facilityId]);
    const facility = facResult.rows[0];
    if (!facility) {
      return res.status(404).json({ error: 'Facility not found' });
    }

    // Get existing confirmed bookings for this facility on this date
    const bookingsResult = await pool.query(
      `SELECT b.*, u.name as user_name, u.email as user_email, u.flat_no as user_flat_no
       FROM bookings b
       JOIN users u ON b.user_id = u.id
       WHERE b.facility_id = $1 AND b.date = $2 AND b.status = 'confirmed'
       ORDER BY b.start_time`,
      [facilityId, dateStr]
    );

    const bookedHours = {};
    for (const b of bookingsResult.rows) {
      bookedHours[b.start_time] = b;
    }

    // Determine current hour to filter past slots for today
    const today = new Date().toISOString().split('T')[0];
    const isToday = dateStr === today;
    const currentHour = isToday ? new Date().getHours() : 0;

    // Generate time slots (6 AM to 10 PM)
    const slots = [];
    for (let h = 6; h < 22; h++) {
      // Skip slots that have already passed today
      if (isToday && h <= currentHour) continue;

      const booking = bookedHours[h] || null;
      const slot = {
        start: h,
        end: h + 1,
        label: `${formatHour(h)} — ${formatHour(h + 1)}`,
        available: booking === null
      };

      if (booking) {
        let bookedBy = booking.user_name;
        const flat = booking.user_flat_no || '';
        if (flat) {
          bookedBy = `${bookedBy} (${flat})`;
        }
        slot.booked_by = bookedBy;
        slot.booking_id = booking.id;
      }

      slots.push(slot);
    }

    return res.json({ facility, date: dateStr, slots });
  } catch (err) {
    console.error('Slots error:', err);
    return res.status(500).json({ error: 'Failed to load slots.' });
  }
});


// ═══════════════════════════════════════════════════════════
//  BOOKINGS API
// ═══════════════════════════════════════════════════════════

app.post('/api/bookings', requireAuth, async (req, res) => {
  try {
    const data = req.body;
    if (!data) return res.status(400).json({ error: 'Invalid request body' });

    const facility_id = data.facility_id;
    const dateStr = data.date;
    const start_time = data.start_time;
    const end_time = data.end_time;

    if (!facility_id || !dateStr || start_time === undefined || end_time === undefined) {
      return res.status(400).json({ error: 'Missing required fields: facility_id, date, start_time, end_time' });
    }

    // Verify facility exists
    const facResult = await pool.query('SELECT * FROM facilities WHERE id = $1', [facility_id]);
    const facility = facResult.rows[0];
    if (!facility) {
      return res.status(404).json({ error: 'Facility not found' });
    }

    // Verify the date is today or in the future
    const today = new Date().toISOString().split('T')[0];
    if (dateStr < today) {
      return res.status(400).json({ error: 'Cannot book slots in the past.' });
    }

    // Verify time range
    if (!(start_time >= 6 && start_time < 22 && start_time < end_time && end_time <= 22)) {
      return res.status(400).json({ error: 'Invalid time range. Slots are available from 6 AM to 10 PM.' });
    }

    // Check for double booking
    const existingBooking = await pool.query(
      `SELECT id FROM bookings 
       WHERE facility_id = $1 AND date = $2 AND start_time = $3 AND status = 'confirmed'`,
      [facility_id, dateStr, start_time]
    );

    if (existingBooking.rows.length > 0) {
      return res.status(409).json({ error: 'This time slot is already booked. Please choose another.' });
    }

    // Create booking
    const result = await pool.query(
      `INSERT INTO bookings (user_id, facility_id, date, start_time, end_time, status)
       VALUES ($1, $2, $3, $4, $5, 'confirmed') RETURNING id`,
      [req.session.userId, facility_id, dateStr, start_time, end_time]
    );
    const bookingId = result.rows[0].id;

    const userResult = await pool.query('SELECT name FROM users WHERE id = $1', [req.session.userId]);
    const userName = userResult.rows[0].name;

    return res.status(201).json({
      message: `Booking confirmed for ${userName}!`,
      booking: {
        id: bookingId,
        facility_id,
        facility_name: facility.name,
        date: dateStr,
        start_time,
        end_time,
        status: 'confirmed'
      }
    });
  } catch (err) {
    console.error('Booking error:', err);
    return res.status(500).json({ error: 'Booking failed. Please try again.' });
  }
});

app.get('/api/bookings/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.*, f.name as facility_name, f.emoji as facility_emoji,
              f.parent_id, pf.name as parent_name, pf.emoji as parent_emoji
       FROM bookings b
       JOIN facilities f ON b.facility_id = f.id
       LEFT JOIN facilities pf ON f.parent_id = pf.id
       WHERE b.user_id = $1 AND b.status = 'confirmed'
       ORDER BY b.date, b.start_time`,
      [req.session.userId]
    );

    const bookings = result.rows.map(b => {
      let displayName = b.facility_name;
      if (b.parent_name) {
        displayName = `${b.parent_name} — ${b.facility_name.split(' — ').pop()}`;
      }
      const emoji = b.parent_emoji || b.facility_emoji || '🏟️';

      return {
        id: b.id,
        facility_id: b.facility_id,
        facility_name: displayName,
        facility_emoji: emoji,
        date: b.date,
        start_time: b.start_time,
        end_time: b.end_time,
        label: `${formatHour(b.start_time)} — ${formatHour(b.end_time)}`,
        status: b.status,
        created_at: b.created_at
      };
    });

    return res.json({ bookings });
  } catch (err) {
    console.error('My bookings error:', err);
    return res.status(500).json({ error: 'Failed to load bookings.' });
  }
});

app.delete('/api/bookings/:id', requireAuth, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id, 10);
    const isAdmin = req.session.userRole === 'admin';

    let result;
    if (isAdmin) {
      result = await pool.query(
        "UPDATE bookings SET status = 'cancelled' WHERE id = $1 AND status = 'confirmed'",
        [bookingId]
      );
    } else {
      result = await pool.query(
        "UPDATE bookings SET status = 'cancelled' WHERE id = $1 AND user_id = $2 AND status = 'confirmed'",
        [bookingId, req.session.userId]
      );
    }

    if (result.rowCount > 0) {
      return res.json({ message: 'Booking cancelled successfully.' });
    } else {
      return res.status(404).json({ error: 'Booking not found or you do not have permission to cancel it.' });
    }
  } catch (err) {
    console.error('Cancel booking error:', err);
    return res.status(500).json({ error: 'Failed to cancel booking.' });
  }
});


// ═══════════════════════════════════════════════════════════
//  ADMIN API
// ═══════════════════════════════════════════════════════════

app.get('/api/admin/bookings', requireAdmin, async (req, res) => {
  try {
    const dateStr = req.query.date || new Date().toISOString().split('T')[0];

    const result = await pool.query(
      `SELECT b.*, u.name as user_name, u.email as user_email, u.flat_no as user_flat_no,
              f.name as facility_name, f.emoji as facility_emoji,
              f.parent_id, pf.name as parent_name, pf.emoji as parent_emoji
       FROM bookings b JOIN users u ON b.user_id = u.id JOIN facilities f ON b.facility_id = f.id
       LEFT JOIN facilities pf ON f.parent_id = pf.id
       WHERE b.status = 'confirmed' ORDER BY b.date DESC, b.start_time DESC`
    );

    const bookings = result.rows.map(b => {
      let displayName = b.facility_name;
      if (b.parent_name) {
        displayName = `${b.parent_name} — ${b.facility_name.split(' — ').pop()}`;
      }
      const emoji = b.parent_emoji || b.facility_emoji || '🏟️';

      return {
        id: b.id,
        user_name: b.user_name,
        user_email: b.user_email,
        user_flat_no: b.user_flat_no || '',
        facility_name: displayName,
        facility_emoji: emoji,
        date: b.date,
        start_time: b.start_time,
        end_time: b.end_time,
        label: `${formatHour(b.start_time)} — ${formatHour(b.end_time)}`,
        status: b.status,
        created_at: b.created_at
      };
    });

    return res.json({ bookings, date: dateStr });
  } catch (err) {
    console.error('Admin bookings error:', err);
    return res.status(500).json({ error: 'Failed to load bookings.' });
  }
});

app.delete('/api/admin/bookings/:id', requireAdmin, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id, 10);
    const result = await pool.query(
      "UPDATE bookings SET status = 'cancelled' WHERE id = $1 AND status = 'confirmed'",
      [bookingId]
    );

    if (result.rowCount > 0) {
      return res.json({ message: 'Booking cancelled by admin.' });
    } else {
      return res.status(404).json({ error: 'Booking not found or already cancelled.' });
    }
  } catch (err) {
    console.error('Admin cancel error:', err);
    return res.status(500).json({ error: 'Failed to cancel booking.' });
  }
});


// ═══════════════════════════════════════════════════════════
//  QR CODE GATE PASS & VERIFICATION
// ═══════════════════════════════════════════════════════════

app.get('/api/bookings/:id/qr', requireAuth, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id, 10);

    const result = await pool.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
    const booking = result.rows[0];
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Only the booking owner can view their gate pass
    if (booking.user_id !== req.session.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (booking.status !== 'confirmed') {
      return res.status(400).json({ error: 'Booking is not active' });
    }

    // Build verification URL
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const baseUrl = `${protocol}://${host}`;
    const payload = `${baseUrl}/verify/${bookingId}`;

    // Generate QR code as PNG buffer
    const qrBuffer = await QRCode.toBuffer(payload, {
      errorCorrectionLevel: 'H',
      type: 'png',
      width: 300,
      margin: 4,
      color: {
        dark: '#1e1b4b',
        light: '#f5f3ff'
      }
    });

    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `inline; filename="gatepass-${bookingId}.png"`);
    return res.send(qrBuffer);
  } catch (err) {
    console.error('QR error:', err);
    return res.status(500).json({ error: 'Failed to generate QR code.' });
  }
});

app.get('/verify/:id', async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id, 10);

    const result = await pool.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
    const booking = result.rows[0];

    // 1. Invalid or Cancelled Pass UI
    if (!booking || booking.status !== 'confirmed') {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Invalid Pass</title>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;800&display=swap" rel="stylesheet" />
        </head>
        <body style="font-family: 'Inter', sans-serif; background: #07060e; color: white; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box;">
            <div style="text-align: center; background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.3); padding: 40px 20px; border-radius: 24px; max-width: 400px; width: 100%;">
                <div style="font-size: 60px; margin-bottom: 20px;">❌</div>
                <h1 style="color: #ef4444; margin: 0 0 10px 0; font-weight: 800; letter-spacing: 1px;">PASS INVALID</h1>
                <p style="color: #9b97ad; margin: 0; font-weight: 600;">This booking is expired, cancelled, or does not exist.</p>
            </div>
        </body>
        </html>
      `);
    }

    // 2. Get Data for Valid Pass
    const facResult = await pool.query('SELECT * FROM facilities WHERE id = $1', [booking.facility_id]);
    const facility = facResult.rows[0];

    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [booking.user_id]);
    const user = userResult.rows[0];

    // Build full facility name
    let facilityName = facility.name;
    if (facility.parent_id) {
      const parentResult = await pool.query('SELECT * FROM facilities WHERE id = $1', [facility.parent_id]);
      const parent = parentResult.rows[0];
      if (parent) {
        facilityName = `${parent.name} — ${facility.name.split(' — ').pop()}`;
      }
    }

    // Format display variables
    const timeSlot = `${formatHour(booking.start_time)} — ${formatHour(booking.end_time)}`;
    const flatNo = user.flat_no || 'N/A';
    const bookingDate = booking.date;
    const bookingRef = `FLX-${String(booking.id).padStart(4, '0')}`;

    // 3. Valid Pass Premium UI
    return res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Gate Pass Verified</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700&family=Poppins:wght@700;800&display=swap" rel="stylesheet" />
        <style>
            body {
                font-family: 'Inter', sans-serif;
                background: #07060e;
                margin: 0;
                padding: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                box-sizing: border-box;
            }
            .verify-card {
                background: rgba(255, 255, 255, 0.03);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border: 1px solid rgba(52, 211, 153, 0.4);
                border-radius: 24px;
                padding: 40px 24px;
                max-width: 420px;
                width: 100%;
                text-align: center;
                box-shadow: 0 20px 40px rgba(52, 211, 153, 0.08);
            }
            .icon-wrap {
                width: 80px;
                height: 80px;
                background: rgba(52, 211, 153, 0.15);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0 auto 24px auto;
                font-size: 36px;
                border: 2px solid rgba(52, 211, 153, 0.4);
                box-shadow: 0 0 20px rgba(52, 211, 153, 0.2);
                animation: pulse 2s infinite;
            }
            @keyframes pulse {
                0% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.4); }
                70% { box-shadow: 0 0 0 20px rgba(52, 211, 153, 0); }
                100% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0); }
            }
            .status-text {
                font-family: 'Poppins', sans-serif;
                color: #34d399;
                font-size: 26px;
                font-weight: 800;
                margin: 0 0 6px 0;
                letter-spacing: 1px;
            }
            .system-text {
                color: #5d5875;
                font-size: 13px;
                margin: 0 0 32px 0;
                text-transform: uppercase;
                letter-spacing: 2px;
                font-weight: 600;
            }
            .detail-box {
                background: rgba(255, 255, 255, 0.04);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 16px;
                padding: 16px 20px;
                text-align: left;
            }
            .detail-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 14px 0;
                border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            }
            .detail-row:last-child { border-bottom: none; padding-bottom: 0; }
            .detail-row:first-child { padding-top: 0; }
            .detail-label { 
                color: #9b97ad; 
                font-size: 13px; 
                font-weight: 600; 
                text-transform: uppercase; 
                letter-spacing: 0.5px; 
            }
            .detail-value { 
                color: #f1f0f5; 
                font-size: 15px; 
                font-weight: 600; 
                text-align: right; 
                max-width: 60%;
            }
            .highlight-value { color: #a855f7; font-weight: 700; }
        </style>
    </head>
    <body>
        <div class="verify-card">
            <div class="icon-wrap">✓</div>
            <h1 class="status-text">ENTRY APPROVED</h1>
            <p class="system-text">FlexSpace Security System</p>
            
            <div class="detail-box">
                <div class="detail-row">
                    <span class="detail-label">Resident</span>
                    <span class="detail-value">${user.name}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Flat No</span>
                    <span class="detail-value">${flatNo}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Facility</span>
                    <span class="detail-value highlight-value">${facility.emoji} ${facilityName}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Date</span>
                    <span class="detail-value">${bookingDate}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Time</span>
                    <span class="detail-value">${timeSlot}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Ref ID</span>
                    <span class="detail-value" style="color: #6366f1;">${bookingRef}</span>
                </div>
            </div>
        </div>
    </body>
    </html>
    `);
  } catch (err) {
    console.error('Verify error:', err);
    return res.status(500).send('Internal server error');
  }
});


// ═══════════════════════════════════════════════════════════
//  DATABASE SETUP (Temporary Bootstrap Route)
// ═══════════════════════════════════════════════════════════

app.get('/api/setup-db', async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        name          TEXT NOT NULL,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        flat_no       TEXT DEFAULT '',
        role          TEXT NOT NULL DEFAULT 'resident' CHECK(role IN ('resident', 'admin')),
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS facilities (
        id            SERIAL PRIMARY KEY,
        name          TEXT NOT NULL,
        category      TEXT NOT NULL,
        capacity      INTEGER DEFAULT 1,
        parent_id     INTEGER DEFAULT NULL REFERENCES facilities(id) ON DELETE CASCADE,
        emoji         TEXT DEFAULT '🏟️',
        image         TEXT DEFAULT '',
        description   TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS bookings (
        id            SERIAL PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        facility_id   INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
        date          TEXT NOT NULL,
        start_time    INTEGER NOT NULL,
        end_time      INTEGER NOT NULL,
        status        TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed', 'cancelled')),
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_booking
        ON bookings(facility_id, date, start_time)
        WHERE status = 'confirmed';
    `);

    // Seed facilities if empty
    const facCount = await pool.query('SELECT COUNT(*) as c FROM facilities');
    if (parseInt(facCount.rows[0].c) === 0) {
      const facilityData = [
        { name: 'Badminton', category: 'racquet', capacity: 4, emoji: '🏸', image: 'assets/badminton.png', description: 'Professional-grade indoor courts with premium flooring, LED scoreboards, and net equipment provided. Perfect for singles or doubles.', units: ['Court 1', 'Court 2', 'Court 3'] },
        { name: 'Box Cricket', category: 'team', capacity: 12, emoji: '🏏', image: 'assets/box_cricket.png', description: 'Enclosed turf pitch with protective netting and LED floodlights. Great for quick cricket matches with friends and family.', units: [] },
        { name: 'Basketball Court', category: 'team', capacity: 10, emoji: '🏀', image: 'assets/basketball.png', description: 'Full-size hardwood court with professional hoops, LED scoreboard, and floodlighting for evening games.', units: [] },
        { name: 'Volleyball Court', category: 'team', capacity: 12, emoji: '🏐', image: 'assets/volleyball.png', description: 'Outdoor sand court with regulation net, LED floodlights, and spectator seating. Ideal for casual and competitive play.', units: [] },
        { name: 'Table Tennis', category: 'racquet', capacity: 4, emoji: '🏓', image: 'assets/table_tennis.png', description: 'Climate-controlled indoor facility with competition-grade tables, paddles, and balls provided. Available for singles or doubles.', units: ['Board 1', 'Board 2', 'Board 3', 'Board 4', 'Board 5'] },
        { name: 'Snooker', category: 'indoor', capacity: 4, emoji: '🎱', image: 'assets/snooker.png', description: 'Elegant snooker lounge with full-size tables, premium cues, and ambient pendant lighting. A refined gaming experience.', units: ['Board 1', 'Board 2', 'Board 3'] },
        { name: 'Pickleball Court', category: 'racquet', capacity: 4, emoji: '🏓', image: 'assets/pickleball.png', description: 'Dedicated outdoor pickleball court with regulation markings, quality nets, and evening LED lighting.', units: [] },
      ];

      for (const fac of facilityData) {
        const parentResult = await pool.query(
          'INSERT INTO facilities (name, category, capacity, emoji, image, description, parent_id) VALUES ($1, $2, $3, $4, $5, $6, NULL) RETURNING id',
          [fac.name, fac.category, fac.capacity, fac.emoji, fac.image, fac.description]
        );
        const parentId = parentResult.rows[0].id;

        for (const unitName of fac.units) {
          const fullName = `${fac.name} — ${unitName}`;
          await pool.query(
            'INSERT INTO facilities (name, category, capacity, emoji, image, description, parent_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [fullName, fac.category, fac.capacity, fac.emoji, fac.image, fac.description, parentId]
          );
        }
      }
    }

    // Seed default admin account if not exists
    const adminCheck = await pool.query("SELECT id FROM users WHERE email = 'admin@flexspace.com'");
    if (adminCheck.rows.length === 0) {
      const pw_hash = await bcrypt.hash('admin123', 10);
      await pool.query(
        'INSERT INTO users (name, email, password_hash, role, flat_no) VALUES ($1, $2, $3, $4, $5)',
        ['Admin', 'admin@flexspace.com', pw_hash, 'admin', 'A-101']
      );
    }

    return res.json({
      message: 'Database setup complete! Tables created and seeded.',
      tables: ['users', 'facilities', 'bookings']
    });
  } catch (err) {
    console.error('Setup DB error:', err);
    return res.status(500).json({ error: 'Database setup failed.', details: err.message });
  }
});


// ═══════════════════════════════════════════════════════════
//  PAGE ROUTES (SPA Fallback)
// ═══════════════════════════════════════════════════════════

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'admin.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});


// ═══════════════════════════════════════════════════════════
//  LOCAL DEV SERVER
// ═══════════════════════════════════════════════════════════

if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`[*] FlexSpace server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
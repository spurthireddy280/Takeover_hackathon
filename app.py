"""
FlexSpace — Flask Backend Application
Handles API routing, authentication, and serves the frontend.
"""

import os
import io
import json
import queue
import functools
from datetime import date, timedelta

import qrcode
from flask import Flask, request, jsonify, session, send_from_directory, send_file, Response
from flask_bcrypt import Bcrypt  # type: ignore

from models import (
    init_db, get_user_by_email, get_user_by_id, create_user,
    get_all_facility_groups, get_facility_by_id,
    get_bookings_for_facility, create_booking, get_user_bookings,
    cancel_booking, get_all_bookings_for_date, get_booking_by_id
)
from seed import seed

# ─── App Setup ───────────────────────────────────────────

app = Flask(__name__, static_folder='.', static_url_path='')
app.secret_key = os.environ.get('SECRET_KEY', 'flexspace-dev-secret-key-change-in-production')
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_HTTPONLY'] = True

bcrypt = Bcrypt(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ─── SSE Client Queues ──────────────────────────────────
sse_clients = []


# ─── Auth Decorators ────────────────────────────────────

def login_required(f):
    """Decorator: requires authenticated user in session."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Authentication required'}), 401
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    """Decorator: requires authenticated admin user."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Authentication required'}), 401
        user = get_user_by_id(session['user_id'])
        if not user or user['role'] != 'admin':
            return jsonify({'error': 'Admin access required'}), 403
        return f(*args, **kwargs)
    return decorated


# ─── Page Routes ─────────────────────────────────────────

@app.route('/')
def index():
    """Serve the main SPA page."""
    return send_file(os.path.join(BASE_DIR, 'index.html'))


@app.route('/admin')
def admin_page():
    """Serve the admin dashboard page."""
    return send_file(os.path.join(BASE_DIR, 'admin.html'))


# ─── Static Files ────────────────────────────────────────

@app.route('/assets/<path:filename>')
def serve_assets(filename):
    return send_from_directory(os.path.join(BASE_DIR, 'assets'), filename)


@app.route('/styles.css')
def serve_css():
    return send_file(os.path.join(BASE_DIR, 'styles.css'), mimetype='text/css')


@app.route('/app.js')
def serve_js():
    return send_file(os.path.join(BASE_DIR, 'app.js'), mimetype='application/javascript')


@app.route('/admin.js')
def serve_admin_js():
    return send_file(os.path.join(BASE_DIR, 'admin.js'), mimetype='application/javascript')


# ═══════════════════════════════════════════════════════════
#  AUTH API
# ═══════════════════════════════════════════════════════════

@app.route('/api/auth/register', methods=['POST'])
def register():
    """Register a new resident user."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid request body'}), 400

    name = (data.get('name') or '').strip()
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    flat_no = (data.get('flat_no') or '').strip().upper()

    # Validation
    errors = []
    if not name or len(name) < 2:
        errors.append('Name must be at least 2 characters.')
    if not email or '@' not in email:
        errors.append('A valid email is required.')
    if len(password) < 6:
        errors.append('Password must be at least 6 characters.')
    if not flat_no:
        errors.append('Flat number is required.')

    if errors:
        return jsonify({'error': ' '.join(errors)}), 400

    # Check duplicate email
    if get_user_by_email(email):
        return jsonify({'error': 'An account with this email already exists.'}), 409

    # Create user
    pw_hash = bcrypt.generate_password_hash(password).decode('utf-8')
    user_id = create_user(name, email, pw_hash, role='resident', flat_no=flat_no)

    if not user_id:
        return jsonify({'error': 'Registration failed. Please try again.'}), 500

    # Auto-login after registration
    session['user_id'] = user_id
    session['user_role'] = 'resident'

    return jsonify({
        'message': 'Account created successfully!',
        'user': {'id': user_id, 'name': name, 'email': email, 'role': 'resident', 'flat_no': flat_no}
    }), 201


@app.route('/api/auth/login', methods=['POST'])
def login():
    """Authenticate a user."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid request body'}), 400

    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''

    if not email or not password:
        return jsonify({'error': 'Email and password are required.'}), 400

    user = get_user_by_email(email)
    if not user:
        return jsonify({'error': 'Invalid email or password.'}), 401

    if not bcrypt.check_password_hash(user['password_hash'], password):
        return jsonify({'error': 'Invalid email or password.'}), 401

    # Set session
    session['user_id'] = user['id']
    session['user_role'] = user['role']

    return jsonify({
        'message': 'Login successful!',
        'user': {
            'id': user['id'],
            'name': user['name'],
            'email': user['email'],
            'role': user['role'],
            'flat_no': user.get('flat_no', '')
        }
    })


@app.route('/api/auth/logout', methods=['POST'])
def logout():
    """Log out the current user."""
    session.clear()
    return jsonify({'message': 'Logged out successfully.'})


@app.route('/api/auth/me')
def me():
    """Get the currently authenticated user's info."""
    if 'user_id' not in session:
        return jsonify({'user': None})

    user = get_user_by_id(session['user_id'])
    if not user:
        session.clear()
        return jsonify({'user': None})

    return jsonify({
        'user': {
            'id': user['id'],
            'name': user['name'],
            'email': user['email'],
            'role': user['role'],
            'flat_no': user.get('flat_no', '')
        }
    })


# ═══════════════════════════════════════════════════════════
#  FACILITIES API
# ═══════════════════════════════════════════════════════════

@app.route('/api/facilities')
def list_facilities():
    """List all facility groups with their sub-units."""
    groups = get_all_facility_groups()
    return jsonify({'facilities': groups})


@app.route('/api/facilities/<int:facility_id>/slots')
def facility_slots(facility_id):
    """
    Get time slots for a facility on a given date.
    Query params: ?date=YYYY-MM-DD
    Returns slots with availability info.
    """
    date_str = request.args.get('date')
    if not date_str:
        # Default to today
        date_str = date.today().isoformat()

    facility = get_facility_by_id(facility_id)
    if not facility:
        return jsonify({'error': 'Facility not found'}), 404

    # Get existing bookings for this facility on this date
    bookings = get_bookings_for_facility(facility_id, date_str)
    booked_hours = {b['start_time']: b for b in bookings}

    # Determine current hour to filter past slots for today
    from datetime import datetime
    is_today = (date_str == date.today().isoformat())
    current_hour = datetime.now().hour if is_today else 0

    # Generate time slots (6 AM to 10 PM), skipping past slots for today
    slots = []
    for h in range(6, 22):
        # Skip slots that have already passed today
        if is_today and h <= current_hour:
            continue

        booking = booked_hours.get(h)
        slot = {
            'start': h,
            'end': h + 1,
            'label': f"{format_hour(h)} — {format_hour(h + 1)}",
            'available': booking is None,
        }
        if booking:
            booked_by = booking['user_name']
            flat = booking.get('user_flat_no', '')
            if flat:
                booked_by = f"{booked_by} ({flat})"
            slot['booked_by'] = booked_by
            slot['booking_id'] = booking['id']
        slots.append(slot)

    return jsonify({
        'facility': dict(facility) if not isinstance(facility, dict) else facility,
        'date': date_str,
        'slots': slots
    })


def format_hour(h):
    """Format 24h hour to 12h AM/PM string."""
    suffix = 'PM' if h >= 12 else 'AM'
    hour12 = h % 12 or 12
    return f"{hour12}:00 {suffix}"


# ═══════════════════════════════════════════════════════════
#  BOOKINGS API
# ═══════════════════════════════════════════════════════════

@app.route('/api/bookings', methods=['POST'])
@login_required
def make_booking():
    """Create a new booking. Requires authentication."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid request body'}), 400

    facility_id = data.get('facility_id')
    date_str = data.get('date')
    start_time = data.get('start_time')
    end_time = data.get('end_time')

    # Validation
    if not all([facility_id, date_str, start_time is not None, end_time is not None]):
        return jsonify({'error': 'Missing required fields: facility_id, date, start_time, end_time'}), 400

    # Verify facility exists
    facility = get_facility_by_id(facility_id)
    if not facility:
        return jsonify({'error': 'Facility not found'}), 404

    # Verify the date is today or in the future
    try:
        booking_date = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD.'}), 400

    if booking_date < date.today():
        return jsonify({'error': 'Cannot book slots in the past.'}), 400

    # Verify time range
    if not (6 <= start_time < 22 and start_time < end_time <= 22):
        return jsonify({'error': 'Invalid time range. Slots are available from 6 AM to 10 PM.'}), 400

    # Attempt to create booking (unique constraint will catch double-booking)
    booking_id = create_booking(
        user_id=session['user_id'],
        facility_id=facility_id,
        date=date_str,
        start_time=start_time,
        end_time=end_time
    )

    if not booking_id:
        return jsonify({'error': 'This time slot is already booked. Please choose another.'}), 409

    # Notify all SSE clients of the slot change
    for q in sse_clients:
        q.put('{"updated": true}')

    user = get_user_by_id(session['user_id'])
    return jsonify({
        'message': f"Booking confirmed for {user['name']}!",
        'booking': {
            'id': booking_id,
            'facility_id': facility_id,
            'facility_name': facility['name'],
            'date': date_str,
            'start_time': start_time,
            'end_time': end_time,
            'status': 'confirmed'
        }
    }), 201


@app.route('/api/bookings/me')
@login_required
def my_bookings():
    """Get the current user's confirmed bookings."""
    bookings = get_user_bookings(session['user_id'])

    # Format bookings for frontend
    result = []
    for b in bookings:
        display_name = b['facility_name']
        if b['parent_name']:
            display_name = f"{b['parent_name']} — {b['facility_name'].split(' — ')[-1]}"
        emoji = b.get('parent_emoji') or b.get('facility_emoji', '🏟️')

        result.append({
            'id': b['id'],
            'facility_id': b['facility_id'],
            'facility_name': display_name,
            'facility_emoji': emoji,
            'date': b['date'],
            'start_time': b['start_time'],
            'end_time': b['end_time'],
            'label': f"{format_hour(b['start_time'])} — {format_hour(b['end_time'])}",
            'status': b['status'],
            'created_at': b['created_at']
        })

    return jsonify({'bookings': result})


@app.route('/api/bookings/<int:booking_id>', methods=['DELETE'])
@login_required
def cancel_my_booking(booking_id):
    """Cancel a booking. Users can only cancel their own; admins can cancel any."""
    is_admin = session.get('user_role') == 'admin'
    success = cancel_booking(booking_id, user_id=session['user_id'], is_admin=is_admin)

    if success:
        # Notify all SSE clients of the slot change
        for q in sse_clients:
            q.put('{"updated": true}')
        return jsonify({'message': 'Booking cancelled successfully.'})
    else:
        return jsonify({'error': 'Booking not found or you do not have permission to cancel it.'}), 404


# ═══════════════════════════════════════════════════════════
#  ADMIN API
# ═══════════════════════════════════════════════════════════

@app.route('/api/admin/bookings')
@admin_required
def admin_all_bookings():
    # Fetch ALL confirmed bookings, ignoring the date query
    conn = get_db()
    rows = conn.execute("""
        SELECT b.*, u.name as user_name, u.email as user_email, u.flat_no as user_flat_no,
               f.name as facility_name, f.emoji as facility_emoji,
               f.parent_id, pf.name as parent_name, pf.emoji as parent_emoji
        FROM bookings b JOIN users u ON b.user_id = u.id JOIN facilities f ON b.facility_id = f.id
        LEFT JOIN facilities pf ON f.parent_id = pf.id
        WHERE b.status = 'confirmed' ORDER BY b.date DESC, b.start_time DESC
    """).fetchall()
    conn.close()
    bookings = [dict(r) for r in rows]
    # ... keep the rest of your formatting loop exactly the same

    result = []
    for b in bookings:
        display_name = b['facility_name']
        if b['parent_name']:
            display_name = f"{b['parent_name']} — {b['facility_name'].split(' — ')[-1]}"
        emoji = b.get('parent_emoji') or b.get('facility_emoji', '🏟️')

        result.append({
            'id': b['id'],
            'user_name': b['user_name'],
            'user_email': b['user_email'],
            'user_flat_no': b.get('user_flat_no', ''),
            'facility_name': display_name,
            'facility_emoji': emoji,
            'date': b['date'],
            'start_time': b['start_time'],
            'end_time': b['end_time'],
            'label': f"{format_hour(b['start_time'])} — {format_hour(b['end_time'])}",
            'status': b['status'],
            'created_at': b['created_at']
        })

    return jsonify({'bookings': result, 'date': date_str})


@app.route('/api/admin/bookings/<int:booking_id>', methods=['DELETE'])
@admin_required
def admin_cancel_booking(booking_id):
    """Admin: cancel any booking."""
    success = cancel_booking(booking_id, is_admin=True)
    if success:
        return jsonify({'message': 'Booking cancelled by admin.'})
    else:
        return jsonify({'error': 'Booking not found or already cancelled.'}), 404


# ═══════════════════════════════════════════════════════════
#  QR CODE GATE PASS & VERIFICATION
# ═══════════════════════════════════════════════════════════

@app.route('/api/bookings/<int:booking_id>/qr')
@login_required
def booking_qr(booking_id):
    """Generate a QR code gate pass image for a booking."""
    booking = get_booking_by_id(booking_id)
    if not booking:
        return jsonify({'error': 'Booking not found'}), 404

    # Only the booking owner can view their gate pass
    if booking['user_id'] != session['user_id']:
        return jsonify({'error': 'Access denied'}), 403

    if booking['status'] != 'confirmed':
        return jsonify({'error': 'Booking is not active'}), 400

    # Build a URL payload for the interactive demo verification
    base_url = request.host_url.rstrip('/')
    payload = f"{base_url}/verify/{booking_id}"

    # Generate QR code image
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=4
    )
    qr.add_data(payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color='#1e1b4b', back_color='#f5f3ff')

    # Serve as PNG
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    buf.seek(0)
    return send_file(buf, mimetype='image/png', download_name=f'gatepass-{booking_id}.png')


@app.route('/verify/<int:booking_id>')
def verify_pass(booking_id):
    """Public route for security guards/judges to verify a scanned QR pass."""
    booking = get_booking_by_id(booking_id)

    # 1. Invalid or Cancelled Pass UI
    if not booking or booking['status'] != 'confirmed':
        return """
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
        """, 404

    # 2. Get Data for Valid Pass
    facility = get_facility_by_id(booking['facility_id'])
    user = get_user_by_id(booking['user_id'])

    # Build full facility name to include parent category (e.g., "Snooker — Board 1")
    facility_name = facility['name']
    if facility.get('parent_id'):
        parent = get_facility_by_id(facility['parent_id'])
        if parent:
            facility_name = f"{parent['name']} — {facility['name'].split(' — ')[-1]}"

    # Format the variables for display
    time_slot = f"{format_hour(booking['start_time'])} — {format_hour(booking['end_time'])}"
    flat_no = user.get('flat_no') or 'N/A'
    booking_date = booking['date']
    booking_ref = f"FLX-{booking['id']:04d}"

    # 3. Valid Pass Premium UI
    return f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Gate Pass Verified</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700&family=Poppins:wght@700;800&display=swap" rel="stylesheet" />
        <style>
            body {{
                font-family: 'Inter', sans-serif;
                background: #07060e;
                margin: 0;
                padding: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                box-sizing: border-box;
            }}
            .verify-card {{
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
            }}
            .icon-wrap {{
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
            }}
            @keyframes pulse {{
                0% {{ box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.4); }}
                70% {{ box-shadow: 0 0 0 20px rgba(52, 211, 153, 0); }}
                100% {{ box-shadow: 0 0 0 0 rgba(52, 211, 153, 0); }}
            }}
            .status-text {{
                font-family: 'Poppins', sans-serif;
                color: #34d399;
                font-size: 26px;
                font-weight: 800;
                margin: 0 0 6px 0;
                letter-spacing: 1px;
            }}
            .system-text {{
                color: #5d5875;
                font-size: 13px;
                margin: 0 0 32px 0;
                text-transform: uppercase;
                letter-spacing: 2px;
                font-weight: 600;
            }}
            .detail-box {{
                background: rgba(255, 255, 255, 0.04);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 16px;
                padding: 16px 20px;
                text-align: left;
            }}
            .detail-row {{
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 14px 0;
                border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            }}
            .detail-row:last-child {{ border-bottom: none; padding-bottom: 0; }}
            .detail-row:first-child {{ padding-top: 0; }}
            .detail-label {{ 
                color: #9b97ad; 
                font-size: 13px; 
                font-weight: 600; 
                text-transform: uppercase; 
                letter-spacing: 0.5px; 
            }}
            .detail-value {{ 
                color: #f1f0f5; 
                font-size: 15px; 
                font-weight: 600; 
                text-align: right; 
                max-width: 60%;
            }}
            .highlight-value {{ color: #a855f7; font-weight: 700; }}
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
                    <span class="detail-value">{user['name']}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Flat No</span>
                    <span class="detail-value">{flat_no}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Facility</span>
                    <span class="detail-value highlight-value">{facility['emoji']} {facility_name}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Date</span>
                    <span class="detail-value">{booking_date}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Time</span>
                    <span class="detail-value">{time_slot}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Ref ID</span>
                    <span class="detail-value" style="color: #6366f1;">{booking_ref}</span>
                </div>
            </div>
        </div>
    </body>
    </html>
    """


# ═══════════════════════════════════════════════════════════
#  SERVER-SENT EVENTS (SSE) — Real-Time Slot Updates
# ═══════════════════════════════════════════════════════════

@app.route('/api/stream/slots')
def stream_slots():
    """SSE endpoint: pushes updates when bookings change."""
    def event_stream():
        q = queue.Queue()
        sse_clients.append(q)
        try:
            while True:
                # Blocks until a message is put in the queue
                msg = q.get()
                yield f"data: {msg}\n\n"
        finally:
            # Clean up when the client disconnects
            sse_clients.remove(q)

    return Response(
        event_stream(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive'
        }
    )


# ═══════════════════════════════════════════════════════════
#  STARTUP
# ═══════════════════════════════════════════════════════════

if __name__ == '__main__':
    # Initialize and seed database on first run
    print("[*] Starting FlexSpace server...")
    seed()
    print("[*] Server running at http://localhost:5000")
    app.run(debug=True, host='0.0.0.0', port=5000, threaded=True)

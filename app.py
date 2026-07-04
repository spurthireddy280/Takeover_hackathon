"""
FlexSpace — Flask Backend Application
Handles API routing, authentication, and serves the frontend.
"""

import os
import functools
from datetime import date, timedelta

from flask import Flask, request, jsonify, session, send_from_directory, send_file
from flask_bcrypt import Bcrypt

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

    # Validation
    errors = []
    if not name or len(name) < 2:
        errors.append('Name must be at least 2 characters.')
    if not email or '@' not in email:
        errors.append('A valid email is required.')
    if len(password) < 6:
        errors.append('Password must be at least 6 characters.')

    if errors:
        return jsonify({'error': ' '.join(errors)}), 400

    # Check duplicate email
    if get_user_by_email(email):
        return jsonify({'error': 'An account with this email already exists.'}), 409

    # Create user
    pw_hash = bcrypt.generate_password_hash(password).decode('utf-8')
    user_id = create_user(name, email, pw_hash, role='resident')

    if not user_id:
        return jsonify({'error': 'Registration failed. Please try again.'}), 500

    # Auto-login after registration
    session['user_id'] = user_id
    session['user_role'] = 'resident'

    return jsonify({
        'message': 'Account created successfully!',
        'user': {'id': user_id, 'name': name, 'email': email, 'role': 'resident'}
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
            'role': user['role']
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
            'role': user['role']
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

    # Generate time slots (6 AM to 10 PM)
    slots = []
    for h in range(6, 22):
        booking = booked_hours.get(h)
        slot = {
            'start': h,
            'end': h + 1,
            'label': f"{format_hour(h)} — {format_hour(h + 1)}",
            'available': booking is None,
        }
        if booking:
            slot['booked_by'] = booking['user_name']
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
        return jsonify({'message': 'Booking cancelled successfully.'})
    else:
        return jsonify({'error': 'Booking not found or you do not have permission to cancel it.'}), 404


# ═══════════════════════════════════════════════════════════
#  ADMIN API
# ═══════════════════════════════════════════════════════════

@app.route('/api/admin/bookings')
@admin_required
def admin_all_bookings():
    """Admin: get all bookings for a given date."""
    date_str = request.args.get('date')
    if not date_str:
        date_str = date.today().isoformat()

    bookings = get_all_bookings_for_date(date_str)

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
#  STARTUP
# ═══════════════════════════════════════════════════════════

if __name__ == '__main__':
    # Initialize and seed database on first run
    print("[*] Starting FlexSpace server...")
    seed()
    print("[*] Server running at http://localhost:5000")
    app.run(debug=True, host='0.0.0.0', port=5000)

"""
FlexSpace — Database Models & Helpers
SQLite relational schema with Users, Facilities, and Bookings.
"""

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'flexspace.db')


def get_db():
    """Get a database connection with row_factory set to sqlite3.Row."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """Create all tables if they don't exist."""
    conn = get_db()
    cursor = conn.cursor()

    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            email       TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            flat_no     TEXT DEFAULT '',
            role        TEXT NOT NULL DEFAULT 'resident' CHECK(role IN ('resident', 'admin')),
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS facilities (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            category    TEXT NOT NULL,
            capacity    INTEGER DEFAULT 1,
            parent_id   INTEGER DEFAULT NULL,
            emoji       TEXT DEFAULT '🏟️',
            image       TEXT DEFAULT '',
            description TEXT DEFAULT '',
            FOREIGN KEY (parent_id) REFERENCES facilities(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS bookings (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            facility_id INTEGER NOT NULL,
            date        TEXT NOT NULL,
            start_time  INTEGER NOT NULL,
            end_time    INTEGER NOT NULL,
            status      TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed', 'cancelled')),
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE
        );

        -- Unique constraint to prevent double-booking of the same slot
        CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_booking
            ON bookings(facility_id, date, start_time)
            WHERE status = 'confirmed';
    """)

    # Migration: add flat_no column to existing databases
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN flat_no TEXT DEFAULT ''")
        conn.commit()
    except Exception:
        pass  # Column already exists

    conn.commit()
    conn.close()


# ─── Query Helpers ───────────────────────────────────────

def get_user_by_email(email):
    """Fetch a user by email. Returns dict or None."""
    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    conn.close()
    return dict(user) if user else None


def get_user_by_id(user_id):
    """Fetch a user by id. Returns dict or None."""
    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    return dict(user) if user else None


def create_user(name, email, password_hash, role='resident', flat_no=''):
    """Insert a new user. Returns the new user id."""
    conn = get_db()
    try:
        cursor = conn.execute(
            "INSERT INTO users (name, email, password_hash, role, flat_no) VALUES (?, ?, ?, ?, ?)",
            (name, email, password_hash, role, flat_no)
        )
        conn.commit()
        user_id = cursor.lastrowid
        return user_id
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()


def get_all_facility_groups():
    """
    Get all top-level facilities (parent_id IS NULL) along with their sub-units.
    Returns a list of dicts with a 'units' key containing child facilities.
    """
    conn = get_db()

    parents = conn.execute(
        "SELECT * FROM facilities WHERE parent_id IS NULL ORDER BY id"
    ).fetchall()

    result = []
    for p in parents:
        parent_dict = dict(p)
        children = conn.execute(
            "SELECT * FROM facilities WHERE parent_id = ? ORDER BY id",
            (p['id'],)
        ).fetchall()
        parent_dict['units'] = [dict(c) for c in children]
        result.append(parent_dict)

    conn.close()
    return result


def get_facility_by_id(facility_id):
    """Fetch a single facility by id."""
    conn = get_db()
    facility = conn.execute("SELECT * FROM facilities WHERE id = ?", (facility_id,)).fetchone()
    conn.close()
    return dict(facility) if facility else None


def get_bookings_for_facility(facility_id, date):
    """Get all confirmed bookings for a facility on a given date."""
    conn = get_db()
    rows = conn.execute(
        """SELECT b.*, u.name as user_name, u.email as user_email, u.flat_no as user_flat_no
           FROM bookings b
           JOIN users u ON b.user_id = u.id
           WHERE b.facility_id = ? AND b.date = ? AND b.status = 'confirmed'
           ORDER BY b.start_time""",
        (facility_id, date)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_booking(user_id, facility_id, date, start_time, end_time):
    """
    Create a new booking. Returns booking id on success, None if slot already taken.
    """
    conn = get_db()
    try:
        cursor = conn.execute(
            """INSERT INTO bookings (user_id, facility_id, date, start_time, end_time, status)
               VALUES (?, ?, ?, ?, ?, 'confirmed')""",
            (user_id, facility_id, date, start_time, end_time)
        )
        conn.commit()
        return cursor.lastrowid
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()


def get_user_bookings(user_id):
    """Get all confirmed bookings for a user, joined with facility info."""
    conn = get_db()
    rows = conn.execute(
        """SELECT b.*, f.name as facility_name, f.emoji as facility_emoji,
                  f.parent_id, pf.name as parent_name, pf.emoji as parent_emoji
           FROM bookings b
           JOIN facilities f ON b.facility_id = f.id
           LEFT JOIN facilities pf ON f.parent_id = pf.id
           WHERE b.user_id = ? AND b.status = 'confirmed'
           ORDER BY b.date, b.start_time""",
        (user_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def cancel_booking(booking_id, user_id=None, is_admin=False):
    """
    Cancel a booking. If is_admin is False, only the booking owner can cancel.
    Returns True on success, False otherwise.
    """
    conn = get_db()

    if is_admin:
        result = conn.execute(
            "UPDATE bookings SET status = 'cancelled' WHERE id = ? AND status = 'confirmed'",
            (booking_id,)
        )
    else:
        result = conn.execute(
            "UPDATE bookings SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'confirmed'",
            (booking_id, user_id)
        )

    conn.commit()
    success = result.rowcount > 0
    conn.close()
    return success


def get_all_bookings_for_date(date):
    """Admin: get all confirmed bookings for a given date, with user and facility info."""
    conn = get_db()
    rows = conn.execute(
        """SELECT b.*, u.name as user_name, u.email as user_email, u.flat_no as user_flat_no,
                  f.name as facility_name, f.emoji as facility_emoji,
                  f.parent_id, pf.name as parent_name, pf.emoji as parent_emoji
           FROM bookings b
           JOIN users u ON b.user_id = u.id
           JOIN facilities f ON b.facility_id = f.id
           LEFT JOIN facilities pf ON f.parent_id = pf.id
           WHERE b.date = ? AND b.status = 'confirmed'
           ORDER BY f.name, b.start_time""",
        (date,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_booking_by_id(booking_id):
    """Fetch a single booking by id."""
    conn = get_db()
    row = conn.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,)).fetchone()
    conn.close()
    return dict(row) if row else None

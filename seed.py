"""
FlexSpace — Database Seeder
Run this script to initialize the database and populate with facility data + default admin.
Usage: python seed.py
"""

from models import init_db, get_db, get_user_by_email

# We'll import bcrypt from flask_bcrypt only if available, else use a fallback
try:
    from flask_bcrypt import Bcrypt
    _bcrypt = Bcrypt()

    def hash_password(pw):
        return _bcrypt.generate_password_hash(pw).decode('utf-8')
except ImportError:
    import hashlib
    def hash_password(pw):
        return hashlib.sha256(pw.encode()).hexdigest()


FACILITY_DATA = [
    {
        'name': 'Badminton',
        'category': 'racquet',
        'capacity': 4,
        'emoji': '🏸',
        'image': 'assets/badminton.png',
        'description': 'Professional-grade indoor courts with premium flooring, LED scoreboards, and net equipment provided. Perfect for singles or doubles.',
        'units': ['Court 1', 'Court 2', 'Court 3']
    },
    {
        'name': 'Box Cricket',
        'category': 'team',
        'capacity': 12,
        'emoji': '🏏',
        'image': 'assets/box_cricket.png',
        'description': 'Enclosed turf pitch with protective netting and LED floodlights. Great for quick cricket matches with friends and family.',
        'units': []
    },
    {
        'name': 'Basketball Court',
        'category': 'team',
        'capacity': 10,
        'emoji': '🏀',
        'image': 'assets/basketball.png',
        'description': 'Full-size hardwood court with professional hoops, LED scoreboard, and floodlighting for evening games.',
        'units': []
    },
    {
        'name': 'Volleyball Court',
        'category': 'team',
        'capacity': 12,
        'emoji': '🏐',
        'image': 'assets/volleyball.png',
        'description': 'Outdoor sand court with regulation net, LED floodlights, and spectator seating. Ideal for casual and competitive play.',
        'units': []
    },
    {
        'name': 'Table Tennis',
        'category': 'racquet',
        'capacity': 4,
        'emoji': '🏓',
        'image': 'assets/table_tennis.png',
        'description': 'Climate-controlled indoor facility with competition-grade tables, paddles, and balls provided. Available for singles or doubles.',
        'units': ['Board 1', 'Board 2', 'Board 3', 'Board 4', 'Board 5']
    },
    {
        'name': 'Snooker',
        'category': 'indoor',
        'capacity': 4,
        'emoji': '🎱',
        'image': 'assets/snooker.png',
        'description': 'Elegant snooker lounge with full-size tables, premium cues, and ambient pendant lighting. A refined gaming experience.',
        'units': ['Board 1', 'Board 2', 'Board 3']
    },
    {
        'name': 'Pickleball Court',
        'category': 'racquet',
        'capacity': 4,
        'emoji': '🏓',
        'image': 'assets/pickleball.png',
        'description': 'Dedicated outdoor pickleball court with regulation markings, quality nets, and evening LED lighting.',
        'units': []
    },
]


def seed():
    """Initialize the database and populate with default data."""
    print("[*] Initializing database schema...")
    init_db()

    conn = get_db()
    cursor = conn.cursor()

    # ── Check if already seeded ──
    existing = cursor.execute("SELECT COUNT(*) as c FROM facilities").fetchone()
    if existing['c'] > 0:
        print("[!] Database already has facility data. Skipping facility seed.")
    else:
        print("[*] Seeding facilities...")
        for fac in FACILITY_DATA:
            # Insert parent facility
            cursor.execute(
                """INSERT INTO facilities (name, category, capacity, emoji, image, description, parent_id)
                   VALUES (?, ?, ?, ?, ?, ?, NULL)""",
                (fac['name'], fac['category'], fac['capacity'], fac['emoji'], fac['image'], fac['description'])
            )
            parent_id = cursor.lastrowid

            # Insert sub-units if any
            for unit_name in fac.get('units', []):
                full_name = f"{fac['name']} — {unit_name}"
                cursor.execute(
                    """INSERT INTO facilities (name, category, capacity, emoji, image, description, parent_id)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (full_name, fac['category'], fac['capacity'], fac['emoji'], fac['image'], fac['description'], parent_id)
                )
            print(f"   [+] {fac['name']} ({len(fac.get('units', []))} units)")

        conn.commit()

    # ── Seed default admin account ──
    admin_email = 'admin@flexspace.com'
    if get_user_by_email(admin_email):
        print("[!] Admin account already exists. Skipping admin seed.")
    else:
        print("[*] Creating default admin account...")
        pw_hash = hash_password('admin123')
        cursor.execute(
            "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
            ('Admin', admin_email, pw_hash, 'admin')
        )
        conn.commit()
        print(f"   [+] Admin: {admin_email} / admin123")

    conn.close()
    print("\n[*] Seeding complete!")


if __name__ == '__main__':
    seed()

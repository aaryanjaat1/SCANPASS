"""
ScanPass — Database Models (SQLite)
Stores user credentials and embedding vectors only. No raw images.
"""

import sqlite3
import json
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "scanpass.db")


def get_db():
    """Get a database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Initialize the database schema."""
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            embedding TEXT DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()


def create_user(username: str, password_hash: str) -> int:
    """Create a new user. Returns user ID."""
    conn = get_db()
    try:
        cursor = conn.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            (username, password_hash)
        )
        conn.commit()
        return cursor.lastrowid
    except sqlite3.IntegrityError:
        raise ValueError(f"Username '{username}' already exists")
    finally:
        conn.close()


def get_user(username: str) -> dict | None:
    """Get user by username."""
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM users WHERE username = ?", (username,)
    ).fetchone()
    conn.close()
    if row:
        return dict(row)
    return None


def store_embedding(username: str, embedding: list[float]):
    """Store the averaged embedding vector for a user."""
    conn = get_db()
    conn.execute(
        "UPDATE users SET embedding = ? WHERE username = ?",
        (json.dumps(embedding), username)
    )
    conn.commit()
    conn.close()


def revoke_embedding(username: str):
    """Revoke (delete) the stored embedding for a user."""
    conn = get_db()
    conn.execute(
        "UPDATE users SET embedding = NULL WHERE username = ?",
        (username,)
    )
    conn.commit()
    conn.close()


def get_embedding(username: str) -> list[float] | None:
    """Retrieve the stored embedding vector for a user."""
    conn = get_db()
    row = conn.execute(
        "SELECT embedding FROM users WHERE username = ?", (username,)
    ).fetchone()
    conn.close()
    if row and row["embedding"]:
        return json.loads(row["embedding"])
    return None


# Initialize database on import
init_db()

"""
ScanPass — Authentication Utilities
Password hashing (SHA-256 + salt) and JWT token management.
"""

import hashlib
import secrets
from jose import jwt, JWTError
from datetime import datetime, timedelta

# --- Config ---
SECRET_KEY = "scanpass-mvp-secret-key-change-in-production"
ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = 60


# --- Password Hashing (SHA-256 + salt, MVP-safe) ---
def hash_password(password: str) -> str:
    """Hash a password using SHA-256 with a random salt."""
    salt = secrets.token_hex(16)
    hashed = hashlib.sha256((salt + password).encode()).hexdigest()
    return f"{salt}${hashed}"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash."""
    try:
        salt, stored_hash = hashed_password.split("$", 1)
        computed = hashlib.sha256((salt + plain_password).encode()).hexdigest()
        return computed == stored_hash
    except (ValueError, AttributeError):
        return False


# --- JWT Tokens ---
def create_token(username: str) -> str:
    """Create a JWT token for authenticated sessions."""
    expire = datetime.utcnow() + timedelta(minutes=TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": username,
        "exp": expire
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> str | None:
    """Verify a JWT token. Returns username if valid, None otherwise."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None

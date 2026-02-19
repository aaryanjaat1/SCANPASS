"""
ScanPass — FastAPI Main Application
Dynamic visual-based secondary authentication system.
"""

import logging
from fastapi import FastAPI, HTTPException, UploadFile, File, Header, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from models import create_user, get_user, store_embedding, get_embedding
from auth import hash_password, verify_password, create_token, verify_token
from embedding_engine import extract_frames, get_average_embedding, get_frame_embeddings, compute_similarity
from liveness import check_liveness, check_challenge_direction
from challenges import get_random_challenge, get_challenge_by_id

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("scanpass")

# --- App Setup ---
app = FastAPI(
    title="ScanPass API",
    description="Dynamic visual-based secondary authentication",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# --- Thresholds ---
SIMILARITY_THRESHOLD = 0.60  # Cosine similarity threshold for object matching
LIVENESS_THRESHOLD = 1.5     # Minimum optical flow magnitude


# --- Helper: Extract username from token ---
def get_current_user(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization token")
    
    token = authorization.replace("Bearer ", "")
    username = verify_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return username


# --- Request Models ---
class RegisterRequest(BaseModel):
    username: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginChallengeRequest(BaseModel):
    username: str


# =====================
# AUTH ENDPOINTS
# =====================

@app.post("/api/register")
async def register(req: RegisterRequest):
    """Register a new user with username and password."""
    logger.info(f"📝 Registration attempt for '{req.username}'")
    
    if len(req.username) < 3 or len(req.password) < 4:
        raise HTTPException(status_code=400, detail="Username (3+ chars) and password (4+ chars) required")
    
    try:
        hashed = hash_password(req.password)
        user_id = create_user(req.username, hashed)
        token = create_token(req.username)
        
        logger.info(f"✅ User '{req.username}' registered successfully (ID: {user_id})")
        return {
            "success": True,
            "message": f"User '{req.username}' registered successfully",
            "token": token,
            "user_id": user_id
        }
    except ValueError as e:
        logger.warning(f"❌ Registration failed: {e}")
        raise HTTPException(status_code=409, detail=str(e))


@app.post("/api/register/visual")
async def register_visual(
    video: UploadFile = File(...),
    username: str = Form(...)
):
    """
    Register a new user with ONLY a visual key (no password).
    """
    logger.info(f"📝 Visual-only registration attempt for '{username}'")
    
    if len(username) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters")
        
    # Check if user exists
    if get_user(username):
        raise HTTPException(status_code=409, detail="Username already taken")

    try:
        # 1. Process Video
        video_bytes = await video.read()
        if len(video_bytes) < 1000:
            raise HTTPException(status_code=400, detail="Video too small")
            
        frames = extract_frames(video_bytes, n_frames=10)
        avg_embedding = get_average_embedding(frames)
        
        # 2. Create User (Sentinel password)
        # We use a specific sentinel that won't match any hash to prevent password login
        # but allows user creation.
        user_id = create_user(username, "VISUAL_ONLY_NO_PASSWORD")
        
        # 3. Store Embedding
        store_embedding(username, avg_embedding.tolist())
        
        # 4. Generate Token
        token = create_token(username)
        
        logger.info(f"✅ User '{username}' registered with Visual Key only!")
        
        return {
            "success": True,
            "message": "Visual account created successfully!",
            "token": token,
            "user_id": user_id,
            "details": {
                "frames": len(frames),
                "embedding_dim": len(avg_embedding)
            }
        }

    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"❌ Visual registration failed: {e}")
        raise HTTPException(status_code=500, detail=f"Registration failed: {str(e)}")


@app.post("/api/login")
async def login(req: LoginRequest):
    """Password login — Step 1 of authentication."""
    logger.info(f"🔐 Login attempt for '{req.username}'")
    
    user = get_user(req.username)
    if not user:
        logger.warning(f"❌ Login failed: user '{req.username}' not found")
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    if not verify_password(req.password, user["password_hash"]):
        logger.warning(f"❌ Login failed: wrong password for '{req.username}'")
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    token = create_token(req.username)
    has_object = user["embedding"] is not None
    
    logger.info(f"✅ Password verified for '{req.username}'. Object enrolled: {has_object}")
    return {
        "success": True,
        "message": "Password verified. Proceed to visual authentication.",
        "token": token,
        "has_object": has_object,
        "needs_visual_auth": has_object
    }


@app.post("/api/login/challenge")
async def login_challenge(req: LoginChallengeRequest):
    """
    Step 1 of Visual Login: Get a challenge for a user without password.
    Checks if user exists and has a visual key enrolled.
    """
    logger.info(f"👁️ Visual login initiated for '{req.username}'")
    
    user = get_user(req.username)
    if not user:
        # Security: Don't reveal user existence easily, but for MVP we need to tell them if they can proceed.
        # In prod, we might return a dummy challenge to prevent enumeration, or rate limit.
        logger.warning(f"❌ Visual login failed: user '{req.username}' not found")
        raise HTTPException(status_code=404, detail="User not found or visual key not enrolled")
    
    if not user["embedding"]:
        logger.warning(f"❌ Visual login failed: user '{req.username}' has no visual key")
        raise HTTPException(status_code=400, detail="No visual key enrolled. Please login with password first.")
    
    challenge = get_random_challenge()
    logger.info(f"🎯 Challenge for '{req.username}': {challenge['text']}")
    
    return {
        "success": True,
        "challenge": challenge
    }


@app.post("/api/login/visual")
async def login_visual(
    video: UploadFile = File(...),
    username: str = Form(...),
    challenge_id: str = Form(...)
):
    """
    Step 2 of Visual Login: Verify visual key and issue JWT.
    """
    logger.info(f"🔐 Visual login verification for '{username}'")
    
    # 1. Get user & embedding
    user = get_user(username)
    if not user or not user["embedding"]:
        raise HTTPException(status_code=401, detail="Invalid user or no visual key")
    
    stored_emb = get_embedding(username)
    
    # 2. Get challenge
    challenge = get_challenge_by_id(challenge_id)
    if not challenge:
        raise HTTPException(status_code=400, detail="Invalid challenge ID")
    
    # 3. Process Video
    video_bytes = await video.read()
    
    try:
        # --- Run Checks (Same as /api/authenticate but returns a token on success) ---
        
        # A. Frames
        frames = extract_frames(video_bytes, n_frames=10)
        
        # B. Liveness
        liveness_result = check_liveness(frames, min_motion=LIVENESS_THRESHOLD)
        if not liveness_result["is_live"]:
            logger.warning(f"❌ Visual login failed: Liveness ({liveness_result['reason']})")
            raise HTTPException(status_code=401, detail=f"Liveness failed: {liveness_result['reason']}")
            
        # C. Direction
        direction_result = check_challenge_direction(frames, challenge["expected_direction"])
        if not direction_result["direction_match"]:
            logger.warning(f"❌ Visual login failed: Direction mismatch")
            raise HTTPException(status_code=401, detail="Challenge failed: Movement direction did not match")
            
        # D. Similarity
        live_embedding = get_average_embedding(frames)
        similarity = compute_similarity(stored_emb, live_embedding.tolist())
        
        if similarity < SIMILARITY_THRESHOLD:
            logger.warning(f"❌ Visual login failed: Low similarity ({similarity:.4f})")
            raise HTTPException(status_code=401, detail="Visual authentication failed: Object mismatch")
            
        # --- Success! Issue Token ---
        token = create_token(username)
        logger.info(f"✅ User '{username}' logged in via Visual Key!")
        
        return {
            "success": True,
            "message": "Visual login successful",
            "token": token,
            "user_id": user["id"]
        }

    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"❌ Visual login error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error during visual login")


# =====================
# CHALLENGE ENDPOINT
# =====================

@app.get("/api/challenge")
async def get_challenge(authorization: str | None = Header(default=None)):
    """Get a random movement challenge for visual authentication."""
    username = get_current_user(authorization)
    challenge = get_random_challenge()
    
    logger.info(f"🎯 Challenge for '{username}': {challenge['text']}")
    return {
        "success": True,
        "challenge": challenge
    }


# =====================
# OBJECT ENROLLMENT
# =====================

@app.post("/api/enroll-object")
async def enroll_object(
    video: UploadFile = File(...),
    authorization: str | None = Header(default=None)
):
    """
    Enroll a personal object by recording a short video.
    Extracts frames → generates CNN embeddings → stores average embedding.
    """
    username = get_current_user(authorization)
    logger.info(f"📦 Object enrollment started for '{username}'")
    
    # Read video bytes
    video_bytes = await video.read()
    if len(video_bytes) < 1000:
        raise HTTPException(status_code=400, detail="Video file too small. Record at least 2 seconds.")
    
    logger.info(f"   Video size: {len(video_bytes)} bytes")
    
    try:
        # Extract frames from video
        frames = extract_frames(video_bytes, n_frames=10)
        logger.info(f"   Extracted {len(frames)} frames from video")
        
        # Generate average embedding
        avg_embedding = get_average_embedding(frames)
        logger.info(f"   Generated embedding vector (dim={len(avg_embedding)})")
        
        # Store embedding (no raw images saved!)
        store_embedding(username, avg_embedding.tolist())
        logger.info(f"✅ Object enrolled for '{username}'. Embedding stored. No raw images saved.")
        
        return {
            "success": True,
            "message": "Object enrolled successfully! Your visual key is ready.",
            "details": {
                "frames_extracted": len(frames),
                "embedding_dim": len(avg_embedding),
                "storage": "embedding_only"
            }
        }
    
    except Exception as e:
        logger.error(f"❌ Enrollment failed for '{username}': {e}")
        raise HTTPException(status_code=500, detail=f"Enrollment failed: {str(e)}")


# =====================
# VISUAL AUTHENTICATION
# =====================

@app.post("/api/authenticate")
async def authenticate(
    video: UploadFile = File(...),
    challenge_id: str = Form(...),
    authorization: str | None = Header(default=None)
):
    """
    Visual authentication — Step 2 of authentication.
    1. Extract frames from live video
    2. Check liveness (optical flow)
    3. Check challenge direction
    4. Compare embedding with stored object
    5. Return detailed pass/fail result
    """
    username = get_current_user(authorization)
    logger.info(f"🔍 Visual authentication started for '{username}'")
    logger.info(f"   Challenge: {challenge_id}")
    
    # Get stored embedding
    stored_emb = get_embedding(username)
    if stored_emb is None:
        raise HTTPException(
            status_code=400,
            detail="No object enrolled. Please enroll an object first."
        )
    
    # Get challenge details
    challenge = get_challenge_by_id(challenge_id)
    if not challenge:
        raise HTTPException(status_code=400, detail="Invalid challenge ID")
    
    # Read video
    video_bytes = await video.read()
    logger.info(f"   Video size: {len(video_bytes)} bytes")
    
    auth_log = []
    
    try:
        # Step 1: Extract frames
        frames = extract_frames(video_bytes, n_frames=10)
        auth_log.append(f"✓ Extracted {len(frames)} frames from video")
        logger.info(f"   Extracted {len(frames)} frames")
        
        # Step 2: Liveness check
        liveness_result = check_liveness(frames, min_motion=LIVENESS_THRESHOLD)
        auth_log.append(
            f"{'✓' if liveness_result['is_live'] else '✗'} Liveness: "
            f"{liveness_result['reason']}"
        )
        logger.info(f"   Liveness: {liveness_result}")
        
        # Step 3: Challenge direction check
        direction_result = check_challenge_direction(
            frames, challenge["expected_direction"]
        )
        auth_log.append(
            f"{'✓' if direction_result['direction_match'] else '✗'} Direction: "
            f"{direction_result['reason']}"
        )
        logger.info(f"   Direction: {direction_result}")
        
        # Step 4: Compute embedding similarity
        live_embedding = get_average_embedding(frames)
        similarity = compute_similarity(stored_emb, live_embedding.tolist())
        similarity_pass = similarity >= SIMILARITY_THRESHOLD
        auth_log.append(
            f"{'✓' if similarity_pass else '✗'} Similarity: {similarity:.4f} "
            f"(threshold: {SIMILARITY_THRESHOLD})"
        )
        logger.info(f"   Similarity: {similarity:.4f} (threshold: {SIMILARITY_THRESHOLD})")
        
        # Step 5: Final decision
        authenticated = (
            liveness_result["is_live"] and
            direction_result["direction_match"] and
            similarity_pass
        )
        
        if authenticated:
            import uuid
            session_id = f"SP-{str(uuid.uuid4())[:8].upper()}"
            auth_log.append("🟢 RESULT: AUTHENTICATED — All checks passed!")
            logger.info(f"✅ '{username}' AUTHENTICATED successfully")
        else:
            session_id = None
            reasons = []
            if not liveness_result["is_live"]:
                reasons.append("failed liveness (static/replay)")
            if not direction_result["direction_match"]:
                reasons.append("failed challenge direction")
            if not similarity_pass:
                reasons.append("object mismatch")
            
            auth_log.append(f"🔴 RESULT: REJECTED — {', '.join(reasons)}")
            logger.warning(f"❌ '{username}' REJECTED: {', '.join(reasons)}")
        
        return {
            "success": True,
            "authenticated": authenticated,
            "session_id": session_id,
            "message": "AUTHENTICATED" if authenticated else "REJECTED",
            "details": {
                "liveness": {
                    "passed": liveness_result["is_live"],
                    "motion_score": liveness_result["motion_score"],
                    "reason": liveness_result["reason"]
                },
                "direction": {
                    "passed": direction_result["direction_match"],
                    "detected": direction_result["detected_direction"],
                    "expected": challenge["expected_direction"],
                    "confidence": direction_result["confidence"],
                    "reason": direction_result["reason"]
                },
                "similarity": {
                    "passed": similarity_pass,
                    "score": round(similarity, 4),
                    "threshold": SIMILARITY_THRESHOLD
                },
                "auth_log": auth_log
            }
        }
    
    except Exception as e:
        logger.error(f"❌ Authentication error for '{username}': {e}")
        raise HTTPException(status_code=500, detail=f"Authentication failed: {str(e)}")


# =====================
# PRODUCT ENHANCEMENTS
# =====================

@app.post("/api/revoke")
async def revoke_key(authorization: str | None = Header(default=None)):
    """Revoke (delete) the user's visual key."""
    username = get_current_user(authorization)
    from models import revoke_embedding
    revoke_embedding(username)
    logger.info(f"🗑️ Visual key revoked for '{username}'")
    return {
        "success": True, 
        "message": "Visual key revoked successfully. You must re-enroll to authenticate."
    }


@app.get("/api/secure-data")
async def get_secure_data(authorization: str | None = Header(default=None)):
    """Protected endpoint — only accessible after visual auth (simulated)."""
    # In a real app, we'd check if the session has a 'visual_auth_passed' flag.
    # For MVP, valid JWT is enough to prove they logged in, but we'll simulate
    # the check on frontend by only calling this if visual auth passed.
    username = get_current_user(authorization)
    logger.info(f"🔓 Secure data accessed by '{username}'")
    return {
        "success": True,
        "data": "SECRET_PAYLOAD_8823: ScanPass has verified your physical presence.",
        "user": username,
        "timestamp": "2026-02-12T23:00:00Z"
    }


# =====================
# HEALTH CHECK
# =====================

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "ScanPass API"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

# ScanPass 🔐

**Dynamic Visual-Based Secondary Authentication System**

ScanPass replaces OTP-based 2FA with a live visual scan using your camera. It uses AI embeddings (MobileNetV2), optical flow liveness detection, and challenge-response to prove you hold the real object — not a photo.

---

## Quick Start

### 1. Install Dependencies
```bash
cd backend
pip install -r requirements.txt
```

### 2. Start Backend
```bash
cd backend
python -m uvicorn main:app --reload --port 8000
```

### 3. Start Frontend
```bash
cd frontend
python -m http.server 5500
```
Open **http://localhost:5500** in your browser.

---

## Architecture

```
┌──────────────────────────────────┐
│     Web Frontend (HTML/JS)       │
│  Camera Capture → MediaRecorder  │
│  View Router → API Integration   │
└────────────┬─────────────────────┘
             │ REST API
┌────────────▼─────────────────────┐
│      FastAPI Backend             │
│  ┌──────────┐  ┌──────────────┐  │
│  │   Auth   │  │  Challenge   │  │
│  │  (JWT)   │  │  Generator   │  │
│  └──────────┘  └──────────────┘  │
│  ┌──────────────────────────────┐│
│  │   CNN Embedding Engine       ││
│  │   (MobileNetV2 → 1280-dim)  ││
│  └──────────────────────────────┘│
│  ┌──────────────────────────────┐│
│  │   Liveness Detector          ││
│  │   (Farneback Optical Flow)   ││
│  └──────────────────────────────┘│
└────────────┬─────────────────────┘
             │
┌────────────▼─────────────────────┐
│   SQLite Database                │
│   user_id + password_hash        │
│   + embedding_vector (1280-dim)  │
│   NO raw images stored           │
└──────────────────────────────────┘
```

---

## How It Works

### Registration
1. Create username + password
2. Record ~3 sec video of your personal object
3. AI extracts 10 frames → MobileNetV2 embeddings → averaged into one 1280-dim vector
4. Only the embedding vector is stored (no images)

### Authentication
1. Login with password (Step 1)
2. Receive a random challenge: "Rotate clockwise", "Move closer", etc.
3. Record video while following the challenge (Step 2)
4. System checks:
   - **Liveness** — Optical flow detects real motion (rejects photos/screenshots)
   - **Direction** — Motion matches challenge direction
   - **Similarity** — CNN embedding matches stored object (cosine similarity > 0.60)
5. All three must pass → ✅ AUTHENTICATED

### Anti-Spoofing
- Photos/screenshots → **REJECTED** (no optical flow = no motion)
- Wrong object → **REJECTED** (low cosine similarity)
- Static video → **REJECTED** (insufficient motion magnitude)

---

## ScanPass vs PIXIE

| Aspect        | PIXIE                      | ScanPass                         |
|---------------|----------------------------|----------------------------------|
| **Input**     | Single static image        | Live 2-3s video                  |
| **Matching**  | ORB/BRISK keypoints        | CNN embeddings (MobileNetV2)     |
| **Anti-spoof**| None                       | Optical flow + challenge-response|
| **Challenge** | None                       | Random movement instructions     |
| **Storage**   | Keypoint descriptors       | 1280-dim embedding vector        |
| **Security**  | Vulnerable to photo replay | Rejects static/replay attacks    |

---

## Demo Flow (Cohort 15 Presentation)

1. **Register** → Create account "demo" / "pass1234"
2. **Enroll** → Hold a coffee mug to camera → Record 3 sec → See "Visual key enrolled"
3. **Login** → Enter credentials → Get challenge: "Rotate your object clockwise"
4. **Auth (PASS)** → Hold same mug → Rotate it → See ✅ AUTHENTICATED with green badges
5. **Auth (FAIL — photo)** → Show a photo of the mug on phone → See 🚫 REJECTED + "Static/replay detected"
6. **Auth (FAIL — wrong object)** → Use a different object → See 🚫 REJECTED + "Object mismatch"

---

## Tech Stack

- **Frontend**: HTML5, CSS3 (glassmorphism), Vanilla JS, MediaRecorder API
- **Backend**: Python 3.10+, FastAPI, PyTorch, OpenCV
- **AI Model**: MobileNetV2 (pretrained on ImageNet, classifier head removed)
- **Storage**: SQLite (embedding vectors only, no raw images)
- **Auth**: bcrypt password hashing, JWT session tokens

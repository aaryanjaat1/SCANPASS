/**
 * ScanPass — Frontend Application
 * Camera capture, API integration, view routing
 */

const API_BASE = "http://localhost:8000";

// --- State ---
let authToken = null;
let currentChallenge = null;
let currentUser = null;
let mediaStream = null;
let sessionTimerInterval;
let isVisualLogin = false;
let isVisualRegistration = false;

// =====================
// VIEW ROUTING
// =====================
function showView(viewId) {
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    const view = document.getElementById(viewId);
    if (view) view.classList.add("active");

    // Stop camera when leaving camera views
    if (viewId !== "view-enroll" && viewId !== "view-auth") {
        stopCamera();
    }

    // Start camera for enrollment/auth views
    if (viewId === "view-enroll") {
        startCamera("enrollVideo");
    } else if (viewId === "view-auth") {
        startCamera("authVideo");
        fetchChallenge();
    }

    // Show/hide logout
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.style.display = authToken ? "block" : "none";
    }
}

// =====================
// CAMERA
// =====================
async function startCamera(videoElementId) {
    stopCamera();
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false
        });
        const videoEl = document.getElementById(videoElementId);
        if (videoEl) {
            videoEl.srcObject = mediaStream;
        }
    } catch (err) {
        console.error("Camera access failed:", err);
        showToast("Camera access denied. Please allow camera access.", "error");
    }
}

function stopCamera() {
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
}

/**
 * Record video from the active camera stream.
 * Returns a Promise that resolves to a Blob (webm video).
 */
function recordVideo(durationMs = 3000, progressBarId = null, progressFillId = null) {
    return new Promise((resolve, reject) => {
        if (!mediaStream) {
            reject(new Error("No active camera stream"));
            return;
        }

        // Check supported MIME types
        let mimeType = "video/webm";
        if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) {
            mimeType = "video/webm;codecs=vp9";
        } else if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8")) {
            mimeType = "video/webm;codecs=vp8";
        } else if (MediaRecorder.isTypeSupported("video/webm")) {
            mimeType = "video/webm";
        } else if (MediaRecorder.isTypeSupported("video/mp4")) {
            mimeType = "video/mp4";
        }

        const recorder = new MediaRecorder(mediaStream, { mimeType });
        const chunks = [];

        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: mimeType });
            resolve(blob);
        };

        recorder.onerror = (e) => reject(e.error);

        // Show progress
        if (progressBarId && progressFillId) {
            const bar = document.getElementById(progressBarId);
            const fill = document.getElementById(progressFillId);
            if (bar) bar.style.display = "block";
            const startTime = Date.now();
            const progressInterval = setInterval(() => {
                const elapsed = Date.now() - startTime;
                const pct = Math.min((elapsed / durationMs) * 100, 100);
                if (fill) fill.style.width = pct + "%";
                if (elapsed >= durationMs) clearInterval(progressInterval);
            }, 50);
        }

        recorder.start(100); // Collect data every 100ms

        setTimeout(() => {
            if (recorder.state === "recording") {
                recorder.stop();
            }
        }, durationMs);
    });
}

// =====================
// AUTH API CALLS
// =====================
async function handleRegister(event) {
    event.preventDefault();
    const username = document.getElementById("regUsername").value.trim();
    const password = document.getElementById("regPassword").value;
    const btn = document.getElementById("registerBtn");

    btn.disabled = true;
    btn.innerHTML = "<span>Creating account...</span>";

    try {
        const res = await fetch(`${API_BASE}/api/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.detail || "Registration failed");

        authToken = data.token;
        currentUser = username;
        showToast("Account created! Now enroll your visual key.", "success");
        showView("view-enroll");
    } catch (err) {
        showToast(err.message, "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = "<span>Create Account</span>";
    }
}

async function handleVisualRegisterClick() {
    const username = document.getElementById("regUsername").value.trim();
    if (!username || username.length < 3) {
        showToast("Please enter a username (3+ chars)", "error");
        return;
    }

    if (!confirm(`Register '${username}' with Visual Key only? (No password will be set)`)) {
        return;
    }

    isVisualRegistration = true;
    currentUser = username; // Temporarily set for enrollment

    // Customize enroll view for registration
    const header = document.querySelector("#view-enroll .card-header h2");
    if (header) header.textContent = "🔑 Create Visual Key";

    showView("view-enroll");
    showToast("Record your object to create your account.", "info");
}


async function handleVisualLoginClick() {
    const username = document.getElementById("loginUsername").value.trim();
    if (!username) {
        showToast("Please enter your username first", "error");
        return;
    }

    const btn = document.querySelector(".visual-login-btn");
    btn.disabled = true;
    btn.innerHTML = `<span class="icon">⏳</span><span>Checking...</span>`;

    try {
        const res = await fetch(`${API_BASE}/api/login/challenge`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.detail || "Visual login not available");

        // Setup for visual login
        currentUser = username;
        isVisualLogin = true;
        currentChallenge = data.challenge;

        // Setup auth view
        document.getElementById("challengeText").textContent = currentChallenge.text;
        document.getElementById("challengeHint").textContent = currentChallenge.description;

        showView("view-auth");
        showToast("Visual key found! Please authenticate.", "success");

    } catch (err) {
        showToast(err.message, "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<span class="icon">👁️</span><span>Login with Visual Key</span>`;
    }
}


async function handleLogin(event) {
    event.preventDefault();
    isVisualLogin = false; // Reset visual login flag
    isVisualRegistration = false; // Reset visual reg flag
    const username = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value;
    const btn = document.getElementById("loginBtn");

    btn.disabled = true;
    btn.innerHTML = "<span>Signing in...</span>";

    try {
        const res = await fetch(`${API_BASE}/api/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.detail || "Login failed");

        authToken = data.token;
        currentUser = username;

        if (data.has_object) {
            showToast("Password verified! Complete visual authentication.", "success");
            showView("view-auth");
        } else {
            showToast("Password verified! Enroll your visual key first.", "success");
            showView("view-enroll");
        }
    } catch (err) {
        showToast(err.message, "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = "<span>Sign In</span>";
    }
}

function logout() {
    authToken = null;
    currentUser = null;
    currentChallenge = null;
    stopCamera();
    showView("view-login");
    showToast("Signed out", "success");
}

// =====================
// CHALLENGE
// =====================
async function fetchChallenge() {
    try {
        const res = await fetch(`${API_BASE}/api/challenge`, {
            headers: { "Authorization": `Bearer ${authToken}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Failed to get challenge");

        currentChallenge = data.challenge;
        document.getElementById("challengeText").textContent = currentChallenge.text;
        document.getElementById("challengeHint").textContent = currentChallenge.description;
    } catch (err) {
        console.error("Challenge fetch failed:", err);
        document.getElementById("challengeText").textContent = "⚠️ Failed to load challenge";
    }
}

// =====================
// OBJECT ENROLLMENT
// =====================
async function startEnrollment() {
    const btn = document.getElementById("enrollRecordBtn");
    const indicator = document.getElementById("enrollRecordingIndicator");
    const status = document.getElementById("enrollStatus");

    btn.disabled = true;
    indicator.style.display = "flex";
    status.textContent = "🎥 Recording... hold your object steady";
    status.className = "status-message info";

    try {
        // Record 3 seconds of video
        const videoBlob = await recordVideo(3000, "enrollProgress", "enrollProgressFill");

        indicator.style.display = "none";
        status.textContent = "🧠 Processing with AI... extracting embeddings";
        status.className = "status-message info";

        // Upload to API
        const formData = new FormData();
        formData.append("video", videoBlob, "enrollment.webm");

        const res = await (async () => {
            if (isVisualRegistration) {
                // VISUAL REGISTRATION
                formData.append("username", currentUser);
                return fetch(`${API_BASE}/api/register/visual`, {
                    method: "POST",
                    body: formData
                });
            } else {
                // NORMAL ENROLLMENT (authenticated)
                return fetch(`${API_BASE}/api/enroll-object`, {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${authToken}` },
                    body: formData
                });
            }
        })();
        const data = await res.json();

        if (!res.ok) throw new Error(data.detail || "Enrollment failed");

        status.textContent = `✅ ${data.message} (${data.details.frames_extracted} frames → ${data.details.embedding_dim}-dim vector)`;
        status.className = "status-message success";

        if (isVisualRegistration) {
            showToast("Account created successfully!", "success");
            authToken = data.token; // Token is returned in registration response
            updateDashboard("SP-VISUAL-NEW");
            setTimeout(() => showView("view-dashboard"), 2000);
        } else {
            showToast("Visual key enrolled! You can now authenticate.", "success");
            setTimeout(() => showView("view-auth"), 2500);
        }

    } catch (err) {
        status.textContent = `❌ ${err.message}`;
        status.className = "status-message error";
        showToast("Enrollment failed: " + err.message, "error");
    } finally {
        btn.disabled = false;
        indicator.style.display = "none";
        const bar = document.getElementById("enrollProgress");
        if (bar) bar.style.display = "none";
    }
}

// =====================
// VISUAL AUTHENTICATION
// =====================
async function startAuthentication() {
    if (!currentChallenge) {
        showToast("No challenge loaded. Please wait...", "error");
        await fetchChallenge();
        return;
    }

    const btn = document.getElementById("authRecordBtn");
    const indicator = document.getElementById("authRecordingIndicator");
    const status = document.getElementById("authStatus");

    btn.disabled = true;
    indicator.style.display = "flex";
    status.textContent = "🎥 Recording... follow the challenge!";
    status.className = "status-message info";

    try {
        // Record 3 seconds
        const videoBlob = await recordVideo(3000, "authProgress", "authProgressFill");

        indicator.style.display = "none";
        status.textContent = "🧠 Analyzing with AI... checking liveness, direction & similarity";
        status.className = "status-message info";

        // Upload to API
        const formData = new FormData();
        formData.append("video", videoBlob, "auth.webm");
        formData.append("challenge_id", currentChallenge.id);

        if (isVisualLogin) {
            // --- VISUAL LOGIN FLOW ---
            formData.append("username", currentUser);

            const res = await fetch(`${API_BASE}/api/login/visual`, {
                method: "POST",
                body: formData
            });
            const data = await res.json();

            if (!res.ok) throw new Error(data.detail || "Visual login failed");

            if (data.success && data.token) {
                authToken = data.token;
                updateDashboard("SP-VISUAL-" + data.user_id);
                showView("view-dashboard");
                showToast("Visual login successful!", "success");
            } else {
                showToast("Visual login failed", "error");
            }

        } else {
            // --- NORMAL SECONDARY AUTH FLOW ---
            const res = await fetch(`${API_BASE}/api/authenticate`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${authToken}` },
                body: formData
            });
            const data = await res.json();

            if (!res.ok) throw new Error(data.detail || "Authentication request failed");

            // Display result
            showResult(data);
        }

    } catch (err) {
        status.textContent = `❌ ${err.message}`;
        status.className = "status-message error";
        showToast("Authentication error: " + err.message, "error");
    } finally {
        btn.disabled = false;
        indicator.style.display = "none";
        const bar = document.getElementById("authProgress");
        if (bar) bar.style.display = "none";
    }
}

// =====================
// RESULT DISPLAY
// =====================
function showResult(data) {
    const authenticated = data.authenticated;
    const details = data.details;

    // Save session ID if authenticated
    if (authenticated && data.session_id) {
        // Update dashboard
        updateDashboard(data.session_id);
        // Show continue button
        const btnContinue = document.getElementById("btnContinue");
        if (btnContinue) btnContinue.style.display = "inline-block";
    }

    // Result icon
    document.getElementById("resultIcon").textContent = authenticated ? "✅" : "🚫";

    // Title
    const title = document.getElementById("resultTitle");
    title.textContent = authenticated ? "AUTHENTICATED" : "REJECTED";
    title.className = `result-title ${authenticated ? "pass" : "fail"}`;

    // Message
    const msg = document.getElementById("resultMessage");
    if (authenticated) {
        msg.textContent = "All security checks passed. Identity verified via visual key.";
    } else {
        const failures = [];
        if (!details.liveness.passed) failures.push("liveness failed (static/replay)");
        if (!details.direction.passed) failures.push("challenge direction mismatch");
        if (!details.similarity.passed) failures.push("object mismatch");
        msg.textContent = "Authentication failed: " + failures.join(", ");
    }

    // Log panel
    const logEntries = document.getElementById("logEntries");
    logEntries.innerHTML = details.auth_log.map(entry => {
        let cls = "log-info";
        if (entry.startsWith("✓")) cls = "log-pass";
        else if (entry.startsWith("✗")) cls = "log-fail";
        else if (entry.includes("AUTHENTICATED")) cls = "log-pass";
        else if (entry.includes("REJECTED")) cls = "log-fail";
        return `<div class="${cls}">${entry}</div>`;
    }).join("");

    // Detail cards
    const grid = document.getElementById("detailGrid");
    grid.innerHTML = `
        <div class="detail-card ${details.liveness.passed ? 'pass' : 'fail'}">
            <div class="detail-label">Liveness</div>
            <div class="detail-value ${details.liveness.passed ? 'pass' : 'fail'}">
                ${details.liveness.passed ? "LIVE" : "STATIC"}
            </div>
            <div class="detail-sublabel">Score: ${details.liveness.motion_score}</div>
        </div>
        <div class="detail-card ${details.direction.passed ? 'pass' : 'fail'}">
            <div class="detail-label">Direction</div>
            <div class="detail-value ${details.direction.passed ? 'pass' : 'fail'}">
                ${details.direction.passed ? "MATCH" : "MISS"}
            </div>
            <div class="detail-sublabel">${details.direction.detected}</div>
        </div>
        <div class="detail-card ${details.similarity.passed ? 'pass' : 'fail'}">
            <div class="detail-label">Similarity</div>
            <div class="detail-value ${details.similarity.passed ? 'pass' : 'fail'}">
                ${(details.similarity.score * 100).toFixed(1)}%
            </div>
            <div class="detail-sublabel">Threshold: ${(details.similarity.threshold * 100)}%</div>
        </div>
    `;

    showView("view-result");
}

function tryAgain() {
    showView("view-auth");
}

// =====================
// DASHBOARD & SESSION
// =====================
function updateDashboard(sessionId) {
    const sessionEl = document.getElementById("dashboardSessionId");
    if (sessionEl) sessionEl.textContent = sessionId;

    // Reset secure data
    const dataDisplay = document.getElementById("secureDataDisplay");
    if (dataDisplay) {
        dataDisplay.style.display = "none";
        dataDisplay.innerHTML = "";
    }

    startSessionTimer();
}

function startSessionTimer() {
    clearInterval(sessionTimerInterval);
    const timerEl = document.getElementById("sessionTimer");
    if (!timerEl) return;

    let timeLeft = 120; // 2 minutes
    timerEl.textContent = `Session expires in ${timeLeft}s`;

    sessionTimerInterval = setInterval(() => {
        timeLeft--;
        timerEl.textContent = `Session expires in ${timeLeft}s`;

        if (timeLeft <= 0) {
            clearInterval(sessionTimerInterval);
            logout();
            showToast("Session expired", "error");
        }
    }, 1000);
}

async function fetchSecureData() {
    const display = document.getElementById("secureDataDisplay");
    display.style.display = "block";
    display.textContent = "Loading secure data...";

    try {
        const res = await fetch(`${API_BASE}/api/secure-data`, {
            headers: { "Authorization": `Bearer ${authToken}` }
        });
        const data = await res.json();

        if (!res.ok) throw new Error("Access denied");

        display.innerHTML = `
            <strong>ACCESS GRANTED</strong><br>
            Payload: ${data.data}<br>
            User: ${data.user}<br>
            Timestamp: ${data.timestamp}
        `;
    } catch (err) {
        display.innerHTML = `<span style="color:var(--accent-red)">ACCESS DENIED: ${err.message}</span>`;
    }
}

async function revokeKey() {
    if (!confirm("Are you sure? This will delete your visual key and you will need to re-enroll.")) {
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/revoke`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${authToken}` }
        });

        if (res.ok) {
            alert("Visual key revoked. You have been signed out.");
            logout();
        } else {
            showToast("Failed to revoke key", "error");
        }
    } catch (err) {
        showToast(err.message, "error");
    }
}

// =====================
// TOAST NOTIFICATIONS
// =====================
function showToast(message, type = "info") {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = `toast show ${type}`;

    setTimeout(() => {
        toast.classList.remove("show");
    }, 3500);
}

/**
 * ScanPass — Frontend Application
 * Camera capture, API integration, view routing
 */

// --- Configuration ---
// ⚠️ ACTION REQUIRED: Replace the URL below with your ACTUAL Render Backend URL
// You can find this on your Render Dashboard (e.g., https://your-app-name.onrender.com)
const RENDER_URL = "https://scanpass.onrender.com/";

const API_BASE = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname === "[::1]")
    ? "http://127.0.0.1:8000" // Use local backend during local development
    : RENDER_URL;             // Use production backend when deployed (e.g., Netlify)

console.log("🚀 ScanPass connecting to backend at:", API_BASE);

// --- DOM Sanity Check ---
function checkDOM() {
    const required = [
        "regUsername", "loginUsername", "loginBtn", "registerBtn",
        "view-login", "view-register", "view-enroll", "view-auth",
        "challengeText", "challengeHint", "toast"
    ];
    const missing = required.filter(id => !document.getElementById(id));
    if (missing.length > 0) {
        console.error("❌ CRITICAL: Missing DOM elements:", missing);
    } else {
        console.log("✅ DOM elements verified.");
    }
}
window.addEventListener("DOMContentLoaded", checkDOM);


// --- State ---
let authToken = null;
let currentChallenge = null;
let currentUser = null;
let mediaStream = null;
let sessionTimerInterval;
let isVisualLogin = false;
let isVisualRegistration = false;
let currentFacingMode = "user"; // "user" or "environment"

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
            video: { facingMode: currentFacingMode, width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false
        });
        const videoEl = document.getElementById(videoElementId);
        if (videoEl) {
            videoEl.srcObject = mediaStream;
            // Mirror only for front camera
            videoEl.style.transform = currentFacingMode === "user" ? "scaleX(-1)" : "scaleX(1)";
        }
    } catch (err) {
        console.error("Camera access failed:", err);
        showToast("Camera access denied. Please allow camera access.", "error");
    }
}

async function switchCamera(videoElementId) {
    currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
    showToast(`Switching to ${currentFacingMode === "user" ? "front" : "back"} camera...`, "info");
    await startCamera(videoElementId);
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
    console.log("📝 handleRegister triggered");

    try {
        const usernameInput = document.getElementById("regUsername");
        if (!usernameInput) {
            throw new Error("Critical Error: 'regUsername' element not found in DOM.");
        }

        const username = usernameInput.value.trim();
        if (!username || username.length < 3) {
            showToast("Please enter a username (3+ chars)", "error");
            return;
        }

        isVisualRegistration = true;
        currentUser = username;

        // Customize enroll view for registration
        const header = document.querySelector("#view-enroll .card-header h2");
        if (header) header.textContent = "🔑 Create Visual Key";

        showView("view-enroll");
        showToast("Record your object to create your account.", "info");
    } catch (err) {
        console.error("Registration UI Error:", err);
        showToast(err.message, "error");
    }
}


async function handleLogin(event) {
    event.preventDefault();
    console.log("🔑 handleLogin triggered");

    try {
        const usernameInput = document.getElementById("loginUsername");
        if (!usernameInput) {
            throw new Error("Critical Error: 'loginUsername' element not found in DOM.");
        }

        const username = usernameInput.value.trim();
        if (!username) {
            showToast("Please enter your username first", "error");
            return;
        }

        const btn = document.getElementById("loginBtn");
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = "<span>Checking visual key...</span>";
        }

        const url = `${API_BASE}/api/login/challenge`;
        console.log(`🌐 Fetching login challenge from: ${url}`);

        const res = await fetch(url, {
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
        const ct = document.getElementById("challengeText");
        const ch = document.getElementById("challengeHint");
        if (ct) ct.textContent = currentChallenge.text;
        if (ch) ch.textContent = currentChallenge.description;

        showView("view-auth");
        showToast("Visual key found! Please authenticate.", "success");

    } catch (err) {
        console.error("Login UI Error:", err);
        showToast(err.message, "error");
    } finally {
        const btn = document.getElementById("loginBtn");
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = "<span>Sign In with Visual Key</span>";
        }
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
        const url = `${API_BASE}/api/challenge`;
        console.log(`🌐 Fetching random challenge from: ${url}`);
        const res = await fetch(url, {
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
                const url = `${API_BASE}/api/register/visual`;
                console.log(`🌐 Uploading enrollment to: ${url}`);
                return fetch(url, {
                    method: "POST",
                    body: formData
                });
            } else {
                // NORMAL ENROLLMENT (authenticated)
                const url = `${API_BASE}/api/enroll-object`;
                console.log(`🌐 Uploading enrollment to: ${url}`);
                return fetch(url, {
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
        console.error("Enrollment error:", err);
        let errorMsg = err.message;
        if (err instanceof TypeError && err.message === "Failed to fetch") {
            errorMsg = `Network Error: Cannot connect to ${API_BASE}. Ensure backend is running.`;
        }
        status.textContent = `❌ ${errorMsg}`;
        status.className = "status-message error";
        showToast(errorMsg, "error");
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

            const url = `${API_BASE}/api/login/visual`;
            console.log(`🌐 Submitting visual login to: ${url}`);

            const res = await fetch(url, {
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
            const url = `${API_BASE}/api/authenticate`;
            console.log(`🌐 Submitting authentication to: ${url}`);

            const res = await fetch(url, {
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
        console.error("Auth error:", err);
        let errorMsg = err.message;
        if (err instanceof TypeError && err.message === "Failed to fetch") {
            errorMsg = `Network Error: Backend unreachable (${API_BASE}). Check server status.`;
        }
        status.textContent = `❌ ${errorMsg}`;
        status.className = "status-message error";
        showToast(errorMsg, "error");
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

    // Update Profile Name if available
    const nameEl = document.querySelector(".profile-name");
    if (nameEl && currentUser) {
        nameEl.textContent = currentUser;
    }

    // Reset secure data
    const dataDisplay = document.getElementById("secureDataDisplay");
    if (dataDisplay) {
        dataDisplay.style.display = "none";
        dataDisplay.innerHTML = "";
    }

    startSessionTimer();
    startTraceLog();
    startLiveGraphs();
    startHexStream();
}

/**
 * Real-time bar graph jitter
 */
function startLiveGraphs() {
    const bars = document.querySelectorAll("#barsLoad .bar-fill");
    if (!bars.length) return;

    setInterval(() => {
        bars.forEach(bar => {
            const randomH = Math.floor(Math.random() * 60) + 30; // 30% to 90%
            bar.style.setProperty("--h", randomH + "%");
        });
    }, 1500);
}

/**
 * Scrolling Hex/Packet Stream
 */
function startHexStream() {
    const stream = document.getElementById("hexStream");
    if (!stream) return;

    const generateHex = () => {
        const addr = "0x" + Math.random().toString(16).substr(2, 6).toUpperCase();
        const data = Array.from({ length: 8 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase()).join(" ");
        return `<div class="hex-line"><span class="hex-head">${addr}</span><span class="hex-data">${data}</span></div>`;
    };

    // Initial fill
    stream.innerHTML = Array.from({ length: 10 }, generateHex).join("");

    setInterval(() => {
        const newLine = generateHex();
        stream.innerHTML += newLine;
        if (stream.children.length > 12) {
            stream.removeChild(stream.firstChild);
        }
    }, 800);
}

function startTraceLog() {
    const traceEl = document.getElementById("traceLog");
    if (!traceEl) return;

    const baseMessages = [
        "[SYS] Visual encryption active...",
        "[AUTH] Identity verified...",
        "[NET] Socket tunneling enabled...",
        "[SEC] Heartbeat 200 OK...",
        "[SYS] Buffer cleared...",
        "[DEB] Optical flow synchronized...",
        "[MEM] Allocation stable...",
        "[SYS] SCANPASS Engine v2.0 running..."
    ];

    setInterval(() => {
        const randomMsg = baseMessages[Math.floor(Math.random() * baseMessages.length)];
        const timestamp = new Date().toLocaleTimeString();
        traceEl.textContent = `${traceEl.textContent} [${timestamp}] ${randomMsg} `;

        // Keep it from getting too long
        if (traceEl.textContent.length > 1000) {
            traceEl.textContent = traceEl.textContent.substring(500);
        }
    }, 5000);
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

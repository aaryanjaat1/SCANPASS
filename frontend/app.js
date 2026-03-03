/**
 * ScanPass — Frontend Application (v2 — Minimal / No-ML Build)
 * Uses image capture (snapshot from camera) + simple upload API.
 */

// --- Configuration ---
const RENDER_URL = "https://scanpass.onrender.com";

const API_BASE = (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "[::1]"
) ? "http://127.0.0.1:8000"
    : RENDER_URL;

console.log("🚀 ScanPass connecting to backend at:", API_BASE);

// --- State ---
let currentUser = null;
let mediaStream = null;
let capturedBlob = null;       // Holds the captured photo blob
let sessionTimerInterval;

// =====================
// TOAST NOTIFICATIONS
// =====================
function showToast(message, type = "info") {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    setTimeout(() => toast.classList.remove("show"), 3500);
}

// =====================
// VIEW ROUTING
// =====================
function showView(viewId) {
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    const view = document.getElementById(viewId);
    if (view) view.classList.add("active");

    // Stop camera when leaving enroll/auth views
    if (viewId !== "view-enroll" && viewId !== "view-auth") {
        stopCamera();
    }

    if (viewId === "view-enroll") {
        startCamera("enrollVideo");
    } else if (viewId === "view-auth") {
        startCamera("authVideo");
    }

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.style.display = currentUser ? "block" : "none";
    }
}

// =====================
// CAMERA
// =====================
async function startCamera(videoElementId) {
    stopCamera();
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
            audio: false
        });
        const videoEl = document.getElementById(videoElementId);
        if (videoEl) {
            videoEl.srcObject = mediaStream;
            videoEl.style.transform = "scaleX(-1)"; // mirror front camera
        }
    } catch (err) {
        console.error("Camera access failed:", err);
        showToast("Camera access denied. Please allow camera access.", "error");
    }
}

function stopCamera() {
    if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
    }
}

/**
 * Capture a single JPEG snapshot from a <video> element.
 * Returns a Blob.
 */
function captureSnapshot(videoElementId) {
    const video = document.getElementById(videoElementId);
    if (!video) throw new Error("Video element not found: " + videoElementId);

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext("2d");
    // Un-mirror before drawing so the saved image is not flipped
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error("Failed to capture snapshot from canvas."));
        }, "image/jpeg", 0.85);
    });
}

// =====================
// REGISTER PAGE
// =====================
async function handleRegister(event) {
    event.preventDefault();
    console.log("📝 handleRegister triggered");

    const usernameInput = document.getElementById("regUsername");
    if (!usernameInput) { showToast("Critical: form element missing", "error"); return; }

    const username = usernameInput.value.trim();
    if (username.length < 3) {
        showToast("Please enter a username (3+ characters)", "error");
        return;
    }

    currentUser = username;
    showView("view-enroll");
    showToast("Position yourself in the frame, then click Capture.", "info");
}

// =====================
// ENROLLMENT — CAPTURE + UPLOAD
// =====================
async function startEnrollment() {
    const btn = document.getElementById("enrollRecordBtn");
    const status = document.getElementById("enrollStatus");

    if (!btn || !status) return;
    btn.disabled = true;
    status.textContent = "📸 Capturing photo...";
    status.className = "status-message info";

    try {
        // 1. Snapshot
        const blob = await captureSnapshot("enrollVideo");
        console.log("📸 Snapshot captured:", blob.size, "bytes");

        status.textContent = "⬆️ Uploading to server...";

        // 2. Upload
        const formData = new FormData();
        formData.append("file", blob, "register.jpg");
        formData.append("username", currentUser);

        const url = `${API_BASE}/api/register/visual`;
        console.log("🌐 POST", url);

        const res = await fetch(url, { method: "POST", body: formData });
        const data = await res.json();

        if (!res.ok) throw new Error(data.detail || "Registration failed");

        console.log("✅ Registration response:", data);

        status.textContent = `✅ Registered! Image saved.`;
        status.className = "status-message success";
        showToast("Account created successfully!", "success");

        capturedBlob = blob;

        // Navigate to dashboard (or login) after short delay
        setTimeout(() => showDashboard(data.image_url), 1800);

    } catch (err) {
        console.error("Enrollment error:", err);
        const msg = err instanceof TypeError && err.message === "Failed to fetch"
            ? `Network error: Cannot reach ${API_BASE}. Is backend running?`
            : err.message;
        status.textContent = `❌ ${msg}`;
        status.className = "status-message error";
        showToast(msg, "error");
    } finally {
        btn.disabled = false;
    }
}

// =====================
// LOGIN (simple — no challenge)
// =====================
async function handleLogin(event) {
    event.preventDefault();
    console.log("🔑 handleLogin triggered");

    const usernameInput = document.getElementById("loginUsername");
    if (!usernameInput) { showToast("Critical: form element missing", "error"); return; }

    const username = usernameInput.value.trim();
    if (!username) { showToast("Please enter your username", "error"); return; }

    currentUser = username;

    // For this MVP there is no password/token — just navigate to auth view
    // so the user can take a photo.
    showView("view-auth");
    showToast("Take a photo to authenticate.", "info");
}

// =====================
// AUTHENTICATION — CAPTURE + UPLOAD
// =====================
async function startAuthentication() {
    const btn = document.getElementById("authRecordBtn");
    const status = document.getElementById("authStatus");

    if (!btn || !status) return;
    btn.disabled = true;
    status.textContent = "📸 Capturing photo...";
    status.className = "status-message info";

    try {
        const blob = await captureSnapshot("authVideo");
        console.log("📸 Auth snapshot:", blob.size, "bytes");

        status.textContent = "⬆️ Uploading...";

        const formData = new FormData();
        formData.append("file", blob, "auth.jpg");

        const url = `${API_BASE}/api/upload/image`;
        console.log("🌐 POST", url);

        const res = await fetch(url, { method: "POST", body: formData });
        const data = await res.json();

        if (!res.ok) throw new Error(data.detail || "Upload failed");

        console.log("✅ Upload response:", data);

        status.textContent = "✅ Photo uploaded! Redirecting...";
        status.className = "status-message success";
        showToast("Authentication photo uploaded!", "success");

        setTimeout(() => showDashboard(data.image_url), 1500);

    } catch (err) {
        console.error("Auth error:", err);
        const msg = err instanceof TypeError && err.message === "Failed to fetch"
            ? `Network error: Cannot reach ${API_BASE}.`
            : err.message;
        status.textContent = `❌ ${msg}`;
        status.className = "status-message error";
        showToast(msg, "error");
    } finally {
        btn.disabled = false;
    }
}

// =====================
// DASHBOARD
// =====================
function showDashboard(imageUrl) {
    stopCamera();

    const sessionEl = document.getElementById("dashboardSessionId");
    if (sessionEl) sessionEl.textContent = `SP-${Date.now()}`;

    const nameEl = document.querySelector(".profile-name");
    if (nameEl && currentUser) nameEl.textContent = currentUser;

    const dataDisplay = document.getElementById("secureDataDisplay");
    if (dataDisplay) {
        dataDisplay.style.display = "none";
        dataDisplay.innerHTML = "";
    }

    if (imageUrl) {
        console.log("🖼️ Image URL:", imageUrl);
    }

    startSessionTimer();
    startTraceLog();
    startLiveGraphs();
    startHexStream();

    showView("view-dashboard");
}

function logout() {
    currentUser = null;
    capturedBlob = null;
    stopCamera();
    clearInterval(sessionTimerInterval);
    showView("view-login");
    showToast("Signed out", "success");
}

// =====================
// DASHBOARD WIDGETS
// =====================
function startLiveGraphs() {
    const bars = document.querySelectorAll("#barsLoad .bar-fill");
    if (!bars.length) return;
    setInterval(() => {
        bars.forEach(bar => {
            const h = Math.floor(Math.random() * 60) + 30;
            bar.style.setProperty("--h", h + "%");
        });
    }, 1500);
}

function startHexStream() {
    const stream = document.getElementById("hexStream");
    if (!stream) return;
    const generateHex = () => {
        const addr = "0x" + Math.random().toString(16).substr(2, 6).toUpperCase();
        const data = Array.from({ length: 8 }, () =>
            Math.floor(Math.random() * 256).toString(16).padStart(2, "0").toUpperCase()
        ).join(" ");
        return `<div class="hex-line"><span class="hex-head">${addr}</span><span class="hex-data">${data}</span></div>`;
    };
    stream.innerHTML = Array.from({ length: 10 }, generateHex).join("");
    setInterval(() => {
        stream.innerHTML += generateHex();
        if (stream.children.length > 12) stream.removeChild(stream.firstChild);
    }, 800);
}

function startTraceLog() {
    const traceEl = document.getElementById("traceLog");
    if (!traceEl) return;
    const messages = [
        "[SYS] Encryption active...",
        "[AUTH] Identity stored...",
        "[NET] Connection stable...",
        "[SEC] Heartbeat 200 OK...",
        "[SYS] Buffer cleared...",
        "[MEM] Allocation stable...",
        "[SYS] SCANPASS Engine v2 running...",
    ];
    setInterval(() => {
        const msg = messages[Math.floor(Math.random() * messages.length)];
        const ts = new Date().toLocaleTimeString();
        traceEl.textContent += ` [${ts}] ${msg}`;
        if (traceEl.textContent.length > 1000) {
            traceEl.textContent = traceEl.textContent.substring(500);
        }
    }, 5000);
}

function startSessionTimer() {
    clearInterval(sessionTimerInterval);
    const timerEl = document.getElementById("sessionTimer");
    if (!timerEl) return;
    let timeLeft = 120;
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
    if (!display) return;
    display.style.display = "block";
    display.textContent = "Loading secure data...";

    try {
        const res = await fetch(`${API_BASE}/api/health`);
        const data = await res.json();

        if (!res.ok) throw new Error("Access denied");

        display.innerHTML = `
            <strong>ACCESS GRANTED</strong><br>
            Service: ${data.service}<br>
            Status: ${data.status}<br>
            User: ${currentUser || "unknown"}<br>
        `;
    } catch (err) {
        display.innerHTML = `<span style="color:var(--accent-red)">ACCESS DENIED: ${err.message}</span>`;
    }
}

async function revokeKey() {
    if (!confirm("Are you sure? This will sign you out.")) return;
    logout();
}

// =====================
// DOM SANITY CHECK
// =====================
window.addEventListener("DOMContentLoaded", () => {
    const required = ["regUsername", "loginUsername", "toast"];
    const missing = required.filter(id => !document.getElementById(id));
    if (missing.length > 0) {
        console.error("❌ Missing DOM elements:", missing);
    } else {
        console.log("✅ DOM elements verified.");
    }
});

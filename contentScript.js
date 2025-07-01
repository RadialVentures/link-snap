chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "showSuccess") {
    playSuccessSound();
    showPopup("✔ Profile Saved", "#0a66c2"); 
  } else if (msg.action === "showFailure") {
    showPopup("❌ Failed to Save", "#c20a0a");
  }
});

// Loader UI
function showLoader() {
  if (document.getElementById("profileSaveLoader")) return;

  const loader = document.createElement("div");
  loader.id = "profileSaveLoader";
  loader.innerHTML = `
    <div style="
      border: 6px solid #f3f3f3;
      border-top: 6px solid #0a66c2;
      border-radius: 50%;
      width: 48px;
      height: 48px;
      animation: spin 1s linear infinite;
    "></div>
  `;
  Object.assign(loader.style, {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    zIndex: "9999",
    padding: "20px",
    background: "rgba(255,255,255,0.9)",
    borderRadius: "12px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
  });

  const style = document.createElement("style");
  style.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(loader);
}

function hideLoader() {
  const loader = document.getElementById("profileSaveLoader");
  if (loader) loader.remove();
}

// Sound function
function playSuccessSound() {
  const audio = new Audio(chrome.runtime.getURL("success.mp3"));
  audio.volume = 0.5;
  audio.play().catch((err) => console.error("Sound error:", err));
}

// POPUP UI (centered)
function showPopup(message = "✅ Success", bgColor = "#0a66c2") {
  const popup = document.createElement("div");
  popup.textContent = message;

  Object.assign(popup.style, {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    backgroundColor: bgColor,
    color: "#fff",
    padding: "14px 28px",
    borderRadius: "10px",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.2)",
    fontSize: "16px",
    fontWeight: "bold",
    zIndex: 999999,
    textAlign: "center",
    opacity: "0",
    transition: "opacity 0.3s ease",
    fontFamily: "Inter, sans-serif"
  });

  document.body.appendChild(popup);
  requestAnimationFrame(() => (popup.style.opacity = "1"));

  setTimeout(() => {
    popup.style.opacity = "0";
    setTimeout(() => popup.remove(), 300);
  }, 2000);
}

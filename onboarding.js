const N8N_WEBHOOK_URL = "https://radial25.app.n8n.cloud/webhook/onboard-user";

document.getElementById("connectionForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const userEmail = document.getElementById("userEmail").value;
  const statusMessage = document.getElementById("statusMessage");

  statusMessage.innerText = "Connecting...";
  statusMessage.style.color = "#0a66c2";

  try {
    const response = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: userEmail })
    });

    const data = await response.json();

    if (response.ok && data.sheetID) {
      // Send the sheetID to the background script for storage
      chrome.runtime.sendMessage({ type: "setGoogleSheetId", sheetId: data.sheetID }, () => {
        statusMessage.innerText = "✅ Account connected successfully!";
        statusMessage.style.color = "#28a745";
        setTimeout(() => {
          window.close(); // Close the onboarding tab/window
        }, 2000);
      });
    } else {
      statusMessage.innerText = data.error || "❌ Failed to connect. Please check your email and try again.";
      statusMessage.style.color = "#e74c3c";
    }
  } catch (error) {
    console.error("Error connecting account:", error);
    statusMessage.innerText = "❌ An error occurred. Please try again later.";
    statusMessage.style.color = "#e74c3c";
  }
}); 

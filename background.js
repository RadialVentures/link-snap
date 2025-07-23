console.log("background.js starting...");
console.log("chrome.storage: ", typeof chrome.storage, chrome.storage);
if (typeof chrome.storage !== 'undefined') {
  console.log("chrome.storage.local: ", typeof chrome.storage.local, chrome.storage.local);
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "ping") {
    // Just wake up the service worker
    return;
  }

  if (message.type === "setGoogleSheetId") {
    chrome.storage.local.set({ googleSheetId: message.sheetId }, () => {
      console.log('Google Sheet ID saved by background script:', message.sheetId);
    });
    return;
  }

  if (message.type === "saveUrl") {
    // Step 1: Inject the content script
    chrome.scripting.executeScript(
      {
        target: { tabId: message.tabId },
        files: ["contentScript.js"]
      },
      () => {
        // Step 2: Show loader
        chrome.tabs.sendMessage(message.tabId, { action: "showLoader" });

        // Step 3: Fetch the current list of URLs
        chrome.storage.local.get('googleSheetId', (data) => {
            const googleSheetId = data.googleSheetId;

            if (!googleSheetId) {
              // Handle case where sheet ID is not set (user not onboarded)
              chrome.tabs.sendMessage(message.tabId, {
                action: "showPopup",
                message: "❌ Please connect your account first!",
                bgColor: "#e74c3c"
              });
              chrome.tabs.sendMessage(message.tabId, { action: "hideLoader" });
              return;
            }

            // Proceed with fetches, including the googleSheetId
            fetch("https://script.google.com/macros/s/AKfycbxpvKmn5ijiDPVYdWCynleUoV5oOT0N5bD7va9HP7ud081f_e_IZwzg4Vf6I4xizKK6uQ/exec", {
              method: "POST", // Change to POST if fetching existing URLs to send sheetId
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: "_check_existing", googleSheetId: googleSheetId }) // Send a special marker for checking
            })
            .then(response => response.json())
            .then(urls => {
              if (Array.isArray(urls) && urls.includes(message.url)) {
                // Already saved, show orange popup
                chrome.tabs.sendMessage(message.tabId, { action: "hideLoader" });
                chrome.tabs.sendMessage(message.tabId, {
                  action: "showPopup",
                  message: "⚠️ Already saved",
                  bgColor: "#ff9800"
                });
                return;
              }
              // Not a duplicate, proceed to save
              fetch("https://script.google.com/macros/s/AKfycbxpvKmn5ijiDPVYdWCynleUoV5oOT0N5bD7va9HP7ud081f_e_IZwzg4Vf6I4xizKK6uQ/exec", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: message.url, googleSheetId: googleSheetId }) // Send the sheetId here
              })
                .then(() => {
                  chrome.tabs.sendMessage(message.tabId, { action: "hideLoader" });
                  chrome.tabs.sendMessage(message.tabId, {
                    action: "showPopup",
                    message: "✅ Profile Saved",
                    bgColor: "#0a66c2"
                  });
                  // Play success sound is handled by contentScript.js with showSuccess message
                })
                .catch(() => {
                  chrome.tabs.sendMessage(message.tabId, { action: "hideLoader" });
                  chrome.tabs.sendMessage(message.tabId, {
                    action: "showPopup",
                    message: "❌ Failed to Save",
                    bgColor: "#e74c3c"
                  });
                });
            })
            .catch(() => {
              chrome.tabs.sendMessage(message.tabId, { action: "hideLoader" });
              chrome.tabs.sendMessage(message.tabId, {
                action: "showPopup",
                message: "❌ Failed to Check",
                bgColor: "#e74c3c"
              });
            });
          }); // End of chrome.storage.local.get
      } // Removed setTimeout closure
    );
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Redirect the user to your React app's onboarding/connection page
    // IMPORTANT: Replace 'YOUR_REACT_APP_ONBOARDING_URL' with the actual URL
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }
});


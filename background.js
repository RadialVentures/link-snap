chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "ping") {
    // Just wake up the service worker
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
        chrome.scripting.executeScript({
          target: { tabId: message.tabId },
          func: () => {
            if (typeof showLoader === "function") showLoader();
          }
        });

        // Step 3: Fetch the current list of URLs
        setTimeout(() => {
          fetch("https://script.google.com/macros/s/AKfycbxpvKmn5ijiDPVYdWCynleUoV5oOT0N5bD7va9HP7ud081f_e_IZwzg4Vf6I4xizKK6uQ/exec")
            .then(response => response.json())
            .then(urls => {
              if (Array.isArray(urls) && urls.includes(message.url)) {
                // Already saved, show orange popup
                chrome.scripting.executeScript({
                  target: { tabId: message.tabId },
                  func: () => {
                    if (typeof hideLoader === "function") hideLoader();
                    if (typeof showPopup === "function") showPopup("⚠️ Already saved", "#ff9800");
                  }
                });
                return;
              }
              // Not a duplicate, proceed to save
              fetch("https://script.google.com/macros/s/AKfycbxpvKmn5ijiDPVYdWCynleUoV5oOT0N5bD7va9HP7ud081f_e_IZwzg4Vf6I4xizKK6uQ/exec", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: message.url })
              })
                .then(() => {
                  chrome.scripting.executeScript({
                    target: { tabId: message.tabId },
                    func: () => {
                      if (typeof hideLoader === "function") hideLoader();
                      if (typeof showPopup === "function") showPopup("✅ Profile Saved", "#0a66c2");
                      playSuccessSound();
                    }
                  });
                })
                .catch(() => {
                  chrome.scripting.executeScript({
                    target: { tabId: message.tabId },
                    func: () => {
                      if (typeof hideLoader === "function") hideLoader();
                      if (typeof showPopup === "function") showPopup("❌ Failed to Save", "#e74c3c");
                    }
                  });
                });
            })
            .catch(() => {
              chrome.scripting.executeScript({
                target: { tabId: message.tabId },
                func: () => {
                  if (typeof hideLoader === "function") hideLoader();
                  if (typeof showPopup === "function") showPopup("❌ Failed to Check", "#e74c3c");
                }
              });
            });
        }, 300); // Let contentScript initialize
      }
    );
  }
});


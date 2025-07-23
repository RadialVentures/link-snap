// Wake up the service worker as soon as the popup opens
chrome.runtime.sendMessage({ type: "ping" });

document.getElementById("saveUrlBtn").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab && (tab.url.includes("linkedin.com/in/") || tab.url.includes("linkedin.com/company/"))) {
      let urlToSave = tab.url;
      // If it's a company profile, trim to base company URL
      const companyMatch = tab.url.match(/(https:\/\/www\.linkedin\.com\/company\/[^\/]+\/)?.*/);
      if (tab.url.includes("linkedin.com/company/")) {
        const match = tab.url.match(/(https:\/\/www\.linkedin\.com\/company\/[^\/]+\/)?.*/);
        if (match && match[1]) {
          urlToSave = match[1];
        }
      }
      chrome.runtime.sendMessage({
        type: "saveUrl",
        url: urlToSave,
        tabId: tab.id
      });
      window.close(); // close popup immediately after click
    } else {
      // Inject overlay message into the page
      chrome.scripting.executeScript({
        target: {tabId: tab.id},
        func: () => {
          const msg = document.createElement("div");
          msg.innerText = "Not a LinkedIn profile!";
          msg.style.position = "fixed";
          msg.style.top = "50%";
          msg.style.left = "50%";
          msg.style.transform = "translate(-50%, -50%)";
          msg.style.padding = "14px 24px";
          msg.style.backgroundColor = "#e74c3c";
          msg.style.color = "#fff";
          msg.style.fontSize = "16px";
          msg.style.borderRadius = "10px";
          msg.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.15)";
          msg.style.zIndex = "9999";
          msg.style.opacity = "0";
          msg.style.transition = "opacity 0.3s ease";
          document.body.appendChild(msg);

          requestAnimationFrame(() => {
            msg.style.opacity = "1";
          });
          setTimeout(() => {
            msg.style.opacity = "0";
            setTimeout(() => msg.remove(), 300);
          }, 2000);
        }
      });
      window.close(); // close popup immediately after injection
    }
  });
});

// Check for a token in the URL hash on popup load
window.addEventListener('load', () => {
  const urlParams = new URLSearchParams(window.location.hash.substring(1));
  const userToken = urlParams.get('token');

  if (userToken) {
    chrome.storage.local.set({ userToken: userToken }, () => {
      console.log('User token saved:', userToken);
      // Optionally, remove the token from the URL hash to keep it clean
      history.replaceState(null, '', window.location.pathname);
    });
  } else {
    console.log('No user token found in URL.');
  }
});

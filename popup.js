// Wake up the service worker as soon as the popup opens
chrome.runtime.sendMessage({ type: "ping" });

document.getElementById("saveUrlBtn").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab && tab.url.includes("linkedin.com/in/")) {
      chrome.runtime.sendMessage({
        type: "saveUrl",
        url: tab.url,
        tabId: tab.id
      });
    } else {
      //You aren't on a linkedin profile page
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
  }

    window.close(); // close popup immediately
  });
});

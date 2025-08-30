// Wake up the service worker as soon as the popup opens
console.log("Popup.js loading...");
chrome.runtime.sendMessage({ type: "ping" });

// Function to check authentication status
async function checkAuthStatus() {
  try {
    const authenticated = await isAuthenticated();
    if (!authenticated) {
      console.log('User not authenticated, opening onboarding page');
      handleMissingAuth();
      return false;
    }
    
    const user = await getCurrentUser();
    if (!user) {
      console.log('Could not get user info, opening onboarding page');
      handleMissingAuth();
      return false;
    }
    
    console.log('User authenticated:', user.email);
    return true;
  } catch (error) {
    console.error('Error checking auth status:', error);
    handleMissingAuth();
    return false;
  }
}

// Function to handle missing authentication
function handleMissingAuth() {
  console.log('No authentication found, opening onboarding page');
  chrome.tabs.create({
    url: chrome.runtime.getURL('onboarding.html')
  });
  window.close();
}

// Check authentication immediately when the popup script runs
(async () => {
  console.log("Checking authentication status...");
  
  try {
    const isAuth = await checkAuthStatus();
    if (!isAuth) {
      return;
    }
    
    console.log('User is authenticated, popup ready');
    
    // Update the popup status to show it's connected with user email
    const statusDiv = document.getElementById('status');
    if (statusDiv) {
      const user = await getCurrentUser();
      const userEmail = user ? user.email : 'your account';
      statusDiv.className = 'status-message success';
      statusDiv.innerHTML = `<span>✅</span> Connected to ${userEmail}`;
      statusDiv.style.display = 'block';
    }
  } catch (error) {
    console.error('Error during authentication check:', error);
    handleMissingAuth();
  }
})();

console.log("Looking for save button...");
const saveBtn = document.getElementById("saveUrlBtn");
console.log("Save button found:", saveBtn);

if (saveBtn) {
  console.log("Adding click listener to save button...");
  saveBtn.addEventListener("click", async () => {
    console.log("Save button clicked!");
    
    // Check authentication before proceeding
    const isAuth = await checkAuthStatus();
    if (!isAuth) {
      return;
    }
    
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      console.log("Current tab:", tab);
      console.log("Tab URL:", tab?.url);
      
      if (tab && (tab.url.includes("linkedin.com/in/") || tab.url.includes("linkedin.com/company/"))) {
        let urlToSave = tab.url;
        console.log("LinkedIn profile detected, original URL:", urlToSave);
        
        // If it's a company profile, trim to base company URL
        const companyMatch = tab.url.match(/(https:\/\/www\.linkedin\.com\/company\/[^\/]+\/)?.*/);
        if (tab.url.includes("linkedin.com/company/")) {
          const match = tab.url.match(/(https:\/\/www\.linkedin\.com\/company\/[^\/]+\/)?.*/);
          if (match && match[1]) {
            urlToSave = match[1];
          }
        }
        
        console.log("Final URL to save:", urlToSave);
        console.log("Sending message to background script...");
        
        chrome.runtime.sendMessage({
          type: "saveUrl",
          url: urlToSave,
          tabId: tab.id
        });
        window.close(); // close popup immediately after click
      } else {
        console.log("Not a LinkedIn profile page");
        // Show error status in popup before closing
        const statusDiv = document.getElementById('status');
        if (statusDiv) {
          statusDiv.className = 'status-message error';
          statusDiv.innerHTML = '<span>❌</span> Not a LinkedIn profile page';
          setTimeout(() => {
            window.close();
          }, 1500);
        } else {
          // Fallback: inject overlay message into the page
          chrome.scripting.executeScript({
            target: {tabId: tab.id},
            func: () => {
              const msg = document.createElement("div");
              msg.innerText = "❌ Not a LinkedIn profile!";
              msg.style.position = "fixed";
              msg.style.top = "50%";
              msg.style.left = "50%";
              msg.style.transform = "translate(-50%, -50%)";
              msg.style.padding = "16px 32px";
              msg.style.background = "linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)";
              msg.style.border = "2px solid #ef4444";
              msg.style.color = "#dc2626";
              msg.style.fontSize = "16px";
              msg.style.fontWeight = "600";
              msg.style.fontFamily = "'Inter', sans-serif";
              msg.style.borderRadius = "12px";
              msg.style.boxShadow = "0 8px 25px rgba(239, 68, 68, 0.2)";
              msg.style.zIndex = "9999";
              msg.style.opacity = "0";
              msg.style.transition = "all 0.3s ease";
              document.body.appendChild(msg);

              requestAnimationFrame(() => {
                msg.style.opacity = "1";
                msg.style.transform = "translate(-50%, -50%) scale(1)";
              });
              setTimeout(() => {
                msg.style.opacity = "0";
                msg.style.transform = "translate(-50%, -50%) scale(0.95)";
                setTimeout(() => msg.remove(), 300);
              }, 2500);
            }
          });
        }
        window.close(); // close popup immediately after injection
      }
    });
  });
} else {
  console.error("Save button not found!");
}

// Add sign-out button functionality
const signOutBtn = document.getElementById("signOutBtn");
if (signOutBtn) {
  console.log("Adding click listener to sign-out button...");
  signOutBtn.addEventListener("click", async () => {
    console.log("Sign-out button clicked!");
    
    try {
      // Sign out from Supabase
      await signOut();
      console.log('Successfully signed out');
      
      // Show success message
      const statusDiv = document.getElementById('status');
      if (statusDiv) {
        statusDiv.className = 'status-message success';
        statusDiv.innerHTML = '<span>✅</span> Signed out successfully';
        statusDiv.style.display = 'block';
      }
      
      // Close popup after a short delay
      setTimeout(() => {
        window.close();
      }, 1500);
      
    } catch (error) {
      console.error('Error signing out:', error);
      
      // Show error message
      const statusDiv = document.getElementById('status');
      if (statusDiv) {
        statusDiv.className = 'status-message error';
        statusDiv.innerHTML = '<span>❌</span> Error signing out';
        statusDiv.style.display = 'block';
      }
    }
  });
} else {
  console.error("Sign-out button not found!");
}

console.log("Popup.js loaded completely");

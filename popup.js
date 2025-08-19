// Wake up the service worker as soon as the popup opens
console.log("Popup.js loading...");
chrome.runtime.sendMessage({ type: "ping" });

// Function to check if JWT token is expired
function isTokenExpired(token) {
  try {
    const tokenParts = token.split('.');
    if (tokenParts.length === 3) {
      const payload = JSON.parse(atob(tokenParts[1]));
      const expiration = payload.exp;
      const currentTime = Math.floor(Date.now() / 1000);
      
      // Check if token will expire within the next 5 minutes
      const fiveMinutesFromNow = currentTime + (5 * 60);
      return expiration < fiveMinutesFromNow;
    }
  } catch (error) {
    console.error('Error parsing JWT token:', error);
  }
  return true; // Consider invalid tokens as expired
}

// Function to automatically refresh the JWT token
async function refreshJWTToken() {
  try {
    console.log('Attempting to automatically refresh JWT token...');
    
    // Get the current user ID from the existing token
    const { supabaseToken } = await chrome.storage.local.get(['supabaseToken']);
    if (!supabaseToken) {
      console.log('No existing token to refresh');
      return false;
    }

    // Extract user ID from current token
    const tokenParts = supabaseToken.split('.');
    if (tokenParts.length !== 3) {
      console.log('Invalid token format for refresh');
      return false;
    }

    const payload = JSON.parse(atob(tokenParts[1]));
    const userId = payload.sub;
    if (!userId) {
      console.log('Could not extract user ID from token');
      return false;
    }

    console.log('Attempting to refresh token for user ID:', userId);

    // Make a request to the main app to get a fresh token
    // We'll use the Supabase API to get a fresh token for this user
    const apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlubWx2dWFkbWpsZG91cHVqZWliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA5NTkzMzYsImV4cCI6MjA2NjUzNTMzNn0.vifa6z50XCItrH1zqK7xsRKUUIjD_ZAsUC-EfLwTmf4';
    
    // First, check if there's a fresh token available in user_profiles
    // Use only the API key since we're just reading public data and the current token might be expired
    const checkResponse = await fetch(`https://ynmlvuadmjldoupujeib.supabase.co/rest/v1/user_profiles?user_id=eq.${userId}&select=extension_token&apikey=${encodeURIComponent(apiKey)}`, {
      method: 'GET',
      headers: {
        'apikey': apiKey,
        'Content-Type': 'application/json'
      }
    });

    console.log('Check response status:', checkResponse.status);
    console.log('Check response headers:', [...checkResponse.headers.entries()]);

    if (checkResponse.ok) {
      const userProfile = await checkResponse.json();
      console.log('User profile response:', userProfile);
      
      if (userProfile && userProfile.length > 0 && userProfile[0].extension_token) {
        const freshToken = userProfile[0].extension_token;
        console.log('Found fresh token, length:', freshToken.length);
        
        // Validate the fresh token
        const freshTokenParts = freshToken.split('.');
        if (freshTokenParts.length === 3) {
          const freshPayload = JSON.parse(atob(freshTokenParts[1]));
          const freshExpiration = freshPayload.exp;
          const currentTime = Math.floor(Date.now() / 1000);
          
          console.log('Fresh token expiration:', new Date(freshExpiration * 1000).toISOString());
          console.log('Current time:', new Date(currentTime * 1000).toISOString());
          console.log('5 minute buffer time:', new Date((currentTime + 300) * 1000).toISOString());
          
          // Check if the fresh token is actually newer and not expired
          if (freshExpiration > currentTime + 300) { // 5 minute buffer
            console.log('Found fresh token, updating storage...');
            await chrome.storage.local.set({ supabaseToken: freshToken });
            
            // Mark the token as confirmed
            try {
              const rpcResp = await fetch(`https://ynmlvuadmjldoupujeib.supabase.co/rest/v1/rpc/mark_extension_token_confirmed?apikey=${encodeURIComponent(apiKey)}`, {
                method: 'POST',
                headers: {
                  'apikey': apiKey,
                  'Authorization': `Bearer ${freshToken}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
              });
              if (rpcResp.ok) {
                console.log('Token refresh successful and confirmed');
                return true;
              }
            } catch (e) {
              console.warn('Could not confirm refreshed token:', e);
            }
            
            return true;
          } else {
            console.log('Fresh token is also expired or expiring soon');
          }
        } else {
          console.log('Fresh token has invalid format');
        }
      } else {
        console.log('No extension_token found in user profile');
      }
    } else {
      const errorText = await checkResponse.text();
      console.error('Failed to fetch user profile:', checkResponse.status, errorText);
    }

    console.log('No fresh token available for automatic refresh');
    return false;
  } catch (error) {
    console.error('Error during automatic token refresh:', error);
    return false;
  }
}

// Function to handle expired token
async function handleExpiredToken() {
  console.log('Token is expired, attempting automatic refresh...');
  
  // Try to automatically refresh the token first
  const refreshSuccess = await refreshJWTToken();
  
  if (refreshSuccess) {
    console.log('Token automatically refreshed, popup ready');
    // Update the popup status to show it's connected
    const statusDiv = document.getElementById('status');
    if (statusDiv) {
      statusDiv.className = 'status-message success';
      statusDiv.innerHTML = '<span>✅</span> Connected to your account';
      statusDiv.style.display = 'block';
    }
    return; // Don't close the popup, let the user continue
  }
  
  console.log('Automatic refresh failed, prompting manual reconnection');
  // Clear the expired token
  chrome.storage.local.remove(['supabaseToken']);
  
  // Show expired token message in popup
  const statusDiv = document.getElementById('status');
  if (statusDiv) {
    statusDiv.className = 'status-message error';
    statusDiv.innerHTML = '<span>🔄</span> Session expired. Please reconnect your account.';
    statusDiv.style.display = 'block';
  }
  
  // Open reconnection info page immediately
  chrome.tabs.create({
    url: chrome.runtime.getURL('reconnect.html')
  });
  window.close();
}

// Function to handle missing token (first time setup)
function handleMissingToken() {
  console.log('No token found, opening onboarding page');
  chrome.tabs.create({
    url: chrome.runtime.getURL('onboarding.html')
  });
  window.close();
}

// Check token expiration immediately when the popup script runs (no window load delay)
(async () => {
  console.log("Checking token expiration...");
  
  // Get stored token
  const { supabaseToken } = await chrome.storage.local.get(['supabaseToken']);
  
  if (!supabaseToken) {
    console.log('No token found, opening onboarding page');
    handleMissingToken();
    return;
  }
  
  // Check if token is expired
  if (isTokenExpired(supabaseToken)) {
    console.log('Token is expired');
    await handleExpiredToken();
    return;
  }
  
  console.log('Token is valid, popup ready');
  
  // Check for a token in the URL hash (for initial onboarding)
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
})();

console.log("Looking for save button...");
const saveBtn = document.getElementById("saveUrlBtn");
console.log("Save button found:", saveBtn);

if (saveBtn) {
  console.log("Adding click listener to save button...");
  saveBtn.addEventListener("click", async () => {
    console.log("Save button clicked!");
    
    // Check token expiration before proceeding
    const { supabaseToken } = await chrome.storage.local.get(['supabaseToken']);
    
    if (!supabaseToken || isTokenExpired(supabaseToken)) {
      console.log('Token is missing or expired, attempting automatic refresh...');
      const refreshSuccess = await refreshJWTToken();
      
      if (!refreshSuccess) {
        console.log('Automatic refresh failed, prompting manual reconnection');
        await handleExpiredToken();
        return;
      }
      
      console.log('Token refreshed, proceeding with save...');
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

console.log("Popup.js loaded completely");

console.log("background.js starting...");
console.log("chrome.storage: ", typeof chrome.storage, chrome.storage);
if (typeof chrome.storage !== 'undefined') {
  console.log("chrome.storage.local: ", typeof chrome.storage.local, chrome.storage.local);
}

chrome.runtime.onMessage.addListener((message, sender) => {
  console.log("Background script received message:", message);
  
  if (message.type === "ping") {
    console.log("Ping received - service worker is awake");
    // Just wake up the service worker
    return;
  }

  if (message.type === "saveUrl") {
    console.log("SaveURL message received, URL:", message.url, "TabId:", message.tabId);
    
    // Step 1: Inject the content script
    console.log("Injecting content script...");
    chrome.scripting.executeScript(
      {
        target: { tabId: message.tabId },
        files: ["contentScript.js"]
      },
      () => {
        console.log("Content script injected, showing loader...");
        // Step 2: Show loader
        chrome.tabs.sendMessage(message.tabId, { action: "showLoader" });

        console.log("Calling saveProfileToSupabase...");
        // Step 3: Save profile to Supabase
        saveProfileToSupabase(message.url, message.tabId);
      }
    );
  }
});

// Function to save profile to Supabase
function saveProfileToSupabase(profileUrl, tabId) {
  console.log('Attempting to save profile URL:', profileUrl);
  
  chrome.storage.local.get(['supabaseToken'], ({ supabaseToken }) => {
    console.log('Token found:', supabaseToken ? 'Yes (length: ' + supabaseToken.length + ')' : 'No');
    
    if (!supabaseToken) {
      console.error('No Supabase token found');
      // User not authenticated
      chrome.tabs.sendMessage(tabId, { action: "hideLoader" });
      chrome.tabs.sendMessage(tabId, {
        action: "showPopup",
        message: "❌ Please connect your account first!",
        bgColor: "#e74c3c"
      });
      return;
    }

    console.log('Making request to Supabase...');
    
    // Extract user ID and check expiration from JWT token
    let userId = null;
    let tokenExpired = false;
    try {
      const tokenParts = supabaseToken.split('.');
      if (tokenParts.length === 3) {
        const payload = JSON.parse(atob(tokenParts[1]));
        userId = payload.sub;
        const expiration = payload.exp;
        const currentTime = Math.floor(Date.now() / 1000);
        
        console.log('Extracted user ID from token:', userId);
        console.log('Token expires at:', new Date(expiration * 1000).toLocaleString());
        console.log('Current time:', new Date(currentTime * 1000).toLocaleString());
        
        // Check if token will expire within the next 5 minutes
        const fiveMinutesFromNow = currentTime + (5 * 60);
        if (expiration < fiveMinutesFromNow) {
          tokenExpired = true;
          console.log('Token is expired or will expire within 5 minutes');
        }
      }
    } catch (error) {
      console.error('Error parsing JWT token:', error);
    }
    
    if (!userId) {
      console.error('Could not extract user ID from token');
      chrome.tabs.sendMessage(tabId, { action: "hideLoader" });
      chrome.tabs.sendMessage(tabId, {
        action: "showPopup",
        message: "❌ Invalid token format",
        bgColor: "#e74c3c"
      });
      return;
    }

    // Handle expired or soon-to-expire tokens
    if (tokenExpired) {
      console.log('Token is expired or expiring soon, prompting user to reconnect');
      chrome.tabs.sendMessage(tabId, { action: "hideLoader" });
      chrome.tabs.sendMessage(tabId, {
        action: "showPopup",
        message: "🔄 Your session expires soon. Please reconnect your account!",
        bgColor: "#f39c12"
      });
      // Clear the expired token
      chrome.storage.local.remove(['supabaseToken']);
      // Open onboarding page for reconnection
      chrome.tabs.create({
        url: chrome.runtime.getURL('onboarding.html')
      });
      return;
    }
    
    // First check if profile already exists
    fetch(`https://ynmlvuadmjldoupujeib.supabase.co/rest/v1/profiles?user_id=eq.${userId}&profile_url=eq.${encodeURIComponent(profileUrl)}`, {
      method: 'GET',
      headers: {
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlubWx2dWFkbWpsZG91cHVqZWliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA5NTkzMzYsImV4cCI6MjA2NjUzNTMzNn0.vifa6z50XCItrH1zqK7xsRKUUIjD_ZAsUC-EfLwTmf4',
        'Authorization': `Bearer ${supabaseToken}`,
        'Content-Type': 'application/json'
      }
    })
    .then(async response => {
      if (response.ok) {
        const existingProfiles = await response.json();
        
        if (existingProfiles && existingProfiles.length > 0) {
          // Profile already exists
          console.log('Profile already exists, skipping insertion');
          chrome.tabs.sendMessage(tabId, { action: "hideLoader" });
          chrome.tabs.sendMessage(tabId, {
            action: "showPopup",
            message: "ℹ️ Profile already saved",
            bgColor: "#3498db"
          });
          return;
        }
        
        // Profile doesn't exist, proceed with insertion
        console.log('Profile does not exist, proceeding with insertion');
        
        // Save to Supabase
        return fetch('https://ynmlvuadmjldoupujeib.supabase.co/rest/v1/profiles', {
          method: 'POST',
          headers: {
            'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlubWx2dWFkbWpsZG91cHVqZWliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA5NTkzMzYsImV4cCI6MjA2NjUzNTMzNn0.vifa6z50XCItrH1zqK7xsRKUUIjD_ZAsUC-EfLwTmf4',
            'Authorization': `Bearer ${supabaseToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            user_id: userId,
            profile_url: profileUrl
          })
        });
      } else {
        // Error checking for duplicates
        console.error('Error checking for existing profile:', response.status);
        chrome.tabs.sendMessage(tabId, { action: "hideLoader" });
        chrome.tabs.sendMessage(tabId, {
          action: "showPopup",
          message: "❌ Error checking for duplicates",
          bgColor: "#e74c3c"
        });
        return null;
      }
    })
    .then(async response => {
      // If response is null, it means we already handled the duplicate case
      if (!response) return;
      
      chrome.tabs.sendMessage(tabId, { action: "hideLoader" });
      
      console.log('Supabase response status:', response.status);
      console.log('Supabase response headers:', [...response.headers.entries()]);
      
      if (response.ok) {
        // Check if response has content before parsing JSON
        const contentType = response.headers.get('content-type');
        let data = null;
        
        if (contentType && contentType.includes('application/json')) {
          const text = await response.text();
          if (text) {
            try {
              data = JSON.parse(text);
            } catch (e) {
              console.log('Could not parse response as JSON, but request was successful');
            }
          }
        }
        
        console.log('Profile saved successfully:', data || 'No response data');
        chrome.tabs.sendMessage(tabId, {
          action: "showPopup",
          message: "✅ Profile Saved",
          bgColor: "#0a66c2"
        });
      } else {
        const errorText = await response.text();
        console.error('Supabase error response:', response.status, errorText);
        
        if (response.status === 401) {
          // Token is invalid/expired - user needs to reconnect
          chrome.tabs.sendMessage(tabId, {
            action: "showPopup",
            message: "❌ Token expired. Please reconnect your account!",
            bgColor: "#e74c3c"
          });
          // Clear the invalid token
          chrome.storage.local.remove(['supabaseToken']);
        } else if (response.status === 403) {
          chrome.tabs.sendMessage(tabId, {
            action: "showPopup",
            message: "❌ Permission denied. Check your account setup.",
            bgColor: "#e74c3c"
          });
        } else if (response.status === 400) {
          chrome.tabs.sendMessage(tabId, {
            action: "showPopup",
            message: "❌ Invalid data. Check the profile URL.",
            bgColor: "#e74c3c"
          });
        } else {
          chrome.tabs.sendMessage(tabId, {
            action: "showPopup",
            message: `❌ Failed to Save (${response.status})`,
            bgColor: "#e74c3c"
          });
        }
      }
    })
    .catch(error => {
      console.error("Error saving profile:", error);
      chrome.tabs.sendMessage(tabId, { action: "hideLoader" });
      chrome.tabs.sendMessage(tabId, {
        action: "showPopup",
        message: "❌ Failed to Save",
        bgColor: "#e74c3c"
      });
    });
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Redirect the user to onboarding page
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }
});


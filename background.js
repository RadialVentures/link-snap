console.log("background.js starting...");
console.log("chrome.storage: ", typeof chrome.storage, chrome.storage);
if (typeof chrome.storage !== 'undefined') {
  console.log("chrome.storage.local: ", typeof chrome.storage.local, chrome.storage.local);
}

// When the extension saves a new token, mark it as confirmed in the user's profile
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.supabaseToken || !changes.supabaseToken.newValue) return;
  try {
    // Normalize token: strip whitespace/newlines that break base64url
    const supabaseTokenRaw = changes.supabaseToken.newValue || '';
    const supabaseToken = supabaseTokenRaw.replace(/\s+/g, '');
    const parts = supabaseToken.split('.');
    if (parts.length !== 3) return;
    const payload = JSON.parse(atob(parts[1]));
    const userId = payload.sub;
    if (!userId) return;

    const apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlubWx2dWFkbWpsZG91cHVqZWliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA5NTkzMzYsImV4cCI6MjA2NjUzNTMzNn0.vifa6z50XCItrH1zqK7xsRKUUIjD_ZAsUC-EfLwTmf4';
    const base = `https://ynmlvuadmjldoupujeib.supabase.co/rest/v1/user_profiles`;
    const headers = {
      'apikey': apiKey,
      'Authorization': `Bearer ${supabaseToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    // Prefer RPC to perform an UPDATE under your RLS (no PATCH)
    try {
      const rpcResp = await fetch(`https://ynmlvuadmjldoupujeib.supabase.co/rest/v1/rpc/mark_extension_token_confirmed?apikey=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({})
      });
      if (rpcResp.ok) {
        console.log('extension_token_confirmed updated via RPC (bg)');
        return;
      } else {
        const t = await rpcResp.text();
        console.warn('RPC mark_extension_token_confirmed failed, falling back:', rpcResp.status, t);
      }
    } catch (e) {
      console.warn('RPC call error, falling back to REST:', e);
    }

    // 1) Check if row exists
    const getResp = await fetch(`${base}?user_id=eq.${userId}&select=id&apikey=${encodeURIComponent(apiKey)}`, { headers });
    const rows = getResp.ok ? await getResp.json() : [];
    const exists = Array.isArray(rows) && rows.length > 0;

    if (exists) {
      // 2a) Upsert via POST using the primary key id to avoid duplicates
      const id = rows[0].id;
      const upsertResp = await fetch(`${base}?apikey=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ id, user_id: userId, extension_token_confirmed: true })
      });
      if (!upsertResp.ok) {
        const text = await upsertResp.text();
        console.warn('Failed to UPSERT extension_token_confirmed (bg):', upsertResp.status, text);
      } else {
        console.log('extension_token_confirmed updated (bg)');
      }
    } else {
      // 2b) Create row if missing
      const postResp = await fetch(`${base}?apikey=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ user_id: userId, extension_token_confirmed: true })
      });
      if (!postResp.ok) {
        const text = await postResp.text();
        console.warn('Failed to INSERT extension_token_confirmed (bg):', postResp.status, text);
      } else {
        console.log('extension_token_confirmed inserted (bg)');
      }
    }
  } catch (e) {
    console.warn('Error setting extension_token_confirmed (bg):', e);
  }
});

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
        console.log("Content script injected, requesting profile name and showing loader...");
        // Ask content script for display name
        chrome.tabs.sendMessage(message.tabId, { action: "extractProfileName" });
        // Step 2: Show loader
        chrome.tabs.sendMessage(message.tabId, { action: "showLoader" });

        console.log("Calling saveProfileToSupabase...");
        // Step 3: Save profile to Supabase
        saveProfileToSupabase(message.url, message.tabId);
      }
    );
  }
});

let latestExtractedName = null;
let latestExtractedImage = null;

// Receive extracted name from content script
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === 'profileNameExtracted') {
    latestExtractedName = typeof msg.name === 'string' ? msg.name : null;
  }
  if (msg.action === 'profileInfoExtracted') {
    latestExtractedName = typeof msg.name === 'string' ? msg.name : latestExtractedName;
    latestExtractedImage = typeof msg.image === 'string' ? msg.image : latestExtractedImage;
  }
});

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

// Function to save profile to Supabase
async function saveProfileToSupabase(profileUrl, tabId) {
  console.log('Attempting to save profile URL:', profileUrl);
  
  const { supabaseToken } = await chrome.storage.local.get(['supabaseToken']);
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
    console.log('Token is expired or expiring soon, attempting automatic refresh...');
    
    // Try to automatically refresh the token first
    const refreshSuccess = await refreshJWTToken();
    
    if (refreshSuccess) {
      console.log('Token automatically refreshed, proceeding with profile save...');
      // Recursively call saveProfileToSupabase with the fresh token
      saveProfileToSupabase(profileUrl, tabId);
      return;
    }
    
    console.log('Automatic refresh failed, prompting user to reconnect');
    chrome.tabs.sendMessage(tabId, { action: "hideLoader" });
    chrome.tabs.sendMessage(tabId, {
      action: "showPopup",
      message: "🔄 Your session expires soon. Please reconnect your account!",
      bgColor: "#f39c12"
    });
    // Clear the expired token
    chrome.storage.local.remove(['supabaseToken']);
    // Open reconnection info page for reconnection
    chrome.tabs.create({
      url: chrome.runtime.getURL('reconnect.html')
    });
    return;
  }

  try {
    // First check if profile already exists
    const checkResponse = await fetch(`https://ynmlvuadmjldoupujeib.supabase.co/rest/v1/profiles?user_id=eq.${userId}&profile_url=eq.${encodeURIComponent(profileUrl)}`, {
      method: 'GET',
      headers: {
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlubWx2dWFkbWpsZG91cHVqZWliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA5NTkzMzYsImV4cCI6MjA2NjUzNTMzNn0.vifa6z50XCItrH1zqK7xsRKUUIjD_ZAsUC-EfLwTmf4',
        'Authorization': `Bearer ${supabaseToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (checkResponse.ok) {
      const existingProfiles = await checkResponse.json();
      
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
      const body = {
        user_id: userId,
        profile_url: profileUrl
      };
      if (latestExtractedName) body.profile_name = latestExtractedName;
      if (latestExtractedImage) body.profile_image_url = latestExtractedImage;
      
      const saveResponse = await fetch('https://ynmlvuadmjldoupujeib.supabase.co/rest/v1/profiles', {
        method: 'POST',
        headers: {
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlubWx2dWFkbWpsZG91cHVqZWliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA5NTkzMzYsImV4cCI6MjA2NjUzNTMzNn0.vifa6z50XCItrH1zqK7xsRKUUIjD_ZAsUC-EfLwTmf4',
          'Authorization': `Bearer ${supabaseToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      chrome.tabs.sendMessage(tabId, { action: "hideLoader" });
      
      console.log('Supabase response status:', saveResponse.status);
      console.log('Supabase response headers:', [...saveResponse.headers.entries()]);
      
      if (saveResponse.ok) {
        // Check if response has content before parsing JSON
        const contentType = saveResponse.headers.get('content-type');
        let data = null;
        
        if (contentType && contentType.includes('application/json')) {
          const text = await saveResponse.text();
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
        const errorText = await saveResponse.text();
        console.error('Supabase error response:', saveResponse.status, errorText);
        
        if (saveResponse.status === 401) {
          // Token is invalid/expired - user needs to reconnect
          chrome.tabs.sendMessage(tabId, {
            action: "showPopup",
            message: "❌ Token expired. Please reconnect your account!",
            bgColor: "#e74c3c"
          });
          // Clear the invalid token
          chrome.storage.local.remove(['supabaseToken']);
          // Open reconnection info page
          chrome.tabs.create({
            url: chrome.runtime.getURL('reconnect.html')
          });
        } else if (saveResponse.status === 403) {
          chrome.tabs.sendMessage(tabId, {
            action: "showPopup",
            message: "❌ Permission denied. Check your account setup.",
            bgColor: "#e74c3c"
          });
        } else if (saveResponse.status === 400) {
          chrome.tabs.sendMessage(tabId, {
            action: "showPopup",
            message: "❌ Invalid data. Check the profile URL.",
            bgColor: "#e74c3c"
          });
        } else {
          chrome.tabs.sendMessage(tabId, {
            action: "showPopup",
            message: `❌ Failed to Save (${saveResponse.status})`,
            bgColor: "#e74c3c"
          });
        }
      }
    } else {
      // Error checking for duplicates
      console.error('Error checking for existing profile:', checkResponse.status);
      chrome.tabs.sendMessage(tabId, { action: "hideLoader" });
      chrome.tabs.sendMessage(tabId, {
        action: "showPopup",
        message: "❌ Error checking for duplicates",
        bgColor: "#e74c3c"
      });
    }
  } catch (error) {
    console.error("Error saving profile:", error);
    chrome.tabs.sendMessage(tabId, { action: "hideLoader" });
    chrome.tabs.sendMessage(tabId, {
      action: "showPopup",
      message: "❌ Failed to Save",
      bgColor: "#e74c3c"
    });
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Redirect the user to onboarding page
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }
});


console.log("background.js starting...");

// Supabase client configuration for Chrome extension
const supabaseUrl = 'https://vqwcdrtnnnykkuaxuaqd.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZxd2NkcnRubm55a2t1YXh1YXFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU5MzIzNTMsImV4cCI6MjA3MTUwODM1M30.9Jk6UFw9YHyIwxU9jeaSmne0NcfQVONEQCIzwVNPaM0';

// Create a simple Supabase client implementation for background script
class SimpleSupabaseClient {
  constructor(url, key) {
    this.url = url;
    this.key = key;
    this.auth = new SimpleAuthClient(this);
    console.log('SimpleSupabaseClient created with URL:', url);
  }

  from(table) {
    console.log('from method called with table:', table);
    const client = new SimpleTableClient(this, table);
    console.log('Created table client:', client);
    console.log('Table client methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(client)));
    console.log('Table client has select method:', typeof client.select);
    console.log('Table client has eq method:', typeof client.eq);
    console.log('Table client has insert method:', typeof client.insert);
    console.log('Table client has execute method:', typeof client.execute);
    return client;
  }
}

class SimpleAuthClient {
  constructor(client) {
    this.client = client;
  }

  async getSession() {
    try {
      const session = await this.getStoredSession();
      if (session && session.expires_at > Date.now()) {
        return { data: { session }, error: null };
      }
      
      // If session is expired but we have a refresh token, try to refresh it
      if (session && session.refresh_token && session.expires_at <= Date.now()) {
        console.log('Session expired in background, attempting to refresh...');
        const refreshResult = await this.refreshSession();
        if (refreshResult.data && refreshResult.data.session) {
          console.log('Session refreshed successfully in background');
          return { data: { session: refreshResult.data.session }, error: null };
        } else {
          console.log('Session refresh failed in background, clearing expired session');
          await this.clearStoredSession();
          return { data: { session: null }, error: null };
        }
      }
      
      return { data: { session: null }, error: null };
    } catch (error) {
      return { data: { session: null }, error };
    }
  }

  async getUser() {
    try {
      const session = await this.getStoredSession();
      if (session && session.user) {
        return { data: { user: session.user }, error: null };
      }
      return { data: { user: null }, error: null };
    } catch (error) {
      return { data: { user: null }, error };
    }
  }

  async getStoredSession() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['supabase_session'], (result) => {
        console.log('Retrieved stored session:', result.supabase_session);
        resolve(result.supabase_session || null);
      });
    });
  }

  async clearStoredSession() {
    return new Promise((resolve) => {
      chrome.storage.local.remove(['supabase_session'], resolve);
    });
  }

  async storeSession(session) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ supabase_session: session }, resolve);
    });
  }

  async refreshSession() {
    try {
      const session = await this.getStoredSession();
      if (!session || !session.refresh_token) {
        throw new Error('No refresh token available');
      }

      console.log('Refreshing session with refresh token in background...');
      const response = await fetch(`${this.client.url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.client.key,
          'Authorization': `Bearer ${this.client.key}`
        },
        body: JSON.stringify({
          refresh_token: session.refresh_token
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Token refresh failed in background:', response.status, errorData);
        throw new Error(errorData.error_description || 'Token refresh failed');
      }

      const data = await response.json();
      console.log('Token refresh successful in background, updating session...');
      
      // Update session with new tokens
      const updatedSession = {
        ...session,
        access_token: data.access_token,
        refresh_token: data.refresh_token || session.refresh_token,
        expires_at: Date.now() + (data.expires_in * 1000)
      };

      await this.storeSession(updatedSession);
      return { data: { session: updatedSession }, error: null };
    } catch (error) {
      console.error('Session refresh error in background:', error);
      return { data: null, error };
    }
  }
}

class SimpleTableClient {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.selectColumns = '*';
    this.filters = [];
    this.operation = 'select'; // Default operation
    console.log('SimpleTableClient created for table:', table);
  }

  // Helper method to handle expired tokens by refreshing and retrying
  async handleExpiredToken(apiCall) {
    try {
      // First attempt
      return await apiCall();
    } catch (error) {
      // Check if error is due to expired token (401 Unauthorized)
      if (error.message && error.message.includes('401') || 
          error.message && error.message.includes('expired') ||
          error.message && error.message.includes('unauthorized')) {
        
        console.log('Token appears expired, attempting refresh and retry...');
        
        // Try to refresh the session
        try {
          const { data: { session } } = await this.client.auth.getSession();
          if (session && session.access_token) {
            // Retry the API call with refreshed token
            try {
              return await apiCall();
            } catch (retryError) {
              console.error('API call failed even after token refresh:', retryError);
              throw retryError;
            }
          } else {
            // No valid session after refresh, user may have logged out
            console.log('No valid session after refresh, user may have logged out');
            throw new Error('User not authenticated');
          }
        } catch (refreshError) {
          console.log('Session refresh failed, user may have logged out:', refreshError.message);
          throw new Error('Authentication failed');
        }
      }
      throw error;
    }
  }

  select(columns = '*') {
    console.log('select method called with columns:', columns);
    this.selectColumns = columns;
    this.operation = 'select';
    return this;
  }

  eq(column, value) {
    console.log('eq method called with:', column, value);
    if (!this.filters) this.filters = [];
    this.filters.push({ column, value, operator: 'eq' });
    return this;
  }

  insert(data) {
    console.log('insert method called with data:', data);
    this.insertData = data;
    this.operation = 'insert';
    return this;
  }

  upsert(data) {
    console.log('upsert method called with data:', data);
    this.upsertData = data;
    this.operation = 'upsert';
    return this;
  }

  async execute() {
    console.log('execute method called, operation:', this.operation);
    if (this.operation === 'select') {
      return this.executeSelect();
    } else if (this.operation === 'insert') {
      return this.executeInsert();
    } else if (this.operation === 'upsert') {
      return this.executeUpsert();
    }
    throw new Error('Unknown operation');
  }

  async executeSelect() {
    return this.handleExpiredToken(async () => {
      try {
        // Get the current session for the access token
        const session = await this.client.auth.getStoredSession();
        if (!session || !session.access_token) {
          throw new Error('No valid session found');
        }

        let url = `${this.client.url}/rest/v1/${this.table}`;
        
        // Add select columns
        if (this.selectColumns && this.selectColumns !== '*') {
          url += `?select=${this.selectColumns}`;
        } else {
          url += '?select=*';
        }

        // Add filters
        if (this.filters && this.filters.length > 0) {
          const filterParams = this.filters.map(f => `${f.column}=eq.${encodeURIComponent(f.value)}`).join('&');
          url += url.includes('?') ? `&${filterParams}` : `?${filterParams}`;
        }

        console.log('Executing select query:', url);

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'apikey': this.client.key,
            'Authorization': `Bearer ${session.access_token}`
          }
        });

        if (!response.ok) {
          const errorData = await response.json();
          console.error('Select query failed:', response.status, errorData);
          throw new Error(errorData.message || `Select query failed with status ${response.status}`);
        }

        const result = await response.json();
        console.log('Select query result:', result);
        return { data: result, error: null };
      } catch (error) {
        console.error('Select query error:', error);
        return { data: null, error };
      }
    });
  }

  async executeInsert() {
    return this.handleExpiredToken(async () => {
      try {
        // Get the current session for the access token
        const session = await this.client.auth.getStoredSession();
        if (!session || !session.access_token) {
          throw new Error('No valid session found');
        }

        console.log('Inserting with session:', { 
          hasSession: !!session, 
          hasToken: !!session.access_token,
          tokenLength: session.access_token?.length 
        });

        const response = await fetch(`${this.client.url}/rest/v1/${this.table}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': this.client.key,
            'Authorization': `Bearer ${session.access_token}`,
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(this.insertData)
        });

        console.log('Insert response status:', response.status);
        console.log('Insert response headers:', Object.fromEntries(response.headers.entries()));

        if (!response.ok) {
          const errorData = await response.json();
          console.error('Insert failed:', errorData);
          throw new Error(errorData.message || 'Insert failed');
        }

        const result = await response.json();
        return { data: result, error: null };
      } catch (error) {
        console.error('Insert error:', error);
        return { data: null, error };
      }
    });
  }

  async executeUpsert() {
    return this.handleExpiredToken(async () => {
      try {
        // Get the current session for the access token
        const session = await this.client.auth.getStoredSession();
        if (!session || !session.access_token) {
          throw new Error('No valid session found');
        }

        console.log('Upserting with session:', { 
          hasSession: !!session, 
          hasToken: !!session.access_token,
          tokenLength: session.access_token?.length 
        });

        const response = await fetch(`${this.client.url}/rest/v1/${this.table}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': this.client.key,
            'Authorization': `Bearer ${session.access_token}`,
            'Prefer': 'return=representation,resolution=merge-duplicates'
          },
          body: JSON.stringify(this.upsertData)
        });

        console.log('Upsert response status:', response.status);
        console.log('Upsert response headers:', Object.fromEntries(response.headers.entries()));

        if (!response.ok) {
          const errorData = await response.json();
          console.error('Upsert failed:', errorData);
          throw new Error(errorData.message || 'Upsert failed');
        }

        const result = await response.json();
        return { data: result, error: null };
      } catch (error) {
        console.error('Upsert error:', error);
        return { data: null, error };
      }
    });
  }
}

// Create the Supabase client instance
const supabase = new SimpleSupabaseClient(supabaseUrl, supabaseKey);
console.log('Supabase client instance created:', supabase);
console.log('Supabase client methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(supabase)));

// Set up proactive token refresh to prevent expiration
let tokenRefreshInterval = null;

const setupTokenRefresh = () => {
  // Clear any existing interval first
  if (tokenRefreshInterval) {
    clearInterval(tokenRefreshInterval);
    console.log('Cleared existing token refresh interval');
  }
  
  // Check and refresh tokens every 50 minutes (tokens typically expire after 1 hour)
  tokenRefreshInterval = setInterval(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && session.refresh_token) {
        // If token expires in less than 10 minutes, refresh it proactively
        const timeUntilExpiry = session.expires_at - Date.now();
        if (timeUntilExpiry < 10 * 60 * 1000) { // Less than 10 minutes
          console.log('Token expires soon, proactively refreshing...');
          await supabase.auth.refreshSession();
        }
      } else {
        // No valid session, stop the interval
        console.log('No valid session found, stopping token refresh interval');
        clearInterval(tokenRefreshInterval);
        tokenRefreshInterval = null;
      }
    } catch (error) {
      console.error('Proactive token refresh check failed:', error);
      // If refresh fails, it might mean user logged out, so stop trying
      if (error.message && error.message.includes('No refresh token available')) {
        console.log('No refresh token available, user may have logged out, stopping interval');
        clearInterval(tokenRefreshInterval);
        tokenRefreshInterval = null;
      }
    }
  }, 50 * 60 * 1000); // Check every 50 minutes
  
  console.log('Token refresh interval started');
  return tokenRefreshInterval;
};

// Start the proactive token refresh mechanism
setupTokenRefresh();

// Monitor for session changes to automatically handle login/logout cycles
const monitorSessionChanges = () => {
  let lastSessionState = null;
  
  // Check session state every 30 seconds
  setInterval(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const currentSessionState = !!session;
      
      // If session state changed
      if (lastSessionState !== currentSessionState) {
        if (currentSessionState && !lastSessionState) {
          // User just logged in
          console.log('Session detected, user logged in, restarting token refresh...');
          setupTokenRefresh();
        } else if (!currentSessionState && lastSessionState) {
          // User just logged out
          console.log('Session lost, user logged out, stopping token refresh...');
          if (tokenRefreshInterval) {
            clearInterval(tokenRefreshInterval);
            tokenRefreshInterval = null;
          }
        }
        
        lastSessionState = currentSessionState;
      }
    } catch (error) {
      console.error('Error monitoring session changes:', error);
    }
  }, 30 * 1000); // Check every 30 seconds
};

// Start session monitoring
monitorSessionChanges();

// Add logout handler to clean up background processes
const handleLogout = async () => {
  try {
    console.log('User logged out, cleaning up background processes...');
    
    // Clear any stored session data
    await supabase.auth.clearStoredSession();
    
    // Stop the proactive token refresh
    if (tokenRefreshInterval) {
      clearInterval(tokenRefreshInterval);
      tokenRefreshInterval = null;
      console.log('Stopped proactive token refresh');
    }
    
    console.log('Logout cleanup completed');
  } catch (error) {
    console.error('Error during logout cleanup:', error);
  }
};

// Helper functions for authentication
async function getCurrentUser() {
  try {
    console.log('Getting current user...');
    const { data: { user } } = await supabase.auth.getUser();
    console.log('Current user result:', { user });
    return user;
  } catch (error) {
    console.error('Error getting current user:', error);
    return null;
  }
}

async function isAuthenticated() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return !!session;
  } catch (error) {
    console.error('Error checking authentication:', error);
    return false;
  }
}

// Enhanced authentication check that handles logout scenarios
async function checkAuthenticationStatus() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return { isAuthenticated: false, reason: 'No session found' };
    }
    
    if (session.expires_at <= Date.now()) {
      if (session.refresh_token) {
        // Try to refresh the token
        try {
          const refreshResult = await supabase.auth.refreshSession();
          if (refreshResult.data && refreshResult.data.session) {
            return { isAuthenticated: true, reason: 'Session refreshed' };
          } else {
            return { isAuthenticated: false, reason: 'Token refresh failed' };
          }
        } catch (refreshError) {
          return { isAuthenticated: false, reason: 'Token refresh error' };
        }
      } else {
        return { isAuthenticated: false, reason: 'No refresh token available' };
      }
    }
    
    return { isAuthenticated: true, reason: 'Valid session' };
  } catch (error) {
    console.error('Error checking authentication status:', error);
    return { isAuthenticated: false, reason: 'Error occurred' };
  }
}

// When the extension saves a new profile, mark it as confirmed in the user's profile
chrome.runtime.onMessage.addListener((message, sender) => {
  console.log("Background script received message:", message);
  
  if (message.type === "ping") {
    console.log("Ping received - service worker is awake");
    // Just wake up the service worker
    return;
  }

  if (message.type === "logout") {
    console.log("Logout message received, cleaning up...");
    handleLogout();
    return;
  }

  if (message.type === "login") {
    console.log("Login message received, restarting token refresh...");
    // Restart the proactive token refresh mechanism
    setupTokenRefresh();
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

// Function to save profile to Supabase
async function saveProfileToSupabase(profileUrl, tabId) {
  console.log('Attempting to save profile URL:', profileUrl);
  
  try {
    // Get current user from Supabase session
    const user = await getCurrentUser();
    if (!user) {
      console.error('No authenticated user found');
      chrome.tabs.sendMessage(tabId, { action: "hideLoader" });
      chrome.tabs.sendMessage(tabId, {
        action: "showPopup",
        message: "❌ Please sign in to your account first!",
        bgColor: "#e74c3c"
      });
      return;
    }

    console.log('User authenticated:', user.email, 'User ID:', user.id);
    console.log('Full user object:', user);
    
    // Also check the session directly
    const { data: { session } } = await supabase.auth.getSession();
    console.log('Current session:', session);
    
    // First check if profile already exists
    console.log('Checking for existing profile...');
    
    const tableClient = supabase.from('profiles');
    console.log('Table client returned:', tableClient);
    console.log('Table client type:', typeof tableClient);
    console.log('Table client methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(tableClient)));
    console.log('Table client has select method:', typeof tableClient.select);
    
    const { data: existingProfiles, error: checkError } = await tableClient
      .select('id')
      .eq('user_id', user.id)
      .eq('profile_url', profileUrl)
      .execute();

    console.log('Existing profiles check result:', { existingProfiles, checkError });

    if (checkError) {
      console.error('Error checking for existing profile:', checkError);
      chrome.tabs.sendMessage(tabId, { action: "hideLoader" });
      chrome.tabs.sendMessage(tabId, {
        action: "showPopup",
        message: "❌ Error checking for duplicates",
        bgColor: "#e74c3c"
      });
      return;
    }

    if (existingProfiles && existingProfiles.length > 0) {
      // Profile already exists
      console.log('Profile already exists, skipping insertion');
      chrome.tabs.sendMessage(tabId, { action: "hideLoader" });
      chrome.tabs.sendMessage(tabId, {
        action: "showPopup",
        message: "ℹ️ Profile already saved",
        bgColor: "#e74c3c"
      });
      return;
    }
    
    // Profile doesn't exist, proceed with insertion
    console.log('Profile does not exist, proceeding with insertion');
    
    // Save to Supabase
    const body = {
      user_id: user.id,
      profile_url: profileUrl,
      saved_at: new Date().toISOString()
    };
    if (latestExtractedName) body.profile_name = latestExtractedName;
    if (latestExtractedImage) body.profile_image_url = latestExtractedImage;
    
    console.log('Inserting profile with data:', body);
    
    const insertResult = await supabase
      .from('profiles')
      .insert(body)
      .execute();

    console.log('Insert result:', insertResult);
    
    const { data, error } = insertResult;

    chrome.tabs.sendMessage(tabId, { action: "hideLoader" });
    
    if (error) {
      console.error('Supabase error:', error);
      
      if (error.code === 'PGRST116') {
        chrome.tabs.sendMessage(tabId, {
          action: "showPopup",
          message: "❌ Permission denied. Check your account setup.",
          bgColor: "#e74c3c"
        });
      } else if (error.code === '23505') {
        chrome.tabs.sendMessage(tabId, {
          action: "showPopup",
          message: "❌ Profile already exists",
          bgColor: "#e74c3c"
        });
      } else {
        chrome.tabs.sendMessage(tabId, {
          action: "showPopup",
          message: `❌ Failed to Save (${error.code})`,
          bgColor: "#e74c3c"
        });
      }
    } else {
      console.log('Profile saved successfully:', data);
      chrome.tabs.sendMessage(tabId, {
        action: "showPopup",
        message: "✅ Profile Saved",
        bgColor: "#0a66c2"
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


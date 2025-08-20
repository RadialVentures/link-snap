console.log("background.js starting...");

// Supabase client configuration for Chrome extension
const supabaseUrl = 'https://ynmlvuadmjldoupujeib.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlubWx2dWFkbWpsZG91cHVqZWliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA5NTkzMzYsImV4cCI6MjA2NjUzNTMzNn0.vifa6z50XCItrH1zqK7xsRKUUIjD_ZAsUC-EfLwTmf4';

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
  }

  async executeInsert() {
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
  }

  async executeUpsert() {
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
  }
}

// Create the Supabase client instance
const supabase = new SimpleSupabaseClient(supabaseUrl, supabaseKey);
console.log('Supabase client instance created:', supabase);
console.log('Supabase client methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(supabase)));

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

// When the extension saves a new profile, mark it as confirmed in the user's profile
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


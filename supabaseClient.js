// Supabase client configuration for Chrome extension
const supabaseUrl = 'https://vqwcdrtnnnykkuaxuaqd.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZxd2NkcnRubm55a2t1YXh1YXFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU5MzIzNTMsImV4cCI6MjA3MTUwODM1M30.9Jk6UFw9YHyIwxU9jeaSmne0NcfQVONEQCIzwVNPaM0';

// Create a simple Supabase client implementation
class SimpleSupabaseClient {
  constructor(url, key) {
    this.url = url;
    this.key = key;
    this.auth = new SimpleAuthClient(this);
  }

  async from(table) {
    return new SimpleTableClient(this, table);
  }
}

class SimpleAuthClient {
  constructor(client) {
    this.client = client;
  }

  async signInWithPassword(credentials) {
    try {
      const response = await fetch(`${this.client.url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.client.key,
          'Authorization': `Bearer ${this.client.key}`
        },
        body: JSON.stringify({
          email: credentials.email,
          password: credentials.password
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error_description || 'Authentication failed');
      }

      const data = await response.json();
      console.log('Auth response:', data);
      
      // Store the session in chrome storage
      const session = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + (data.expires_in * 1000),
        user: {
          id: data.user.id,
          email: data.user.email
        }
      };

      await this.storeSession(session);

      return { data: { session, user: data.user }, error: null };
    } catch (error) {
      console.error('Auth error:', error);
      return { data: null, error };
    }
  }

  async getSession() {
    try {
      const session = await this.getStoredSession();
      if (session && session.expires_at > Date.now()) {
        return { data: { session }, error: null };
      }
      
      // If session is expired but we have a refresh token, try to refresh it
      if (session && session.refresh_token && session.expires_at <= Date.now()) {
        console.log('Session expired, attempting to refresh...');
        const refreshResult = await this.refreshSession();
        if (refreshResult.data && refreshResult.data.session) {
          console.log('Session refreshed successfully');
          return { data: { session: refreshResult.data.session }, error: null };
        } else {
          console.log('Session refresh failed, clearing expired session');
          await this.clearStoredSession();
          return { data: { session: null }, error: null };
        }
      }
      
      return { data: { session: null }, error: null };
    } catch (error) {
      return { data: { session: null }, error };
    }
  }

  async refreshSession() {
    try {
      const session = await this.getStoredSession();
      if (!session || !session.refresh_token) {
        throw new Error('No refresh token available');
      }

      console.log('Refreshing session with refresh token...');
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
        console.error('Token refresh failed:', response.status, errorData);
        throw new Error(errorData.error_description || 'Token refresh failed');
      }

      const data = await response.json();
      console.log('Token refresh successful, updating session...');
      
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
      console.error('Session refresh error:', error);
      return { data: null, error };
    }
  }

  async getUser() {
    try {
      const session = await this.getStoredSession();
      if (session && session.user) {
        // Check if session is expired and try to refresh if needed
        if (session.expires_at <= Date.now() && session.refresh_token) {
          console.log('Session expired in getUser, attempting to refresh...');
          const refreshResult = await this.refreshSession();
          if (refreshResult.data && refreshResult.data.session) {
            return { data: { user: refreshResult.data.session.user }, error: null };
          } else {
            // Refresh failed, clear session
            await this.clearStoredSession();
            return { data: { user: null }, error: null };
          }
        }
        return { data: { user: session.user }, error: null };
      }
      return { data: { user: null }, error: null };
    } catch (error) {
      return { data: { user: null }, error };
    }
  }

  async signOut() {
    try {
      await this.clearStoredSession();
      return { error: null };
    } catch (error) {
      return { error };
    }
  }

  async storeSession(session) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ 'supabase_session': session }, resolve);
    });
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
}

class SimpleTableClient {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.selectColumns = '*';
    this.filters = [];
  }

  select(columns = '*') {
    this.selectColumns = columns;
    return this;
  }

  eq(column, value) {
    if (!this.filters) this.filters = [];
    this.filters.push({ column, value, operator: 'eq' });
    return this;
  }

  async insert(data) {
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
        body: JSON.stringify(data)
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

  async execute() {
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

      console.log('Executing query:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'apikey': this.client.key,
          'Authorization': `Bearer ${session.access_token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Query failed:', response.status, errorData);
        throw new Error(errorData.message || `Query failed with status ${response.status}`);
      }

      const result = await response.json();
      console.log('Query result:', result);
      return { data: result, error: null };
    } catch (error) {
      console.error('Query error:', error);
      return { data: null, error };
    }
  }
}

// Create the Supabase client instance
const supabase = new SimpleSupabaseClient(supabaseUrl, supabaseKey);

// Helper function to check if user is authenticated
const isAuthenticated = async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return !!session;
  } catch (error) {
    console.error('Error checking authentication:', error);
    return false;
  }
};

// Helper function to get current user
const getCurrentUser = async () => {
  try {
    console.log('Getting current user...');
    const { data: { user } } = await supabase.auth.getUser();
    console.log('Current user result:', { user });
    return user;
  } catch (error) {
    console.error('Error getting current user:', error);
    return null;
  }
};

// Helper function to sign out
const signOut = async () => {
  try {
    await supabase.auth.signOut();
    return true;
  } catch (error) {
    console.error('Error signing out:', error);
    return false;
  }
};

// Export the client getter function
const getSupabaseClient = async () => {
  return supabase;
};

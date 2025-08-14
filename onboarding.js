// Check for existing token on page load
window.addEventListener('load', () => {
  chrome.storage.local.get('supabaseToken', (data) => {
    if (data.supabaseToken) {
      // User is already connected
      document.getElementById('onboardingSection').style.display = 'none';
      document.getElementById('connectedSection').style.display = 'block';
    }
  });
});

// Handle form submission for token connection
document.getElementById("connectionForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  // Normalize token: remove all whitespace characters to avoid invalid base64url errors
  const rawToken = document.getElementById("userToken").value;
  const userToken = rawToken ? rawToken.replace(/\s+/g, '').trim() : '';
  const statusMessage = document.getElementById("statusMessage");

  // Basic validation: must be JWT-like with 3 base64url segments
  const isBase64Url = (s) => /^[A-Za-z0-9_-]+$/.test(s || '');
  const parts = (userToken || '').split('.');
  const looksLikeJwt = parts.length === 3 && isBase64Url(parts[0]) && isBase64Url(parts[1]) && isBase64Url(parts[2]);

  if (!userToken || !looksLikeJwt) {
    statusMessage.innerText = "Please enter a valid token.";
    statusMessage.className = "status-error";
    statusMessage.style.display = "block";
    return;
  }

  statusMessage.innerText = "Connecting...";
  statusMessage.className = "";
  statusMessage.style.display = "block";
  statusMessage.style.color = "var(--primary)";
  statusMessage.style.background = "var(--background)";
  statusMessage.style.border = "1px solid var(--border)";

  try {
    // Store the token
    await chrome.storage.local.set({ supabaseToken: userToken });
    
    // Test the token by making a simple request to Supabase
    // This validates both the token format and that it belongs to a valid user
    const testResponse = await fetch('https://ynmlvuadmjldoupujeib.supabase.co/rest/v1/profiles?select=count', {
      method: 'GET',
      headers: {
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlubWx2dWFkbWpsZG91cHVqZWliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA5NTkzMzYsImV4cCI6MjA2NjUzNTMzNn0.vifa6z50XCItrH1zqK7xsRKUUIjD_ZAsUC-EfLwTmf4',
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (testResponse.ok) {
      // Mark the token as confirmed in the user's profile (for reconnection verification)
      try {
        const tokenParts = userToken.split('.');
        if (tokenParts.length === 3) {
          const payload = JSON.parse(atob(tokenParts[1]));
          const userId = payload.sub;
          if (userId) {
            const flagResp = await fetch('https://ynmlvuadmjldoupujeib.supabase.co/rest/v1/user_profiles', {
              method: 'POST',
              headers: {
                'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlubWx2dWFkbWpsZG91cHVqZWliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA5NTkzMzYsImV4cCI6MjA2NjUzNTMzNn0.vifa6z50XCItrH1zqK7xsRKUUIjD_ZAsUC-EfLwTmf4',
                'Authorization': `Bearer ${userToken}`,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates'
              },
              body: JSON.stringify({
                user_id: userId,
                extension_token_confirmed: true
              })
            });
            if (!flagResp.ok) {
              const text = await flagResp.text();
              console.warn('Failed to set extension_token_confirmed:', flagResp.status, text);
            } else {
              console.log('extension_token_confirmed set successfully');
            }
          }
        }
      } catch (flagErr) {
        console.warn('Could not set extension_token_confirmed flag:', flagErr);
      }

      statusMessage.innerHTML = "&#9989; Connected successfully!";
      statusMessage.className = "status-success";
      
      // Show success section
      setTimeout(() => {
        document.getElementById('onboardingSection').style.display = 'none';
        document.getElementById('connectedSection').style.display = 'block';
      }, 1000);
    } else {
      throw new Error('Invalid token');
    }
  } catch (error) {
    console.error("Error connecting account:", error);
    statusMessage.innerHTML = "&#10060; Invalid token. Please check your token and try again.";
    statusMessage.className = "status-error";
    statusMessage.style.display = "block";
  }
}); 

// Check for existing session on page load
window.addEventListener('load', async () => {
  // Hide loading indicator immediately since we don't need to wait for CDN
  document.getElementById('loadingIndicator').style.display = 'none';
  
  // Check for existing session
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      // User is already connected
      document.getElementById('onboardingSection').style.display = 'none';
      document.getElementById('connectedSection').style.display = 'block';
      updateUserInfo(session.user);
    } else {
      // No session, show onboarding section
      document.getElementById('onboardingSection').style.display = 'block';
    }
  } catch (error) {
    console.error('Error checking session on load:', error);
    // Show onboarding section on error
    document.getElementById('onboardingSection').style.display = 'block';
  }
});

// Handle form submission for authentication
document.getElementById("connectionForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.getElementById("userEmail").value;
  const password = document.getElementById("userPassword").value;
  const statusMessage = document.getElementById("statusMessage");

  if (!email || !password) {
    statusMessage.innerText = "Please enter both email and password.";
    statusMessage.className = "status-error";
    statusMessage.style.display = "block";
    return;
  }

  statusMessage.innerText = "Signing in...";
  statusMessage.className = "";
  statusMessage.style.display = "block";
  statusMessage.style.color = "var(--primary)";
  statusMessage.style.background = "var(--background)";
  statusMessage.style.border = "1px solid var(--border)";

  try {
    console.log('Attempting to sign in with:', { email });

    // Sign in with Supabase
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password
    });

    console.log('Sign in response:', { data, error });

    if (error) {
      throw error;
    }

    if (data.session) {
      // Successfully authenticated
      statusMessage.innerHTML = "&#9989; Connected successfully!";
      statusMessage.className = "status-success";
      
      // Update user_profiles table to mark extension as connected
      console.log('Attempting to update user profile for user ID:', data.user.id);
      
      try {
        // Make direct REST API call to update user_profiles table
        const response = await fetch('https://vqwcdrtnnnykkuaxuaqd.supabase.co/rest/v1/user_profiles?user_id=eq.' + data.user.id, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZxd2NkcnRubm55a2t1YXh1YXFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU5MzIzNTMsImV4cCI6MjA3MTUwODM1M30.9Jk6UFw9YHyIwxU9jeaSmne0NcfQVONEQCIzwVNPaM0',
            'Authorization': `Bearer ${data.session.access_token}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            has_onboarded_extension: true,
            updated_at: new Date().toISOString()
          })
        });

        if (response.ok) {
          console.log('User profile updated successfully - extension now connected!');
          // Update status message to show connection success
          statusMessage.innerHTML = "&#9989; Extension connected to Virtual Newsroom!";
        } else {
          const errorData = await response.json();
          console.error('Failed to update user profile:', errorData);
        }
      } catch (profileErr) {
        console.error('Error updating user profile:', profileErr);
        // Don't fail the connection, just log the error
      }
      
      // Show success section
      setTimeout(() => {
        document.getElementById('onboardingSection').style.display = 'none';
        document.getElementById('connectedSection').style.display = 'block';
        updateUserInfo(data.user);
      }, 1000);
    } else {
      throw new Error('No session created');
    }
  } catch (error) {
    console.error("Error signing in:", error);
    console.error("Error details:", {
      message: error.message,
      code: error.code,
      status: error.status,
      name: error.name
    });
    
    let errorMessage = "Sign in failed. Please check your credentials.";
    
    if (error.message.includes('Invalid login credentials')) {
      errorMessage = "Invalid email or password. Please try again.";
    } else if (error.message.includes('Email not confirmed')) {
      errorMessage = "Please confirm your email address before signing in.";
    } else if (error.message.includes('fetch')) {
      errorMessage = "Network error. Please check your internet connection.";
    }
    
    statusMessage.innerHTML = `&#10060; ${errorMessage}`;
    statusMessage.className = "status-error";
    statusMessage.style.display = "block";
  }
});

// Function to update user info display
function updateUserInfo(user) {
  const userInfoDiv = document.getElementById('userInfo');
  if (userInfoDiv && user) {
    userInfoDiv.innerHTML = `
      <div style="text-align: center; margin-bottom: 20px;">
        <div style="font-size: 1.2em; font-weight: 600; margin-bottom: 10px;">
          Welcome, ${user.email}
        </div>
        <div style="font-size: 0.9em; color: #666;">
          User ID: ${user.id}
        </div>
      </div>
    `;
  }
}

 

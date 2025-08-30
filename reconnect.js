document.addEventListener('DOMContentLoaded', () => {
  const openVNR = document.getElementById('openVNR');
  const openOnboarding = document.getElementById('openOnboarding');

  const virtualNewsroomUrl = 'https://virtual-newsroom-radial.vercel.app/';

  openVNR?.addEventListener('click', () => {
    chrome.tabs.create({ url: virtualNewsroomUrl });
  });

  openOnboarding?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  });
  
  // Set the confirmation flag when a new token is saved (more reliable)
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !changes.supabaseToken || !changes.supabaseToken.newValue) return;
    try {
      const supabaseToken = (changes.supabaseToken.newValue || '').replace(/\s+/g, '');
      const parts = supabaseToken.split('.');
      if (parts.length !== 3) return;
      const payload = JSON.parse(atob(parts[1]));
      const userId = payload.sub;
      if (!userId) return;
      const resp = await fetch('https://vqwcdrtnnnykkuaxuaqd.supabase.co/rest/v1/user_profiles', {
        method: 'POST',
        headers: {
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZxd2NkcnRubm55a2t1YXh1YXFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU5MzIzNTMsImV4cCI6MjA3MTUwODM1M30.9Jk6UFw9YHyIwxU9jeaSmne0NcfQVONEQCIzwVNPaM0',
          'Authorization': `Bearer ${supabaseToken}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({ user_id: userId, extension_token_confirmed: true })
      });
      if (!resp.ok) {
        const text = await resp.text();
        console.warn('Failed to set extension_token_confirmed from reconnect (onChanged):', resp.status, text);
      } else {
        console.log('extension_token_confirmed set successfully from reconnect (onChanged)');
      }
    } catch (e) {
      console.warn('Failed to set confirmation flag from reconnect page (onChanged):', e);
    }
  });
});



chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "showSuccess") {
    playSuccessSound();
    showPopup("✔ Profile Saved", "#0a66c2"); 
  } else if (msg.action === "showFailure") {
    showPopup("❌ Failed to Save", "#c20a0a");
  } else if (msg.action === "showLoader") {
    showLoader();
  } else if (msg.action === "hideLoader") {
    hideLoader();
  } else if (msg.action === "showPopup") { // Generic popup for custom messages
    showPopup(msg.message, msg.bgColor);
  } else if (msg.action === "extractProfileName" || msg.action === "getProfileName") {
    const attempt = () => {
      try {
        const name = extractLinkedInDisplayName();
        const image = extractLinkedInProfileImageUrl();
        chrome.runtime.sendMessage({ action: "profileInfoExtracted", name, image });
        chrome.runtime.sendMessage({ action: "profileNameExtracted", name });
      } catch (e) {
        chrome.runtime.sendMessage({ action: "profileInfoExtracted", name: null, image: null });
        chrome.runtime.sendMessage({ action: "profileNameExtracted", name: null });
      }
    };
    // Try now and once more shortly after to catch lazy loads
    attempt();
    setTimeout(attempt, 800);
  }
});



// Loader UI
function showLoader() {
  if (document.getElementById("profileSaveLoader")) return;

  const loader = document.createElement("div");
  loader.id = "profileSaveLoader";
  loader.innerHTML = `
    <div style="
      border: 6px solid #f3f3f3;
      border-top: 6px solid #0a66c2;
      border-radius: 50%;
      width: 48px;
      height: 48px;
      animation: spin 1s linear infinite;
    "></div>
  `;
  Object.assign(loader.style, {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    zIndex: "9999",
    padding: "20px",
    background: "rgba(255,255,255,0.9)",
    borderRadius: "12px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
  });

  const style = document.createElement("style");
  style.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(loader);
}

function hideLoader() {
  const loader = document.getElementById("profileSaveLoader");
  if (loader) loader.remove();
}

// Sound function
function playSuccessSound() {
  const audio = new Audio(chrome.runtime.getURL("success.mp3"));
  audio.volume = 0.5;
  audio.play().catch((err) => console.error("Sound error:", err));
}

// POPUP UI (centered)
function showPopup(message = "✅ Success", bgColor = "#0a66c2") {
  const popup = document.createElement("div");
  popup.textContent = message;

  Object.assign(popup.style, {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    backgroundColor: bgColor,
    color: "#fff",
    padding: "14px 28px",
    borderRadius: "10px",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.2)",
    fontSize: "16px",
    fontWeight: "bold",
    zIndex: 999999,
    textAlign: "center",
    opacity: "0",
    transition: "opacity 0.3s ease",
    fontFamily: "Inter, sans-serif"
  });

  document.body.appendChild(popup);
  requestAnimationFrame(() => (popup.style.opacity = "1"));

  setTimeout(() => {
    popup.style.opacity = "0";
    setTimeout(() => popup.remove(), 300);
  }, 2000);
}

// Heuristics to extract LinkedIn display name/company from the page
function extractLinkedInDisplayName() {
  const isCompanyPath = /\/company\//.test(location.pathname || '');

  // 1) og:title (works well on most pages)
  const og = document.querySelector("meta[property='og:title']");
  const fromOg = og?.getAttribute('content')?.split('|')[0]?.split(' - ')[0]?.trim();
  if (fromOg && fromOg.length > 1) return fromOg;

  // 2) JSON-LD with preference: Person > Organization (unless company page)
  let personName = null;
  let orgName = null;
  const ld = Array.from(document.querySelectorAll("script[type='application/ld+json']"));
  for (const s of ld) {
    try {
      const data = JSON.parse(s.textContent || '{}');
      const consider = (node) => {
        if (!node || typeof node !== 'object') return;
        const t = node['@type'];
        const n = node.name;
        if (!n) return;
        if (t === 'Person' && !personName) personName = n;
        if (t === 'Organization' && !orgName) orgName = n;
      };
      if (Array.isArray(data)) {
        for (const d of data) consider(d);
      } else {
        consider(data);
      }
    } catch {}
  }
  if (!isCompanyPath && personName) return personName;
  if (isCompanyPath && orgName) return orgName;
  if (personName) return personName;
  // On person pages, avoid falling back to organization name

  // 3) DOM fallbacks (try profile top-card titles first)
  const domCandidates = [
    '.top-card-layout__title',
    '.pv-text-details__left-panel h1',
    'main h1',
    'h1'
  ];
  for (const sel of domCandidates) {
    const el = document.querySelector(sel);
    const txt = el?.textContent?.trim();
    if (txt && txt.length > 1) return txt;
  }

  return null;
}

// Heuristics to extract LinkedIn profile/company image URL
function extractLinkedInProfileImageUrl() {
  const path = (location && location.pathname) ? location.pathname : '';
  const isCompanyPage = /\/company\//.test(path);
  // 1) og:image (and variants)
  const metaCandidates = [
    "meta[property='og:image']",
    "meta[property='og:image:secure_url']",
    "meta[property='og:image:url']",
    "meta[name='twitter:image']",
    "link[rel='image_src']"
  ];
  for (const sel of metaCandidates) {
    const el = document.querySelector(sel);
    const val = el?.getAttribute('content') || el?.getAttribute('href');
    if (val && /^https?:\/\//.test(val)) return val;
  }

  // 2) JSON-LD image / logo (collect for type-aware preference)
  const ld = Array.from(document.querySelectorAll("script[type='application/ld+json']"));
  const personImages = [];
  const orgLogos = [];
  for (const s of ld) {
    try {
      const data = JSON.parse(s.textContent || '{}');
      const tryImage = (img) => {
        if (!img) return null;
        if (typeof img === 'string') return img;
        if (typeof img === 'object') {
          return img.url || img.contentUrl || null;
        }
        return null;
      };
      const collect = (node) => {
        if (!node || typeof node !== 'object') return;
        const t = node['@type'];
        if (t === 'Person') {
          const u = tryImage(node?.image);
          if (u) personImages.push(u);
        } else if (t === 'Organization') {
          const u = tryImage(node?.logo) || tryImage(node?.image);
          if (u) orgLogos.push(u);
        }
      };
      if (Array.isArray(data)) {
        for (const d of data) collect(d);
      } else {
        collect(data);
      }
    } catch {}
  }
  if (isCompanyPage && orgLogos.length) return orgLogos[0];
  if (!isCompanyPage && personImages.length) return personImages[0];
  if (personImages.length) return personImages[0];
  if (orgLogos.length) return orgLogos[0];

  // Extract a normalized company name for alt-text matching (best-effort)
  let normalizedCompanyName = null;
  if (isCompanyPage) {
    const ogTitle = document.querySelector("meta[property='og:title']")?.getAttribute('content') || '';
    const namePart = ogTitle.split('|')[0].split(' - ')[0].trim();
    if (namePart) normalizedCompanyName = namePart.toLowerCase();
  }

  // 3) DOM fallbacks (separate person vs company selectors)
  const companyImgSel = [
    '.org-top-card-primary-content__logo img',
    '.org-top-card-summary__image img',
    'img.org-top-card-primary-content__logo',
    'img.org-top-card__logo',
    'section.org-top-card img[alt*="logo" i]',
    'section.org-top-card img[alt^="Logo"]',
    'section.org-top-card img[alt$="logo"]',
    'section.org-top-card img[srcset]',
    'section.org-top-card img[src]',
    'img[alt*="company logo" i]',
    'img.company-logo'
  ];
  const personImgSel = [
    'img.top-card__profile-image',
    'img.top-card-layout__entity-image',
    'img.contextual-sign-in-modal__img',
    'img.pv-top-card-profile-picture__image',
    'img.pv-top-card__photo',
    'img.presence-entity__image'
  ];

  const isInNav = (node) => !!node?.closest && !!node.closest('header, nav, .global-nav, #global-nav');

  // If on a company page, first pass: prefer alt texts that mention 'logo' or the company name
  if (isCompanyPage) {
    for (const sel of companyImgSel) {
      const elements = Array.from(document.querySelectorAll(sel));
      for (const el of elements) {
        if (isInNav(el)) continue;
        const alt = (el.getAttribute('alt') || '').toLowerCase();
        const likelyLogo = alt.includes('logo') || (normalizedCompanyName && alt.includes(normalizedCompanyName));
        if (!likelyLogo) continue;
        const srcset = el.getAttribute('srcset');
        if (srcset) {
          const best = pickLargestFromSrcset(srcset);
          if (best) return best;
        }
        const src = el.getAttribute('src') || el.getAttribute('data-delayed-url') || el.getAttribute('data-img-src') || el.getAttribute('data-src');
        if (src && /^https?:\/\//.test(src)) return src;
      }
    }
  }

  // Second pass: type-appropriate selectors first
  const ordered = isCompanyPage ? [...companyImgSel, ...personImgSel] : [...personImgSel];
  for (const sel of ordered) {
    const elements = Array.from(document.querySelectorAll(sel));
    for (const el of elements) {
      if (isInNav(el)) continue;
      // On person pages, avoid elements that look like logos or are inside org sections
      if (!isCompanyPage) {
        const alt = (el.getAttribute('alt') || '').toLowerCase();
        if (alt.includes('logo')) continue;
        if (el.closest && el.closest('section.org-top-card, .org-top-card-primary-content__logo, .org-top-card__logo')) continue;
      }
      const srcset = el.getAttribute('srcset');
      if (srcset) {
        const best = pickLargestFromSrcset(srcset);
        if (best) return best;
      }
      const src = el.getAttribute('src') || el.getAttribute('data-delayed-url') || el.getAttribute('data-img-src') || el.getAttribute('data-src');
      if (src && /^https?:\/\//.test(src)) return src;
    }
  }

  // 4) Background-image based logos (some company pages use CSS backgrounds)
  const bgLogoSelectors = [
    '.org-top-card-primary-content__logo',
    '.org-top-card__logo',
    'section.org-top-card .org-top-card__logo',
    'section.org-top-card div[style*="background-image"]',
    'div[role="img"][aria-label*="logo" i]',
    'div[aria-label*="logo" i]'
  ];
  for (const sel of bgLogoSelectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const inlineBg = el.style?.backgroundImage || '';
    const computedBg = !inlineBg ? getComputedStyle(el).backgroundImage : inlineBg;
    const urlMatch = computedBg && computedBg.match(/url\(("|')?(?<url>[^"')]+)("|')?\)/);
    const url = urlMatch?.groups?.url;
    if (url && /^https?:\/\//.test(url)) return url;
  }

  return null;
}

function pickLargestFromSrcset(srcset) {
  try {
    const entries = srcset.split(',').map(s => s.trim()).map(part => {
      const [url, size] = part.split(' ');
      const num = size && size.endsWith('w') ? parseInt(size) : 0;
      return { url, w: num };
    }).filter(e => e.url);
    entries.sort((a,b) => b.w - a.w);
    return entries[0]?.url || null;
  } catch { return null; }
}

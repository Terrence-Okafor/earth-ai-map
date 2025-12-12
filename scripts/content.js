// ============================================
// Earth Cinema - Content Script
// Injected into Google Earth pages
// ============================================

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'capture') {
    // Old canvas capture method - kept for reference but unreliable
    captureGoogleEarthCanvas()
      .then(imageData => sendResponse({ success: true, imageData }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (request.action === 'hideUI') {
    const hidden = hideUIElements();
    // Store reference globally so we can restore later
    window._earthCinemaHiddenElements = hidden;
    sendResponse({ success: true, hiddenCount: hidden.length });
    return true;
  }
  
  if (request.action === 'restoreUI') {
    if (window._earthCinemaHiddenElements) {
      restoreUIElements(window._earthCinemaHiddenElements);
      window._earthCinemaHiddenElements = null;
    }
    sendResponse({ success: true });
    return true;
  }
});

/**
 * Main capture function
 */
async function captureGoogleEarthCanvas() {
  console.log('[Earth Cinema] Starting capture...');
  
  // Find the main canvas
  const canvas = findGoogleEarthCanvas();
  if (!canvas) {
    throw new Error('Could not find Google Earth canvas. Make sure you\'re in 3D view.');
  }
  
  console.log('[Earth Cinema] Canvas found:', canvas.width, 'x', canvas.height);
  
  // Hide UI elements
  const hiddenElements = hideUIElements();
  
  // Wait for next frame to ensure UI is hidden
  await waitForFrame();
  await waitForFrame(); // Double frame wait for safety
  
  // Capture the canvas
  let imageData;
  try {
    imageData = await captureWebGLCanvas(canvas);
  } catch (error) {
    // Restore UI before throwing
    restoreUIElements(hiddenElements);
    throw error;
  }
  
  // Restore UI
  restoreUIElements(hiddenElements);
  
  console.log('[Earth Cinema] Capture complete');
  return imageData;
}

/**
 * Find the Google Earth WebGL canvas
 */
function findGoogleEarthCanvas() {
  // Try multiple selectors as Google Earth's DOM structure may vary
  const selectors = [
    'canvas.widget-scene-canvas',
    'canvas[data-eventpolicy]',
    'canvas.scene-canvas',
    '#scene canvas',
    '.scene canvas',
    'canvas'
  ];
  
  for (const selector of selectors) {
    const canvases = document.querySelectorAll(selector);
    for (const canvas of canvases) {
      // Look for the main WebGL canvas (usually the largest one)
      if (canvas.width > 100 && canvas.height > 100) {
        // Check if it has a WebGL context
        const gl = canvas.getContext('webgl') || 
                   canvas.getContext('webgl2') || 
                   canvas.getContext('experimental-webgl');
        if (gl || canvas.width > 500) {
          return canvas;
        }
      }
    }
  }
  
  // Fallback: find the largest canvas
  const allCanvases = document.querySelectorAll('canvas');
  let largest = null;
  let maxArea = 0;
  
  for (const canvas of allCanvases) {
    const area = canvas.width * canvas.height;
    if (area > maxArea) {
      maxArea = area;
      largest = canvas;
    }
  }
  
  return largest;
}

/**
 * Hide Google Earth UI elements for clean capture
 * Uses aggressive approach: hide everything except canvas and its container chain
 */
function hideUIElements() {
  const hiddenElements = [];
  
  // Find the main canvas
  const canvas = findGoogleEarthCanvas();
  if (!canvas) {
    console.log('[Earth Cinema] No canvas found, using selector-based hiding');
    return hideUIElementsBySelector();
  }
  
  // Strategy: Hide all siblings at each level from canvas up to body
  // This leaves only the canvas and its direct ancestor chain visible
  let current = canvas;
  const ancestorChain = new Set();
  
  // Build the ancestor chain (elements we should NOT hide)
  while (current && current !== document.body) {
    ancestorChain.add(current);
    current = current.parentElement;
  }
  
  // Now hide all elements that are NOT in the ancestor chain
  // Start from body's children and work down
  function hideNonAncestors(element) {
    if (!element || element === document.body) return;
    
    const children = element.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      
      // Skip the canvas and its ancestors
      if (ancestorChain.has(child)) {
        // Recurse into ancestors to hide their other children
        hideNonAncestors(child);
      } else {
        // Hide this element (it's not part of canvas chain)
        if (child.style.visibility !== 'hidden') {
          hiddenElements.push({
            element: child,
            originalVisibility: child.style.visibility,
            originalOpacity: child.style.opacity,
            originalPointerEvents: child.style.pointerEvents
          });
          child.style.visibility = 'hidden';
          child.style.opacity = '0';
          child.style.pointerEvents = 'none';
        }
      }
    }
  }
  
  hideNonAncestors(document.body);
  
  // Also hide any fixed/absolute positioned elements that might overlay
  const overlays = document.querySelectorAll('[style*="position: fixed"], [style*="position: absolute"], [style*="position:fixed"], [style*="position:absolute"]');
  overlays.forEach(el => {
    if (!ancestorChain.has(el) && el.style.visibility !== 'hidden') {
      hiddenElements.push({
        element: el,
        originalVisibility: el.style.visibility,
        originalOpacity: el.style.opacity,
        originalPointerEvents: el.style.pointerEvents
      });
      el.style.visibility = 'hidden';
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
    }
  });
  
  console.log(`[Earth Cinema] Hidden ${hiddenElements.length} UI elements (aggressive mode)`);
  return hiddenElements;
}

/**
 * Fallback: Hide UI elements by CSS selectors
 */
function hideUIElementsBySelector() {
  const hiddenElements = [];
  
  const uiSelectors = [
    '[class*="compass"]', '[class*="navigation"]', '[class*="zoom"]',
    '[class*="toolbar"]', '[class*="controls"]', '[class*="sidebar"]',
    '[class*="drawer"]', '[class*="menu"]', '[class*="panel"]',
    '[class*="search"]', '[class*="omnibox"]', '[class*="logo"]',
    '[class*="attribution"]', '[class*="watermark"]', '[class*="copyright"]',
    '[class*="overlay"]', '[class*="hud"]', '[class*="widget"]',
    '[class*="header"]', '[class*="footer"]', '[class*="bar"]',
    '.gmnoprint', '.gm-style-cc', '[role="button"]', '[role="toolbar"]',
    'header', 'footer'
  ];
  
  for (const selector of uiSelectors) {
    try {
      document.querySelectorAll(selector).forEach(el => {
        if (el.tagName !== 'CANVAS' && !el.querySelector('canvas')) {
          hiddenElements.push({
            element: el,
            originalVisibility: el.style.visibility,
            originalOpacity: el.style.opacity,
            originalPointerEvents: el.style.pointerEvents
          });
          el.style.visibility = 'hidden';
          el.style.opacity = '0';
        }
      });
    } catch (e) {}
  }
  
  console.log(`[Earth Cinema] Hidden ${hiddenElements.length} UI elements (selector mode)`);
  return hiddenElements;
}

/**
 * Restore hidden UI elements
 */
function restoreUIElements(hiddenElements) {
  for (const item of hiddenElements) {
    item.element.style.visibility = item.originalVisibility || '';
    item.element.style.opacity = item.originalOpacity || '';
    if (item.originalPointerEvents !== undefined) {
      item.element.style.pointerEvents = item.originalPointerEvents || '';
    }
  }
  console.log(`[Earth Cinema] Restored ${hiddenElements.length} UI elements`);
}

/**
 * Capture a WebGL canvas
 * Handles the preserveDrawingBuffer issue
 */
async function captureWebGLCanvas(canvas) {
  // Method 1: Try direct toDataURL (works if preserveDrawingBuffer is true)
  try {
    const dataUrl = canvas.toDataURL('image/png', 1.0);
    
    // Check if the capture is not blank
    if (!isBlankImage(dataUrl)) {
      console.log('[Earth Cinema] Direct capture successful');
      return dataUrl;
    }
  } catch (e) {
    console.log('[Earth Cinema] Direct capture failed:', e.message);
  }
  
  // Method 2: Try to capture on the next animation frame
  // This sometimes works even with preserveDrawingBuffer: false
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 10;
    
    function tryCapture() {
      requestAnimationFrame(() => {
        try {
          const dataUrl = canvas.toDataURL('image/png', 1.0);
          
          if (!isBlankImage(dataUrl)) {
            console.log(`[Earth Cinema] Frame capture successful (attempt ${attempts + 1})`);
            resolve(dataUrl);
            return;
          }
          
          attempts++;
          if (attempts < maxAttempts) {
            // Try again on next frame
            setTimeout(tryCapture, 50);
          } else {
            // Last resort: use the possibly blank image
            console.log('[Earth Cinema] Using fallback capture');
            resolve(dataUrl);
          }
        } catch (e) {
          reject(new Error('Canvas capture failed: ' + e.message));
        }
      });
    }
    
    tryCapture();
  });
}

/**
 * Check if a data URL represents a blank/transparent image
 */
function isBlankImage(dataUrl) {
  // A very small data URL usually indicates a blank image
  // Blank PNG is typically around 100-200 characters
  // Real images are much larger
  if (dataUrl.length < 5000) {
    return true;
  }
  return false;
}

/**
 * Wait for the next animation frame
 */
function waitForFrame() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

// Announce that content script is loaded
console.log('[Earth Cinema] Content script loaded');


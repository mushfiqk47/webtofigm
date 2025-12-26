/**
 * Chrome Extension Background Service Worker
 * Handles extension lifecycle and message routing
 */

// Log when extension is installed or updated
chrome.runtime.onInstalled.addListener((details) => {
    console.log('HTML to Figma Extension installed:', details.reason);
});

const IMAGE_TIMEOUT_MS = 8000;
const MAX_IMAGE_BYTES = 7_500_000; // ~7.5MB guard

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'captureComplete') {
        console.log('Capture complete:', request.layerCount, 'layers');
    }

    if (request.type === 'FETCH_IMAGE_BASE64') {
        fetchImageBase64(request.url).then(base64 => {
            sendResponse({ base64 });
        }).catch(err => {
            console.error('Failed to fetch image in background:', request.url, err);
            sendResponse({ base64: null, error: err.toString() });
        });
        return true; // Keep channel open for async response
    }

    return false;
});

async function fetchImageBase64(url) {
    try {
        console.log('Background fetching image:', url);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const blob = await response.blob();
        if (blob.size > MAX_IMAGE_BYTES) {
            console.warn(`Image exceeds size limit (${blob.size} bytes) for ${url}`);
            return null;
        }

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => {
                console.error('FileReader error for:', url);
                reject(new Error('FileReader failed'));
            };
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.error('Fetch failed for URL:', url, e);
        return null;
    }
}

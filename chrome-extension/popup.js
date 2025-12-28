/**
 * Chrome Extension Popup Script
 * Handles capture button click and coordinates with content script
 */

// DOM Elements
const captureBtn = document.getElementById('captureBtn');
const btnText = document.getElementById('btnText');
const spinner = document.getElementById('spinner');
const progress = document.getElementById('progress');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const status = document.getElementById('status');

// Settings elements
const maxNodesInput = document.getElementById('maxNodes');
const maxDepthInput = document.getElementById('maxDepth');
const maxDurationInput = document.getElementById('maxDuration');
const resetSettingsBtn = document.getElementById('resetSettings');

// State
let isCapturing = false;

// Default settings
const DEFAULT_SETTINGS = {
    maxNodes: 30000,
    maxDepth: 50,
    maxDuration: 90
};

/**
 * Load settings from chrome.storage
 */
async function loadSettings() {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const result = await chrome.storage.local.get('captureSettings');
            const settings = result.captureSettings || DEFAULT_SETTINGS;

            maxNodesInput.value = settings.maxNodes;
            maxDepthInput.value = settings.maxDepth;
            maxDurationInput.value = settings.maxDuration;
        } else {
            console.warn('chrome.storage.local is not available. Using default settings.');
            maxNodesInput.value = DEFAULT_SETTINGS.maxNodes;
            maxDepthInput.value = DEFAULT_SETTINGS.maxDepth;
            maxDurationInput.value = DEFAULT_SETTINGS.maxDuration;
        }
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

/**
 * Save settings to chrome.storage
 */
async function saveSettings() {
    const settings = {
        maxNodes: parseInt(maxNodesInput.value),
        maxDepth: parseInt(maxDepthInput.value),
        maxDuration: parseInt(maxDurationInput.value)
    };

    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ captureSettings: settings });
        }
    } catch (error) {
        console.error('Failed to save settings:', error);
    }
}

/**
 * Reset settings to defaults
 */
function resetSettings() {
    maxNodesInput.value = DEFAULT_SETTINGS.maxNodes;
    maxDepthInput.value = DEFAULT_SETTINGS.maxDepth;
    maxDurationInput.value = DEFAULT_SETTINGS.maxDuration;
    saveSettings();
}

/**
 * Update UI to show capturing state
 */
function setCapturing(capturing) {
    isCapturing = capturing;
    captureBtn.disabled = capturing;

    if (capturing) {
        btnText.textContent = 'Capturing...';
        spinner.classList.add('visible');
        progress.classList.add('visible');
        status.classList.remove('visible');
    } else {
        btnText.textContent = 'Capture Page';
        spinner.classList.remove('visible');
    }
}

/**
 * Update progress display
 */
function updateProgress(percent, text) {
    progressFill.style.width = `${percent}%`;
    progressText.textContent = text;
}

/**
 * Show status message
 */
function showStatus(message, type) {
    status.textContent = message;
    status.className = `status-message visible ${type}`;
    progress.classList.remove('visible');
}

/**
 * Generate .htfig file content
 */
function generateHtfigContent(layers, viewport) {
    const SCHEMA_VERSION = '1.0.0';
    const HTFIG_MAGIC = 'HTFIG';

    const viewportMeta = {
        width: viewport.width,
        height: viewport.height,
        devicePixelRatio: viewport.devicePixelRatio,
        captureTimestamp: Date.now(),
        schemaVersion: SCHEMA_VERSION,
        sourceUrl: viewport.sourceUrl
    };

    const payloadData = {
        magic: HTFIG_MAGIC,
        version: SCHEMA_VERSION,
        viewport: viewportMeta,
        layers: layers
    };

    // Simple checksum
    const payloadString = JSON.stringify(payloadData);
    let hash = 0;
    for (let i = 0; i < payloadString.length; i++) {
        const char = payloadString.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    const checksum = Math.abs(hash).toString(16).padStart(8, '0') +
        payloadString.length.toString(16).padStart(8, '0');

    const document = {
        ...payloadData,
        checksum: checksum
    };

    return JSON.stringify(document, null, 2);
}

/**
 * Trigger file download using anchor element (works in popup without downloads permission)
 */
function downloadFile(content, filename) {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Clean up after a short delay
    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 1000);
}

/**
 * Main capture function
 */
async function capturePage() {
    if (isCapturing) return;

    setCapturing(true);
    updateProgress(10, 'Getting active tab...');

    try {
        // Get current tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab || !tab.id) {
            throw new Error('No active tab found');
        }

        // Check if we can inject into this page
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
            throw new Error('Cannot capture browser internal pages');
        }

        updateProgress(20, 'Injecting capture script...');

        // Inject the content script
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content-script.js']
        });

        updateProgress(40, 'Capturing DOM structure...');

        // Get current settings
        const settings = {
            maxNodes: parseInt(maxNodesInput.value),
            maxDepth: parseInt(maxDepthInput.value),
            maxDurationMs: parseInt(maxDurationInput.value) * 1000
        };

        // Send capture message with settings
        let response;
        try {
            response = await chrome.tabs.sendMessage(tab.id, {
                type: 'CAPTURE_PAGE',
                settings: settings
            });
        } catch (msgError) {
            // Check if connection failed (content script not ready?)
            throw new Error('Failed to communicate with page. Please reload the page and try again.');
        }

        if (!response) {
            throw new Error('No response from content script');
        }

        if (response.error || !response.success) {
            throw new Error(response.error || 'Unknown capture error');
        }

        updateProgress(90, 'Downloading file...');

        // Content Script now returns the fully generated .htfig string in response.data
        const htfigContent = response.data;
        const warnings = response.warnings || [];
        const stats = response.stats || {};

        if (!htfigContent) {
            throw new Error('Received empty data from capture');
        }

        // Generate filename from page title
        const pageTitle = tab.title || 'capture';
        const safeFilename = pageTitle
            .replace(/[^a-z0-9]/gi, '_')
            .toLowerCase()
            .substring(0, 50);
        const filename = `${safeFilename}_${Date.now()}.htfig`;

        // Download the file
        downloadFile(htfigContent, filename);

        updateProgress(100, 'Complete!');

        if (warnings.length > 0) {
            const warningMsg = `⚠️ Capture completed with warnings (${warnings.length}): ${warnings.join('; ')}. Nodes: ${stats.nodesVisited ?? 'n/a'}`;
            showStatus(warningMsg, 'warning');
        } else {
            showStatus(`✓ Capture successful. File downloading...`, 'success');
        }

    } catch (error) {
        console.error('Capture error:', error);
        showStatus(`✗ ${error.message}`, 'error');
    } finally {
        setCapturing(false);
    }
}

// Event listeners
captureBtn.addEventListener('click', capturePage);
resetSettingsBtn.addEventListener('click', resetSettings);

// Save settings when they change
maxNodesInput.addEventListener('change', saveSettings);
maxDepthInput.addEventListener('change', saveSettings);
maxDurationInput.addEventListener('change', saveSettings);

// Load settings on startup
loadSettings();

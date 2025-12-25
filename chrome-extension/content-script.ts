import { ContentCollector } from '../src/capture/collector';
import { LayerNode } from '../src/types/layer-node';
import { encodeHtfig } from '../src/types/file-format';

declare var chrome: any;

console.log('HTML-to-Figma Content Script Loaded');

chrome.runtime.onMessage.addListener((request: any, sender: any, sendResponse: (response: any) => void) => {
    if (request.type === 'CAPTURE_PAGE') {
        capturePage().then(result => {
            sendResponse(result);
        }).catch(err => {
            console.error('Capture failed:', err);
            sendResponse({ success: false, error: err.message });
        });
        return true; // Keep channel open for async response
    }
});

async function autoScroll() {
    return new Promise<void>((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;

            if (totalHeight >= scrollHeight) {
                clearInterval(timer);
                window.scrollTo(0, 0);
                setTimeout(resolve, 500); // Wait for scroll back to finish
            }
        }, 20); // Fast scroll
    });
}

async function capturePage() {
    try {
        // 1. Auto Scroll to trigger lazy loading
        await autoScroll();

        // Start from documentElement to capture page backgrounds/variables on HTML tag
        const root = document.documentElement;
        const collector = new ContentCollector(root);

        // Collect the entire tree starting from HTML
        const rootLayer = await collector.collect(root);

        if (!rootLayer) {
            throw new Error('No content captured from page');
        }

        // Wrap in array as expected by file format
        const layers = [rootLayer];

        // Gather viewport metadata
        const viewport = {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
            sourceUrl: window.location.href
        };

        // Serialize to .htfig format
        // Note: encodeHtfig is in src/types/file-format.ts
        // We need to ensure that file is importable. 
        // If not, we might need to inline the encoding or ensure build process handles it.
        const fileContent = encodeHtfig(layers, viewport);

        return { success: true, data: fileContent };

    } catch (e) {
        console.error('HTML-to-Figma Capture Error:', e);
        return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
}

import { ContentCollector } from '../src/capture/collector';
import { LayerNode } from '../src/types/layer-node';
import { encodeHtfig } from '../src/types/file-format';

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
        const distance = 200;
        const intervalMs = 40;
        const maxDurationMs = 15000;
        const maxSteps = 400;

        let lastScrollHeight = 0;
        let stableHeightTicks = 0;
        let steps = 0;
        const start = Date.now();

        const timer = setInterval(() => {
            const scrollHeight = Math.max(
                document.documentElement?.scrollHeight || 0,
                document.body?.scrollHeight || 0
            );

            window.scrollBy(0, distance);
            steps += 1;

            if (scrollHeight === lastScrollHeight) {
                stableHeightTicks += 1;
            } else {
                stableHeightTicks = 0;
                lastScrollHeight = scrollHeight;
            }

            const atBottom = (window.scrollY + window.innerHeight) >= (scrollHeight - 4);
            const timedOut = (Date.now() - start) > maxDurationMs;
            const tooManySteps = steps >= maxSteps;
            const heightStable = stableHeightTicks >= 5;

            if (atBottom || timedOut || tooManySteps || heightStable) {
                clearInterval(timer);
                window.scrollTo(0, 0);
                setTimeout(resolve, 500); // Wait for scroll back to finish
            }
        }, intervalMs);
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
        const warnings = collector.getWarnings();
        const stats = collector.getStats();

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

        if (warnings.length > 0) {
            console.warn('Capture completed with warnings:', warnings, stats);
        }

        return { success: true, data: fileContent, warnings, stats };

    } catch (e) {
        console.error('HTML-to-Figma Capture Error:', e);
        return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
}

import { Collector } from '../ui/collector/index';
import { LayerNode } from '../types/layer-node';

declare const chrome: {
    runtime: {
        onMessage: {
            addListener: (callback: (request: any, sender: any, sendResponse: (response: any) => void) => boolean) => void;
        };
    };
};

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request: any, sender: any, sendResponse: (response: any) => void): boolean => {
    if (request.action === 'capture') {
        captureLayout().then(data => {
            sendResponse({ data });
        }).catch(err => {
            console.error(err);
            sendResponse({ error: err.message });
        });
        return true; // Keep channel open for async response
    }
    return false;
});

async function captureLayout() {
    // Note: We REMOVED forceVisibility to fix black box artifacts.
    // We now respect the page's native visibility.

    // Collect from body
    let rootNode = await Collector.collect(document.body);

    if (rootNode) {
        // Apply Optimizations
        rootNode = Collector.pruneRedundantLayers(rootNode);

        // Apply Root Page Layout Heuristics (Vertical Stack) to match Plugin behavior
        rootNode.layoutMode = 'VERTICAL';
        rootNode.primaryAxisSizingMode = 'AUTO';
        rootNode.counterAxisSizingMode = 'FIXED';

        if (!rootNode.fills || rootNode.fills.length === 0) {
            rootNode.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }];
        }
    }

    return [rootNode]; // Return as array to match new protocol
}

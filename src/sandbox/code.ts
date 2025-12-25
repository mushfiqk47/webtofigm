import { Builder } from './builder';
import { LayerNode } from '../types/layer-node';
import { UIAction } from '../types/messages';

// Show UI
figma.showUI(__html__, { width: 400, height: 400 });

// Handle Messages
figma.ui.onmessage = async (msg: UIAction) => {

    if (msg.type === 'generate') {
        const nodes = msg.data;
        postStatus(`Building ${nodes.length} layers...`);

        const builder = new Builder();
        const createdNodes: SceneNode[] = [];

        // Batch Processing Configuration
        const BATCH_SIZE = 20;
        const total = nodes.length;

        for (let i = 0; i < total; i += BATCH_SIZE) {
            const batch = nodes.slice(i, i + BATCH_SIZE);

            // Process Batch
            for (const node of batch) {
                const figmaNode = await builder.build(node);
                if (figmaNode) {
                    createdNodes.push(figmaNode);
                    figma.currentPage.appendChild(figmaNode);
                }
            }

            // Update Status on every batch
            const percent = Math.round(((i + BATCH_SIZE) / total) * 100);
            postStatus(`Processing... ${Math.min(percent, 100)}%`);

            // Yield to Main Thread to keep UI responsive
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        // Select created nodes
        if (createdNodes.length > 0) {
            figma.currentPage.selection = createdNodes;
            figma.viewport.scrollAndZoomIntoView(createdNodes);
        }

        figma.ui.postMessage({ type: 'complete', message: 'Completed!' });
    }

    if (msg.type === 'status') {
        console.log('UI Status:', msg.message);
    }
};

function postStatus(message: string, isError = false) {
    figma.ui.postMessage({ type: isError ? 'error' : 'status', message });
}

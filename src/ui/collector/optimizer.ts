import { LayerNode } from '../../types/layer-node';

export class Optimizer {
    /**
     * Tree Shaking: Removes redundant wrapper frames that add depth but no style/value.
     */
    static pruneRedundantLayers(node: LayerNode): LayerNode {
        // Recurse first (bottom-up optimization)
        if (node.children) {
            node.children = node.children.map(child => this.pruneRedundantLayers(child));
        }

        // Check if THIS node is redundant
        // A node is redundant if it's a FRAME with exactly 1 child, and has no visible style or layout impact.
        if (node.type === 'FRAME' && node.children && node.children.length === 1) {
            const child = node.children[0];

            // 1. Visual Checks
            const isVisible = (node.fills && node.fills.length > 0) ||
                (node.strokes && node.strokes.length > 0) ||
                (node.effects && node.effects.length > 0);

            if (isVisible) return node;

            // 2. Layout Checks
            const hasPadding = node.padding && (node.padding.top > 0 || node.padding.right > 0 || node.padding.bottom > 0 || node.padding.left > 0);
            if (hasPadding) return node;

            if (node.clipsContent) return node; // If it clips, it serves a purpose

            // 3. Adopt the Child
            // Adjust Child Position to be absolute relative to Node's parent 
            child.x += node.x;
            child.y += node.y;

            return child;
        }

        return node;
    }
}

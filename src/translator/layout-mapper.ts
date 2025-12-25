import { LayerNode } from '../types/layer-node';

/**
 * Maps CSS Flexbox logic to Figma Auto Layout
 */
export class LayoutMapper {

    static map(node: LayerNode, figmaNode: FrameNode) {
        if (node.layoutMode === 'NONE') {
            figmaNode.layoutMode = 'NONE';
            return;
        }

        // Direction
        figmaNode.layoutMode = node.layoutMode || 'HORIZONTAL';

        // Spacing
        figmaNode.itemSpacing = node.itemSpacing || 0;

        // Padding
        if (node.padding) {
            figmaNode.paddingTop = node.padding.top;
            figmaNode.paddingRight = node.padding.right;
            figmaNode.paddingBottom = node.padding.bottom;
            figmaNode.paddingLeft = node.padding.left;
        }

        // Alignments
        figmaNode.primaryAxisAlignItems = node.primaryAxisAlignItems || 'MIN';
        figmaNode.counterAxisAlignItems = node.counterAxisAlignItems || 'MIN';

        // Sizing (Modern)
        if (node.layoutSizingHorizontal) {
            figmaNode.layoutSizingHorizontal = node.layoutSizingHorizontal;
        } else if (node.primaryAxisSizingMode) {
            // Fallback
            if (node.layoutMode === 'HORIZONTAL') figmaNode.primaryAxisSizingMode = node.primaryAxisSizingMode;
            else figmaNode.counterAxisSizingMode = node.primaryAxisSizingMode; // If vertical, primary is vertical
        }

        if (node.layoutSizingVertical) {
            figmaNode.layoutSizingVertical = node.layoutSizingVertical;
        } else if (node.counterAxisSizingMode) {
            // Fallback
            if (node.layoutMode === 'HORIZONTAL') figmaNode.counterAxisSizingMode = node.counterAxisSizingMode;
            else figmaNode.primaryAxisSizingMode = node.counterAxisSizingMode;
        }
    }
}

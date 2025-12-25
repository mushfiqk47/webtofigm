import { LayerNode } from '../../types/layer-node';

export class LayoutParser {

    static extractLayout(node: LayerNode, style: CSSStyleDeclaration) {
        // Defaults
        node.layoutMode = 'NONE';
        node.primaryAxisSizingMode = 'FIXED';
        node.counterAxisSizingMode = 'FIXED';

        const isFlex = style.display === 'flex' || style.display === 'inline-flex';
        const isGrid = style.display === 'grid' || style.display === 'inline-grid';
        const isBlock = style.display === 'block' || style.display === 'inline-block';

        // 1. Padding (Common to all)
        node.padding = {
            top: parseFloat(style.paddingTop) || 0,
            right: parseFloat(style.paddingRight) || 0,
            bottom: parseFloat(style.paddingBottom) || 0,
            left: parseFloat(style.paddingLeft) || 0
        };

        // 2. Determine Layout Mode
        if (isFlex) {
            node.layoutMode = style.flexDirection.includes('column') ? 'VERTICAL' : 'HORIZONTAL';
            node.itemSpacing = parseFloat(style.gap) || 0;

            // Justify Content (Primary Axis)
            const jc = style.justifyContent;
            if (jc === 'center') node.primaryAxisAlignItems = 'CENTER';
            else if (jc.includes('end') || jc.includes('flex-end')) node.primaryAxisAlignItems = 'MAX';
            else if (jc.includes('between')) node.primaryAxisAlignItems = 'SPACE_BETWEEN';
            else node.primaryAxisAlignItems = 'MIN';

            // Align Items (Counter Axis)
            const ai = style.alignItems;
            if (ai === 'center') node.counterAxisAlignItems = 'CENTER';
            else if (ai.includes('end') || ai.includes('flex-end')) node.counterAxisAlignItems = 'MAX';
            else if (ai === 'baseline') node.counterAxisAlignItems = 'BASELINE';
            else node.counterAxisAlignItems = 'MIN';

            // Wrap
            if (style.flexWrap === 'wrap') {
                node.layoutWrap = 'WRAP';
                node.counterAxisSpacing = parseFloat(style.rowGap) || parseFloat(style.gap) || 0;
            }

        } else if (isGrid) {
            // Treat Grid as Wrappable Horizontal Auto Layout
            node.layoutMode = 'HORIZONTAL';
            node.layoutWrap = 'WRAP';
            node.itemSpacing = parseFloat(style.columnGap) || parseFloat(style.gap) || 0;
            node.counterAxisSpacing = parseFloat(style.rowGap) || parseFloat(style.gap) || 0;
            node.primaryAxisAlignItems = 'MIN';
            node.counterAxisAlignItems = 'MIN';

        } else if (isBlock) {
            // Treat standard blocks as Vertical Stacks IF they have height: auto (meaning they grow with content)
            // This mimics the web 'normal flow'
            node.layoutMode = 'VERTICAL';
            node.itemSpacing = 0;
            node.primaryAxisAlignItems = 'MIN';
            node.counterAxisAlignItems = 'MIN'; // Left aligned by default
        }

        // 3. Inference for Sizing Mode (Hug vs Fixed)
        // Check explicit sizing properties
        const width = style.width;
        const height = style.height;

        // Helper: 'fit-content', 'max-content', 'auto' (sometimes) -> Hug
        const isHugWidth = width === 'fit-content' || width === 'max-content' || (width === 'auto' && style.display === 'inline-block');
        const isHugHeight = height === 'fit-content' || height === 'max-content' || height === 'auto';

        if (node.layoutMode === 'HORIZONTAL') {
            node.primaryAxisSizingMode = isHugWidth ? 'AUTO' : 'FIXED';
            node.counterAxisSizingMode = isHugHeight ? 'AUTO' : 'FIXED';
        } else if (node.layoutMode === 'VERTICAL') {
            node.primaryAxisSizingMode = isHugHeight ? 'AUTO' : 'FIXED';
            node.counterAxisSizingMode = isHugWidth ? 'AUTO' : 'FIXED';
        }
    }
}

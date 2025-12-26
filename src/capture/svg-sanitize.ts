/**
 * Minimal SVG sanitizer to strip active content before embedding into Figma.
 * Removes <script> tags, event handler attributes, and javascript: href/src.
 */

export function sanitizeSvg(svgText: string): string {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgText, 'image/svg+xml');
        const root = doc.documentElement;
        if (!root || root.nodeName.toLowerCase() !== 'svg') {
            return '';
        }

        const walker = (node: Element) => {
            // Remove script tags entirely
            if (node.tagName.toLowerCase() === 'script') {
                node.remove();
                return;
            }

            // Strip event handlers and dangerous href/src values
            const attrs = Array.from(node.attributes);
            for (const attr of attrs) {
                const name = attr.name.toLowerCase();
                const value = attr.value || '';

                if (name.startsWith('on')) {
                    node.removeAttribute(attr.name);
                    continue;
                }

                if (name === 'href' || name === 'xlink:href' || name === 'src') {
                    if (/^\s*javascript:/i.test(value) || /^\s*data:text\/html/i.test(value)) {
                        node.removeAttribute(attr.name);
                        continue;
                    }
                }
            }

            // Recurse
            const children = Array.from(node.children);
            for (const child of children) {
                walker(child as Element);
            }
        };

        walker(root);

        const serializer = new XMLSerializer();
        return serializer.serializeToString(root);
    } catch (e) {
        // If parsing fails, drop the SVG
        return '';
    }
}

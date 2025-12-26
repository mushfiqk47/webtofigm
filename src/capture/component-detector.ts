import { LayerNode } from '../types/layer-node';

/**
 * Component Detector - Finds repeated patterns in the layer tree
 * Uses heuristic-based detection (no AI required)
 */
export class ComponentDetector {

    /**
     * Analyze the layer tree and identify components
     * @param root The root layer node
     * @returns Map of component hash to instances
     */
    detectComponents(root: LayerNode): Map<string, LayerNode[]> {
        const componentMap = new Map<string, LayerNode[]>();
        const hashCounts = new Map<string, number>();

        // First pass: count all structural hashes
        this.countStructures(root, hashCounts);

        // Second pass: collect nodes that appear 2+ times
        this.collectComponents(root, hashCounts, componentMap);

        // Filter out single instances
        for (const [hash, nodes] of componentMap) {
            if (nodes.length < 2) {
                componentMap.delete(hash);
            }
        }

        return componentMap;
    }

    /**
     * Mark detected components in the tree
     * Adds component metadata to repeated elements
     */
    markComponents(root: LayerNode): void {
        const components = this.detectComponents(root);
        let componentIndex = 1;

        for (const [hash, instances] of components) {
            const componentName = this.generateComponentName(instances[0]);

            for (let i = 0; i < instances.length; i++) {
                const node = instances[i];
                // Add component marker to the name
                node.name = `${componentName} (${i + 1}/${instances.length})`;
            }

            componentIndex++;
        }
    }

    /**
     * Generate a structural hash for a node
     * Similar structures will have the same hash
     */
    private getStructuralHash(node: LayerNode): string {
        const parts: string[] = [];

        // Include type
        parts.push(node.type);

        // Include child count and structure (not content)
        if (node.children && node.children.length > 0) {
            parts.push(`children:${node.children.length}`);

            // Hash child types in order
            const childTypes = node.children.map(c => c.type).join(',');
            parts.push(`childTypes:${childTypes}`);
        }

        // Include rough size category (to group similar sized elements)
        const sizeCategory = this.getSizeCategory(node.width, node.height);
        parts.push(`size:${sizeCategory}`);

        // Include layout mode
        if (node.layoutMode) {
            parts.push(`layout:${node.layoutMode}`);
        }

        // Include semantic type if present
        if (node.semanticType) {
            parts.push(`semantic:${node.semanticType}`);
        }

        return parts.join('|');
    }

    /**
     * Get a size category (small, medium, large)
     * This allows grouping similarly-sized elements
     */
    private getSizeCategory(width: number, height: number): string {
        const area = width * height;

        if (area < 2500) return 'xs';        // < 50x50
        if (area < 10000) return 'sm';       // < 100x100
        if (area < 40000) return 'md';       // < 200x200
        if (area < 160000) return 'lg';      // < 400x400
        return 'xl';
    }

    /**
     * Count occurrences of each structure
     */
    private countStructures(node: LayerNode, counts: Map<string, number>): void {
        const hash = this.getStructuralHash(node);
        counts.set(hash, (counts.get(hash) || 0) + 1);

        if (node.children) {
            for (const child of node.children) {
                this.countStructures(child, counts);
            }
        }
    }

    /**
     * Collect nodes that match repeated patterns
     */
    private collectComponents(
        node: LayerNode,
        counts: Map<string, number>,
        componentMap: Map<string, LayerNode[]>
    ): void {
        const hash = this.getStructuralHash(node);
        const count = counts.get(hash) || 0;

        // Only collect if appears 2+ times and has children (is a real component)
        if (count >= 2 && node.children && node.children.length > 0) {
            if (!componentMap.has(hash)) {
                componentMap.set(hash, []);
            }
            componentMap.get(hash)!.push(node);
        }

        if (node.children) {
            for (const child of node.children) {
                this.collectComponents(child, counts, componentMap);
            }
        }
    }

    /**
     * Generate a readable component name from the first instance
     */
    private generateComponentName(node: LayerNode): string {
        // Try to infer a good name
        if (node.semanticType) {
            return `${node.semanticType} Component`;
        }

        // Use the existing name if it's meaningful
        if (node.name && !node.name.startsWith('div') && !node.name.startsWith('span')) {
            return node.name;
        }

        // Infer from children
        if (node.children && node.children.length > 0) {
            const childTypes = node.children.map(c => c.type);

            if (childTypes.includes('IMAGE') && childTypes.includes('TEXT')) {
                return 'Card';
            }
            if (childTypes.every(t => t === 'TEXT')) {
                return 'Text Group';
            }
            if (node.children.length === 1 && childTypes[0] === 'IMAGE') {
                return 'Image Container';
            }
        }

        // Fallback based on layout
        if (node.layoutMode === 'HORIZONTAL') {
            return 'Row';
        }
        if (node.layoutMode === 'VERTICAL') {
            return 'Stack';
        }

        return 'Component';
    }
}

/**
 * Utility function to detect and mark components in a layer tree
 */
export function detectAndMarkComponents(root: LayerNode): void {
    const detector = new ComponentDetector();
    detector.markComponents(root);
}

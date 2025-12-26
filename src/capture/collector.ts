import { LayerNode, Paint, Effect, BlendMode, TextCase, TextDecoration } from '../types/layer-node';
import {
    isHidden, parseColor, parseBoxShadow, parseFilterDropShadow, cleanText,
    imageToBase64, parseGap, parseGradient, parseTransform, parseLineHeight,
    parseLetterSpacing, parseTextCase, parseTextDecoration, parseBackdropFilter,
    shouldClipContent
} from './dom-utils';
import { detectAndMarkComponents } from './component-detector';
import { extractDesignTokens, DesignTokens } from './design-tokens';
import { sanitizeSvg } from './svg-sanitize';

export interface CollectionResult {
    root: LayerNode;
    designTokens?: DesignTokens;
}

export class ContentCollector {
    root: HTMLElement;
    enableComponentDetection: boolean = true;
    enableDesignTokens: boolean = true;

    // Traversal safety limits
    private maxNodes: number;
    private maxDepth: number;
    private maxDurationMs: number;
    private nodesVisited: number = 0;
    private startedAt: number = 0;
    private limitHit: boolean = false;
    private limitFlags: Record<'MAX_NODES' | 'MAX_DEPTH' | 'MAX_DURATION', boolean> = {
        MAX_NODES: false,
        MAX_DEPTH: false,
        MAX_DURATION: false
    };
    private warnings: string[] = [];

    constructor(root: HTMLElement, options?: {
        detectComponents?: boolean;
        extractTokens?: boolean;
        maxNodes?: number;
        maxDepth?: number;
        maxDurationMs?: number;
    }) {
        this.root = root;
        this.enableComponentDetection = options?.detectComponents ?? true;
        this.enableDesignTokens = options?.extractTokens ?? true;

        // Use MAX_SAFE_INTEGER if 0 is passed for unlimited
        this.maxNodes = (!options?.maxNodes || options.maxNodes === 0) ? Number.MAX_SAFE_INTEGER : options.maxNodes;
        this.maxDepth = (!options?.maxDepth || options.maxDepth === 0) ? Number.MAX_SAFE_INTEGER : options.maxDepth;
        this.maxDurationMs = (!options?.maxDurationMs || options.maxDurationMs === 0) ? Number.MAX_SAFE_INTEGER : options.maxDurationMs;

        // If not specified, default to generous but safe limits if not 0
        if (options?.maxNodes === undefined) this.maxNodes = 15000;
        if (options?.maxDepth === undefined) this.maxDepth = 50;
        if (options?.maxDurationMs === undefined) this.maxDurationMs = 30000;
    }

    /**
     * Collect the entire page with components and design tokens
     */
    async collectPage(): Promise<CollectionResult | null> {
        const root = await this.collect(this.root as HTMLElement, 0);

        if (!root) return null;

        // Run component detection if enabled
        if (this.enableComponentDetection) {
            detectAndMarkComponents(root);
        }

        // Extract design tokens if enabled
        let designTokens: DesignTokens | undefined;
        if (this.enableDesignTokens) {
            designTokens = extractDesignTokens(root);
        }

        return { root, designTokens };
    }

    getWarnings(): string[] {
        return [...this.warnings];
    }

    getStats(): { nodesVisited: number; limitHit: boolean } {
        return {
            nodesVisited: this.nodesVisited,
            limitHit: this.limitHit
        };
    }

    async collect(element: HTMLElement, depth: number = 0): Promise<LayerNode | null> {
        try {
            if (!this.startedAt) {
                this.startedAt = Date.now();
            }

            if (this.shouldStopTraversal(depth)) {
                return null;
            }

            if (!this.reserveNode('element', element, depth)) {
                return null;
            }

            const style = window.getComputedStyle(element);

            if (isHidden(element, style)) {
                return null;
            }

            const isDisplayContents = style.display === 'contents';
            const rect = element.getBoundingClientRect();

            const isDocumentRoot = element === document.documentElement || element === document.body;

            /**
             * COORDINATE SYSTEM DOCUMENTATION:
             * 
             * We use DOCUMENT-RELATIVE coordinates throughout the capture process.
             * This ensures consistent positioning regardless of scroll position.
             * 
             * getBoundingClientRect() returns VIEWPORT-RELATIVE coordinates.
             * To convert to document-relative, we add the scroll offsets:
             *   documentX = rect.x + scrollX
             *   documentY = rect.y + scrollY
             * 
             * In Figma, coordinates are PARENT-RELATIVE.
             * The Builder converts document-relative to parent-relative:
             *   figmaNode.x = documentX - parentDocumentX
             *   figmaNode.y = documentY - parentDocumentY
             */
            const scrollX = window.scrollX || window.pageXOffset || 0;
            const scrollY = window.scrollY || window.pageYOffset || 0;

            const width = isDocumentRoot
                ? Math.max(rect.width, document.documentElement.scrollWidth, document.documentElement.clientWidth)
                : rect.width;
            const height = isDocumentRoot
                ? Math.max(rect.height, document.documentElement.scrollHeight, document.documentElement.clientHeight)
                : rect.height;

            const opacity = parseFloat(style.opacity);

            // Base Node Construction - coordinates are document-relative (not affected by scroll)
            const node: LayerNode = {
                type: 'FRAME',
                name: element.tagName.toLowerCase(),
                x: isDocumentRoot ? 0 : rect.x + scrollX,  // Document-relative X
                y: isDocumentRoot ? 0 : rect.y + scrollY,  // Document-relative Y
                width: width,
                height: height,
                opacity: isNaN(opacity) ? 1 : opacity,
                blendMode: this.getBlendMode(style),
                fills: [],
                strokes: [],
                effects: [],
                children: [],
                isContentOnly: isDisplayContents,
                zIndex: style.zIndex !== 'auto' ? parseInt(style.zIndex) : 0
            };

            // 1. Semantic Helpers
            this.assignSemanticType(node, element);

            const isVisible = style.visibility !== 'hidden';

            if (!isDisplayContents && isVisible) {
                // 2. Styling Extraction
                this.extractBackgrounds(node, style);
                this.extractBorders(node, style);
                this.extractShadows(node, style);
                this.extractFilters(node, style);
                this.extractRadius(node, style);
                this.extractTransform(node, style);
                this.extractClipping(node, style);

                // 3. Layout Extraction (Flex/Grid -> AutoLayout)
                this.extractLayout(node, style, element);

                // 4. Content Handling
                const tagName = element.tagName.toUpperCase();
                if (tagName === 'IMG') {
                    await this.handleImage(node, element as HTMLImageElement);
                } else if (tagName === 'SVG' || element instanceof SVGSVGElement) {
                    this.handleSvg(node, element as unknown as SVGElement);
                } else if (tagName === 'VIDEO') {
                    await this.handleVideo(node, element as HTMLVideoElement);
                } else if (tagName === 'CANVAS') {
                    await this.handleCanvas(node, element as HTMLCanvasElement);
                } else if (tagName === 'PICTURE') {
                    await this.handlePicture(node, element as HTMLPictureElement);
                }
            } else if (!isVisible && !isDisplayContents) {
                // Keep layout info for invisible elements so they take up space
                // But stripping visual properties happens by just not calling extract* methods
                // However, we might need basic layout (dimensions) which are already in Base Node
                // We might want to ensure they don't have fills:
                node.fills = [];
                node.strokes = [];
                node.effects = [];
            }

            // 5. Children Recursion
            if (node.type !== 'IMAGE' && node.type !== 'SVG') {
                await this.processChildren(node, element, depth + 1);
            }

            // 6. Pruning
            // FIDELITY FIX: Disable pruning to ensure every DOM element exists in Figma
            if (this.shouldPrune(node)) {
                // node.isContentOnly = true; 
            }

            // FIDELITY FIX: Handle Margins by wrapping in a Frame
            // Figma Auto Layout does not support margins on children, only padding on parents or gaps.
            // To preserve exact spacing, we wrap elements with significant margins in a transparent frame with padding.
            if (node.layoutPositioning !== 'ABSOLUTE' && !isDocumentRoot) {
                const margins = {
                    top: parseFloat(style.marginTop) || 0,
                    right: parseFloat(style.marginRight) || 0,
                    bottom: parseFloat(style.marginBottom) || 0,
                    left: parseFloat(style.marginLeft) || 0
                };

                // Only wrap if there are actual margins
                if (margins.top > 1 || margins.right > 1 || margins.bottom > 1 || margins.left > 1) {
                    return this.createMarginWrapper(node, margins);
                }
            }

            return node;
        } catch (e) {
            console.warn('Error collecting node', element, e);
            return null;
        }
    }

    private createMarginWrapper(node: LayerNode, margins: { top: number, right: number, bottom: number, left: number }): LayerNode {
        const wrapper: LayerNode = {
            type: 'FRAME',
            name: `Margin Wrapper (${node.name})`,
            x: node.x - margins.left,
            y: node.y - margins.top,
            width: node.width + margins.left + margins.right,
            height: node.height + margins.top + margins.bottom,
            opacity: 1,
            blendMode: 'NORMAL',
            fills: [], // Transparent
            strokes: [],
            effects: [],
            children: [node],
            layoutMode: 'VERTICAL', // Default to vertical to hold the child
            layoutSizingHorizontal: node.layoutSizingHorizontal === 'FIXED' ? 'HUG' : node.layoutSizingHorizontal, // Hug the child
            layoutSizingVertical: node.layoutSizingVertical === 'FIXED' ? 'HUG' : node.layoutSizingVertical,
            padding: margins,
            itemSpacing: 0
        };

        // Adjust child position inside wrapper (relative to wrapper)
        // Auto Layout handles this via padding, but for initial state:
        // node.x becomes 0 (relative to content box) -> actually with padding it's handled.

        // If the child was FILL, the wrapper should be FILL?
        // If child is FILL, wrapper FILL.
        if (node.layoutSizingHorizontal === 'FILL') wrapper.layoutSizingHorizontal = 'FILL';
        if (node.layoutSizingVertical === 'FILL') wrapper.layoutSizingVertical = 'FILL';

        return wrapper;
    }

    private extractFilters(node: LayerNode, style: CSSStyleDeclaration) {
        if (style.filter && style.filter !== 'none') {
            const filterEffects = parseFilterDropShadow(style.filter);
            if (filterEffects.length > 0) {
                if (!node.effects) node.effects = [];
                node.effects.push(...filterEffects);
            }
        }
    }

    private extractTextShadows(node: LayerNode, style: CSSStyleDeclaration) {
        if (style.textShadow && style.textShadow !== 'none') {
            const textShadows = parseFilterDropShadow(style.textShadow); // Use droplet logic for now as it maps well
            if (textShadows.length > 0) {
                if (!node.effects) node.effects = [];
                node.effects.push(...textShadows);
            }
        }
    }

    private assignSemanticType(node: LayerNode, element: HTMLElement) {
        const tag = element.tagName;

        // 1. Determine semantic type from HTML tag
        if (tag === 'BUTTON' || (tag === 'A' && element.classList.contains('btn'))) node.semanticType = 'BUTTON';
        else if (tag === 'INPUT') node.semanticType = 'INPUT';
        else if (tag === 'IMG') node.semanticType = 'IMAGE';
        else if (tag === 'SECTION' || tag === 'HEADER' || tag === 'FOOTER' || tag === 'NAV' || tag === 'MAIN' || tag === 'ARTICLE' || tag === 'ASIDE') node.semanticType = 'SECTION';

        // 2. Build smart name with priority: aria-label > data-testid > role > id > class > text content
        let smartName = node.semanticType ? node.semanticType.toLowerCase() : tag.toLowerCase();

        // Check ARIA label first (most semantic)
        const ariaLabel = element.getAttribute('aria-label');
        if (ariaLabel) {
            smartName = ariaLabel.slice(0, 40); // Limit length
        }
        // Check data-testid (common in React apps)
        else if (element.getAttribute('data-testid')) {
            smartName = element.getAttribute('data-testid')!.replace(/-/g, ' ');
        }
        // Check role attribute
        else if (element.getAttribute('role')) {
            const role = element.getAttribute('role');
            if (role && role !== 'presentation' && role !== 'none') {
                smartName = role;
            }
        }
        // Check ID
        else if (element.id) {
            smartName += `#${element.id}`;
        }
        // Check first class
        else if (element.className && typeof element.className === 'string' && element.className.trim()) {
            const firstClass = element.className.split(' ')[0];
            if (firstClass && !firstClass.startsWith('_') && firstClass.length < 30) {
                smartName += `.${firstClass}`;
            }
        }
        // For buttons/links, use text content
        else if ((tag === 'BUTTON' || tag === 'A') && element.textContent) {
            const text = element.textContent.trim().slice(0, 25);
            if (text) smartName = text;
        }

        node.name = smartName;
    }

    private extractLayout(node: LayerNode, style: CSSStyleDeclaration, element: HTMLElement) {
        const display = style.display;

        // Extract Padding
        node.padding = {
            top: parseFloat(style.paddingTop) || 0,
            right: parseFloat(style.paddingRight) || 0,
            bottom: parseFloat(style.paddingBottom) || 0,
            left: parseFloat(style.paddingLeft) || 0,
        };

        const isFlex = display === 'flex' || display === 'inline-flex';
        const isGrid = display === 'grid' || display === 'inline-grid';

        if (isFlex || isGrid) {
            // Logic correction:
            // Flex Row -> HORIZONTAL
            // Grid Row (default) -> HORIZONTAL (L->R then wrap)
            // Flex Column -> VERTICAL
            // Grid Column -> VERTICAL (T->B then wrap)

            let isHorizontal = false;
            if (isFlex) {
                isHorizontal = style.flexDirection === 'row' || style.flexDirection === 'row-reverse';
            } else if (isGrid) {
                // Grid default is row (horizontal flow), only column is vertical flow
                isHorizontal = !style.gridAutoFlow.includes('column');
            }

            node.layoutMode = isHorizontal ? 'HORIZONTAL' : 'VERTICAL';

            // FIDELITY FIX: Check for complex 2D grids and force absolute positioning
            if (isGrid) {
                const hasComplexRows = style.gridTemplateRows !== 'none' && style.gridTemplateRows.split(' ').length > 1;
                const hasComplexCols = style.gridTemplateColumns !== 'none' && style.gridTemplateColumns.split(' ').length > 1;

                if (hasComplexRows && hasComplexCols) {
                    node.layoutMode = 'NONE';
                    node.layoutSizingHorizontal = 'FIXED';
                    node.layoutSizingVertical = 'FIXED';
                    // We can return early or let it proceed, but we need to ensure we don't overwrite this later
                    // However, we still want to capture other props. 
                    // Setting layoutMode NONE means we should skip the flex/grid specific logic below?
                    // The original code enters the if (isFlex || isGrid) block.
                    // If we change it to NONE here, we should probably stop setting gaps/alignments for AutoLayout.
                }
            }

            if (node.layoutMode !== 'NONE') {
                const gaps = parseGap(style.gap);
                // Fallback if shorthand failed
                if (gaps.row === 0 && style.rowGap && style.rowGap !== 'normal') gaps.row = parseFloat(style.rowGap);
                if (gaps.col === 0 && style.columnGap && style.columnGap !== 'normal') gaps.col = parseFloat(style.columnGap);

                if (node.layoutMode === 'HORIZONTAL') {
                    node.itemSpacing = gaps.col;
                    node.counterAxisSpacing = gaps.row;
                } else {
                    node.itemSpacing = gaps.row;
                    node.counterAxisSpacing = gaps.col;
                }

                const align = style.alignItems;
                if (align === 'flex-start' || align === 'start') node.counterAxisAlignItems = 'MIN';
                else if (align === 'flex-end' || align === 'end') node.counterAxisAlignItems = 'MAX';
                else if (align === 'center') node.counterAxisAlignItems = 'CENTER';
                else if (align === 'baseline') node.counterAxisAlignItems = 'BASELINE';
                else if (align === 'stretch') node.counterAxisAlignItems = 'MIN';

                const justify = style.justifyContent;
                if (justify === 'flex-start' || justify === 'start') node.primaryAxisAlignItems = 'MIN';
                else if (justify === 'flex-end' || justify === 'end') node.primaryAxisAlignItems = 'MAX';
                else if (justify === 'center') node.primaryAxisAlignItems = 'CENTER';
                else if (justify === 'space-between') node.primaryAxisAlignItems = 'SPACE_BETWEEN';

                if (style.flexWrap === 'wrap' || isGrid) {
                    node.layoutWrap = 'WRAP';
                }
            }

            // FIDELITY FIX: Intelligent sizing detection instead of always HUG
            // Horizontal sizing
            const hasExplicitWidth = style.width !== 'auto' && style.width !== '' && !style.width.includes('%');
            const isFullWidth = style.width === '100%' || style.width === '100vw' || style.width === '100vi';
            const hasMinWidth = style.minWidth !== 'none' && style.minWidth !== '0px' && style.minWidth !== '';

            if (isFullWidth) {
                node.layoutSizingHorizontal = 'FILL';
            } else if (hasExplicitWidth) {
                node.layoutSizingHorizontal = 'FIXED';
                // FIDELITY FIX: Force captured dimension if explicit width is set
                node.width = element.getBoundingClientRect().width;
            } else {
                node.layoutSizingHorizontal = 'HUG';
            }

            // Vertical sizing
            const hasExplicitHeight = style.height !== 'auto' && style.height !== '' && !style.height.includes('%');
            const isFullHeight = style.height === '100%' || style.height === '100vh' || style.height === '100vb';
            const hasMinHeight = style.minHeight !== 'none' && style.minHeight !== '0px' && style.minHeight !== '';

            if (isFullHeight) {
                node.layoutSizingVertical = 'FILL';
            } else if (hasExplicitHeight) {
                node.layoutSizingVertical = 'FIXED';
            } else {
                node.layoutSizingVertical = 'HUG';
            }
        } else {
            // Non-flex/grid elements: Use absolute positioning (layoutMode = NONE)
            node.layoutMode = 'NONE';

            // Fixed sizing - elements should use their actual captured dimensions
            node.layoutSizingHorizontal = 'FIXED';
            node.layoutSizingVertical = 'FIXED';
        }

        // Extract flex child properties (for when THIS element is inside a flex parent)
        const flexGrow = parseFloat(style.flexGrow);
        if (flexGrow > 0) {
            node.layoutGrow = flexGrow;
        }

        // Align-self for child alignment override
        const alignSelf = style.alignSelf;
        if (alignSelf === 'flex-start' || alignSelf === 'start') node.layoutAlign = 'MIN';
        else if (alignSelf === 'flex-end' || alignSelf === 'end') node.layoutAlign = 'MAX';
        else if (alignSelf === 'center') node.layoutAlign = 'CENTER';
        else if (alignSelf === 'stretch') node.layoutAlign = 'STRETCH';

        if (style.position === 'absolute' || style.position === 'fixed') {
            node.layoutPositioning = 'ABSOLUTE';
        }
    }

    private async extractBackgrounds(node: LayerNode, style: CSSStyleDeclaration) {
        const color = parseColor(style.backgroundColor);
        if (color.a > 0) {
            node.fills?.push({
                type: 'SOLID',
                color: { r: color.r, g: color.g, b: color.b },
                opacity: color.a
            });
        }

        // Background Images (Multiple support) - including gradients
        if (style.backgroundImage && style.backgroundImage !== 'none') {
            // Check for gradients FIRST
            if (style.backgroundImage.includes('gradient')) {
                const gradient = parseGradient(style.backgroundImage);
                if (gradient) {
                    node.fills?.push(gradient);
                    node.isContentOnly = false;
                }
            }

            // Then check for image URLs
            const regex = /url\(['"]?(.*?)['"]?\)/g;
            let match;
            const urls: string[] = [];

            while ((match = regex.exec(style.backgroundImage)) !== null) {
                if (match[1]) {
                    urls.push(match[1]);
                }
            }

            // CSS lists background images top-to-bottom (first is top).
            // Figma fills are back-to-front (last is top).
            // Reverse order.
            urls.reverse();

            // PERFORMANCE FIX: Load all images in parallel instead of sequentially
            const imagePromises = urls.map(async (urlStr): Promise<Paint | null> => {
                const url = this.normalizeUrl(urlStr);
                try {
                    const base64 = await imageToBase64(url);
                    if (base64) {
                        return {
                            type: 'IMAGE',
                            scaleMode: 'FILL',
                            imageHash: '',
                            _base64: base64
                        };
                    }
                } catch (e) {
                    console.warn('Failed to extract background image', url, e);
                }
                return null;
            });

            const imageFills = (await Promise.all(imagePromises)).filter((fill): fill is Paint => fill !== null);
            if (imageFills.length > 0) {
                node.fills?.push(...imageFills);
                node.isContentOnly = false;
            }
        }

        // Mask Image (common for icon fonts and sprites)
        if (style.webkitMaskImage && style.webkitMaskImage !== 'none') {
            const urlMatch = style.webkitMaskImage.match(/url\(['"]?(.*?)['"]?\)/);
            if (urlMatch && urlMatch[1]) {
                const url = this.normalizeUrl(urlMatch[1]);
                try {
                    const base64 = await imageToBase64(url);
                    if (base64) {
                        node.fills?.push({
                            type: 'IMAGE',
                            scaleMode: 'FILL',
                            imageHash: '',
                            _base64: base64
                        });
                        node.isContentOnly = false;
                    }
                } catch (e) {
                    console.warn('Failed to extract mask image', url, e);
                }
            }
        }

        // List Style Image
        if (style.listStyleImage && style.listStyleImage !== 'none') {
            const urlMatch = style.listStyleImage.match(/url\(['"]?(.*?)['"]?\)/);
            if (urlMatch && urlMatch[1]) {
                const url = this.normalizeUrl(urlMatch[1]);
                try {
                    const base64 = await imageToBase64(url);
                    if (base64) {
                        node.fills?.push({
                            type: 'IMAGE',
                            scaleMode: 'FILL',
                            imageHash: '',
                            _base64: base64
                        });
                        node.isContentOnly = false;
                    }
                } catch (e) {
                    console.warn('Failed to extract list style image', url, e);
                }
            }
        }
    }

    private extractBorders(node: LayerNode, style: CSSStyleDeclaration) {
        if (style.borderStyle !== 'none' && parseFloat(style.borderWidth) > 0) {
            const color = parseColor(style.borderColor);
            node.strokes?.push({
                type: 'SOLID',
                color: { r: color.r, g: color.g, b: color.b },
                opacity: color.a
            });
            node.strokeWeight = parseFloat(style.borderWidth);
        }
    }

    private extractShadows(node: LayerNode, style: CSSStyleDeclaration) {
        if (style.boxShadow && style.boxShadow !== 'none') {
            node.effects = parseBoxShadow(style.boxShadow);
        }
    }

    private extractRadius(node: LayerNode, style: CSSStyleDeclaration) {
        const tl = parseFloat(style.borderTopLeftRadius);
        const tr = parseFloat(style.borderTopRightRadius);
        const bl = parseFloat(style.borderBottomLeftRadius);
        const br = parseFloat(style.borderBottomRightRadius);

        if (tl === tr && tr === bl && bl === br) {
            node.cornerRadius = tl;
        } else {
            node.cornerRadius = { topLeft: tl, topRight: tr, bottomLeft: bl, bottomRight: br };
        }
    }

    private extractTransform(node: LayerNode, style: CSSStyleDeclaration) {
        const transform = parseTransform(style.transform);
        if (transform.rotation !== 0) {
            node.rotation = transform.rotation;
        }
        // Note: Figma doesn't support scale on individual nodes the same way CSS does
        // Scale is effectively baked into width/height via getBoundingClientRect
    }

    private extractClipping(node: LayerNode, style: CSSStyleDeclaration) {
        node.clipsContent = shouldClipContent(style);

        // Extract backdrop-filter for glassmorphism effects
        const backdropBlur = parseBackdropFilter(style.backdropFilter);
        if (backdropBlur) {
            if (!node.effects) node.effects = [];
            node.effects.push(backdropBlur);
        }
    }

    private getBlendMode(style: CSSStyleDeclaration): BlendMode {
        const map: Record<string, BlendMode> = {
            'normal': 'NORMAL',
            'multiply': 'MULTIPLY',
            'screen': 'SCREEN',
            'overlay': 'OVERLAY',
            'darken': 'DARKEN',
            'lighten': 'LIGHTEN',
            'color-dodge': 'COLOR_DODGE',
            'color-burn': 'COLOR_BURN',
            'hard-light': 'HARD_LIGHT',
            'soft-light': 'SOFT_LIGHT',
            'difference': 'DIFFERENCE',
            'exclusion': 'EXCLUSION',
            'hue': 'HUE',
            'saturation': 'SATURATION',
            'color': 'COLOR',
            'luminosity': 'LUMINOSITY'
        };
        return map[style.mixBlendMode] || 'NORMAL';
    }

    private async handleImage(node: LayerNode, img: HTMLImageElement) {
        node.type = 'IMAGE';

        // 1. Try generic lazy load attributes
        let url = img.currentSrc || img.src;
        const dataset = img.dataset;
        if (dataset.src) url = dataset.src;
        else if (dataset.lazySrc) url = dataset.lazySrc;
        else if (dataset.original) url = dataset.original;
        else if (dataset.sysimg) url = dataset.sysimg;

        // 2. Handle Srcset (Pick largest)
        if (img.srcset) {
            try {
                const sources = img.srcset.split(',').map(s => {
                    const parts = s.trim().split(' ');
                    return {
                        url: parts[0],
                        w: parts[1] ? parseInt(parts[1]) : 0
                    };
                });
                sources.sort((a, b) => b.w - a.w); // Descending
                if (sources.length > 0 && sources[0].url) {
                    url = sources[0].url;
                }
            } catch (e) {
                console.warn('Failed to parse srcset', e);
            }
        }

        // Handle inline data URLs directly
        if (url && url.startsWith('data:')) {
            if (url.includes('svg')) {
                try {
                    const svgData = decodeURIComponent(url.split(',')[1] || '');
                    if (svgData.includes('<svg')) {
                        const sanitized = sanitizeSvg(svgData);
                        if (sanitized) {
                            node.type = 'SVG';
                            node.svgContent = sanitized;
                            return;
                        } else {
                            this.addWarning('Dropped unsafe inline SVG image');
                        }
                    }
                } catch (e) {
                    console.warn('Failed to decode inline SVG', e);
                }
            }
            node.imageBase64 = url;
            node.fills?.push({
                type: 'IMAGE',
                scaleMode: 'FILL',
                imageHash: '',
                _base64: url
            });
            return;
        }

        url = this.normalizeUrl(url);

        // Check if it's an SVG image
        if (url.toLowerCase().endsWith('.svg') || url.includes('.svg?')) {
            try {
                const response = await fetch(url);
                if (response.ok) {
                    const svgText = await response.text();
                    if (svgText.includes('<svg')) {
                        const sanitized = sanitizeSvg(svgText);
                        if (sanitized) {
                            node.type = 'SVG';
                            node.svgContent = sanitized;
                            return;
                        } else {
                            this.addWarning(`Dropped unsafe SVG from ${url}`);
                        }
                    }
                }
            } catch (e) {
                console.warn('Failed to fetch SVG source for image, falling back to raster', url, e);
            }
        }

        const base64 = await imageToBase64(url);
        if (base64) {
            node.imageBase64 = base64;
            node.fills?.push({
                type: 'IMAGE',
                scaleMode: 'FILL',
                imageHash: '',
                _base64: base64
            });
        }
    }

    private handleSvg(node: LayerNode, svg: SVGElement) {
        node.type = 'SVG';

        // PERFORMANCE FIX: Clone SVG before processing to avoid DOM thrashing and live DOM mutation
        const clonedSvg = svg.cloneNode(true) as SVGElement;

        // Attempt to inline <use> tags
        try {
            const useTags = Array.from(clonedSvg.querySelectorAll('use'));
            for (const use of useTags) {
                const href = use.getAttribute('href') || use.getAttribute('xlink:href');
                if (href && href.startsWith('#')) {
                    const targetId = href.substring(1);
                    // Search in the entire document for the symbol
                    const target = document.getElementById(targetId);
                    if (target) {
                        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                        Array.from(use.attributes).forEach(attr => {
                            if (attr.name !== 'href' && attr.name !== 'xlink:href') {
                                group.setAttribute(attr.name, attr.value);
                            }
                        });
                        group.innerHTML = target.innerHTML;
                        use.parentNode?.replaceChild(group, use);
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to inline SVG use tags', e);
        }

        let svgHtml = clonedSvg.outerHTML;

        // FIDELITY FIX: Resolve 'currentColor' to actual color
        // Many icons use fill="currentColor" to inherit text color.
        // Figma doesn't support this dynamic binding on import, so we bake it in.
        if (svgHtml.includes('currentColor')) {
            const style = window.getComputedStyle(svg);
            const color = style.color || 'black';
            // Replace all instances of currentColor with the computed rgb/rgba string
            svgHtml = svgHtml.replace(/currentColor/g, color);
        }

        const sanitized = sanitizeSvg(svgHtml);
        if (sanitized) {
            node.svgContent = sanitized;
        } else {
            this.addWarning('Dropped unsafe SVG element');
            node.type = 'FRAME';
            node.name = 'SVG (sanitized)';
        }
    }

    private async handleVideo(node: LayerNode, video: HTMLVideoElement) {
        let posterUrl = video.poster;
        let base64: string | null = null;

        // 1. Try Poster
        if (posterUrl) {
            posterUrl = this.normalizeUrl(posterUrl);
            base64 = await imageToBase64(posterUrl);
        }

        // 2. If no poster (or failed), try capturing current frame
        if (!base64) {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth || video.clientWidth;
                canvas.height = video.videoHeight || video.clientHeight;
                const ctx = canvas.getContext('2d');
                if (ctx && video.readyState >= 2) { // HAVE_CURRENT_DATA
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    base64 = canvas.toDataURL('image/png');
                }
            } catch (e) {
                console.warn('Failed to capture video frame', e);
            }
        }

        if (base64) {
            node.type = 'IMAGE';
            node.imageBase64 = base64;
            if (!node.fills) node.fills = [];
            node.fills.push({
                type: 'IMAGE',
                scaleMode: 'FILL',
                imageHash: '',
                _base64: base64
            });
        } else {
            node.type = 'FRAME';
            node.name = 'Video Player';

            // Only add visual placeholder if we don't have other fills (like background image)
            if (!node.fills || node.fills.length === 0) {
                if (!node.fills) node.fills = [];
                node.fills.push({
                    type: 'SOLID',
                    color: { r: 0.2, g: 0.2, b: 0.2 },
                    opacity: 1
                });
            }
        }
    }

    private async handleCanvas(node: LayerNode, canvas: HTMLCanvasElement) {
        try {
            node.type = 'IMAGE';
            const dataUrl = canvas.toDataURL('image/png');
            if (dataUrl) {
                node.imageBase64 = dataUrl;
                if (!node.fills) node.fills = [];
                node.fills.push({
                    type: 'IMAGE',
                    scaleMode: 'FILL',
                    imageHash: '',
                    _base64: dataUrl
                });
            }
        } catch (e) {
            console.warn('Failed to capture canvas content', e);
            node.type = 'FRAME';
            node.name = 'Canvas (Tainted)';
        }
    }

    private async handlePicture(node: LayerNode, picture: HTMLPictureElement) {
        // Picture elements contain img as child, find it
        const img = picture.querySelector('img');
        if (img) {
            await this.handleImage(node, img as HTMLImageElement);
        } else {
            node.type = 'FRAME';
            node.name = 'Picture';
        }
    }

    private async processChildren(node: LayerNode, element: HTMLElement, depth: number) {
        const childNodes = Array.from(element.childNodes);
        const collectedChildren: LayerNode[] = [];

        if (this.shouldStopTraversal(depth)) return;

        const beforeNode = await this.collectPseudoElement(node, element, '::before', depth + 1);
        if (beforeNode) collectedChildren.push(beforeNode);

        for (const child of childNodes) {
            if (this.shouldStopTraversal(depth)) break;
            if (child.nodeType === Node.TEXT_NODE) {
                const textNode = this.createTextLeaf(child as Text, element, depth + 1);
                if (textNode) collectedChildren.push(textNode);
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const childElement = child as Element;
                // Handle SVG elements specially - they have a different namespace
                if (childElement instanceof SVGSVGElement) {
                    const svgNode = await this.collect(childElement as unknown as HTMLElement, depth + 1);
                    if (svgNode) collectedChildren.push(svgNode);
                } else if (childElement instanceof HTMLElement) {
                    const childLayer = await this.collect(childElement, depth + 1);
                    if (childLayer) {
                        collectedChildren.push(childLayer);
                    }
                }
            }
        }

        if (this.shouldStopTraversal(depth)) return;

        const afterNode = await this.collectPseudoElement(node, element, '::after', depth + 1);
        if (afterNode) collectedChildren.push(afterNode);

        // Sort children by stacking order (z-index)
        this.sortChildrenByZIndex(collectedChildren);

        if (!node.children) node.children = [];
        node.children.push(...collectedChildren);
    }

    private sortChildrenByZIndex(children: LayerNode[]) {
        const indexed = children.map((child, index) => ({ child, index }));

        indexed.sort((a, b) => {
            const az = a.child.zIndex || 0;
            const bz = b.child.zIndex || 0;
            if (az !== bz) return az - bz;

            // If z-index is same, positioning matters but DOM order should be fallback
            // Figma layers bottom-to-top, so higher index last
            return a.index - b.index;
        });

        children.splice(0, children.length, ...indexed.map(i => i.child));
    }

    private async collectPseudoElement(parentNode: LayerNode, element: HTMLElement, pseudoType: '::before' | '::after', depth: number): Promise<LayerNode | null> {
        if (this.shouldStopTraversal(depth)) return null;
        if (!this.reserveNode('pseudo', element, depth)) return null;

        const style = window.getComputedStyle(element, pseudoType);
        const content = style.content;

        if (!content || content === 'none' || content === 'normal') return null;

        const width = parseFloat(style.width);
        const height = parseFloat(style.height);
        const hasSize = width > 0 && height > 0;
        const hasContentString = content.replace(/['"]/g, '').length > 0;
        const urlMatch = content.match(/url\(['"]?(.*?)['"]?\)/);

        // Capture if it has content string OR url match OR (has size AND (border or background))
        // Many generic icons have empty content but use background-image and sizing.
        const hasBackground = style.backgroundImage !== 'none' || (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent');
        const hasBorder = style.borderStyle !== 'none' && parseFloat(style.borderWidth) > 0;

        if (!hasContentString && !urlMatch && !(hasSize && (hasBackground || hasBorder))) return null;

        /**
         * COORDINATE FIX: Pseudo-elements inherit parent's document-relative coordinates.
         * Parent coordinates are already document-relative, so we use them directly.
         * For positioned pseudo-elements, we calculate offset from parent.
         */
        const pseudoNode: LayerNode = {
            type: 'FRAME',
            name: pseudoType,
            x: parentNode.x,  // Inherit parent's document-relative X
            y: parentNode.y,  // Inherit parent's document-relative Y
            width: width || 0,
            height: height || 0,
            opacity: parseFloat(style.opacity),
            blendMode: this.getBlendMode(style),
            fills: [],
            strokes: [],
            effects: [],
            children: [],
            isContentOnly: false,
            zIndex: style.zIndex !== 'auto' ? parseInt(style.zIndex) : (pseudoType === '::after' ? 1 : -1)
        };

        // Handle positioned pseudo-elements (absolute/fixed)
        if (style.position === 'absolute' || style.position === 'fixed') {
            pseudoNode.layoutPositioning = 'ABSOLUTE';

            const top = parseFloat(style.top);
            const left = parseFloat(style.left);
            const right = parseFloat(style.right);
            const bottom = parseFloat(style.bottom);

            // Calculate document-relative position based on parent + offset
            // Parent coordinates are already document-relative
            if (!isNaN(top)) {
                pseudoNode.y = parentNode.y + top;
            }
            if (!isNaN(left)) {
                pseudoNode.x = parentNode.x + left;
            }
            if (isNaN(left) && !isNaN(right)) {
                pseudoNode.x = parentNode.x + parentNode.width - pseudoNode.width - right;
            }
            if (isNaN(top) && !isNaN(bottom)) {
                pseudoNode.y = parentNode.y + parentNode.height - pseudoNode.height - bottom;
            }
        }

        await this.extractBackgrounds(pseudoNode, style);

        if (urlMatch && urlMatch[1]) {
            const url = this.normalizeUrl(urlMatch[1]);
            const base64 = await imageToBase64(url);
            if (base64) {
                pseudoNode.type = 'IMAGE';
                pseudoNode.fills?.push({
                    type: 'IMAGE',
                    scaleMode: 'FILL',
                    imageHash: '',
                    _base64: base64
                });
                if (pseudoNode.width === 0) pseudoNode.width = 24;
                if (pseudoNode.height === 0) pseudoNode.height = 24;
            }
        }

        this.extractBorders(pseudoNode, style);
        this.extractShadows(pseudoNode, style);
        this.extractFilters(pseudoNode, style);
        this.extractRadius(pseudoNode, style);

        const cleanContent = content.replace(/['"]/g, '');
        if (cleanContent && cleanContent.length > 0 && !urlMatch) {
            pseudoNode.type = 'TEXT';
            pseudoNode.text = cleanContent;
            pseudoNode.fontFamily = style.fontFamily.split(',')[0].replace(/['"]/g, '');
            pseudoNode.fontSize = parseFloat(style.fontSize);
            pseudoNode.fontWeight = style.fontWeight;
            pseudoNode.textAlign = style.textAlign.toUpperCase() as any;
            const color = parseColor(style.color);
            if (!pseudoNode.fills) pseudoNode.fills = [];
            pseudoNode.fills.push({ type: 'SOLID', color: { r: color.r, g: color.g, b: color.b }, opacity: color.a });

            this.extractTextShadows(pseudoNode, style);
        }

        return pseudoNode;
    }

    private normalizeUrl(url: string): string {
        try {
            return new URL(url, document.baseURI).href;
        } catch (e) {
            return url;
        }
    }

    private createTextLeaf(textNode: Text, parent: HTMLElement, depth: number): LayerNode | null {
        if (this.shouldStopTraversal(depth)) return null;
        if (!this.reserveNode('text', parent, depth)) return null;

        const style = window.getComputedStyle(parent);
        const range = document.createRange();
        range.selectNode(textNode);
        const rect = range.getBoundingClientRect();

        if (rect.width === 0 && rect.height === 0) return null;

        const text = cleanText(textNode.textContent || '', style.whiteSpace);
        if (!text) return null;

        const color = parseColor(style.color);
        const fontSize = parseFloat(style.fontSize);

        // Add scroll offset for document-relative coordinates
        const scrollX = window.scrollX || window.pageXOffset || 0;
        const scrollY = window.scrollY || window.pageYOffset || 0;

        const node: LayerNode = {
            type: 'TEXT',
            name: 'Text',
            x: rect.x + scrollX,
            y: rect.y + scrollY,
            width: rect.width,
            height: rect.height,
            text: text,
            fontFamily: style.fontFamily.split(',')[0].replace(/['"]/g, ''),
            fontWeight: style.fontWeight,
            fontSize: fontSize,
            textAlign: ((): 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED' => {
                const align = style.textAlign.toLowerCase();
                if (align === 'center') return 'CENTER';
                if (align === 'right' || align === 'end') return 'RIGHT';
                if (align === 'justify') return 'JUSTIFIED';
                return 'LEFT';
            })(),
            // Enhanced text properties
            lineHeight: parseLineHeight(style.lineHeight, fontSize),
            letterSpacing: parseLetterSpacing(style.letterSpacing, fontSize),
            textDecoration: parseTextDecoration(style.textDecorationLine || style.textDecoration),
            textCase: parseTextCase(style.textTransform),
            fills: [{
                type: 'SOLID',
                color: { r: color.r, g: color.g, b: color.b },
                opacity: color.a
            }]
        };
        this.extractTextShadows(node, style);
        return node;
    }

    /**
     * Traversal guard: returns true when traversal should stop for this subtree
     */
    private shouldStopTraversal(depth: number): boolean {
        const timedOut = this.maxDurationMs > 0 && this.startedAt > 0 && (Date.now() - this.startedAt) > this.maxDurationMs;
        if (timedOut) {
            this.recordLimit('MAX_DURATION', `Capture timed out after ${this.maxDurationMs}ms`);
            return true;
        }

        if (depth > this.maxDepth) {
            this.recordLimit('MAX_DEPTH', `Max depth ${this.maxDepth} exceeded`);
            return true;
        }

        if (this.nodesVisited >= this.maxNodes) {
            this.recordLimit('MAX_NODES', `Max nodes ${this.maxNodes} reached`);
            return true;
        }

        return false;
    }

    /**
     * Reserve a node slot; returns false if limits exceeded.
     */
    private reserveNode(kind: 'element' | 'pseudo' | 'text', element: Element, depth: number): boolean {
        if (this.shouldStopTraversal(depth)) return false;
        this.nodesVisited += 1;
        if (this.nodesVisited > this.maxNodes) {
            this.recordLimit('MAX_NODES', `Max nodes ${this.maxNodes} reached (while adding ${kind} ${element.tagName || 'node'})`);
            return false;
        }
        return true;
    }

    private recordLimit(type: 'MAX_NODES' | 'MAX_DEPTH' | 'MAX_DURATION', message: string) {
        if (!this.limitFlags[type]) {
            this.limitFlags[type] = true;
            this.warnings.push(message);
        }
        this.limitHit = true;
    }

    private addWarning(message: string) {
        this.warnings.push(message);
    }

    private shouldPrune(node: LayerNode): boolean {
        if (node.isContentOnly) return true;

        const hasVisibleBg = (node.fills?.length ?? 0) > 0;
        const hasBorder = (node.strokes?.length ?? 0) > 0;
        const hasShadow = (node.effects?.length ?? 0) > 0;
        const isLayout = node.layoutMode !== 'NONE';

        const hasPadding = node.padding && (node.padding.top > 0 || node.padding.right > 0 || node.padding.bottom > 0 || node.padding.left > 0);
        const isSemantic = node.semanticType && node.semanticType !== 'CONTAINER';

        const hasOpacity = node.opacity !== undefined && !isNaN(node.opacity) && node.opacity < 1;
        const hasBlendMode = node.blendMode !== undefined && node.blendMode !== 'NORMAL';
        const hasRotation = node.rotation !== undefined && !isNaN(node.rotation) && node.rotation !== 0;
        const clipsContent = node.clipsContent === true;

        if (hasVisibleBg || hasBorder || hasShadow || isLayout || isSemantic || hasPadding || hasOpacity || hasBlendMode || hasRotation || clipsContent || node.type === 'IMAGE' || node.type === 'SVG' || node.type === 'TEXT') {
            return false;
        }

        return true;
    }
}

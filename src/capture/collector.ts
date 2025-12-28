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
        console.log('ContentCollector initialized (v2.1)');
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

            // Ensure style is captured immediately
            let style: CSSStyleDeclaration;
            try {
                style = window.getComputedStyle(element);
            } catch (e) {
                return null; // Detached element or other error
            }

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
                } else if (tagName === 'IFRAME') {
                    await this.handleIframe(node, element as HTMLIFrameElement);
                } else if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
                    await this.handleInput(node, element as HTMLElement);
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
            name: 'Container',
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

        // 2. Uniform Naming (User Request: "name every layer on figma is container")
        node.name = 'Container';
    }

    private extractLayout(node: LayerNode, style: CSSStyleDeclaration, element: HTMLElement) {
        const display = style.display;
        const pos = style.position;
        const isAbsolute = pos === 'absolute' || pos === 'fixed';
        const isFlex = display === 'flex' || display === 'inline-flex';
        const isGrid = display === 'grid' || display === 'inline-grid';
        // Treat standard block elements as Vertical Auto Layout
        const isBlock = display === 'block' || display === 'list-item';

        // 1. Positioning Strategy
        node.layoutPositioning = isAbsolute ? 'ABSOLUTE' : 'AUTO';

        // 2. Padding
        node.padding = {
            top: parseFloat(style.paddingTop) || 0,
            right: parseFloat(style.paddingRight) || 0,
            bottom: parseFloat(style.paddingBottom) || 0,
            left: parseFloat(style.paddingLeft) || 0,
        };

        // 3. Layout Mode
        if (isFlex) {
            node.layoutMode = style.flexDirection.includes('column') ? 'VERTICAL' : 'HORIZONTAL';
            
            const gap = parseGap(style.gap);
            node.itemSpacing = node.layoutMode === 'VERTICAL' ? gap.row : gap.col;
             
            // Flex Alignments
            const jc = style.justifyContent;
            if (jc.includes('center')) node.primaryAxisAlignItems = 'CENTER';
            else if (jc.includes('end') || jc.includes('flex-end')) node.primaryAxisAlignItems = 'MAX';
            else if (jc.includes('between')) node.primaryAxisAlignItems = 'SPACE_BETWEEN';
            else node.primaryAxisAlignItems = 'MIN';

            const ai = style.alignItems;
            if (ai.includes('center')) node.counterAxisAlignItems = 'CENTER';
            else if (ai.includes('end') || ai.includes('flex-end')) node.counterAxisAlignItems = 'MAX';
            else if (ai.includes('baseline')) node.counterAxisAlignItems = 'BASELINE';
            else node.counterAxisAlignItems = 'MIN';

            // Wrap
            if (style.flexWrap === 'wrap') {
                node.layoutWrap = 'WRAP';
                node.counterAxisSpacing = node.layoutMode === 'VERTICAL' ? gap.col : gap.row;
            }

        } else if (isGrid) {
            // Grid -> Horizontal Wrap
             node.layoutMode = 'HORIZONTAL';
             node.layoutWrap = 'WRAP';
             
             const gap = parseGap(style.gap);
             node.itemSpacing = gap.col;
             node.counterAxisSpacing = gap.row;
             
             node.primaryAxisAlignItems = 'MIN';
             node.counterAxisAlignItems = 'MIN';

        } else if (isBlock && !isAbsolute) {
             // Block Flow -> Vertical Stack
             node.layoutMode = 'VERTICAL';
             node.itemSpacing = 0; // Block elements stack with 0 gap (margins handled by wrapper)
             node.primaryAxisAlignItems = 'MIN';
             node.counterAxisAlignItems = 'MIN'; // Default left align
        } else {
             // Fallback for others (inline, table, etc.) or Absolute
             node.layoutMode = 'NONE';
        }

        // 4. Sizing Inference
        // Check explicit styles
        const styleW = element.style.width;
        const styleH = element.style.height;
        const flexGrow = parseFloat(style.flexGrow) || 0;
        const alignSelf = style.alignSelf;

        node.layoutGrow = flexGrow;
        if (alignSelf === 'stretch') node.layoutAlign = 'STRETCH';
        else if (alignSelf === 'center') node.layoutAlign = 'CENTER';
        else if (alignSelf === 'flex-start' || alignSelf === 'start') node.layoutAlign = 'MIN';
        else if (alignSelf === 'flex-end' || alignSelf === 'end') node.layoutAlign = 'MAX';
        
        // Helper to check if size is determined by content
        const isContentSizedW = styleW === 'fit-content' || styleW === 'max-content' || styleW === 'auto';
        const isContentSizedH = styleH === 'fit-content' || styleH === 'max-content' || styleH === 'auto';

        // Default assumptions based on display type
        let hSizing: 'FIXED' | 'HUG' | 'FILL' = 'FIXED';
        let vSizing: 'FIXED' | 'HUG' | 'FILL' = 'FIXED';

        if (isFlex || isGrid) {
            // Flex Containers usually behave like blocks (FILL width) unless inline-flex (HUG width)
            hSizing = display.includes('inline') ? 'HUG' : 'FILL';
            // Height is usually HUG unless fixed
            vSizing = 'HUG';
        } else if (isBlock) {
             // Blocks FILL width and HUG height by default
             hSizing = 'FILL';
             vSizing = 'HUG';
        }

        // Overrides based on explicit styles
        if (styleW && styleW !== 'auto' && !styleW.includes('%')) hSizing = 'FIXED';
        if (styleH && styleH !== 'auto' && !styleH.includes('%')) vSizing = 'FIXED';
        
        // Percentage often means FILL (relative to parent)
        if (styleW?.includes('%')) hSizing = 'FILL';
        if (styleH?.includes('%')) vSizing = 'FILL';

        // Overrides based on Flex/Grid context (Parent's layout dictates child behavior, but we infer from child props)
        // Note: This logic is applied to the CONTAINER itself.
        // However, flex-grow applies to the element as a CHILD.
        // If THIS element has flex-grow, it means it should FILL its PARENT's primary axis.
        // But we need to know the PARENT's layout mode to know which axis is primary.
        // We don't have parent context easily here.
        // BUT: CSS 'width' on a flex item is often ignored if flex-grow is set.
        
        // If we detect flex-grow, we can assume it wants to FILL the relevant axis
        // We'll trust the Builder to apply this to the child in the parent context.
        // Here we just set the preferred *internal* sizing mode?
        // No, layoutSizingHorizontal IS the property for "Resizing" panel in Figma (Fill/Hug/Fixed).
        
        // So if this element is a child of a flex row, and has flex-grow: 1, 
        // Figma needs layoutSizingHorizontal = FILL.
        // We can't know for sure if parent is row or col here without passing parent context.
        // However, 'flex-grow' implies filling the main axis.
        // Since we don't know the axis, we can't definitively set hSizing or vSizing here based on flex-grow alone
        // without knowing parent direction.
        
        // STRICTER RULE: We will rely on 'layoutGrow' being passed to Figma.
        // The Builder (src/sandbox/builder.ts) applies 'layoutGrow'.
        // Figma automatically handles the sizing if layoutGrow is set? 
        // Actually, in Figma, setting layoutGrow = 1 automatically sets primary axis sizing to FILL.
        // So we just need to ensure layoutGrow is passed. (Done above).
        
        // What about align-self: stretch?
        // If align-self is stretch, counter axis sizing should be FILL.
        // Again, dependent on parent axis.
        
        // HEURISTIC: Standard Web Defaults
        // If width is NOT fixed px, and it's a block/div, it's usually FILL width.
        
        // Apply to Node
        if (node.layoutMode === 'HORIZONTAL') {
            node.layoutSizingHorizontal = hSizing;
            node.layoutSizingVertical = vSizing;
        } else if (node.layoutMode === 'VERTICAL') {
            node.layoutSizingHorizontal = hSizing; // Cross axis for vertical is Horizontal
            node.layoutSizingVertical = vSizing;   // Primary axis for vertical is Vertical
        } else {
            // Absolute frames
            node.layoutSizingHorizontal = 'FIXED';
            node.layoutSizingVertical = 'FIXED';
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

    private async handleSvg(node: LayerNode, svg: SVGElement) {
        node.type = 'SVG';

        // 1. Inline computed styles (fill, stroke, etc.) to ensure visual fidelity
        this.inlineSvgStyles(svg);

        // Attempt to inline <use> tags
        try {
            const useTags = Array.from(svg.querySelectorAll('use'));
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

        let svgHtml = svg.outerHTML;

        // FIDELITY FIX: Resolve 'currentColor' to actual color
        if (svgHtml.includes('currentColor')) {
            const style = window.getComputedStyle(svg);
            const color = style.color || 'black';
            svgHtml = svgHtml.replace(/currentColor/g, color);
        }

        const sanitized = sanitizeSvg(svgHtml);
        if (sanitized) {
            node.svgContent = sanitized;
        } else {
            // Fallback: Rasterize to Image if vector capture fails
            await this.rasterizeSvg(node, svg);
        }
    }

    private inlineSvgStyles(svg: SVGElement) {
        // Recursively inline critical CSS properties for all SVG children
        const walker = (el: Element) => {
            if (el instanceof SVGElement) {
                const style = window.getComputedStyle(el);
                
                // Fill
                const fill = style.fill;
                if (fill && fill !== 'none' && !el.hasAttribute('fill')) {
                    el.setAttribute('fill', fill);
                }
                
                // Stroke
                const stroke = style.stroke;
                if (stroke && stroke !== 'none' && !el.hasAttribute('stroke')) {
                    el.setAttribute('stroke', stroke);
                }
                const strokeWidth = style.strokeWidth;
                if (strokeWidth && strokeWidth !== '0px' && !el.hasAttribute('stroke-width')) {
                    el.setAttribute('stroke-width', strokeWidth);
                }
                
                // Opacity
                const opacity = style.opacity;
                if (opacity && opacity !== '1' && !el.hasAttribute('opacity')) {
                    el.setAttribute('opacity', opacity);
                }
                
                // Visibility
                if (style.visibility === 'hidden') {
                    el.setAttribute('visibility', 'hidden');
                }
                
                // Display
                if (style.display === 'none') {
                    el.setAttribute('display', 'none');
                }
            }
            
            for (const child of Array.from(el.children)) {
                walker(child);
            }
        };
        
        try {
            walker(svg);
        } catch (e) {
            console.warn('Failed to inline SVG styles', e);
        }
    }

    private async rasterizeSvg(node: LayerNode, svg: SVGElement) {
        try {
            const rect = svg.getBoundingClientRect();
            const width = rect.width || 24;
            const height = rect.height || 24;

            // Serialize and encode
            const xml = new XMLSerializer().serializeToString(svg);
            const svg64 = btoa(unescape(encodeURIComponent(xml)));
            const b64Start = `data:image/svg+xml;base64,${svg64}`;

            const base64 = await this.loadImageToCanvas(b64Start, width, height);

            if (base64) {
                node.type = 'IMAGE';
                node.imageBase64 = base64;
                node.fills = [{
                    type: 'IMAGE',
                    scaleMode: 'FILL',
                    imageHash: '',
                    _base64: base64
                }];
                // Ensure name indicates it was rasterized
                node.name = (node.name || 'SVG') + ' (Raster)';
            } else {
                node.type = 'FRAME';
                node.name = 'SVG (Failed)';
            }
        } catch (e) {
            console.warn('Rasterize SVG failed', e);
        }
    }

    private loadImageToCanvas(url: string, width: number, height: number): Promise<string | null> {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                // Scale for better quality (2x)
                const scale = 2;
                canvas.width = width * scale;
                canvas.height = height * scale;
                
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.scale(scale, scale);
                    ctx.drawImage(img, 0, 0, width, height);
                    try {
                        resolve(canvas.toDataURL('image/png'));
                    } catch { resolve(null); }
                } else { resolve(null); }
            };
            img.onerror = () => resolve(null);
            img.src = url;
        });
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

    private async handleIframe(node: LayerNode, iframe: HTMLIFrameElement) {
        node.type = 'FRAME';
        node.name = 'Iframe';

        try {
            // Try to access content if same-origin
            const doc = iframe.contentDocument;
            if (doc && doc.body) {
                // We can potentially capture the iframe content recursively!
                // However, we need to adjust coordinates since the iframe has its own coordinate space.
                // For now, let's treat it as a container and try to collect its body.
                
                // Note: deeply recursive iframe capture is complex due to coordinate mapping.
                // A simple approach is to capture the body as children of this node.
                // We must reset the 'root' context for coordinates or handle offsets.
                
                // LIMITATION: Coordinates in the recursive call will be relative to the iframe's document.
                // Our Collector uses document-relative coords.
                // If we recurse, the child nodes will have X/Y relative to iframe 0,0.
                // When we build in Figma, we need to ensure the Iframe Frame is positioned correctly (it is),
                // and its children are relative to it.
                // Since our Builder subtracts parentAbsoluteX/Y, this works out!
                // IF the iframe node itself is the "Parent" in Figma.
                
                // Let's try to collect the body's children.
                await this.processChildren(node, doc.body, 0); // Reset depth to allow full capture? Or keep depth? Keep depth for safety.
                
                // If we successfully captured children, we don't need a placeholder fill.
                if (node.children && node.children.length > 0) {
                    return;
                }
            }
        } catch (e) {
            // Access denied (cross-origin)
            this.addWarning(`Cannot capture cross-origin iframe: ${iframe.src}`);
        }

        // Fallback: Visual Placeholder
        node.fills = [{
            type: 'SOLID',
            color: { r: 0.9, g: 0.9, b: 0.9 },
            opacity: 1
        }];
        
        // Add a text label
        const label: LayerNode = {
            type: 'TEXT',
            name: 'Label',
            x: node.x + 10,
            y: node.y + 10,
            width: node.width - 20,
            height: 20,
            text: `IFRAME: ${iframe.src || 'Embedded Content'}`,
            fontFamily: 'Inter',
            fontSize: 12,
            fontWeight: 'normal',
            textAlign: 'LEFT',
            fills: [{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 1 }]
        };
        
        if (!node.children) node.children = [];
        node.children.push(label);
    }

    private async handleInput(node: LayerNode, element: HTMLElement) {
        let text = '';
        let isPlaceholder = false;

        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            text = element.value;
            if (!text && element.placeholder) {
                text = element.placeholder;
                isPlaceholder = true;
            }
        } else if (element instanceof HTMLSelectElement) {
            text = element.options[element.selectedIndex]?.text || '';
        }

        if (!text) return;

        const style = window.getComputedStyle(element);
        const fontSize = parseFloat(style.fontSize);

        // Calculate vertical alignment for text within the input box
        // Inputs often have padding, we need to respect that.
        // The parent 'node' (FRAME) already has the bounding box and padding of the input.
        // We just need to create a text node inside it.
        // But wait, the 'node' creation in 'collect' already handles padding via 'node.padding'.
        // Figma text inside an Auto Layout frame (which our inputs effectively are) will be positioned by padding.
        // However, we are using ABSOLUTE positioning.
        // So we need to calculate the absolute X/Y of the text.

        // Get padding values again
        const paddingTop = parseFloat(style.paddingTop) || 0;
        const paddingLeft = parseFloat(style.paddingLeft) || 0;
        const paddingRight = parseFloat(style.paddingRight) || 0;
        const paddingBottom = parseFloat(style.paddingBottom) || 0;

        // Effective content box
        const contentX = node.x + paddingLeft;
        const contentY = node.y + paddingTop;
        const contentWidth = node.width - paddingLeft - paddingRight;
        const contentHeight = node.height - paddingTop - paddingBottom;

        const textNode: LayerNode = {
            type: 'TEXT',
            name: isPlaceholder ? 'Placeholder' : 'Value',
            x: contentX,
            y: contentY,
            width: contentWidth,
            height: contentHeight, // Text node height usually matches content height for inputs
            text: text,
            fontFamily: style.fontFamily.split(',')[0].replace(/['"]/g, ''),
            fontWeight: style.fontWeight,
            fontSize: fontSize,
            textAlign: 'LEFT', // Inputs are usually left-aligned, but check style
            lineHeight: parseLineHeight(style.lineHeight, fontSize),
            letterSpacing: parseLetterSpacing(style.letterSpacing, fontSize),
            textCase: parseTextCase(style.textTransform),
            fills: await this.resolveTextFills(style)
        };

        // If placeholder, reduce opacity or change color if possible
        if (isPlaceholder) {
            // Placeholder pseudo-element color is hard to get via JS.
            // Best guess: reduce opacity of the text color
            if (textNode.fills && textNode.fills[0] && textNode.fills[0].color) {
                textNode.fills[0].opacity = (textNode.fills[0].opacity || 1) * 0.6;
            }
        }

        // Handle Text Align
        const textAlign = style.textAlign.toUpperCase();
        if (textAlign === 'CENTER' || textAlign === 'RIGHT' || textAlign === 'JUSTIFY') {
            textNode.textAlign = textAlign === 'JUSTIFY' ? 'JUSTIFIED' : textAlign as 'CENTER' | 'RIGHT';
        }

        // Add to children
        if (!node.children) node.children = [];
        node.children.push(textNode);
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
        // Retrieve style for flex direction check
        const style = window.getComputedStyle(element);

        // SHADOW DOM SUPPORT
        // If the element has a shadow root, we must capture that tree instead of light DOM children
        // (unless we want to handle slots, but for now capturing the shadow root is the priority for Web Components)
        let childNodes: Node[];
        let rootElement: Element | DocumentFragment = element;

        if (element.shadowRoot) {
            // It's a web component or shadow host
            childNodes = Array.from(element.shadowRoot.childNodes);
            rootElement = element.shadowRoot;
            
            // Note: Pseudo elements (::before/::after) don't apply to the host the same way if shadow root is present,
            // but the host itself is still an element in the light DOM so it can have them.
            // We keep the logic for pseudo elements on the HOST 'element'.
        } else {
            childNodes = Array.from(element.childNodes);
        }

        const collectedChildren: LayerNode[] = [];

        if (this.shouldStopTraversal(depth)) return;

        const beforeNode = await this.collectPseudoElement(node, element, '::before', depth + 1);
        if (beforeNode) collectedChildren.push(beforeNode);

        for (const child of childNodes) {
            if (this.shouldStopTraversal(depth)) break;
            if (child.nodeType === Node.TEXT_NODE) {
                const textNode = await this.createTextLeaf(child as Text, element, depth + 1);
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

        // Handle Flex Reverse direction
        if (style.flexDirection === 'row-reverse' || style.flexDirection === 'column-reverse') {
            collectedChildren.reverse();
        }

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
            // FIDELITY FIX: Check for icon fonts or single characters that might be icons
            const fontFamily = style.fontFamily.toLowerCase();
            const isIconFont = fontFamily.includes('icon') || fontFamily.includes('awesome') || fontFamily.includes('material') || fontFamily.includes('glyph');
            // If it's a single char and not a standard letter/number, it's likely an icon
            const isSingleChar = cleanContent.length === 1 && !/[a-zA-Z0-9]/.test(cleanContent);

            if (isIconFont || isSingleChar) {
                // RASTERIZE ICON FONTS
                // We can't easily rasterize a pseudo-element directly via HTMLCanvasElement.
                // Best effort: Try to create a canvas, set font, and draw text.
                const fontSize = parseFloat(style.fontSize) || 16;
                const fontWeight = style.fontWeight || 'normal';
                const font = `${fontWeight} ${fontSize}px ${style.fontFamily}`;
                const color = style.color || '#000000';
                
                // approximate width/height if 0
                const drawW = pseudoNode.width || fontSize * 1.5;
                const drawH = pseudoNode.height || fontSize * 1.5;

                const base64 = await this.textToImage(cleanContent, font, color, drawW, drawH);
                
                if (base64) {
                    pseudoNode.type = 'IMAGE';
                    pseudoNode.name = `${pseudoType} (Icon)`;
                    pseudoNode.imageBase64 = base64;
                    if (!pseudoNode.fills) pseudoNode.fills = [];
                    pseudoNode.fills.push({
                        type: 'IMAGE',
                        scaleMode: 'FILL',
                        imageHash: '',
                        _base64: base64
                    });
                    if (pseudoNode.width === 0) pseudoNode.width = drawW;
                    if (pseudoNode.height === 0) pseudoNode.height = drawH;
                } else {
                    // Fallback to text if canvas fails
                    pseudoNode.type = 'TEXT';
                    pseudoNode.text = cleanContent;
                    pseudoNode.fontFamily = style.fontFamily.split(',')[0].replace(/['"]/g, '');
                    pseudoNode.fontSize = fontSize;
                    pseudoNode.fontWeight = style.fontWeight;
                    pseudoNode.textAlign = 'CENTER';
                    pseudoNode.fills = await this.resolveTextFills(style);
                }
            } else {
                pseudoNode.type = 'TEXT';
                pseudoNode.text = cleanContent;
                pseudoNode.fontFamily = style.fontFamily.split(',')[0].replace(/['"]/g, '');
                pseudoNode.fontSize = parseFloat(style.fontSize);
                pseudoNode.fontWeight = style.fontWeight;
                pseudoNode.textAlign = style.textAlign.toUpperCase() as any;
                pseudoNode.fills = await this.resolveTextFills(style);

                this.extractTextShadows(pseudoNode, style);
            }
        }

        return pseudoNode;
    }

    private textToImage(text: string, font: string, color: string, width: number, height: number): Promise<string | null> {
        return new Promise((resolve) => {
            try {
                const canvas = document.createElement('canvas');
                const scale = 2; // Retina quality
                canvas.width = width * scale;
                canvas.height = height * scale;
                const ctx = canvas.getContext('2d');
                if (!ctx) { resolve(null); return; }

                ctx.scale(scale, scale);
                ctx.font = font;
                ctx.fillStyle = color;
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'center';
                
                // Draw in center
                ctx.fillText(text, width / 2, height / 2);
                
                resolve(canvas.toDataURL('image/png'));
            } catch (e) {
                resolve(null);
            }
        });
    }

    private normalizeUrl(url: string): string {
        try {
            return new URL(url, document.baseURI).href;
        } catch (e) {
            return url;
        }
    }

    private async resolveTextFills(style: CSSStyleDeclaration): Promise<Paint[]> {
        const fills: Paint[] = [];

        // Check for background-clip: text (Gradient Text)
        const bgClip = style.backgroundClip || (style as any).webkitBackgroundClip;
        const isTextClip = bgClip === 'text';

        // Check for text-fill-color override
        const webkitFill = (style as any).webkitTextFillColor;
        const hasWebkitFill = webkitFill && webkitFill !== 'currentcolor';

        if (isTextClip) {
            // Priority: Background Gradients/Images -> Background Color
            
            // 1. Gradients / Images
            if (style.backgroundImage && style.backgroundImage !== 'none') {
                // Gradients
                if (style.backgroundImage.includes('gradient')) {
                    const gradient = parseGradient(style.backgroundImage);
                    if (gradient) {
                        fills.push(gradient);
                    }
                }
                
                // Image Text (Texture)
                const regex = /url\(['"]?(.*?)['"]?\)/g;
                let match;
                const urls: string[] = [];
                while ((match = regex.exec(style.backgroundImage)) !== null) {
                    if (match[1]) urls.push(match[1]);
                }
                urls.reverse(); // Standardize order

                for (const urlStr of urls) {
                    const url = this.normalizeUrl(urlStr);
                    try {
                        const base64 = await imageToBase64(url);
                        if (base64) {
                            fills.push({
                                type: 'IMAGE',
                                scaleMode: 'FILL',
                                imageHash: '',
                                _base64: base64
                            });
                        }
                    } catch (e) {
                        console.warn('Failed to load text texture', url);
                    }
                }
            }

            // 2. Background Color (if no gradient/image or blended)
            const bgColor = parseColor(style.backgroundColor);
            if (bgColor.a > 0 && fills.length === 0) {
                fills.push({
                    type: 'SOLID',
                    color: { r: bgColor.r, g: bgColor.g, b: bgColor.b },
                    opacity: bgColor.a
                });
            }
        }

        // If no fills from background clip, or explicitly using text-fill-color, or just standard color
        if (fills.length === 0) {
            let colorStr = style.color;
            if (hasWebkitFill) {
                colorStr = webkitFill;
            }
            const color = parseColor(colorStr);
            fills.push({
                type: 'SOLID',
                color: { r: color.r, g: color.g, b: color.b },
                opacity: color.a
            });
        }

        return fills;
    }

    private async createTextLeaf(textNode: Text, parent: HTMLElement, depth: number): Promise<LayerNode | null> {
        if (this.shouldStopTraversal(depth)) return null;
        if (!this.reserveNode('text', parent, depth)) return null;

        const style = window.getComputedStyle(parent);
        const range = document.createRange();
        range.selectNode(textNode);
        const rect = range.getBoundingClientRect();

        if (rect.width === 0 && rect.height === 0) return null;

        const text = cleanText(textNode.textContent || '', style.whiteSpace);
        if (!text) return null;

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
            fills: await this.resolveTextFills(style)
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

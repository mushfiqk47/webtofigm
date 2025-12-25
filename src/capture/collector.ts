import { LayerNode, Paint, Effect, BlendMode, TextCase, TextDecoration } from '../types/layer-node';
import { isHidden, parseColor, parseBoxShadow, parseFilterDropShadow, cleanText, imageToBase64, parseGap } from './dom-utils';

export class ContentCollector {
    root: HTMLElement;

    constructor(root: HTMLElement) {
        this.root = root;
    }

    async collect(element: HTMLElement): Promise<LayerNode | null> {
        try {
            const style = window.getComputedStyle(element);

            if (isHidden(element, style)) {
                return null;
            }

            const isDisplayContents = style.display === 'contents';
            const rect = element.getBoundingClientRect();

            // Base Node Construction
            const node: LayerNode = {
                type: 'FRAME',
                name: element.tagName.toLowerCase(),
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                opacity: parseFloat(style.opacity),
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

                // 3. Layout Extraction (Flex/Grid -> AutoLayout)
                this.extractLayout(node, style);

                // 4. Content Handling
                if (element.tagName === 'IMG') {
                    await this.handleImage(node, element as HTMLImageElement);
                } else if (element.tagName === 'SVG') {
                    this.handleSvg(node, element as unknown as SVGElement);
                } else if (element.tagName === 'VIDEO') {
                    await this.handleVideo(node, element as HTMLVideoElement);
                } else if (element.tagName === 'CANVAS') {
                    await this.handleCanvas(node, element as HTMLCanvasElement);
                } else if (element.tagName === 'PICTURE') {
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
                await this.processChildren(node, element);
            }

            // 6. Pruning
            if (this.shouldPrune(node)) {
                node.isContentOnly = true;
            }

            return node;
        } catch (e) {
            console.warn('Error collecting node', element, e);
            return null;
        }
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
        if (tag === 'BUTTON' || (tag === 'A' && element.classList.contains('btn'))) node.semanticType = 'BUTTON';
        else if (tag === 'INPUT') node.semanticType = 'INPUT';
        else if (tag === 'IMG') node.semanticType = 'IMAGE';
        else if (tag === 'SECTION' || tag === 'HEADER' || tag === 'FOOTER') node.semanticType = 'SECTION';

        if (node.semanticType) {
            node.name = `${node.semanticType.toLowerCase()}`;
        }
        if (element.id) node.name += `#${element.id}`;
        else if (element.className && typeof element.className === 'string') node.name += `.${element.className.split(' ')[0]}`;
    }

    private extractLayout(node: LayerNode, style: CSSStyleDeclaration) {
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
            node.layoutMode = (style.flexDirection === 'row' || style.flexDirection === 'row-reverse' || (isGrid && style.gridAutoFlow.includes('column'))) ? 'HORIZONTAL' : 'VERTICAL';
            
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
            else if (align === 'stretch') node.counterAxisAlignItems = 'MIN'; // Figma doesn't really have "stretch" for auto layout, it uses "Fill Container" on children

            const justify = style.justifyContent;
            if (justify === 'flex-start' || justify === 'start') node.primaryAxisAlignItems = 'MIN';
            else if (justify === 'flex-end' || justify === 'end') node.primaryAxisAlignItems = 'MAX';
            else if (justify === 'center') node.primaryAxisAlignItems = 'CENTER';
            else if (justify === 'space-between') node.primaryAxisAlignItems = 'SPACE_BETWEEN';

            if (style.flexWrap === 'wrap' || isGrid) {
                node.layoutWrap = 'WRAP';
            }
        } else {
            // Standard Flow Layout -> FORCE Vertical Auto Layout
            // The user wants "Always Auto Layout".
            // We treat almost everything as a vertical stack of content.
            node.layoutMode = 'VERTICAL';
            node.primaryAxisAlignItems = 'MIN';
            node.counterAxisAlignItems = 'MIN';
            node.itemSpacing = parseFloat(style.rowGap) || 0;

            // If it's a list item, we might want to handle marker? 
            // For now, capturing the LI as a frame is fine.
        }

        const isWidthFill = style.width === '100%' || style.width === '100vw' || parseFloat(style.flexGrow) > 0;
        const isHeightFill = style.height === '100%' || style.height === '100vh';

        node.layoutSizingHorizontal = isWidthFill ? 'FILL' : 'HUG';
        node.layoutSizingVertical = isHeightFill ? 'FILL' : 'HUG';

        // For non-flex/grid elements, if they are "block-like" (taking full width), force FILL.
        // display: block, list-item, flow-root, flex (handled above), grid (handled above), table, etc.
        // Basically if it's NOT inline or inline-block (unless width is 100%), default to FILL.
        if (node.layoutMode === 'VERTICAL' && !isFlex && !isGrid) {
            if (display !== 'inline' && display !== 'inline-block' && display !== 'inline-flex' && display !== 'inline-grid') {
                node.layoutSizingHorizontal = 'FILL';
            }
        }

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

        // Background Images (Multiple support)
        if (style.backgroundImage && style.backgroundImage !== 'none') {
            // Use exec loop instead of matchAll for better compatibility
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

            for (const urlStr of urls) {
                const url = this.normalizeUrl(urlStr);
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
                    console.warn('Failed to extract background image', url, e);
                }
            }
        }

        // Mask Image (common for icon fonts and sprites)
        if (style.webkitMaskImage && style.webkitMaskImage !== 'none') {
            const urlMatch = style.webkitMaskImage.match(/url\(['"]?(.*?)['"]?\)/);
            if (urlMatch && urlMatch[1]) {
                const url = this.normalizeUrl(urlMatch[1]);
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
            }
        }

        // List Style Image
        if (style.listStyleImage && style.listStyleImage !== 'none') {
            const urlMatch = style.listStyleImage.match(/url\(['"]?(.*?)['"]?\)/);
            if (urlMatch && urlMatch[1]) {
                const url = this.normalizeUrl(urlMatch[1]);
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
                        node.type = 'SVG';
                        node.svgContent = svgData;
                        return;
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
                        node.type = 'SVG';
                        node.svgContent = svgText;
                        return;
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
                        // Clone content
                        // Note: This is a simplistic inlining. 
                        // A more robust way would be to replace <use> with a <g> containing the clone.
                        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                        // Copy attributes (transform, etc)
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

        node.svgContent = svg.outerHTML;
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
            // Visual placeholder
            node.fills?.push({
                type: 'SOLID',
                color: { r: 0.2, g: 0.2, b: 0.2 },
                opacity: 1
            });
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

    private async processChildren(node: LayerNode, element: HTMLElement) {
        await this.collectPseudoElement(node, element, '::before');

        const childNodes = Array.from(element.childNodes);
        const collectedChildren: LayerNode[] = [];

        for (const child of childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                const textNode = this.createTextLeaf(child as Text, element);
                if (textNode) collectedChildren.push(textNode);
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const childLayer = await this.collect(child as HTMLElement);
                if (childLayer) {
                    collectedChildren.push(childLayer);
                }
            }
        }

        await this.collectPseudoElement(node, element, '::after');

        // Sort children by stacking order (z-index)
        this.sortChildrenByZIndex(collectedChildren);

        if (!node.children) node.children = [];
        node.children.push(...collectedChildren);
    }

    private sortChildrenByZIndex(children: LayerNode[]) {
        children.sort((a, b) => {
            const az = a.zIndex || 0;
            const bz = b.zIndex || 0;
            if (az !== bz) return az - bz;

            // If z-index is same, positioning matters but DOM order should be fallback
            // Figma layers bottom-to-top, so higher index last
            return 0;
        });
    }

    private async collectPseudoElement(parentNode: LayerNode, element: HTMLElement, pseudoType: '::before' | '::after') {
        const style = window.getComputedStyle(element, pseudoType);
        const content = style.content;

        if (!content || content === 'none' || content === 'normal') return;

        const width = parseFloat(style.width);
        const height = parseFloat(style.height);
        const hasSize = width > 0 && height > 0;
        const hasContentString = content.replace(/['"]/g, '').length > 0;
        const urlMatch = content.match(/url\(['"]?(.*?)['"]?\)/);

        // Capture if it has content string OR url match OR (has size AND (border or background))
        // Many generic icons have empty content but use background-image and sizing.
        const hasBackground = style.backgroundImage !== 'none' || style.backgroundColor !== 'rgba(0, 0, 0, 0)';
        const hasBorder = style.borderStyle !== 'none' && parseFloat(style.borderWidth) > 0;

        if (!hasContentString && !urlMatch && !(hasSize && (hasBackground || hasBorder))) return;

        const pseudoNode: LayerNode = {
            type: 'FRAME',
            name: pseudoType,
            x: 0,
            y: 0,
            width: width || 0,
            height: height || 0,
            opacity: parseFloat(style.opacity),
            blendMode: this.getBlendMode(style),
            fills: [],
            strokes: [],
            effects: [],
            children: [],
            isContentOnly: false,
            zIndex: style.zIndex !== 'auto' ? parseInt(style.zIndex) : 0
        };

        if (style.position === 'absolute') {
            pseudoNode.layoutPositioning = 'ABSOLUTE';
            const top = parseFloat(style.top);
            const left = parseFloat(style.left);
            if (!isNaN(top)) pseudoNode.y = parentNode.y + top;
            if (!isNaN(left)) pseudoNode.x = parentNode.x + left;
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
            pseudoNode.fontFamily = style.fontFamily;
            pseudoNode.fontSize = parseFloat(style.fontSize);
            pseudoNode.fontWeight = style.fontWeight;
            pseudoNode.textAlign = style.textAlign.toUpperCase() as any;
            const color = parseColor(style.color);
            if (!pseudoNode.fills) pseudoNode.fills = [];
            pseudoNode.fills.push({ type: 'SOLID', color: { r: color.r, g: color.g, b: color.b }, opacity: color.a });

            this.extractTextShadows(pseudoNode, style);
        }

        parentNode.children?.push(pseudoNode);
    }

    private normalizeUrl(url: string): string {
        try {
            return new URL(url, document.baseURI).href;
        } catch (e) {
            return url;
        }
    }

    private createTextLeaf(textNode: Text, parent: HTMLElement): LayerNode | null {
        const style = window.getComputedStyle(parent);
        const range = document.createRange();
        range.selectNode(textNode);
        const rect = range.getBoundingClientRect();

        if (rect.width === 0 && rect.height === 0) return null;

        const text = cleanText(textNode.textContent || '', style.whiteSpace);
        if (!text) return null;

        const color = parseColor(style.color);

        const node: LayerNode = {
            type: 'TEXT',
            name: 'Text',
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            text: text,
            fontFamily: style.fontFamily,
            fontWeight: style.fontWeight,
            fontSize: parseFloat(style.fontSize),
            textAlign: style.textAlign.toUpperCase() as any,
            fills: [{
                type: 'SOLID',
                color: { r: color.r, g: color.g, b: color.b },
                opacity: color.a
            }]
        };

        this.extractTextShadows(node, style);
        return node;
    }

    private shouldPrune(node: LayerNode): boolean {
        if (node.isContentOnly) return true;

        const hasVisibleBg = (node.fills?.length ?? 0) > 0;
        const hasBorder = (node.strokes?.length ?? 0) > 0;
        const hasShadow = (node.effects?.length ?? 0) > 0;
        const isLayout = node.layoutMode !== 'NONE';

        const hasPadding = node.padding && (node.padding.top > 0 || node.padding.right > 0 || node.padding.bottom > 0 || node.padding.left > 0);
        const isSemantic = node.semanticType && node.semanticType !== 'CONTAINER';

        if (hasVisibleBg || hasBorder || hasShadow || isLayout || isSemantic || hasPadding || node.type === 'IMAGE' || node.type === 'SVG' || node.type === 'TEXT') {
            return false;
        }

        return true;
    }
}

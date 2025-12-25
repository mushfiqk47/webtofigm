import { LayerNode } from '../../types/layer-node';
import { AssetHandler } from '../asset-handler';
import { DomUtils } from './utils';
import { StyleParser } from './style-parser';
import { LayoutParser } from './layout-parser';
import { Optimizer } from './optimizer';

export class Collector {

    static async collect(element: HTMLElement, parentRect?: DOMRect): Promise<LayerNode | null> {
        if (!element) return null;

        const tagName = element.tagName.toUpperCase();
        if (DomUtils.IGNORED_TAGS.has(tagName) || DomUtils.isHidden(element)) {
            return null;
        }

        const computedStyle = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        // Calculate Relative Coordinates
        let x = rect.x;
        let y = rect.y;

        if (parentRect) {
            x = rect.x - parentRect.x;
            y = rect.y - parentRect.y;
        }

        // Sanitization Helpers
        const safeFloat = (v: any, def = 0) => { const f = parseFloat(v); return isNaN(f) ? def : f; };
        const safeInt = (v: any, def = 0) => { const i = parseInt(v); return isNaN(i) ? def : i; };

        const node: LayerNode = {
            type: 'FRAME',
            name: `${element.tagName.toLowerCase()}.${(element.getAttribute('class') || '').replace(/\s+/g, '.') || 'node'}`,
            x: isNaN(x) ? 0 : x,
            y: isNaN(y) ? 0 : y,
            width: safeFloat(rect.width, 10), // Default to 10px if something goes wrong
            height: safeFloat(rect.height, 10),
            fills: [],
            children: [],
            zIndex: computedStyle.zIndex !== 'auto' ? safeInt(computedStyle.zIndex) : 0,
            opacity: safeFloat(computedStyle.opacity, 1),
            clipsContent: computedStyle.overflow === 'hidden' || computedStyle.overflow === 'scroll',
            layoutPositioning: (computedStyle.position === 'absolute' || computedStyle.position === 'fixed') ? 'ABSOLUTE' : 'AUTO',
            semanticType: DomUtils.getSemanticType(element, computedStyle),

            // Layout Children Properties
            layoutGrow: parseFloat(computedStyle.flexGrow) || 0,
            layoutAlign: computedStyle.alignSelf === 'stretch' ? 'STRETCH' :
                computedStyle.alignSelf === 'center' ? 'CENTER' :
                    computedStyle.alignSelf === 'flex-start' ? 'MIN' :
                        computedStyle.alignSelf === 'flex-end' ? 'MAX' : 'INHERIT'
        };

        // 1. Text Nodes
        if (DomUtils.isTextNode(element)) {
            return await this.createTextLeaf(element, computedStyle, rect, parentRect);
        }

        // 2. Images
        if (tagName === 'IMG') {
            const src = (element as HTMLImageElement).src;
            if (src) {
                node.type = 'IMAGE';
                const base64 = await AssetHandler.imageToBase64(src);
                if (base64) node.imageBase64 = base64;
            }
        }

        // 3. SVGs
        if (tagName === 'SVG') {
            node.type = 'SVG';
            node.svgContent = AssetHandler.serializeSvg(element as unknown as SVGElement);
            return node;
        }

        // 4. Styles & Layout
        await this.applyStyles(node, computedStyle);
        LayoutParser.extractLayout(node, computedStyle);
        this.applyClipPath(node, computedStyle, rect);

        // 5. Children
        const childNodes = Array.from(element.childNodes);

        // Pseudo-elements
        const beforeNode = await this.createPseudoElement(element, '::before', rect);
        if (beforeNode) node.children?.push(beforeNode);

        for (const child of childNodes) {
            if (child.nodeType === Node.ELEMENT_NODE) {
                const childNode = await this.collect(child as HTMLElement, rect);
                if (childNode) {
                    node.children?.push(childNode);
                }
            } else if (child.nodeType === Node.TEXT_NODE) {
                const textContent = child.textContent?.trim();
                if (textContent && textContent.length > 0) {
                    // Precise text positioning using Range
                    const range = document.createRange();
                    range.selectNode(child);
                    const textRect = range.getBoundingClientRect();

                    const textLayer = this.createRawTextNode(textContent, computedStyle, textRect, rect);
                    if (textLayer) node.children?.push(textLayer);
                }
            }
        }

        const afterNode = await this.createPseudoElement(element, '::after', rect);
        if (afterNode) node.children?.push(afterNode);

        // 6. Z-Index Sorting
        node.children?.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

        return node;
    }

    static pruneRedundantLayers(node: LayerNode): LayerNode {
        return Optimizer.pruneRedundantLayers(node);
    }

    // --- Private Helpers ---

    private static async applyStyles(node: LayerNode, style: CSSStyleDeclaration) {
        // Background
        if (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') {
            node.fills?.push({
                type: 'SOLID',
                color: StyleParser.parseColor(style.backgroundColor),
                opacity: StyleParser.parseOpacity(style.backgroundColor)
            });
        }

        // Background Image
        const bgUrl = StyleParser.parseBackgroundImage(style.backgroundImage);
        if (bgUrl) {
            const base64 = await AssetHandler.imageToBase64(bgUrl);
            if (base64) {
                if (!node.fills) node.fills = [];
                // Figma uses a stack, so we push it. 
                // Standard CSS puts bg image ON TOP of bg color if both exist? No, usually blended or replaces. 
                // Actually CSS allows multiple backgrounds.
                // We will push it.
                node.fills.push({
                    type: 'IMAGE',
                    scaleMode: 'FILL',
                    _base64: base64
                });
            }
        }

        // Borders
        if (style.borderWidth !== '0px' && style.borderStyle !== 'none' && style.borderColor && style.borderColor !== 'transparent') {
            node.strokes = [{ type: 'SOLID', color: StyleParser.parseColor(style.borderColor) }];
            node.strokeWeight = parseFloat(style.borderWidth);
        }

        // Radius
        const radius = parseFloat(style.borderRadius);
        if (radius > 0) node.cornerRadius = radius;

        // Effects
        if (style.boxShadow && style.boxShadow !== 'none') {
            node.effects = StyleParser.parseBoxShadow(style.boxShadow);
        }

        // Mix Blend Mode
        if (style.mixBlendMode && style.mixBlendMode !== 'normal') {
            node.blendMode = style.mixBlendMode.replace(/-/g, '_').toUpperCase() as any;
        }

        // Backdrop Filter
        if ((style as any).backdropFilter && (style as any).backdropFilter !== 'none') {
            const bf = (style as any).backdropFilter;
            const blurMatch = bf.match(/blur\(([^)]+)\)/);
            if (blurMatch) {
                const blurValue = parseFloat(blurMatch[1]);
                if (!isNaN(blurValue) && blurValue > 0) {
                    if (!node.effects) node.effects = [];
                    node.effects.push({
                        type: 'BACKGROUND_BLUR',
                        radius: blurValue,
                        visible: true,
                    } as any);
                }
            }
        }
    }

    private static applyClipPath(node: LayerNode, style: CSSStyleDeclaration, rect: DOMRect) {
        const clipPath = style.clipPath || (style as any).webkitClipPath;
        if (clipPath && clipPath.includes('50% 0%') && clipPath.includes('100% 50%') && clipPath.includes('0% 50%')) {
            // Diamond heuristic
            node.rotation = 45;
            const scale = 0.7071;
            const newW = node.width * scale;
            const newH = node.height * scale;
            node.width = newW;
            node.height = newH;
            node.x += (rect.width - newW) / 2;
            node.y += (rect.height - newH) / 2;
        }
    }

    private static createRawTextNode(text: string, parentStyle: CSSStyleDeclaration, textRect: DOMRect, parentRect: DOMRect): LayerNode {
        const x = textRect.x - parentRect.x;
        const y = textRect.y - parentRect.y;

        const fontSize = parseFloat(parentStyle.fontSize);

        return {
            type: 'TEXT',
            name: text.slice(0, 20),
            x: x,
            y: y,
            width: textRect.width,
            height: textRect.height,
            text: text,
            fontFamily: parentStyle.fontFamily.split(',')[0].replace(/['"]/g, ''),
            fontWeight: parentStyle.fontWeight,
            fontSize: fontSize,
            textAlign: parentStyle.textAlign.toUpperCase() as any,
            lineHeight: StyleParser.parseLineHeight(parentStyle.lineHeight, fontSize),
            letterSpacing: StyleParser.parseLetterSpacing(parentStyle.letterSpacing, fontSize),
            fills: [{ type: 'SOLID', color: StyleParser.parseColor(parentStyle.color) }],
            zIndex: 0
        };
    }

    private static async createTextLeaf(element: HTMLElement, computedStyle: CSSStyleDeclaration, rect: DOMRect, parentRect?: DOMRect): Promise<LayerNode> {
        let x = rect.x;
        let y = rect.y;
        if (parentRect) {
            x = rect.x - parentRect.x;
            y = rect.y - parentRect.y;
        }

        const fontSize = parseFloat(computedStyle.fontSize);

        const node: LayerNode = {
            type: 'TEXT',
            name: element.textContent?.slice(0, 20) || 'Text',
            x: x + (parseFloat(computedStyle.paddingLeft) || 0),
            y: y + (parseFloat(computedStyle.paddingTop) || 0),
            width: rect.width,
            height: rect.height,
            text: element.textContent || '',
            fontFamily: computedStyle.fontFamily.split(',')[0].replace(/['"]/g, ''),
            fontWeight: computedStyle.fontWeight,
            fontSize: fontSize,
            textAlign: computedStyle.textAlign.toUpperCase() as any,
            lineHeight: StyleParser.parseLineHeight(computedStyle.lineHeight, fontSize),
            letterSpacing: StyleParser.parseLetterSpacing(computedStyle.letterSpacing, fontSize),
            fills: [{ type: 'SOLID', color: StyleParser.parseColor(computedStyle.color) }],
            zIndex: computedStyle.zIndex !== 'auto' ? parseInt(computedStyle.zIndex) : 0,

            // Transform
            rotation: StyleParser.parseTransform(computedStyle.transform)
        };
        return node;
    }

    private static async createPseudoElement(element: HTMLElement, type: '::before' | '::after', parentRect: DOMRect): Promise<LayerNode | null> {
        const style = window.getComputedStyle(element, type);
        const content = style.content.replace(/['"]/g, '');

        const width = parseFloat(style.width);
        const height = parseFloat(style.height);

        const hasSize = !isNaN(width) && !isNaN(height) && width > 0 && height > 0;
        const hasVisuals = style.borderWidth !== '0px' || (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') || style.backgroundImage !== 'none';

        if (content === 'none') return null;
        if ((!content || content === '') && !hasSize && !hasVisuals) return null;
        if (style.display === 'none') return null;

        let x = 0;
        let y = 0;

        if (style.position === 'absolute' || style.position === 'fixed') {
            const top = parseFloat(style.top);
            const left = parseFloat(style.left);
            const right = parseFloat(style.right);
            const bottom = parseFloat(style.bottom);

            if (!isNaN(left)) x = left;
            else if (!isNaN(right)) x = parentRect.width - width - right;

            if (!isNaN(top)) y = top;
            else if (!isNaN(bottom)) y = parentRect.height - height - bottom;
        }

        const node: LayerNode = {
            type: 'FRAME',
            name: type,
            x: x,
            y: y,
            width: width || parentRect.width,
            height: height || parentRect.height,
            fills: [],
            zIndex: style.zIndex !== 'auto' ? parseInt(style.zIndex) : (type === '::after' ? 1 : -1),
            layoutPositioning: (style.position === 'absolute' || style.position === 'fixed') ? 'ABSOLUTE' : 'AUTO'
        };

        if (hasSize || hasVisuals) {
            await this.applyStyles(node, style);
        }

        if (content && content !== '') {
            node.type = 'TEXT';
            node.text = content;
            node.fontFamily = style.fontFamily.split(',')[0].replace(/['"]/g, '');
            node.fontSize = parseFloat(style.fontSize);
            node.fills = [{ type: 'SOLID', color: StyleParser.parseColor(style.color) }];
        }

        return node;
    }
}

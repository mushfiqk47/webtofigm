import { LayerNode } from '../types/layer-node';
import { LayoutMapper } from '../translator/layout-mapper';
import { StyleMapper } from '../translator/style-mapper';
import { TypographyMapper } from '../translator/typography-mapper';
import { FontLoader } from './font-loader';

export class Builder {

    async build(node: LayerNode, isRootNode: boolean = true, parentAbsoluteX: number = 0, parentAbsoluteY: number = 0): Promise<SceneNode | null> {
        try {
            let figmaNode: SceneNode;

            switch (node.type) {
                case 'TEXT':
                    figmaNode = await this.createText(node);
                    break;
                case 'IMAGE':
                    figmaNode = figma.createRectangle();
                    figmaNode.name = node.name || 'Image';
                    await this.prepareImageFills(node); // Convert Base64 to Hash
                    break;
                case 'SVG':
                    if (node.svgContent) {
                        try {
                            figmaNode = figma.createNodeFromSvg(node.svgContent);
                            figmaNode.name = node.name || 'SVG';
                        } catch (e) {
                            console.warn('Failed to create SVG, falling back to frame', e);
                            figmaNode = figma.createFrame();
                        }
                    } else {
                        figmaNode = figma.createFrame();
                    }
                    break;
                case 'FRAME':
                default:
                    figmaNode = figma.createFrame();
                    figmaNode.name = node.name || 'Frame';

                    // Smart Naming: "Container" for structural frames
                    const isAutoLayout = node.layoutMode && node.layoutMode !== 'NONE';
                    const hasChildren = node.children && node.children.length > 0;

                    if (isAutoLayout || hasChildren) {
                        figmaNode.name = 'Container';
                        if (node.semanticType) {
                            const typeName = node.semanticType.charAt(0) + node.semanticType.slice(1).toLowerCase();
                            if (typeName !== 'Container') { // Avoid "Container (Container)"
                                figmaNode.name = `${typeName} Container`;
                            }
                        } else if (node.name.includes('#')) {
                            const id = node.name.split('#')[1].split('.')[0];
                            figmaNode.name = `Container #${id}`;
                        } else if (node.name.includes('.')) {
                            const cls = node.name.split('.')[1].split(' ')[0];
                            figmaNode.name = `Container .${cls}`;
                        }
                    } else {
                        figmaNode.name = node.name || 'Frame';
                    }

                    if (node.clipsContent !== undefined) {
                        (figmaNode as FrameNode).clipsContent = node.clipsContent;
                    }
                    break;
            }

            if (!figmaNode) return null;

            // 1. Dimensions & Position (Global <-> Local Translation)
            const globalX = isNaN(node.x) ? 0 : node.x;
            const globalY = isNaN(node.y) ? 0 : node.y;

            // Figma Node.x/y are relative to parent.
            // parentAbsoluteX/Y are the global coordinates of the parent frame (or 0,0 if root).
            figmaNode.x = globalX - parentAbsoluteX;
            figmaNode.y = globalY - parentAbsoluteY;

            if (node.rotation && !isNaN(node.rotation)) {
                figmaNode.rotation = -node.rotation;
            }

            // Resize
            if (node.type !== 'TEXT' && node.type !== 'SVG') {
                this.safeResize(figmaNode as FrameNode | RectangleNode, node.width, node.height);
            }

            // 2. Styles
            if (node.type !== 'SVG') {
                try {
                    StyleMapper.apply(node, figmaNode as GeometryMixin & BlendMixin);
                } catch (styleErr) {
                    console.warn(`Failed to apply styles to ${node.name}`, styleErr);
                }
            }

            // 3. Layout (Frames only)
            if (node.type === 'FRAME' || node.type === 'RECTANGLE' || node.type === 'IMAGE') {
                if ('layoutMode' in figmaNode) {
                    // APPLY AUTO LAYOUT TO ALL NODES (Fixed bug where only root had it)
                    if (node.layoutMode && node.layoutMode !== 'NONE') {
                        try {
                            LayoutMapper.map(node, figmaNode as FrameNode);

                            // Wrap Support
                            if (node.layoutWrap === 'WRAP' && node.layoutMode === 'HORIZONTAL') {
                                (figmaNode as FrameNode).layoutWrap = 'WRAP';
                                if (node.counterAxisSpacing !== undefined) {
                                    (figmaNode as FrameNode).counterAxisSpacing = node.counterAxisSpacing;
                                }
                            }
                        } catch (layoutErr) {
                            console.warn(`Failed to apply layout to ${node.name}`, layoutErr);
                        }
                    } else {
                        (figmaNode as FrameNode).layoutMode = 'NONE';
                    }
                }
            }

            // 4. Children (Recursion) with Pruning/Flattening
            if (node.children && 'appendChild' in figmaNode) {
                // Flatten children of 'isContentOnly' nodes
                const effectiveChildren = this.getEffectiveChildren(node);

                let childCount = 0;
                for (const child of effectiveChildren) {
                    try {
                        // Pass global coordinates of THIS node as the 'parentAbsolute' for the child.
                        const childFigmaNode = await this.build(child, false, globalX, globalY);

                        if (childFigmaNode) {
                            (figmaNode as FrameNode).appendChild(childFigmaNode);

                            // Apply Layout Props to CHILD (Only if parent has Auto Layout)
                            if (node.layoutMode && node.layoutMode !== 'NONE') {
                                try {
                                    this.applyChildLayout(child, childFigmaNode as LayoutMixin);
                                } catch (layoutErr) {
                                    console.warn(`Layout mapping failed for child ${child.name}`, layoutErr);
                                }
                            }
                        }
                    } catch (childErr) {
                        console.error(`Failed to build child ${child.name || 'unknown'}`, childErr);
                    }

                    childCount++;
                    // Throttle to keep Figma UI responsive for huge trees
                    if (childCount % 50 === 0) await new Promise(r => setTimeout(r, 2));
                }
            }

            return figmaNode;

        } catch (err) {
            console.error(`CRITICAL: Failed to build node ${node.name}`, err);
            // Return a placeholder so the entire tree doesn't fail
            const errorRect = figma.createRectangle();
            errorRect.name = `Error: ${node.name}`;
            errorRect.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }];
            this.safeResize(errorRect, node.width, node.height);
            return errorRect;
        }
    }

    private safeResize(node: FrameNode | RectangleNode | ComponentNode | InstanceNode, width: number, height: number) {
        // Figma Minimum is 0.01
        const w = Math.max(0.01, isNaN(width) ? 100 : width);
        const h = Math.max(0.01, isNaN(height) ? 100 : height);
        try {
            node.resize(w, h);
        } catch (e) {
            console.warn(`Resize failed for ${node.name}: ${w}x${h}`, e);
        }
    }

    private async createText(node: LayerNode): Promise<TextNode> {
        const textNode = figma.createText();
        textNode.name = node.name || 'Text';

        const family = node.fontFamily || 'Inter';
        const style = TypographyMapper.mapWeight(node.fontWeight || 400);

        try {
            await FontLoader.load(family, style);
            textNode.fontName = { family, style };
        } catch (e) {
            // Fallback to Inter
            await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
            textNode.fontName = { family: 'Inter', style: 'Regular' };
        }

        textNode.characters = node.text || ' '; // Empty string can crash text node resize sometimes

        const fontSize = node.fontSize || 16;
        textNode.fontSize = Math.max(1, fontSize); // Minimum font size

        // Line Height
        if (node.lineHeight) {
            textNode.lineHeight = node.lineHeight;
        }

        // Letter Spacing
        if (node.letterSpacing) {
            textNode.letterSpacing = node.letterSpacing;
        }

        // Text Align
        if (node.textAlign) {
            switch (node.textAlign) {
                case 'CENTER': textNode.textAlignHorizontal = 'CENTER'; break;
                case 'RIGHT': textNode.textAlignHorizontal = 'RIGHT'; break;
                case 'JUSTIFIED': textNode.textAlignHorizontal = 'JUSTIFIED'; break;
                case 'LEFT': default: textNode.textAlignHorizontal = 'LEFT'; break;
            }
        }

        textNode.textAutoResize = 'WIDTH_AND_HEIGHT';

        StyleMapper.apply(node, textNode);
        return textNode;
    }

    /**
     * Pre-processes image fills to generate Figma Hashes in parallel.
     * Updates the node.fills in place so StyleMapper can use them.
     */
    private async prepareImageFills(node: LayerNode) {
        const tasks: Promise<any>[] = [];

        if (node.imageBase64) {
            tasks.push((async () => {
                const hash = await this.createImageHash(node.imageBase64!);
                if (hash) {
                    if (!node.fills) node.fills = [];
                    node.fills.push({
                        type: 'IMAGE',
                        scaleMode: 'FILL',
                        imageHash: hash
                    });
                }
            })());
        }

        if (node.fills && node.fills.length > 0) {
            for (const fill of node.fills) {
                if (fill.type === 'IMAGE' && fill._base64) {
                    tasks.push((async () => {
                        const hash = await this.createImageHash(fill._base64!);
                        if (hash) {
                            fill.imageHash = hash;
                            delete fill._base64;
                        }
                    })());
                }
            }
        }

        if (tasks.length > 0) {
            await Promise.all(tasks);
        }
    }

    private async createImageHash(base64: string): Promise<string | null> {
        try {
            const cleanBase64 = base64.replace(/^data:image\/\w+;base64,/, "");
            const binaryString = atob(cleanBase64);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const image = figma.createImage(bytes);
            return image.hash;
        } catch (e) {
            console.error('Image creation failed', e);
            return null;
        }
    }

    private getEffectiveChildren(node: LayerNode): LayerNode[] {
        if (!node.children) return [];
        const result: LayerNode[] = [];
        for (const child of node.children) {
            if (child.isContentOnly) {
                // Flatten: Recursively get children of this hidden wrapper
                result.push(...this.getEffectiveChildren(child));
            } else {
                result.push(child);
            }
        }
        return result;
    }

    private applyChildLayout(node: LayerNode, figmaNode: LayoutMixin) {
        if (node.layoutGrow !== undefined) {
            figmaNode.layoutGrow = node.layoutGrow;
        }
        if (node.layoutAlign) {
            figmaNode.layoutAlign = node.layoutAlign;
        }
        if (node.layoutPositioning === 'ABSOLUTE') {
            figmaNode.layoutPositioning = 'ABSOLUTE';
        }
        // If node has fixed W/H but parent is AutoLayout, we might need to set Sizing to FIXED explicitly,
        // but Figma defaults to FIXED usually. We rely on the layoutSizingHorizontal/Vertical set in build().
    }
}

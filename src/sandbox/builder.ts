import { LayerNode } from '../types/layer-node';
import { LayoutMapper } from '../translator/layout-mapper';
import { StyleMapper } from '../translator/style-mapper';
import { TypographyMapper } from '../translator/typography-mapper';
import { FontLoader } from './font-loader';

export class Builder {

    constructor(private warn: (message: string) => void = () => { }) { }

    async build(node: LayerNode, isRootNode: boolean = true, parentAbsoluteX: number = 0, parentAbsoluteY: number = 0): Promise<SceneNode | null> {
        try {
            let figmaNode: SceneNode;

            switch (node.type) {
                case 'TEXT':
                    figmaNode = await this.createText(node);
                    break;
                case 'IMAGE':
                    figmaNode = figma.createRectangle();
                    await this.prepareImageFills(node); // Convert Base64 to Hash
                    break;
                case 'SVG':
                    if (node.svgContent) {
                        try {
                            figmaNode = figma.createNodeFromSvg(node.svgContent);
                        } catch (e) {
                            this.warn(`Failed to create SVG (${node.name || 'SVG'}), falling back to frame: ${e instanceof Error ? e.message : String(e)}`);
                            figmaNode = figma.createFrame();
                        }
                    } else {
                        figmaNode = figma.createFrame();
                    }
                    break;
                case 'FRAME':
                default:
                    figmaNode = figma.createFrame();

                    if (node.clipsContent !== undefined) {
                        (figmaNode as FrameNode).clipsContent = node.clipsContent;
                    }
                    break;
            }

            if (!figmaNode) return null;

            // FORCE UNIFORM NAMING (User Request)
            figmaNode.name = 'Container';

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

            // Resize - SVGs need special handling because createNodeFromSvg uses viewBox dimensions
            if (node.type === 'SVG') {
                // SVGs are created at their native viewBox size, need to scale to actual rendered size
                const svgNode = figmaNode as FrameNode;
                if (svgNode.width > 0 && svgNode.height > 0 && node.width > 0 && node.height > 0) {
                    const scaleX = node.width / svgNode.width;
                    const scaleY = node.height / svgNode.height;
                    svgNode.rescale(Math.min(scaleX, scaleY));
                    // Now resize to exact dimensions
                    this.safeResize(svgNode, node.width, node.height);
                }
            } else if (node.type !== 'TEXT') {
                this.safeResize(figmaNode as FrameNode | RectangleNode, node.width, node.height);
            }

            // 2. Styles
            if (node.type !== 'SVG') {
                try {
                    StyleMapper.apply(node, figmaNode as GeometryMixin & BlendMixin);
                } catch (styleErr) {
                    this.warn(`Failed to apply styles to ${node.name}: ${styleErr instanceof Error ? styleErr.message : String(styleErr)}`);
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
                            this.warn(`Failed to apply layout to ${node.name}: ${layoutErr instanceof Error ? layoutErr.message : String(layoutErr)}`);
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
                                    this.warn(`Layout mapping failed for child ${child.name}: ${layoutErr instanceof Error ? layoutErr.message : String(layoutErr)}`);
                                }
                            }
                        }
                    } catch (childErr) {
                        this.warn(`Failed to build child ${child.name || 'unknown'}: ${childErr instanceof Error ? childErr.message : String(childErr)}`);
                    }

                    childCount++;
                    // Throttle to keep Figma UI responsive for huge trees
                    if (childCount % 50 === 0) await new Promise(r => setTimeout(r, 2));
                }
            }

            return figmaNode;

        } catch (err) {
            this.warn(`CRITICAL: Failed to build node ${node.name}: ${err instanceof Error ? err.message : String(err)}`);
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
            // FIDELITY FIX: improved fallback logic
            console.warn(`Font ${family} not found, using Inter`);
            try {
                // Try a safer system font before defaulting to Inter
                await figma.loadFontAsync({ family: 'Roboto', style: 'Regular' });
                textNode.fontName = { family: 'Roboto', style: 'Regular' };
            } catch (e2) {
                // Final fallback
                await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
                textNode.fontName = { family: 'Inter', style: 'Regular' };
            }
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

        // Text Resizing Strategy
        // If text is multiline or has a constrained width, use FIXED_WIDTH (Auto Height)
        // Otherwise use WIDTH_AND_HEIGHT (Auto Width)
        
        // Estimate line height in pixels for heuristic
        let lhPx = fontSize * 1.2;
        if (node.lineHeight && node.lineHeight.unit === 'PIXELS') lhPx = node.lineHeight.value;
        if (node.lineHeight && node.lineHeight.unit === 'PERCENT') lhPx = fontSize * (node.lineHeight.value / 100);

        const isMultiline = node.height > (lhPx * 1.5);
        
        if (isMultiline && node.width > 1) {
             textNode.textAutoResize = 'HEIGHT'; // Fixed Width, grows vertically
             textNode.resize(node.width, textNode.height);
        } else {
             textNode.textAutoResize = 'WIDTH_AND_HEIGHT';
        }

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
            this.warn(`Image creation failed: ${e instanceof Error ? e.message : String(e)}`);
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

import { Paint, Effect, LayerNode } from '../types/layer-node';

/**
 * Maps Visual Styles
 */
export class StyleMapper {

    static apply(node: LayerNode, figmaNode: any) {
        // Helper to clamp values
        const clamp = (val: number) => Math.max(0, Math.min(1, isNaN(val) ? 0 : val));

        // Manual safe access to avoid Optional Chaining (?. syntax error in some environments)
        const safeColor = (c: any) => ({
            r: clamp((c && c.r) || 0),
            g: clamp((c && c.g) || 0),
            b: clamp((c && c.b) || 0)
        });

        // Fills
        try {
            if (node.fills && node.fills.length > 0) {
                figmaNode.fills = node.fills.map(fill => {
                    if (fill.type === 'SOLID') {
                        return {
                            type: 'SOLID',
                            color: safeColor(fill.color),
                            opacity: clamp(fill.opacity !== undefined ? fill.opacity : 1)
                        };
                    }
                    if (fill.type === 'IMAGE' && fill.imageHash) {
                        return {
                            type: 'IMAGE',
                            scaleMode: fill.scaleMode || 'FILL',
                            imageHash: fill.imageHash
                        };
                    }
                    if ((fill.type === 'GRADIENT_LINEAR' || fill.type === 'GRADIENT_RADIAL') && fill.gradientStops) {
                        return {
                            type: fill.type,
                            gradientStops: fill.gradientStops.map(s => {
                                const c = safeColor(s.color);
                                return {
                                    position: clamp(s.position),
                                    color: {
                                        r: c.r,
                                        g: c.g,
                                        b: c.b,
                                        a: clamp((s.color && s.color.a !== undefined) ? s.color.a : 1)
                                    }
                                };
                            }),
                            gradientTransform: fill.gradientTransform || [[1, 0, 0], [0, 1, 0]]
                        };
                    }
                    // Fallback
                    return { type: 'SOLID', color: { r: 0, g: 0, b: 0 }, visible: false };
                });
            } else {
                figmaNode.fills = [];
            }
        } catch (e) {
            console.warn('Failed to apply fills', e);
        }

        // Strokes
        try {
            if (node.strokes && node.strokes.length > 0 && node.strokeWeight) {
                figmaNode.strokes = node.strokes.map((s: any) => ({
                    type: 'SOLID',
                    color: safeColor(s.color),
                    opacity: clamp(s.opacity !== undefined ? s.opacity : 1)
                }));

                // Individual Strokes
                if (node.strokeDiff && 'strokeTopWeight' in figmaNode) {
                    figmaNode.strokeTopWeight = node.strokeDiff.top;
                    figmaNode.strokeRightWeight = node.strokeDiff.right;
                    figmaNode.strokeBottomWeight = node.strokeDiff.bottom;
                    figmaNode.strokeLeftWeight = node.strokeDiff.left;
                } else {
                    figmaNode.strokeWeight = Math.max(0, node.strokeWeight);
                }

                figmaNode.strokeAlign = node.strokeAlign || 'INSIDE';
            }
        } catch (e) {
            console.warn('Failed to apply strokes', e);
        }

        // Effects (Shadows)
        try {
            if (node.effects && node.effects.length > 0) {
                figmaNode.effects = node.effects.map((e: any) => {
                    const c = safeColor(e.color);
                    return {
                        type: 'DROP_SHADOW',
                        color: {
                            r: c.r,
                            g: c.g,
                            b: c.b,
                            a: clamp((e.color && e.color.a !== undefined) ? e.color.a : 0.25)
                        },
                        offset: e.offset || { x: 0, y: 0 },
                        radius: Math.max(0, e.radius || 0),
                        spread: e.spread || 0,
                        visible: true,
                        blendMode: e.blendMode || 'NORMAL'
                    };
                });
            }
        } catch (e) {
            console.warn('Failed to apply effects', e);
        }

        // Opacity
        if (node.opacity !== undefined) {
            figmaNode.opacity = clamp(node.opacity);
        }

        // Blend Mode
        if (node.blendMode && 'blendMode' in figmaNode) {
            try {
                figmaNode.blendMode = node.blendMode;
            } catch (e) {
                // Ignore invalid blend modes
            }
        }

        // Corner Radius
        try {
            if (node.cornerRadius !== undefined) {
                if (typeof node.cornerRadius === 'number') {
                    if ('cornerRadius' in figmaNode) {
                        figmaNode.cornerRadius = Math.max(0, node.cornerRadius);
                    }
                } else {
                    // Mixed corners
                    if ('topLeftRadius' in figmaNode) {
                        figmaNode.topLeftRadius = Math.max(0, node.cornerRadius.topLeft);
                        figmaNode.topRightRadius = Math.max(0, node.cornerRadius.topRight);
                        figmaNode.bottomLeftRadius = Math.max(0, node.cornerRadius.bottomLeft);
                        figmaNode.bottomRightRadius = Math.max(0, node.cornerRadius.bottomRight);
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to apply corner radius', e);
        }
    }
}
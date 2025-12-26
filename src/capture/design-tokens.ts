import { LayerNode, RGB, RGBA } from '../types/layer-node';

/**
 * Design Token Extractor - Extracts reusable design tokens from the layer tree
 * Identifies colors, typography, and spacing patterns
 */

export interface ColorToken {
    name: string;
    hex: string;
    rgb: RGB;
    usage: 'fill' | 'stroke' | 'text';
    count: number;
}

export interface TypographyToken {
    name: string;
    fontFamily: string;
    fontSize: number;
    fontWeight: string | number;
    lineHeight?: { value: number; unit: 'PIXELS' | 'PERCENT' };
    count: number;
}

export interface SpacingToken {
    value: number;
    count: number;
    usage: 'padding' | 'gap' | 'margin';
}

export interface DesignTokens {
    colors: ColorToken[];
    typography: TypographyToken[];
    spacing: SpacingToken[];
    summary: {
        totalColors: number;
        totalFonts: number;
        spacingScale: number[];
    };
}

export class DesignTokenExtractor {
    private colorMap = new Map<string, ColorToken>();
    private typographyMap = new Map<string, TypographyToken>();
    private spacingMap = new Map<number, SpacingToken>();

    /**
     * Extract all design tokens from the layer tree
     */
    extract(root: LayerNode): DesignTokens {
        this.reset();
        this.traverse(root);

        return {
            colors: this.getColorTokens(),
            typography: this.getTypographyTokens(),
            spacing: this.getSpacingTokens(),
            summary: {
                totalColors: this.colorMap.size,
                totalFonts: this.typographyMap.size,
                spacingScale: this.detectSpacingScale()
            }
        };
    }

    private reset(): void {
        this.colorMap.clear();
        this.typographyMap.clear();
        this.spacingMap.clear();
    }

    private traverse(node: LayerNode): void {
        // Extract colors from fills
        if (node.fills) {
            for (const fill of node.fills) {
                if (fill.type === 'SOLID' && fill.color) {
                    this.addColor(fill.color, 'fill');
                }
            }
        }

        // Extract colors from strokes
        if (node.strokes) {
            for (const stroke of node.strokes) {
                if (stroke.type === 'SOLID' && stroke.color) {
                    this.addColor(stroke.color, 'stroke');
                }
            }
        }

        // Extract typography from text nodes
        if (node.type === 'TEXT' && node.fontFamily && node.fontSize) {
            this.addTypography(node);
        }

        // Extract spacing from padding
        if (node.padding) {
            this.addSpacing(node.padding.top, 'padding');
            this.addSpacing(node.padding.right, 'padding');
            this.addSpacing(node.padding.bottom, 'padding');
            this.addSpacing(node.padding.left, 'padding');
        }

        // Extract spacing from item gaps
        if (node.itemSpacing && node.itemSpacing > 0) {
            this.addSpacing(node.itemSpacing, 'gap');
        }

        // Recurse children
        if (node.children) {
            for (const child of node.children) {
                this.traverse(child);
            }
        }
    }

    private addColor(rgb: RGB, usage: 'fill' | 'stroke' | 'text'): void {
        const hex = this.rgbToHex(rgb);

        if (this.colorMap.has(hex)) {
            this.colorMap.get(hex)!.count++;
        } else {
            this.colorMap.set(hex, {
                name: this.generateColorName(rgb),
                hex,
                rgb,
                usage,
                count: 1
            });
        }
    }

    private addTypography(node: LayerNode): void {
        const key = `${node.fontFamily}|${node.fontSize}|${node.fontWeight}`;

        if (this.typographyMap.has(key)) {
            this.typographyMap.get(key)!.count++;
        } else {
            this.typographyMap.set(key, {
                name: this.generateTypographyName(node.fontSize!),
                fontFamily: node.fontFamily!,
                fontSize: node.fontSize!,
                fontWeight: node.fontWeight || 400,
                lineHeight: node.lineHeight,
                count: 1
            });
        }
    }

    private addSpacing(value: number, usage: SpacingToken['usage']): void {
        if (value <= 0) return;

        // Round to nearest integer for grouping
        const rounded = Math.round(value);

        if (this.spacingMap.has(rounded)) {
            this.spacingMap.get(rounded)!.count++;
        } else {
            this.spacingMap.set(rounded, {
                value: rounded,
                count: 1,
                usage
            });
        }
    }

    private rgbToHex(rgb: RGB): string {
        const r = Math.round(rgb.r * 255);
        const g = Math.round(rgb.g * 255);
        const b = Math.round(rgb.b * 255);
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
    }

    private generateColorName(rgb: RGB): string {
        const r = Math.round(rgb.r * 255);
        const g = Math.round(rgb.g * 255);
        const b = Math.round(rgb.b * 255);

        // Detect common colors
        if (r === 255 && g === 255 && b === 255) return 'White';
        if (r === 0 && g === 0 && b === 0) return 'Black';
        if (r > 200 && g < 100 && b < 100) return 'Red';
        if (r < 100 && g > 200 && b < 100) return 'Green';
        if (r < 100 && g < 100 && b > 200) return 'Blue';
        if (r > 200 && g > 200 && b < 100) return 'Yellow';
        if (r === g && g === b) return `Gray-${Math.round(r / 25.5) * 10}`;

        // Default to hex-based name
        return `Color-${this.rgbToHex(rgb).slice(1, 5)}`;
    }

    private generateTypographyName(fontSize: number): string {
        if (fontSize >= 48) return 'Display';
        if (fontSize >= 36) return 'Heading 1';
        if (fontSize >= 28) return 'Heading 2';
        if (fontSize >= 22) return 'Heading 3';
        if (fontSize >= 18) return 'Heading 4';
        if (fontSize >= 16) return 'Body Large';
        if (fontSize >= 14) return 'Body';
        if (fontSize >= 12) return 'Caption';
        return 'Small';
    }

    private detectSpacingScale(): number[] {
        // Find common spacing values and try to detect a scale
        const values = Array.from(this.spacingMap.values())
            .filter(s => s.count >= 2)  // Only values used 2+ times
            .map(s => s.value)
            .sort((a, b) => a - b);

        // Try to detect common scales (4px, 8px base)
        const base4 = [4, 8, 12, 16, 20, 24, 32, 40, 48, 64];
        const base8 = [8, 16, 24, 32, 40, 48, 64, 80, 96];

        const matchesBase4 = values.filter(v => base4.some(b => Math.abs(v - b) <= 2)).length;
        const matchesBase8 = values.filter(v => base8.some(b => Math.abs(v - b) <= 2)).length;

        if (matchesBase8 > matchesBase4) {
            return base8.filter(v => values.some(val => Math.abs(val - v) <= 4));
        }
        if (matchesBase4 > 0) {
            return base4.filter(v => values.some(val => Math.abs(val - v) <= 4));
        }

        // Return detected values
        return values.slice(0, 10);
    }

    private getColorTokens(): ColorToken[] {
        return Array.from(this.colorMap.values())
            .sort((a, b) => b.count - a.count);
    }

    private getTypographyTokens(): TypographyToken[] {
        return Array.from(this.typographyMap.values())
            .sort((a, b) => b.count - a.count);
    }

    private getSpacingTokens(): SpacingToken[] {
        return Array.from(this.spacingMap.values())
            .filter(s => s.count >= 2)  // Only include values used multiple times
            .sort((a, b) => a.value - b.value);
    }
}

/**
 * Utility function to extract design tokens
 */
export function extractDesignTokens(root: LayerNode): DesignTokens {
    const extractor = new DesignTokenExtractor();
    return extractor.extract(root);
}

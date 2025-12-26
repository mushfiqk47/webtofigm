/**
 * Shared Utilities Module
 * 
 * Consolidated utility functions used across the codebase.
 * Eliminates duplication between capture, collector, and UI modules.
 */

import { RGB, RGBA, Effect, ColorStop, Paint, Transform } from '../types/layer-node';

// ============================================
// Number Utilities
// ============================================

/**
 * Clamp a value between 0 and 1
 */
export function clamp(val: number, min = 0, max = 1): number {
    return Math.max(min, Math.min(max, isNaN(val) ? min : val));
}

/**
 * Safely parse a float with default fallback
 */
export function safeFloat(value: unknown, defaultValue = 0): number {
    if (value === null || value === undefined) return defaultValue;
    const parsed = parseFloat(String(value));
    return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Safely parse an integer with default fallback
 */
export function safeInt(value: unknown, defaultValue = 0): number {
    if (value === null || value === undefined) return defaultValue;
    const parsed = parseInt(String(value), 10);
    return isNaN(parsed) ? defaultValue : parsed;
}

// ============================================
// Color Parsing
// ============================================

/**
 * Parse CSS color string to RGB object (normalized 0-1)
 */
export function parseColor(color: string): RGB {
    if (!color || color === 'transparent') {
        return { r: 0, g: 0, b: 0 };
    }

    // Handle hex colors
    if (color.startsWith('#')) {
        return parseHexColor(color);
    }

    // Handle rgb/rgba
    const rgba = color.match(/-?\d+(?:\.\d+)?/g);
    if (rgba && rgba.length >= 3) {
        return {
            r: clamp(parseFloat(rgba[0]) / 255),
            g: clamp(parseFloat(rgba[1]) / 255),
            b: clamp(parseFloat(rgba[2]) / 255)
        };
    }

    return { r: 0, g: 0, b: 0 };
}

/**
 * Parse hex color to RGB
 */
export function parseHexColor(hex: string): RGB {
    const cleanHex = hex.replace('#', '');
    let r = 0, g = 0, b = 0;

    if (cleanHex.length === 3) {
        r = parseInt(cleanHex[0] + cleanHex[0], 16) / 255;
        g = parseInt(cleanHex[1] + cleanHex[1], 16) / 255;
        b = parseInt(cleanHex[2] + cleanHex[2], 16) / 255;
    } else if (cleanHex.length >= 6) {
        r = parseInt(cleanHex.substring(0, 2), 16) / 255;
        g = parseInt(cleanHex.substring(2, 4), 16) / 255;
        b = parseInt(cleanHex.substring(4, 6), 16) / 255;
    }

    return { r: clamp(r), g: clamp(g), b: clamp(b) };
}

/**
 * Parse opacity from CSS color string
 */
export function parseOpacity(color: string): number {
    if (!color || color === 'transparent') return 0;

    const rgba = color.match(/-?\d+(?:\.\d+)?/g);
    if (rgba && rgba.length >= 4) {
        return clamp(parseFloat(rgba[3]));
    }
    return 1;
}

/**
 * Parse CSS color to RGBA (normalized 0-1)
 */
export function parseColorWithAlpha(color: string): RGBA {
    const rgb = parseColor(color);
    return {
        ...rgb,
        a: parseOpacity(color)
    };
}

// ============================================
// Shadow Parsing
// ============================================

/**
 * Parse CSS box-shadow string to Effect array
 */
export function parseBoxShadow(shadowString: string): Effect[] {
    if (!shadowString || shadowString === 'none') return [];

    const shadows: Effect[] = [];
    // Split by comma, ignoring commas inside parentheses (rgba)
    const parts = shadowString.split(/,(?![^(]*\))/);

    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;

        // Extract color
        const colorMatch = trimmed.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]+|[a-z]+)/);
        const colorStr = colorMatch ? colorMatch[0] : 'rgba(0,0,0,0.25)';
        const color = parseColorWithAlpha(colorStr);

        // Extract numeric values
        const rest = trimmed.replace(colorStr, '').trim();
        const nums = rest.match(/-?\d+(?:\.\d+)?(?:px)?/g)?.map(n => parseFloat(n));

        if (nums && nums.length >= 2) {
            const isInset = trimmed.toLowerCase().includes('inset');

            shadows.push({
                type: isInset ? 'INNER_SHADOW' : 'DROP_SHADOW',
                color,
                offset: { x: nums[0], y: nums[1] },
                radius: nums[2] || 0,
                spread: nums[3] || 0,
                visible: true,
                blendMode: 'NORMAL'
            });
        }
    }

    return shadows;
}

/**
 * Parse CSS filter: drop-shadow() to Effect
 */
export function parseFilterDropShadow(filterString: string): Effect[] {
    if (!filterString || !filterString.includes('drop-shadow')) return [];

    const effects: Effect[] = [];
    const regex = /drop-shadow\(([^)]+)\)/g;
    let match;

    while ((match = regex.exec(filterString)) !== null) {
        const content = match[1].trim();
        const colorMatch = content.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]+)/);
        const colorStr = colorMatch ? colorMatch[0] : 'rgba(0,0,0,0.25)';
        const color = parseColorWithAlpha(colorStr);

        const rest = content.replace(colorStr, '').trim();
        const nums = rest.match(/-?\d+(?:\.\d+)?(?:px)?/g)?.map(n => parseFloat(n));

        if (nums && nums.length >= 2) {
            effects.push({
                type: 'DROP_SHADOW',
                color,
                offset: { x: nums[0], y: nums[1] },
                radius: nums[2] || 0,
                spread: 0, // drop-shadow doesn't support spread
                visible: true,
                blendMode: 'NORMAL'
            });
        }
    }

    return effects;
}

// ============================================
// Gradient Parsing
// ============================================

/**
 * Parse CSS gradient to Paint object
 */
export function parseGradient(bgString: string): Paint | null {
    try {
        const isLinear = bgString.includes('linear-gradient');
        const isRadial = bgString.includes('radial-gradient');

        if (!isLinear && !isRadial) return null;

        const match = bgString.match(/gradient\((.*)\)/);
        if (!match) return null;

        const content = match[1];
        const parts = content.split(/,(?![^(]*\))/).map(s => s.trim());

        let angleDeg = 180; // Default: top to bottom

        // Parse angle/direction
        if (isLinear && parts.length > 0) {
            const first = parts[0];

            if (first.includes('deg')) {
                angleDeg = parseFloat(first);
                parts.shift();
            } else if (first.includes('to ')) {
                if (first.includes('top')) angleDeg = 0;
                else if (first.includes('right')) angleDeg = 90;
                else if (first.includes('bottom')) angleDeg = 180;
                else if (first.includes('left')) angleDeg = 270;
                parts.shift();
            }
        }

        // Parse color stops
        const stops: ColorStop[] = [];
        parts.forEach((part, i) => {
            let position = parts.length > 1 ? i / (parts.length - 1) : 0;

            const posMatch = part.match(/(\d+)%/);
            if (posMatch) {
                position = parseInt(posMatch[1]) / 100;
            }

            const colorPart = part.replace(/(\d+)%/, '').trim();
            const rgb = parseColor(colorPart);
            const alpha = parseOpacity(colorPart);

            stops.push({
                position: clamp(position),
                color: { ...rgb, a: colorPart === 'transparent' ? 0 : alpha }
            });
        });

        // Simple transform approximation
        const transform: Transform = angleDeg === 90
            ? [[1, 0, 0], [0, 1, 0]]
            : [[0, -1, 0], [1, 0, 0]];

        return {
            type: isRadial ? 'GRADIENT_RADIAL' : 'GRADIENT_LINEAR',
            gradientStops: stops,
            gradientTransform: transform
        };
    } catch (e) {
        console.warn('Gradient parse error:', e);
        return null;
    }
}

// ============================================
// Text Utilities
// ============================================

/**
 * Clean text content respecting white-space CSS property
 */
export function cleanText(text: string, whiteSpaceStyle = 'normal'): string {
    if (!text) return '';

    if (whiteSpaceStyle === 'pre' || whiteSpaceStyle === 'pre-wrap') {
        return text;
    }

    // Collapse whitespace
    return text.replace(/\s+/g, ' ').trim();
}

/**
 * Parse CSS gap property
 */
export function parseGap(gap: string): { row: number; column: number } {
    if (!gap || gap === 'normal') {
        return { row: 0, column: 0 };
    }

    const values = gap.split(/\s+/).map(v => parseFloat(v) || 0);

    if (values.length === 1) {
        return { row: values[0], column: values[0] };
    }

    return { row: values[0], column: values[1] || values[0] };
}

// ============================================
// Checksum Computation
// ============================================

/**
 * Compute simple checksum for file integrity validation
 * Uses a fast, deterministic string hash
 */
export function computeChecksum(data: string): string {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
        const char = data.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }

    const hashHex = Math.abs(hash).toString(16).padStart(8, '0');
    const lengthComponent = data.length.toString(16).padStart(8, '0');

    return `${hashHex}${lengthComponent}`;
}

// ============================================
// DOM Utilities
// ============================================

/**
 * Check if an element is hidden
 */
export function isHidden(element: HTMLElement, computedStyle?: CSSStyleDeclaration): boolean {
    const style = computedStyle || window.getComputedStyle(element);

    // Don't check opacity - elements with opacity 0 (animations) should still be captured
    return style.display === 'none' || style.visibility === 'hidden';
}

/**
 * Set of tags to ignore during DOM collection
 */
export const IGNORED_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'HEAD', 'META', 'LINK',
    'TEMPLATE', 'SLOT', 'DIALOG'
]);

/**
 * Check if element tag should be ignored
 */
export function shouldIgnoreTag(tagName: string): boolean {
    return IGNORED_TAGS.has(tagName.toUpperCase());
}

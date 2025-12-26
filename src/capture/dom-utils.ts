import { LayerNode, Paint, Effect, BlendMode } from '../types/layer-node';

const IMAGE_TIMEOUT_MS = 80000;
const MAX_IMAGE_BYTES = 7_500_000; // ~7.5MB guard to avoid huge blobs/base64

/**
 * Utility functions for DOM inspection and style extraction
 */

export function isHidden(element: HTMLElement, computedStyle: CSSStyleDeclaration): boolean {
    if (element.tagName === 'SCRIPT' || element.tagName === 'STYLE' || element.tagName === 'NOSCRIPT' || element.tagName === 'META') {
        return true;
    }

    if (computedStyle.display === 'none') return true;

    // visibility: hidden elements are invisible, but their children might be visible.
    // We will return false here so they are collected, but we must handle their visual styling
    // (fills, strokes, etc.) in the collector to ensure they don't render as black boxes.
    if (computedStyle.visibility === 'hidden') return false;

    // Check if dimensions are zero (unless it has overflow: visible or is display: contents)
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && computedStyle.overflow === 'hidden' && computedStyle.display !== 'contents') {
        return true;
    }

    return false;
}

declare var chrome: any;

export function imageToBase64(src: string): Promise<string | null> {
    return new Promise((resolve) => {
        // If it's already a data URL, return it
        if (src.startsWith('data:')) {
            if (isWithinSizeLimit(src)) {
                resolve(src);
            } else {
                resolve(null);
            }
            return;
        }

        // Priority 1: Background Fetch (Bypasses CORS if host_permissions set)
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ type: 'FETCH_IMAGE_BASE64', url: src }, (response: any) => {
                if (response && response.base64) {
                    if (isWithinSizeLimit(response.base64)) {
                        resolve(response.base64);
                    } else {
                        resolve(null);
                    }
                } else {
                    // Fallback to Canvas (likely to fail if Background failed, but worth a shot for local)
                    attemptCanvasCapture(src, resolve);
                }
            });
            return;
        }

        // Fallback: Canvas capture
        attemptCanvasCapture(src, resolve);
    });
}

function attemptCanvasCapture(src: string, resolve: (data: string | null) => void) {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    let settled = false;
    const done = (val: string | null) => {
        if (settled) return;
        settled = true;
        resolve(val);
    };

    const timer = setTimeout(() => done(null), IMAGE_TIMEOUT_MS);

    img.onload = () => {
        clearTimeout(timer);
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            done(null);
            return;
        }
        ctx.drawImage(img, 0, 0);
        try {
            const dataUrl = canvas.toDataURL('image/png');
            if (isWithinSizeLimit(dataUrl)) {
                done(dataUrl);
            } else {
                done(null);
            }
        } catch (e) {
            done(null);
        }
    };
    img.onerror = () => {
        clearTimeout(timer);
        done(null);
    };
    img.src = src;
}

function fallbackToBackgroundFetch(url: string, resolve: (data: string | null) => void) {
    // Deprecated in favor of primary strategy, but kept if needed
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'FETCH_IMAGE_BASE64', url: url }, (response: any) => {
            if (response && response.base64) {
                resolve(isWithinSizeLimit(response.base64) ? response.base64 : null);
            } else {
                resolve(null);
            }
        });
    } else {
        resolve(null);
    }
}

function isWithinSizeLimit(dataUrl: string): boolean {
    try {
        const parts = dataUrl.split(',');
        const base64 = parts[1] || '';
        // Base64 decoded bytes ~ length * 0.75
        const estimatedBytes = Math.floor(base64.length * 0.75);
        return estimatedBytes <= MAX_IMAGE_BYTES;
    } catch {
        return false;
    }
}

export function parseColor(color: string): { r: number; g: number; b: number; a: number } {
    if (!color || color === 'transparent') {
        return { r: 0, g: 0, b: 0, a: 0 };
    }

    // Normalized parsing for rgba/rgb using a temporary element if regex fails or for complex colors
    // However, in a content script environment, regex is faster and safer than DOM manipulation if possible.
    // Let's improve the regex to handle commas AND spaces (modern syntax).
    // Matches: rgba(255, 255, 255, 0.5) OR rgba(255 255 255 / 0.5)

    const rgbaMatch = color.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\)/);
    if (rgbaMatch) {
        return {
            r: parseInt(rgbaMatch[1]) / 255,
            g: parseInt(rgbaMatch[2]) / 255,
            b: parseInt(rgbaMatch[3]) / 255,
            a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1
        };
    }

    if (color.startsWith('#')) {
        const hex = color.substring(1);

        // Hex 3: #RGB
        if (hex.length === 3) {
            const r = parseInt(hex[0] + hex[0], 16) / 255;
            const g = parseInt(hex[1] + hex[1], 16) / 255;
            const b = parseInt(hex[2] + hex[2], 16) / 255;
            return { r, g, b, a: 1 };
        }
        // Hex 6: #RRGGBB
        else if (hex.length === 6) {
            const r = parseInt(hex.substring(0, 2), 16) / 255;
            const g = parseInt(hex.substring(2, 4), 16) / 255;
            const b = parseInt(hex.substring(4, 6), 16) / 255;
            return { r, g, b, a: 1 };
        }
        // Hex 4: #RGBA (Hex Alpha)
        else if (hex.length === 4) {
            const r = parseInt(hex[0] + hex[0], 16) / 255;
            const g = parseInt(hex[1] + hex[1], 16) / 255;
            const b = parseInt(hex[2] + hex[2], 16) / 255;
            const a = parseInt(hex[3] + hex[3], 16) / 255;
            return { r, g, b, a };
        }
        // Hex 8: #RRGGBBAA (Hex Alpha)
        else if (hex.length === 8) {
            const r = parseInt(hex.substring(0, 2), 16) / 255;
            const g = parseInt(hex.substring(2, 4), 16) / 255;
            const b = parseInt(hex.substring(4, 6), 16) / 255;
            const a = parseInt(hex.substring(6, 8), 16) / 255;
            return { r, g, b, a };
        }
    }

    // Fallback: If we can't parse it, default to TRANSPARENT, not black.
    // This prevents "Black Box" issues on unknown colors.
    return { r: 0, g: 0, b: 0, a: 0 };
}

/**
 * Parses CSS box-shadow into Figma Effects
 */
export function parseBoxShadow(shadowString: string): Effect[] {
    if (!shadowString || shadowString === 'none') return [];
    return parseShadowInternal(shadowString, false);
}

/**
 * Parses CSS filter: drop-shadow into Figma Effects
 */
export function parseFilterDropShadow(filterString: string): Effect[] {
    if (!filterString || filterString === 'none') return [];

    const dropShadowMatch = filterString.match(/drop-shadow\((.*?)\)/g);
    if (!dropShadowMatch) return [];

    let effects: Effect[] = [];
    for (const ds of dropShadowMatch) {
        const inner = ds.match(/drop-shadow\((.*)\)/)?.[1];
        if (inner) {
            effects.push(...parseShadowInternal(inner, false));
        }
    }
    return effects;
}

/**
 * Shared shadow parsing logic
 */
function parseShadowInternal(shadowString: string, isText: boolean): Effect[] {
    const effects: Effect[] = [];
    const shadows = shadowString.split(/,(?![^(]*\))/);

    for (const shadow of shadows) {
        const cleanShadow = shadow.trim();
        if (!cleanShadow) continue;

        // Split by space but respect parentheses (for rgba(..., ..., ...))
        const parts: string[] = [];
        let current = '';
        let depth = 0;
        for (const char of cleanShadow) {
            if (char === '(') depth++;
            else if (char === ')') depth--;

            if (char === ' ' && depth === 0) {
                if (current) parts.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        if (current) parts.push(current);

        let colorStr = 'rgb(0,0,0)';
        let lengths: string[] = [];
        let inset = false;

        for (const part of parts) {
            if (part === 'inset') {
                inset = true;
            } else if (part.startsWith('rgb') || part.startsWith('#') || part.match(/^[a-z]+$/i)) {
                colorStr = part;
            } else if (part.match(/px|em|rem|%/)) {
                lengths.push(part);
            } else if (part === '0') {
                lengths.push('0px');
            }
        }

        if (lengths.length >= 2) {
            const color = parseColor(colorStr);
            const x = parseFloat(lengths[0]);
            const y = parseFloat(lengths[1]);
            const blur = lengths.length > 2 ? parseFloat(lengths[2]) : 0;
            const spread = lengths.length > 3 ? parseFloat(lengths[3]) : 0;

            effects.push({
                type: inset ? 'INNER_SHADOW' : 'DROP_SHADOW',
                color: color,
                offset: { x, y },
                radius: blur,
                spread: spread,
                visible: true,
                blendMode: 'NORMAL'
            });
        }
    }
    return effects;
}

export function cleanText(text: string, whiteSpaceStyle?: string): string | null {
    if (!text) return null;

    // Replace non-breaking spaces
    let clean = text.replace(/[\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ');

    if (whiteSpaceStyle && ['pre', 'pre-wrap', 'pre-line'].includes(whiteSpaceStyle)) {
        // Preserve whitespace for pre-formatted text
        if (clean.trim().length === 0) return null;
        return clean;
    }

    // Normalize whitespace
    clean = clean.replace(/\s+/g, ' ').trim();

    if (clean.length === 0) return null;

    return clean;
}

export function parseGap(gap: string): { row: number; col: number } {
    if (!gap || gap === 'normal') return { row: 0, col: 0 };
    const parts = gap.trim().split(/\s+/);
    const row = parseFloat(parts[0]) || 0;
    const col = parts.length > 1 ? parseFloat(parts[1]) : row;
    return { row, col };
}

/**
 * Parse CSS gradient to Figma-compatible format
 */
export function parseGradient(bgString: string): import('../types/layer-node').Paint | null {
    try {
        const isLinear = bgString.includes('linear-gradient');
        const isRadial = bgString.includes('radial-gradient');

        if (!isLinear && !isRadial) return null;

        const match = bgString.match(/gradient\((.*)\)/);
        if (!match) return null;

        const content = match[1];
        // Split by comma, but not inside parentheses (rgba)
        const parts = content.split(/,(?![^(]*\))/).map(s => s.trim());

        let angleDeg = 180; // Default: top to bottom

        // Parse angle/direction for linear gradients
        if (isLinear && parts.length > 0) {
            const first = parts[0];

            if (first.includes('deg')) {
                angleDeg = parseFloat(first) || 180;
                parts.shift();
            } else if (first.includes('to ')) {
                // Handle direction keywords
                if (first.includes('right') && first.includes('bottom')) angleDeg = 135;
                else if (first.includes('left') && first.includes('bottom')) angleDeg = 225;
                else if (first.includes('right') && first.includes('top')) angleDeg = 45;
                else if (first.includes('left') && first.includes('top')) angleDeg = 315;
                else if (first.includes('top')) angleDeg = 0;
                else if (first.includes('right')) angleDeg = 90;
                else if (first.includes('bottom')) angleDeg = 180;
                else if (first.includes('left')) angleDeg = 270;
                parts.shift();
            }
        }

        // Parse color stops
        const stops: import('../types/layer-node').ColorStop[] = [];
        parts.forEach((part, i) => {
            let position = parts.length > 1 ? i / (parts.length - 1) : 0;

            // Extract position if specified
            const posMatch = part.match(/([\d.]+)%/);
            if (posMatch) {
                position = parseFloat(posMatch[1]) / 100;
            }

            // Extract color
            const colorPart = part.replace(/([\d.]+)%/, '').trim();
            const rgba = parseColor(colorPart);

            stops.push({
                position: Math.max(0, Math.min(1, position)),
                color: {
                    r: rgba.r,
                    g: rgba.g,
                    b: rgba.b,
                    a: colorPart === 'transparent' ? 0 : rgba.a
                }
            });
        });

        // Calculate gradient transform based on angle
        const rad = (angleDeg - 90) * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        // Figma uses 2x3 transform matrix for gradients
        const transform: import('../types/layer-node').Transform = [
            [cos, sin, 0.5 - cos * 0.5 - sin * 0.5],
            [-sin, cos, 0.5 + sin * 0.5 - cos * 0.5]
        ];

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

/**
 * Extract CSS transform properties
 */
export function parseTransform(transformStr: string): { rotation: number; scaleX: number; scaleY: number } {
    const result = { rotation: 0, scaleX: 1, scaleY: 1 };

    if (!transformStr || transformStr === 'none') return result;

    // Extract rotation from rotate()
    const rotateMatch = transformStr.match(/rotate\(([-\d.]+)deg\)/);
    if (rotateMatch) {
        result.rotation = parseFloat(rotateMatch[1]) || 0;
    }

    // Extract from matrix()
    const matrixMatch = transformStr.match(/matrix\(([^)]+)\)/);
    if (matrixMatch) {
        const values = matrixMatch[1].split(',').map(v => parseFloat(v.trim()));
        if (values.length >= 4) {
            // matrix(a, b, c, d, tx, ty)
            // rotation = atan2(b, a)
            result.rotation = Math.atan2(values[1], values[0]) * 180 / Math.PI;
            result.scaleX = Math.sqrt(values[0] * values[0] + values[1] * values[1]);
            result.scaleY = Math.sqrt(values[2] * values[2] + values[3] * values[3]);
        }
    }

    // Extract scale
    const scaleMatch = transformStr.match(/scale\(([-\d.]+)(?:,\s*([-\d.]+))?\)/);
    if (scaleMatch) {
        result.scaleX = parseFloat(scaleMatch[1]) || 1;
        result.scaleY = scaleMatch[2] ? parseFloat(scaleMatch[2]) : result.scaleX;
    }

    return result;
}

/**
 * Parse line-height to Figma format
 */
export function parseLineHeight(lineHeight: string, fontSize: number): { value: number; unit: 'PIXELS' | 'PERCENT' } | undefined {
    if (!lineHeight || lineHeight === 'normal') {
        return undefined; // Let Figma use default
    }

    if (lineHeight.endsWith('%')) {
        return { value: parseFloat(lineHeight), unit: 'PERCENT' };
    }

    if (lineHeight.endsWith('px')) {
        return { value: parseFloat(lineHeight), unit: 'PIXELS' };
    }

    // Unitless value (multiplier)
    const multiplier = parseFloat(lineHeight);
    if (!isNaN(multiplier)) {
        return { value: multiplier * 100, unit: 'PERCENT' };
    }

    return undefined;
}

/**
 * Parse letter-spacing to Figma format
 */
export function parseLetterSpacing(letterSpacing: string, fontSize: number): { value: number; unit: 'PIXELS' | 'PERCENT' } | undefined {
    if (!letterSpacing || letterSpacing === 'normal') {
        return undefined;
    }

    if (letterSpacing.endsWith('%')) {
        return { value: parseFloat(letterSpacing), unit: 'PERCENT' };
    }

    if (letterSpacing.endsWith('em')) {
        // Convert em to percent (relative to font size)
        return { value: parseFloat(letterSpacing) * 100, unit: 'PERCENT' };
    }

    // Default to pixels
    return { value: parseFloat(letterSpacing) || 0, unit: 'PIXELS' };
}

/**
 * Map CSS text-transform to Figma textCase
 */
export function parseTextCase(textTransform: string): import('../types/layer-node').TextCase {
    switch (textTransform) {
        case 'uppercase': return 'UPPER';
        case 'lowercase': return 'LOWER';
        case 'capitalize': return 'TITLE';
        default: return 'ORIGINAL';
    }
}

/**
 * Map CSS text-decoration to Figma format
 */
export function parseTextDecoration(textDecoration: string): import('../types/layer-node').TextDecoration {
    if (textDecoration.includes('underline')) return 'UNDERLINE';
    if (textDecoration.includes('line-through')) return 'LINE_THROUGH';
    return 'NONE';
}

/**
 * Parse backdrop-filter to Figma BACKGROUND_BLUR effect
 */
export function parseBackdropFilter(backdropFilter: string): import('../types/layer-node').Effect | null {
    if (!backdropFilter || backdropFilter === 'none') return null;

    const blurMatch = backdropFilter.match(/blur\(([\d.]+)px\)/);
    if (blurMatch) {
        return {
            type: 'BACKGROUND_BLUR',
            radius: parseFloat(blurMatch[1]) || 0,
            visible: true
        };
    }

    return null;
}

/**
 * Check if element should clip content (overflow: hidden)
 */
export function shouldClipContent(style: CSSStyleDeclaration): boolean {
    return style.overflow === 'hidden' ||
        style.overflowX === 'hidden' ||
        style.overflowY === 'hidden';
}


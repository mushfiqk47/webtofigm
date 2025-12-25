import { LayerNode, Paint, Effect, BlendMode } from '../types/layer-node';

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
            resolve(src);
            return;
        }

        // Priority 1: Background Fetch (Bypasses CORS if host_permissions set)
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ type: 'FETCH_IMAGE_BASE64', url: src }, (response: any) => {
                if (response && response.base64) {
                    resolve(response.base64);
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
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            resolve(null);
            return;
        }
        ctx.drawImage(img, 0, 0);
        try {
            const dataUrl = canvas.toDataURL('image/png');
            resolve(dataUrl);
        } catch (e) {
            resolve(null);
        }
    };
    img.onerror = () => {
        resolve(null);
    };
    img.src = src;
}

function fallbackToBackgroundFetch(url: string, resolve: (data: string | null) => void) {
    // Deprecated in favor of primary strategy, but kept if needed
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'FETCH_IMAGE_BASE64', url: url }, (response: any) => {
            if (response && response.base64) {
                resolve(response.base64);
            } else {
                resolve(null);
            }
        });
    } else {
        resolve(null);
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
        if (hex.length === 3) {
            const r = parseInt(hex[0] + hex[0], 16) / 255;
            const g = parseInt(hex[1] + hex[1], 16) / 255;
            const b = parseInt(hex[2] + hex[2], 16) / 255;
            return { r, g, b, a: 1 };
        } else if (hex.length === 6) {
            const r = parseInt(hex.substring(0, 2), 16) / 255;
            const g = parseInt(hex.substring(2, 4), 16) / 255;
            const b = parseInt(hex.substring(4, 6), 16) / 255;
            return { r, g, b, a: 1 };
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

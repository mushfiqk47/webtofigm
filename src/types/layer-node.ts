// Schema version for file format validation
export const SCHEMA_VERSION = '1.0.0';

// File format magic identifier
export const HTFIG_MAGIC = 'HTFIG';

/**
 * Viewport metadata captured at time of export
 */
export interface ViewportMeta {
    width: number;
    height: number;
    devicePixelRatio: number;
    captureTimestamp: number;
    schemaVersion: string;
    sourceUrl?: string;
}

/**
 * Text decoration properties
 */
export type TextDecoration = 'NONE' | 'UNDERLINE' | 'LINE_THROUGH';
export type TextCase = 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE';

export interface LayerNode {
    // Core Identification
    type: 'FRAME' | 'TEXT' | 'VECTOR' | 'IMAGE' | 'SVG' | 'RECTANGLE';
    name: string;

    // Spatial Coordinates (Normalized to Absolute Parent Space)
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number; // In degrees

    // Styling
    fills?: Paint[];          // Mapped from background-color, background-image
    strokes?: Paint[];        // Mapped from border
    strokeWeight?: number;
    strokeDiff?: { top: number; right: number; bottom: number; left: number }; // For non-uniform borders
    strokeAlign?: 'INSIDE' | 'OUTSIDE' | 'CENTER'; // CSS borders are usually INSIDE
    opacity?: number;
    cornerRadius?: number | { topLeft: number, topRight: number, bottomLeft: number, bottomRight: number };
    effects?: Effect[];       // Mapped from box-shadow
    blendMode?: BlendMode;    // Mapped from mix-blend-mode

    // Layout Logic (The Flexbox/Auto Layout Bridge)
    layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';

    // Modern Figma Auto Layout Sizing (preferred over primary/counter axis legacy)
    layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL';
    layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL';

    // Legacy fallback (keep for now for safety, but prefer above)
    primaryAxisSizingMode?: 'FIXED' | 'AUTO';
    counterAxisSizingMode?: 'FIXED' | 'AUTO';

    primaryAxisAlignItems?: 'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN';
    counterAxisAlignItems?: 'MIN' | 'MAX' | 'CENTER' | 'BASELINE';
    layoutWrap?: 'NO_WRAP' | 'WRAP'; // Support for wrapping
    counterAxisSpacing?: number; // Gap between wrapped rows

    // Child behavior in Flex parent
    layoutGrow?: number; // flex-grow
    layoutAlign?: 'MIN' | 'MAX' | 'CENTER' | 'STRETCH' | 'INHERIT'; // align-self
    layoutPositioning?: 'AUTO' | 'ABSOLUTE'; // For absolute positioned children

    itemSpacing?: number;    // Mapped from CSS gap
    padding?: { top: number; right: number; bottom: number; left: number };

    // Semantic tagging and Pruning helpers
    semanticType?: 'BUTTON' | 'INPUT' | 'IMAGE' | 'TEXT' | 'CONTAINER' | 'SECTION';
    isContentOnly?: boolean; // If true, this frame might be redundant if it has no styling

    // Typography Specifics
    text?: string;
    fontFamily?: string;
    fontWeight?: string | number; // e.g., 400, 700 or "Bold"
    fontSize?: number;
    textAlign?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
    lineHeight?: { value: number; unit: 'PIXELS' | 'PERCENT' };
    letterSpacing?: { value: number; unit: 'PIXELS' | 'PERCENT' };
    textDecoration?: TextDecoration;
    textCase?: TextCase;

    // Tree Structure
    children?: LayerNode[];

    // Asset Data
    imageBase64?: string; // For images
    svgContent?: string;  // For SVGs

    // Meta
    isMask?: boolean;
    clipsContent?: boolean; // overflow: hidden
    zIndex?: number;
}

// Re-export Figma types for convenience if needed, 
// though we usually use global PluginAPI types.
// We define simplified versions here for the UI thread which doesn't have Figma globals.

export interface Paint {
    type: 'SOLID' | 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'IMAGE';
    color?: RGB; // For solid/gradient
    opacity?: number;
    // Gradient specific
    gradientStops?: ColorStop[];
    gradientTransform?: Transform;
    // Image specific
    imageHash?: string; // Only available in sandbox
    scaleMode?: 'FILL' | 'FIT' | 'CROP' | 'TILE';
    _base64?: string; // Internal: Transport for background images
}

export interface RGB {
    r: number;
    g: number;
    b: number;
}

export interface ColorStop {
    position: number;
    color: RGBA;
}

export interface RGBA extends RGB {
    a: number;
    // CSS-to-Figma color helper
    r255?: number;
    g255?: number;
    b255?: number;
}

export interface Effect {
    type: 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR';
    color?: RGBA;
    offset?: Vector;
    radius: number;
    spread?: number;
    visible: boolean;
    blendMode?: BlendMode;
}

export interface Vector {
    x: number;
    y: number;
}

export type Transform = [[number, number, number], [number, number, number]];

export type BlendMode = 'PASS_THROUGH' | 'NORMAL' | 'DARKEN' | 'MULTIPLY' | 'LINEAR_BURN' | 'COLOR_BURN' | 'LIGHTEN' | 'SCREEN' | 'LINEAR_DODGE' | 'COLOR_DODGE' | 'OVERLAY' | 'SOFT_LIGHT' | 'HARD_LIGHT' | 'DIFFERENCE' | 'EXCLUSION' | 'HUE' | 'SATURATION' | 'COLOR' | 'LUMINOSITY';

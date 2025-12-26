/**
 * Design Tokens
 * 
 * Centralized design system constants for consistent theming
 * across the Figma plugin UI and Chrome extension.
 */

// ============================================
// Color Palette
// ============================================

export const colors = {
    // Background colors (Deep Space theme)
    bgApp: '#0f172a',      // Slate 900
    bgSurface: '#1e293b',  // Slate 800

    // Glass effects
    glassBg: 'rgba(30, 41, 59, 0.7)',
    glassBorder: 'rgba(255, 255, 255, 0.08)',

    // Brand colors
    brandPrimary: '#6366f1',    // Indigo 500
    brandSecondary: '#8b5cf6',  // Violet 500
    brandGlow: 'rgba(99, 102, 241, 0.25)',

    // Text colors
    textPrimary: '#f8fafc',     // Slate 50
    textSecondary: '#94a3b8',   // Slate 400
    textMuted: '#64748b',       // Slate 500
    textOnBrand: '#ffffff',

    // Status colors
    statusSuccess: '#10b981',   // Emerald 500
    statusError: '#ef4444',     // Red 500
    statusWarning: '#f59e0b',   // Amber 500
    statusInfo: '#3b82f6',      // Blue 500
} as const;

// ============================================
// Gradients
// ============================================

export const gradients = {
    brand: `linear-gradient(135deg, ${colors.brandPrimary} 0%, ${colors.brandSecondary} 100%)`,
    brandReverse: `linear-gradient(135deg, ${colors.brandSecondary} 0%, ${colors.brandPrimary} 100%)`,
    surface: 'linear-gradient(180deg, rgba(30, 41, 59, 0.9) 0%, rgba(15, 23, 42, 0.95) 100%)',
} as const;

// ============================================
// Typography
// ============================================

export const typography = {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",

    // Font sizes
    sizeXs: '11px',
    sizeSm: '12px',
    sizeMd: '13px',
    sizeLg: '15px',
    sizeXl: '18px',

    // Font weights
    weightRegular: 400,
    weightMedium: 500,
    weightSemibold: 600,
    weightBold: 700,

    // Line heights
    lineHeightTight: 1.25,
    lineHeightNormal: 1.5,
    lineHeightRelaxed: 1.75,
} as const;

// ============================================
// Spacing
// ============================================

export const spacing = {
    px: '1px',
    0: '0',
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    5: '20px',
    6: '24px',
    8: '32px',
    10: '40px',
    12: '48px',
} as const;

// ============================================
// Border Radius
// ============================================

export const radius = {
    sm: '6px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    full: '9999px',
} as const;

// ============================================
// Shadows
// ============================================

export const shadows = {
    sm: '0 1px 2px rgba(0, 0, 0, 0.3)',
    md: '0 4px 6px rgba(0, 0, 0, 0.3)',
    lg: '0 8px 16px rgba(0, 0, 0, 0.4)',
    brand: `0 4px 12px ${colors.brandGlow}`,
    brandHover: `0 6px 16px rgba(99, 102, 241, 0.4)`,
} as const;

// ============================================
// Transitions
// ============================================

export const transitions = {
    fast: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
    normal: '200ms cubic-bezier(0.4, 0, 0.2, 1)',
    slow: '300ms cubic-bezier(0.4, 0, 0.2, 1)',
    bounce: '300ms cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;

// ============================================
// Z-Index Scale
// ============================================

export const zIndex = {
    base: 0,
    dropdown: 100,
    sticky: 200,
    modal: 300,
    popover: 400,
    tooltip: 500,
} as const;

// ============================================
// CSS Custom Properties Generator
// ============================================

/**
 * Generate CSS custom properties string for injection
 */
export function generateCSSVariables(): string {
    return `
:root {
    /* Colors */
    --color-bg-app: ${colors.bgApp};
    --color-bg-surface: ${colors.bgSurface};
    --glass-bg: ${colors.glassBg};
    --glass-border: ${colors.glassBorder};
    --color-brand-primary: ${colors.brandPrimary};
    --color-brand-secondary: ${colors.brandSecondary};
    --color-brand-glow: ${colors.brandGlow};
    --color-text-primary: ${colors.textPrimary};
    --color-text-secondary: ${colors.textSecondary};
    --color-text-muted: ${colors.textMuted};
    --color-text-on-brand: ${colors.textOnBrand};
    --color-status-success: ${colors.statusSuccess};
    --color-status-error: ${colors.statusError};
    --color-status-warning: ${colors.statusWarning};
    --color-status-info: ${colors.statusInfo};
    
    /* Gradients */
    --gradient-brand: ${gradients.brand};
    
    /* Typography */
    --font-family-base: ${typography.fontFamily};
    --font-size-xs: ${typography.sizeXs};
    --font-size-sm: ${typography.sizeSm};
    --font-size-md: ${typography.sizeMd};
    --font-size-lg: ${typography.sizeLg};
    --font-weight-regular: ${typography.weightRegular};
    --font-weight-medium: ${typography.weightMedium};
    --font-weight-semibold: ${typography.weightSemibold};
    
    /* Spacing */
    --spacing-4: ${spacing[1]};
    --spacing-8: ${spacing[2]};
    --spacing-12: ${spacing[3]};
    --spacing-16: ${spacing[4]};
    --spacing-20: ${spacing[5]};
    --spacing-24: ${spacing[6]};
    
    /* Radius */
    --radius-sm: ${radius.sm};
    --radius-md: ${radius.md};
    --radius-lg: ${radius.lg};
    --radius-full: ${radius.full};
    
    /* Shadows */
    --shadow-brand: ${shadows.brand};
    --shadow-brand-hover: ${shadows.brandHover};
    
    /* Transitions */
    --transition-fast: ${transitions.fast};
    --transition-normal: ${transitions.normal};
    --transition-bounce: ${transitions.bounce};
}
`.trim();
}

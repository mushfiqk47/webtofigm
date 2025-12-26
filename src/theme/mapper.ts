import { RGB, ColorUsage } from './extractor';

/**
 * Maps raw color clusters to a semantic UI palette
 */
export class PaletteMapper {

    public generatePalette(colors: RGB[]): Record<string, ColorUsage> {
        if (colors.length === 0) return {};

        const palette: Record<string, ColorUsage> = {};

        // 1. Analyze properties (HSL sorting)
        const candidates = colors.map(rgb => ({
            rgb,
            hsl: this.rgbToHsl(rgb.r, rgb.g, rgb.b),
            hex: this.rgbToHex(rgb)
        }));

        // 2. Identify Background (Usually darkest or lightest depending on perceived "mode")
        // For profile matching, we often want a background that matches the "vibe".
        // Let's bias towards a neutral-ish color that is either very light or very dark.
        const sortedByLuminance = [...candidates].sort((a, b) => a.hsl.l - b.hsl.l);
        const darkCandidate = sortedByLuminance[0];
        const lightCandidate = sortedByLuminance[sortedByLuminance.length - 1];

        // Heuristic: If dominant color is very dark, use widespread dark bg (Dark Mode).
        // Otherwise light.
        // For safety, let's pick the one with lower saturation as background
        const background = (darkCandidate.hsl.s < lightCandidate.hsl.s) ? darkCandidate : lightCandidate;

        palette['background'] = {
            color: background.hex,
            original: background.rgb,
            population: 0, // Placeholder
            usage: 'background'
        };

        // 3. Identify Primary (Anchor)
        // Look for high saturation, distinct from background
        const eligibleForPrimary = candidates.filter(c =>
            this.getContrast(c.rgb, background.rgb) > 3.0 && // Min readable
            c.hex !== background.hex
        );

        // Sort by Saturation * Population-weight (implied order)
        // Since input is sorted by population, we iterate.
        let primary = eligibleForPrimary.find(c => c.hsl.s > 0.3);
        if (!primary) primary = eligibleForPrimary[0] || candidates[0]; // Fallback

        palette['primary'] = {
            color: primary.hex,
            original: primary.rgb,
            population: 0,
            usage: 'primary'
        };

        // 4. Identify Text (High Contrast against Background)
        // If background is dark, text is white. If bg is light, text is black.
        // Or pick a very contrasting color from the image.
        const bestContrast = this.getBestContrastColor(background.rgb, candidates.map(c => c.rgb));
        palette['text'] = {
            color: this.rgbToHex(bestContrast),
            original: bestContrast,
            population: 0,
            usage: 'text'
        };

        // 5. Secondary/Accent
        // Distinct hue from primary
        const secondary = candidates.find(c =>
            c.hex !== primary!.hex &&
            c.hex !== background.hex &&
            c.hex !== palette['text'].color &&
            Math.abs(c.hsl.h - primary!.hsl.h) > 30 // 30 degree hue sort
        );

        if (secondary) {
            palette['secondary'] = {
                color: secondary.hex,
                original: secondary.rgb,
                population: 0,
                usage: 'secondary'
            };
        }

        return palette;
    }

    private rgbToHex(rgb: RGB): string {
        const toHex = (c: number) => {
            const hex = c.toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        };
        return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
    }

    private rgbToHsl(r: number, g: number, b: number) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0, l = (max + min) / 2;

        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }

        return { h: h * 360, s, l };
    }

    private getLuminance(rgb: RGB): number {
        const a = [rgb.r, rgb.g, rgb.b].map(v => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
    }

    private getContrast(rgb1: RGB, rgb2: RGB): number {
        const Lum1 = this.getLuminance(rgb1);
        const Lum2 = this.getLuminance(rgb2);
        const brightest = Math.max(Lum1, Lum2);
        const darkest = Math.min(Lum1, Lum2);
        return (brightest + 0.05) / (darkest + 0.05);
    }

    private getBestContrastColor(bg: RGB, candidates: RGB[]): RGB {
        let best = { r: 0, g: 0, b: 0 }; // Default black
        let maxContrast = 0;

        // Add pure black and white to candidates for safety
        const safeCandidates = [...candidates, { r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }];

        for (const c of safeCandidates) {
            const contrast = this.getContrast(bg, c);
            if (contrast > maxContrast) {
                maxContrast = contrast;
                best = c;
            }
        }
        return best;
    }
}

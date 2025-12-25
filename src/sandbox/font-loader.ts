/**
 * Font Loader
 * Handles async font loading with fallback strategies.
 */
export class FontLoader {

    static async load(family: string, style: string): Promise<FontName> {
        const requestedFont: FontName = { family, style };

        try {
            await figma.loadFontAsync(requestedFont);
            return requestedFont;
        } catch (e) {
            console.warn(`Font not found: ${family} ${style}. Falling back to Inter.`);
            try {
                const fallback: FontName = { family: 'Inter', style: 'Regular' };
                await figma.loadFontAsync(fallback);
                return fallback;
            } catch (e2) {
                // Ultimate fallback
                const safe: FontName = { family: 'Roboto', style: 'Regular' };
                await figma.loadFontAsync(safe);
                return safe;
            }
        }
    }
}

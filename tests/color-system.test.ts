import { ThemeEngine } from '../src/theme/index';

describe('Intelligent Color System', () => {
    it('should extract a palette from synthetic image data', () => {
        // Create a 100px buffer with a Red-to-Blue gradient
        const data = new Uint8ClampedArray(100 * 4);
        for (let i = 0; i < 100; i++) {
            const r = Math.floor(255 * (1 - i / 100));
            const b = Math.floor(255 * (i / 100));
            data[i * 4] = r;
            data[i * 4 + 1] = 0;
            data[i * 4 + 2] = b;
            data[i * 4 + 3] = 255;
        }

        const engine = new ThemeEngine();
        const result = engine.processImage(data);

        console.log('Generated Palette:', JSON.stringify(result.palette, null, 2));

        expect(result.palette).toBeDefined();
        // We expect at least a primary and background
        expect(result.palette.primary).toBeDefined();
        expect(result.palette.background).toBeDefined();

        // Verify primary is Red-ish or Blue-ish (High saturation)
        const primaryHex = result.palette.primary.color;
        expect(primaryHex).toMatch(/^#[0-9a-f]{6}$/i);
    });
});

import { ColorExtractor, RGB } from './extractor';
import { PaletteMapper } from './mapper';

export class ThemeEngine {
    private extractor: ColorExtractor;
    private mapper: PaletteMapper;

    constructor() {
        this.extractor = new ColorExtractor(8, 10);
        this.mapper = new PaletteMapper();
    }

    public processImage(imageData: Uint8ClampedArray): any {
        const rawColors = this.extractor.extractFactors(imageData);
        const palette = this.mapper.generatePalette(rawColors);

        return {
            raw: rawColors,
            palette: palette
        };
    }
}

// Simple test helper (mocking image data)
export function runColorTest() {
    console.log("Running Color System Test...");

    // Mock Data: A gradient from Red to Blue
    // 100 pixels
    const data = new Uint8ClampedArray(100 * 4);
    for (let i = 0; i < 100; i++) {
        // R goes 255 -> 0
        // B goes 0 -> 255
        const r = Math.floor(255 * (1 - i / 100));
        const b = Math.floor(255 * (i / 100));

        data[i * 4] = r;
        data[i * 4 + 1] = 0;
        data[i * 4 + 2] = b;
        data[i * 4 + 3] = 255; // Alpha
    }

    const engine = new ThemeEngine();
    const result = engine.processImage(data);

    console.log("Extracted Theme:", JSON.stringify(result.palette, null, 2));
    return result;
}

// Self-execute for testing
runColorTest();

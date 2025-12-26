export interface RGB {
    r: number;
    g: number;
    b: number;
}

export interface ColorUsage {
    color: string; // Hex
    original: RGB;
    population: number;
    usage?: 'primary' | 'secondary' | 'background' | 'text' | 'accent';
}

/**
 * Lightweight K-Means implementation for color extraction
 */
export class ColorExtractor {
    private maxColors: number;
    private maxIterations: number;

    constructor(maxColors: number = 8, maxIterations: number = 10) {
        this.maxColors = maxColors;
        this.maxIterations = maxIterations;
    }

    public extractFactors(imageData: Uint8ClampedArray): RGB[] {
        const pixels = this.quantizePixels(imageData);
        if (pixels.length === 0) return [];

        const centroids = this.initializeCentroids(pixels, this.maxColors);
        const clusters = this.runKMeans(pixels, centroids, this.maxIterations);

        // Sort by population (descending)
        return clusters
            .sort((a, b) => b.population - a.population)
            .map(c => c.centroid);
    }

    private quantizePixels(data: Uint8ClampedArray): RGB[] {
        const pixels: RGB[] = [];
        // Sample every 4th pixel for performance (quality vs speed trade-off)
        for (let i = 0; i < data.length; i += 4 * 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];

            // Ignore transparent or very dark/white pixels? 
            // Better to keep white/black for UI analysis, but maybe ignore transparent
            if (a < 128) continue;

            pixels.push({ r, g, b });
        }
        return pixels;
    }

    private initializeCentroids(pixels: RGB[], k: number): RGB[] {
        // K-Means++ initialization or simple random
        // Simple random sampling for speed in JS
        const centroids: RGB[] = [];
        const step = Math.floor(pixels.length / k);
        for (let i = 0; i < k; i++) {
            centroids.push(pixels[Math.floor(i * step)]);
        }
        return centroids;
    }

    private runKMeans(pixels: RGB[], centroids: RGB[], iterations: number) {
        let currentCentroids = [...centroids];
        let clusters: { centroid: RGB; population: number }[] = [];

        for (let i = 0; i < iterations; i++) {
            // Assignment Step
            const assignments: number[] = new Array(pixels.length);
            const sums: { r: number; g: number; b: number; count: number }[] =
                currentCentroids.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));

            for (let p = 0; p < pixels.length; p++) {
                const pixel = pixels[p];
                let minDist = Number.MAX_VALUE;
                let bestIdx = 0;

                for (let c = 0; c < currentCentroids.length; c++) {
                    const centroid = currentCentroids[c];
                    // Euclidean distance squared
                    const dist =
                        (pixel.r - centroid.r) ** 2 +
                        (pixel.g - centroid.g) ** 2 +
                        (pixel.b - centroid.b) ** 2;

                    if (dist < minDist) {
                        minDist = dist;
                        bestIdx = c;
                    }
                }

                assignments[p] = bestIdx;
                sums[bestIdx].r += pixel.r;
                sums[bestIdx].g += pixel.g;
                sums[bestIdx].b += pixel.b;
                sums[bestIdx].count++;
            }

            // Update Step
            let diff = 0;
            currentCentroids = sums.map((sum, idx) => {
                if (sum.count === 0) return currentCentroids[idx]; // Keep old if empty
                const newC = {
                    r: Math.round(sum.r / sum.count),
                    g: Math.round(sum.g / sum.count),
                    b: Math.round(sum.b / sum.count)
                };

                diff += Math.abs(newC.r - currentCentroids[idx].r) +
                    Math.abs(newC.g - currentCentroids[idx].g) +
                    Math.abs(newC.b - currentCentroids[idx].b);

                return newC;
            });

            if (diff < 5) break; // Converged
        }

        // Final cluster compilation
        const pixelsPerCluster = new Array(centroids.length).fill(0);
        // Re-assign one last time to get accurate counts (or reuse sums if available from last iter)
        // For simplicity/robustness, just re-scan or use the sums from the last iteration if we track them.
        // Actually, we can just map the currentCentroids.
        // But we need 'population'. 'sums' has the population for the *previous* centroids assignment.
        // If we updated centroids, the population count is technically for the previous centroids, but it's close enough.

        // HOWEVER, to be safe, let's just use the logic we had, but ensure it runs.
        // Easier: Just return the stats from the last `sums` we computed.
        // Wait, `sums` is local to the loop. 
        // I need to lift `sums` or just calculate it at the end.

        // Recalculate population for final centroids
        const finalPopulations = new Array(currentCentroids.length).fill(0);
        for (let p = 0; p < pixels.length; p++) {
            const pixel = pixels[p];
            let minDist = Number.MAX_VALUE;
            let bestIdx = 0;
            for (let c = 0; c < currentCentroids.length; c++) {
                const dist = (pixel.r - currentCentroids[c].r) ** 2 +
                    (pixel.g - currentCentroids[c].g) ** 2 +
                    (pixel.b - currentCentroids[c].b) ** 2;
                if (dist < minDist) { minDist = dist; bestIdx = c; }
            }
            finalPopulations[bestIdx]++;
        }

        clusters = currentCentroids.map((c, idx) => ({
            centroid: c,
            population: finalPopulations[idx]
        }));

        return clusters;
    }
}

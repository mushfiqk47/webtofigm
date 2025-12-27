/**
 * Basic tests for ContentCollector
 * These tests verify core functionality of the HTML-to-Figma conversion
 */

import { TextEncoder, TextDecoder } from 'util';
global.TextEncoder = TextEncoder as any;
global.TextDecoder = TextDecoder as any;

import { ContentCollector } from '../src/capture/collector';

describe('ContentCollector', () => {
    beforeEach(() => {
        // Reset document body
        document.body.innerHTML = '';

        // Mock getBoundingClientRect
        Object.defineProperty(global.HTMLElement.prototype, 'getBoundingClientRect', {
            writable: true,
            value: function() {
                const style = window.getComputedStyle(this);
                return {
                    x: 0,
                    y: 0,
                    width: parseFloat(style.width) || 100, // Default to 100 if not set
                    height: parseFloat(style.height) || 100, // Default to 100 if not set
                    top: 0,
                    left: 0,
                    right: parseFloat(style.width) || 100,
                    bottom: parseFloat(style.height) || 100,
                    toJSON: () => {}
                };
            }
        });

        // Mock Range.prototype.getBoundingClientRect
        global.Range.prototype.getBoundingClientRect = () => ({
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            top: 0,
            left: 0,
            right: 10,
            bottom: 10,
            toJSON: () => {}
        });

        // Mock Range.prototype.getClientRects
        global.Range.prototype.getClientRects = () => ({
            item: () => null,
            length: 0,
            [Symbol.iterator]: function* () {}
        }) as any;

        // Suppress JSDOM not implemented error for pseudo elements
        const originalConsoleError = console.error;
        console.error = (...args) => {
            if (args[0] && args[0].toString().includes('Not implemented: window.getComputedStyle')) return;
            originalConsoleError(...args);
        };
    });

    describe('Basic Element Capture', () => {
        it('should capture a simple div with background color', async () => {
            const div = document.createElement('div');
            div.style.width = '100px';
            div.style.height = '50px';
            div.style.backgroundColor = 'rgb(255, 0, 0)';
            document.body.appendChild(div);

            const collector = new ContentCollector(div as HTMLElement);
            const result = await collector.collect(div as HTMLElement);

            expect(result).not.toBeNull();
            expect(result?.type).toBe('FRAME');
            expect(result?.width).toBe(100);
            expect(result?.height).toBe(50);
            expect(result?.fills?.length).toBeGreaterThan(0);
            expect(result?.fills?.[0].type).toBe('SOLID');
        });

        it('should handle nested elements', async () => {
            const parent = document.createElement('div');
            const child = document.createElement('div');
            parent.appendChild(child);
            document.body.appendChild(parent);

            const collector = new ContentCollector(parent as HTMLElement);
            const result = await collector.collect(parent as HTMLElement);

            expect(result).not.toBeNull();
            expect(result?.children?.length).toBeGreaterThan(0);
        });
    });

    describe('Layout Detection', () => {
        it('should detect flexbox layout', async () => {
            const flex = document.createElement('div');
            flex.style.display = 'flex';
            flex.style.flexDirection = 'row';
            flex.style.gap = '10px';
            document.body.appendChild(flex);

            const collector = new ContentCollector(flex as HTMLElement);
            const result = await collector.collect(flex as HTMLElement);

            expect(result?.layoutMode).toBe('HORIZONTAL');
            expect(result?.itemSpacing).toBe(10);
        });

        it('should detect FILL sizing for width: 100%', async () => {
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.width = '100%';
            document.body.appendChild(div);

            const collector = new ContentCollector(div as HTMLElement);
            const result = await collector.collect(div as HTMLElement);

            expect(result?.layoutSizingHorizontal).toBe('FILL');
        });

        it('should detect FIXED sizing for explicit dimensions', async () => {
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.width = '200px';
            div.style.height = '100px';
            document.body.appendChild(div);

            const collector = new ContentCollector(div as HTMLElement);
            const result = await collector.collect(div as HTMLElement);

            expect(result?.layoutSizingHorizontal).toBe('FIXED');
            expect(result?.layoutSizingVertical).toBe('FIXED');
        });
    });

    describe('Traversal Limits', () => {
        it('should respect max nodes limit', async () => {
            const container = document.createElement('div');
            // Create 100 child elements
            for (let i = 0; i < 100; i++) {
                const child = document.createElement('div');
                container.appendChild(child);
            }
            document.body.appendChild(container);

            const collector = new ContentCollector(container as HTMLElement, {
                maxNodes: 50
            });
            const result = await collector.collect(container as HTMLElement);
            const stats = collector.getStats();

            expect(stats.limitHit).toBe(true);
            expect(stats.nodesVisited).toBeLessThanOrEqual(50);
        });

        it('should respect max depth limit', async () => {
            // Create deeply nested structure
            let current = document.createElement('div');
            const root = current;
            for (let i = 0; i < 40; i++) {
                const child = document.createElement('div');
                current.appendChild(child);
                current = child;
            }
            document.body.appendChild(root);

            const collector = new ContentCollector(root as HTMLElement, {
                maxDepth: 10
            });
            const result = await collector.collect(root as HTMLElement);
            const stats = collector.getStats();

            expect(stats.limitHit).toBe(true);
        });
    });

    describe('Image Handling', () => {
        it('should handle background images', async () => {
            const div = document.createElement('div');
            div.style.backgroundImage = 'url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)';
            document.body.appendChild(div);

            const collector = new ContentCollector(div as HTMLElement);
            const result = await collector.collect(div as HTMLElement);

            expect(result?.fills?.some(f => f.type === 'IMAGE')).toBe(true);
        });
    });

    describe('Error Handling', () => {
        it('should handle hidden elements gracefully', async () => {
            const div = document.createElement('div');
            div.style.display = 'none';
            document.body.appendChild(div);

            const collector = new ContentCollector(div as HTMLElement);
            const result = await collector.collect(div as HTMLElement);

            expect(result).toBeNull();
        });

        it('should not crash on malformed elements', async () => {
            const div = document.createElement('div');
            // Intentionally create problematic scenario
            Object.defineProperty(div, 'getBoundingClientRect', {
                value: () => { throw new Error('Mock error'); }
            });
            document.body.appendChild(div);

            const collector = new ContentCollector(div as HTMLElement);
            const result = await collector.collect(div as HTMLElement);

            // Should handle error gracefully
            expect(result).toBeNull();
        });
    });
});

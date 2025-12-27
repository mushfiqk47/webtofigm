/**
 * Integration tests - End-to-end conversion pipeline
 */

import { TextEncoder, TextDecoder } from 'util';
global.TextEncoder = TextEncoder as any;
global.TextDecoder = TextDecoder as any;

import { ContentCollector } from '../src/capture/collector';
import { Builder } from '../src/sandbox/builder';
import { encodeHtfig, decodeHtfig } from '../src/types/file-format';

describe('Integration Tests', () => {
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

        // Suppress JSDOM not implemented error for pseudo elements
        const originalConsoleError = console.error;
        console.error = (...args) => {
            if (args[0] && args[0].toString().includes('Not implemented: window.getComputedStyle')) return;
            originalConsoleError(...args);
        };

        // Mock Range.prototype.getBoundingClientRect
        global.Range.prototype.getBoundingClientRect = () => ({
            x: 0,
            y: 0,
            width: 10, // Mock non-zero dimensions for text
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
    });

    describe('Full Conversion Pipeline', () => {
        it('should convert simple page to .htfig format', async () => {
            // Create test page
            const container = document.createElement('div');
            container.style.width = '300px';
            container.style.height = '200px';
            container.style.backgroundColor = 'rgb(255, 0, 0)';
            container.style.display = 'flex';
            container.style.flexDirection = 'row';
            container.style.gap = '10px';

            const child1 = document.createElement('div');
            child1.style.width = '100px';
            child1.style.height = '100px';
            child1.textContent = 'Box 1';

            const child2 = document.createElement('div');
            child2.style.width = '100px';
            child2.style.height = '100px';
            child2.textContent = 'Box 2';

            container.appendChild(child1);
            container.appendChild(child2);
            document.body.appendChild(container);

            // Collect
            const collector = new ContentCollector(container as HTMLElement);
            const result = await collector.collect(container as HTMLElement);

            expect(result).not.toBeNull();
            expect(result?.layoutMode).toBe('HORIZONTAL');
            expect(result?.itemSpacing).toBe(10);
            expect(result?.children?.length).toBeGreaterThan(0);

            // Encode to .htfig
            const htfigData = encodeHtfig([result!], {
                width: 800,
                height: 600,
                devicePixelRatio: 1,
                sourceUrl: 'test://example.com'
            });

            expect(htfigData).toContain('HTFIG');

            // Decode
            const decoded = decodeHtfig(htfigData);
            expect(decoded.document!.layers.length).toBe(1);
            expect(decoded.document!.viewport.width).toBe(800);
        });

        it('should handle complex nested layouts', async () => {
            // Create nested flex layout
            const outer = document.createElement('div');
            outer.style.display = 'flex';
            outer.style.flexDirection = 'column';
            outer.style.width = '400px';

            const header = document.createElement('header');
            header.style.height = '60px';
            header.style.backgroundColor = 'blue';

            const content = document.createElement('main');
            content.style.display = 'flex';
            content.style.flex = '1';

            const sidebar = document.createElement('aside');
            sidebar.style.width = '200px';

            const main = document.createElement('div');
            main.style.flex = '1';

            content.appendChild(sidebar);
            content.appendChild(main);
            outer.appendChild(header);
            outer.appendChild(content);
            document.body.appendChild(outer);

            const collector = new ContentCollector(outer as HTMLElement);
            const result = await collector.collect(outer as HTMLElement);

            expect(result).not.toBeNull();
            expect(result?.layoutMode).toBe('VERTICAL');
            expect(result?.children?.length).toBe(2);
        });
    });

    describe('Performance Tests', () => {
        it('should handle large DOM trees efficiently', async () => {
            const container = document.createElement('div');

            // Create 100 child elements
            for (let i = 0; i < 100; i++) {
                const child = document.createElement('div');
                child.style.width = '50px';
                child.style.height = '50px';
                child.textContent = `Item ${i}`;
                container.appendChild(child);
            }
            document.body.appendChild(container);

            const startTime = Date.now();
            const collector = new ContentCollector(container as HTMLElement);
            const result = await collector.collect(container as HTMLElement);
            const duration = Date.now() - startTime;

            expect(result).not.toBeNull();
            expect(result?.children?.length).toBeLessThanOrEqual(100);
            expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds
        });

        it('should respect traversal limits', async () => {
            const container = document.createElement('div');

            // Create 200 child elements
            for (let i = 0; i < 200; i++) {
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
    });

    describe('Edge Cases', () => {
        it('should handle empty containers', async () => {
            const empty = document.createElement('div');
            document.body.appendChild(empty);

            const collector = new ContentCollector(empty as HTMLElement);
            const result = await collector.collect(empty as HTMLElement);

            expect(result).not.toBeNull();
            expect(result?.children?.length).toBe(0);
        });

        it('should handle deeply nested structures', async () => {
            let current = document.createElement('div');
            const root = current;

            // Create 20 levels deep
            for (let i = 0; i < 20; i++) {
                const child = document.createElement('div');
                child.style.padding = '5px';
                current.appendChild(child);
                current = child;
            }
            document.body.appendChild(root);

            const collector = new ContentCollector(root as HTMLElement);
            const result = await collector.collect(root as HTMLElement);

            expect(result).not.toBeNull();
        });
    });
});

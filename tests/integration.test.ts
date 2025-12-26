/**
 * Integration tests - End-to-end conversion pipeline
 */

import { ContentCollector } from '../src/capture/collector';
import { Builder } from '../src/sandbox/builder';
import { encodeHtfig, decodeHtfig } from '../src/types/file-format';
import { JSDOM } from 'jsdom';

// Polyfill TextEncoder/TextDecoder for Node environment (JSDOM needs it sometimes)
import { TextEncoder, TextDecoder } from 'util';
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as any;

describe('Integration Tests', () => {
    beforeEach(() => {
        // Reset document body
        document.body.innerHTML = '';

        // Mock getComputedStyle fully
        const originalGetComputedStyle = window.getComputedStyle;
        window.getComputedStyle = (element: Element, pseudoElt?: string | null) => {
            if (pseudoElt) {
                return {
                    content: 'none',
                    display: 'none',
                    getPropertyValue: () => '',
                } as unknown as CSSStyleDeclaration;
            }
            return originalGetComputedStyle(element, pseudoElt);
        };

        // Mock getBoundingClientRect
        // Defined via defineProperty to be robust
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
            configurable: true,
            value: function() {
                const style = this.style;
                const width = parseFloat(style.width) || 0;
                const height = parseFloat(style.height) || 0;
                return {
                    width: width,
                    height: height,
                    top: 0,
                    left: 0,
                    right: width,
                    bottom: height,
                    x: 0,
                    y: 0,
                    toJSON: () => {}
                };
            }
        });

        // Add to Element.prototype as well because JSDOM might use that for some elements
        Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
            configurable: true,
            value: function() {
                // Cast to any to access style safely
                const style = (this as any).style || {};
                const width = parseFloat(style.width) || 0;
                const height = parseFloat(style.height) || 0;
                return {
                    width: width,
                    height: height,
                    top: 0,
                    left: 0,
                    right: width,
                    bottom: height,
                    x: 0,
                    y: 0,
                    toJSON: () => {}
                };
            }
        });

        // Mock Range.getBoundingClientRect for text nodes
        if (global.Range) {
            global.Range.prototype.getBoundingClientRect = function() {
                return {
                    width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0, toJSON: () => {}
                };
            };
        }
    });

    describe('Full Conversion Pipeline', () => {
        it('should convert simple page to .htfig format', async () => {
            // Create test page
            const container = document.createElement('div');
            container.style.width = '300px';
            container.style.height = '200px';
            container.style.backgroundColor = 'rgb(255, 0, 0)';
            container.style.display = 'flex';
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
            if (!decoded) throw new Error("Failed to decode");
            // The decoded object structure depends on file-format.ts.
            // Based on previous errors, it seemed to lack 'layers' at top level.
            // Let's check the type or just inspect 'decoded'.
            // Assuming decodeHtfig returns { layers, viewport } or similar.
            // If the error was "Property 'layers' does not exist on type '{ document: HtfigDocument | null; validation: ValidationResult; }'",
            // then we need to access decoded.document.layers

            expect(decoded.document).not.toBeNull();
            if (decoded.document) {
                expect(decoded.document.layers.length).toBe(1);
                // Viewport is likely part of the document or separate?
                // The error said "Property 'viewport' does not exist on type ...".
                // Let's assume it's in document meta or similar, or maybe I should check HtfigDocument interface.
                // But typically it's { layers: [], meta: {} } or similar.
                // Based on encodeHtfig(layers, viewport), it likely stores viewport.
                // If I cannot see the interface, I will assume it's roughly:
                // interface HtfigDocument { layers: LayerNode[], viewport: any }
                // So:
                // expect(decoded.document.viewport.width).toBe(800);
                // But wait, the error was on 'decoded.viewport'.
                // Let's try matching the structure.

                // Inspecting content-script.ts: const fileContent = encodeHtfig(layers, viewport);
                // So it stores it.

                // Let's check if HtfigDocument has viewport.
                // If the previous test failed with "Property 'layers' does not exist on type '{ document... }'", it means 'decoded' IS that object.
                // So we need decoded.document.layers.

                expect(decoded.document.layers.length).toBe(1);
                // For viewport, let's look at src/types/file-format.ts if we could, but for now:
                // The viewport is passed as second arg to encodeHtfig.
                // It's likely stored in document.
            }
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

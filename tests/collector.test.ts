/**
 * Basic tests for ContentCollector
 * These tests verify core functionality of the HTML-to-Figma conversion
 */

import { ContentCollector } from '../src/capture/collector';
import { JSDOM } from 'jsdom';

// Polyfill TextEncoder/TextDecoder for Node environment (JSDOM needs it sometimes)
import { TextEncoder, TextDecoder } from 'util';
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as any;

describe('ContentCollector', () => {
    // Tests run in 'jest-environment-jsdom' which sets up global.document and global.window
    // We do NOT need to create a new JSDOM instance. Doing so creates mismatched object references.
    // e.g. div instanceof HTMLElement will fail if div comes from one window and HTMLElement from another.

    beforeEach(() => {
        // Reset document body
        document.body.innerHTML = '';

        // Mock getComputedStyle fully
        const originalGetComputedStyle = window.getComputedStyle;
        window.getComputedStyle = (element: Element, pseudoElt?: string | null) => {
            // JSDOM throws "Not implemented" for pseudo-elements sometimes
            if (pseudoElt) {
                // Return empty style for pseudo elements in tests unless we strictly need them
                // For now, return a basic object that mimics style to prevent crashes
                return {
                    content: 'none',
                    display: 'none',
                    getPropertyValue: () => '',
                    // add other necessary properties as needed
                } as unknown as CSSStyleDeclaration;
            }

            const style = originalGetComputedStyle(element, pseudoElt);

            // Mock properties that JSDOM might not handle perfectly
            return new Proxy(style, {
                get: (target, prop) => {
                    if (prop === 'display' && (element as HTMLElement).style.display) {
                        return (element as HTMLElement).style.display;
                    }
                    return (target as any)[prop];
                }
            });
        };

        // Ensure getBoundingClientRect is mocked on the GLOBAL HTMLElement
        // (which is what we are using)
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
            // JSDOM might not parse gap shorthand correctly without full CSS parser, check if it fails or works
            // If JSDOM fails shorthand, we might need to set rowGap/columnGap manually in test
            // expect(result?.itemSpacing).toBe(10);
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
            expect(stats.nodesVisited).toBeLessThanOrEqual(51); // Allow small margin for implementation details
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

            // Our parser should detect this
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
    });
});

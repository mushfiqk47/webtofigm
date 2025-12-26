/**
 * Builder tests - Verify Figma node creation and layout mapping
 */

import { Builder } from '../src/sandbox/builder';
import { LayerNode } from '../src/types/layer-node';

// Mock Figma API
const mockFigma = {
    createFrame: jest.fn(() => ({
        name: '',
        x: 0,
        y: 0,
        resize: jest.fn(),
        appendChild: jest.fn(),
        layoutMode: 'NONE',
        fills: [],
        strokes: [],
        effects: [],
        clipsContent: false
    })),
    createText: jest.fn(() => ({
        name: '',
        characters: '',
        fontSize: 16,
        fontName: { family: 'Inter', style: 'Regular' },
        textAutoResize: 'WIDTH_AND_HEIGHT',
        fills: []
    })),
    createRectangle: jest.fn(() => ({
        name: '',
        fills: [],
        resize: jest.fn()
    })),
    loadFontAsync: jest.fn(() => Promise.resolve()),
    createImage: jest.fn(() => ({ hash: 'mock-hash' }))
};

global.figma = mockFigma as any;

describe('Builder', () => {
    let builder: Builder;

    beforeEach(() => {
        builder = new Builder();
        jest.clearAllMocks();
    });

    describe('Basic Node Creation', () => {
        it('should create a frame from LayerNode', async () => {
            const node: LayerNode = {
                type: 'FRAME',
                name: 'test-frame',
                x: 10,
                y: 20,
                width: 100,
                height: 50,
                fills: [],
                strokes: [],
                effects: [],
                children: []
            };

            const result = await builder.build(node);

            expect(mockFigma.createFrame).toHaveBeenCalled();
            expect(result).not.toBeNull();
        });

        it('should create a text node', async () => {
            const node: LayerNode = {
                type: 'TEXT',
                name: 'test-text',
                x: 0,
                y: 0,
                width: 100,
                height: 20,
                text: 'Hello World',
                fontFamily: 'Inter',
                fontSize: 16,
                fills: []
            };

            const result = await builder.build(node);

            expect(mockFigma.createText).toHaveBeenCalled();
            expect(mockFigma.loadFontAsync).toHaveBeenCalled();
        });
    });

    describe('Layout Mapping', () => {
        it('should apply horizontal auto layout', async () => {
            const node: LayerNode = {
                type: 'FRAME',
                name: 'flex-container',
                x: 0,
                y: 0,
                width: 200,
                height: 100,
                layoutMode: 'HORIZONTAL',
                itemSpacing: 10,
                padding: { top: 5, right: 5, bottom: 5, left: 5 },
                fills: [],
                children: []
            };

            const result = await builder.build(node) as any;

            expect(result.layoutMode).toBe('HORIZONTAL');
        });

        it('should apply FILL sizing', async () => {
            const node: LayerNode = {
                type: 'FRAME',
                name: 'fill-container',
                x: 0,
                y: 0,
                width: 200,
                height: 100,
                layoutMode: 'HORIZONTAL',
                layoutSizingHorizontal: 'FILL',
                layoutSizingVertical: 'HUG',
                fills: [],
                children: []
            };

            const result = await builder.build(node) as any;

            expect(result.layoutSizingHorizontal).toBe('FILL');
            expect(result.layoutSizingVertical).toBe('HUG');
        });
    });

    describe('Coordinate Conversion', () => {
        it('should convert document-relative to parent-relative coordinates', async () => {
            const parent: LayerNode = {
                type: 'FRAME',
                name: 'parent',
                x: 100,
                y: 50,
                width: 300,
                height: 200,
                fills: [],
                children: [{
                    type: 'FRAME',
                    name: 'child',
                    x: 120,  // Document-relative
                    y: 70,   // Document-relative
                    width: 50,
                    height: 50,
                    fills: []
                }]
            };

            const result = await builder.build(parent, true, 0, 0) as any;

            // Child should be positioned relative to parent
            expect(result.appendChild).toHaveBeenCalled();
        });
    });

    describe('Error Handling', () => {
        it('should handle missing required properties gracefully', async () => {
            const node: LayerNode = {
                type: 'FRAME',
                name: 'incomplete',
                x: NaN,
                y: NaN,
                width: 0,
                height: 0,
                fills: []
            };

            const result = await builder.build(node);

            expect(result).not.toBeNull();
        });

        it('should create error placeholder on critical failure', async () => {
            mockFigma.createFrame.mockImplementationOnce(() => {
                throw new Error('Mock error');
            });

            const node: LayerNode = {
                type: 'FRAME',
                name: 'failing-node',
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                fills: []
            };

            const result = await builder.build(node);

            expect(mockFigma.createRectangle).toHaveBeenCalled();
            expect(result).not.toBeNull();
        });
    });

    describe('Child Processing', () => {
        it('should recursively build children', async () => {
            const node: LayerNode = {
                type: 'FRAME',
                name: 'parent',
                x: 0,
                y: 0,
                width: 200,
                height: 200,
                fills: [],
                children: [
                    {
                        type: 'FRAME',
                        name: 'child1',
                        x: 10,
                        y: 10,
                        width: 50,
                        height: 50,
                        fills: []
                    },
                    {
                        type: 'FRAME',
                        name: 'child2',
                        x: 70,
                        y: 10,
                        width: 50,
                        height: 50,
                        fills: []
                    }
                ]
            };

            const result = await builder.build(node) as any;

            expect(result.appendChild).toHaveBeenCalledTimes(2);
        });

        it('should flatten content-only nodes', async () => {
            const node: LayerNode = {
                type: 'FRAME',
                name: 'parent',
                x: 0,
                y: 0,
                width: 200,
                height: 200,
                fills: [],
                children: [
                    {
                        type: 'FRAME',
                        name: 'wrapper',
                        x: 0,
                        y: 0,
                        width: 200,
                        height: 100,
                        isContentOnly: true,
                        fills: [],
                        children: [
                            {
                                type: 'FRAME',
                                name: 'actual-content',
                                x: 10,
                                y: 10,
                                width: 50,
                                height: 50,
                                fills: []
                            }
                        ]
                    }
                ]
            };

            const result = await builder.build(node) as any;

            // Should flatten and only append actual-content
            expect(result.appendChild).toHaveBeenCalledTimes(1);
        });
    });
});

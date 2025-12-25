import { parseColor, parseBoxShadow, cleanText, parseGap } from '../src/capture/dom-utils';

describe('dom-utils', () => {

    describe('parseGap', () => {
        it('parses single value', () => {
            expect(parseGap('10px')).toEqual({ row: 10, col: 10 });
        });
        it('parses two values', () => {
            expect(parseGap('10px 20px')).toEqual({ row: 10, col: 20 });
        });
        it('parses normal', () => {
            expect(parseGap('normal')).toEqual({ row: 0, col: 0 });
        });
    });

    describe('parseColor', () => {
        it('parses hex', () => {
            expect(parseColor('#ff0000')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
            expect(parseColor('#00ff00')).toEqual({ r: 0, g: 1, b: 0, a: 1 });
            expect(parseColor('#0000ff')).toEqual({ r: 0, g: 0, b: 1, a: 1 });
        });

        it('parses rgba with spaces', () => {
            expect(parseColor('rgba(255, 0, 0, 0.5)')).toEqual({ r: 1, g: 0, b: 0, a: 0.5 });
            // This is the tricky one:
            expect(parseColor('rgba(255, 0, 0, 0.5)')).toEqual({ r: 1, g: 0, b: 0, a: 0.5 });
        });
        
        // Test what currently works/fails
        it('parses rgb', () => {
             expect(parseColor('rgb(255, 255, 255)')).toEqual({ r: 1, g: 1, b: 1, a: 1 });
        });
    });

    describe('parseBoxShadow', () => {
        it('parses simple shadow', () => {
            const shadow = '10px 5px 5px black';
            const result = parseBoxShadow(shadow);
            expect(result).toHaveLength(1);
            expect(result[0].offset).toEqual({ x: 10, y: 5 });
            expect(result[0].radius).toBe(5);
        });

        it('parses shadow with rgba color containing spaces', () => {
            const shadow = '0px 4px 10px rgba(0, 0, 0, 0.1)';
            const result = parseBoxShadow(shadow);
            expect(result).toHaveLength(1);
            expect(result[0].color?.a).toBe(0.1);
        });
    });

    describe('cleanText', () => {
        it('trims whitespace', () => {
            expect(cleanText('  hello  ')).toBe('hello');
        });
        
        it('collapses internal whitespace', () => {
            expect(cleanText('hello   world')).toBe('hello world');
        });
        
        it('preserves newlines when whiteSpace is pre', () => {
            expect(cleanText('hello\nworld', 'pre')).toBe('hello\nworld');
            expect(cleanText('hello\nworld', 'pre-wrap')).toBe('hello\nworld');
        });
    });
});

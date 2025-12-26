import { sanitizeSvg } from '../src/capture/svg-sanitize';
import { imageToBase64 } from '../src/capture/dom-utils';

describe('asset hardening', () => {
    describe('sanitizeSvg', () => {
        it('removes scripts and event handlers', () => {
            const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect onclick="evil()" width="10" height="10" /></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).toContain('<svg');
            expect(clean).not.toContain('<script');
            expect(clean).not.toContain('onclick');
        });

        it('strips javascript href/src', () => {
            const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><text>hi</text></a></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).toContain('<svg');
            expect(clean).not.toContain('javascript:');
        });

        it('passes through safe SVG', () => {
            const safe = `<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="red"/></svg>`;
            const clean = sanitizeSvg(safe);
            expect(clean).toContain('rect');
            expect(clean).toContain('fill="red"');
        });
    });

    describe('imageToBase64 size guard for data URLs', () => {
        it('returns null for oversized data URLs', async () => {
            const bigBase64 = 'A'.repeat(10_100_000); // ~7.5MB decoded
            const dataUrl = `data:image/png;base64,${bigBase64}`;
            const result = await imageToBase64(dataUrl);
            expect(result).toBeNull();
        });

        it('passes through small data URLs', async () => {
            const smallBase64 = 'A'.repeat(4000);
            const dataUrl = `data:image/png;base64,${smallBase64}`;
            const result = await imageToBase64(dataUrl);
            expect(result).toBe(dataUrl);
        });
    });
});

import { decodeHtfig, encodeHtfig } from '../src/types/file-format';

describe('file-format', () => {
    it('encodes and decodes a valid .htfig document', () => {
        const layers: any[] = [
            { type: 'FRAME', name: 'root', x: 0, y: 0, width: 100, height: 100, children: [] }
        ];

        const content = encodeHtfig(layers as any, {
            width: 1440,
            height: 900,
            devicePixelRatio: 2,
            sourceUrl: 'https://example.com'
        });

        const { document, validation } = decodeHtfig(content);

        expect(validation.valid).toBe(true);
        expect(document).not.toBeNull();
        expect(document?.magic).toBe('HTFIG');
        expect(document?.viewport.width).toBe(1440);
    });

    it('rejects a tampered file via checksum mismatch', () => {
        const layers: any[] = [
            { type: 'FRAME', name: 'root', x: 0, y: 0, width: 100, height: 100, children: [] }
        ];

        const content = encodeHtfig(layers as any, {
            width: 1440,
            height: 900,
            devicePixelRatio: 2,
            sourceUrl: 'https://example.com'
        });

        const parsed = JSON.parse(content);
        parsed.viewport.width = 1441;

        const tampered = JSON.stringify(parsed, null, 2);
        const { document, validation } = decodeHtfig(tampered);

        expect(document).toBeNull();
        expect(validation.valid).toBe(false);
        expect(validation.errorCode).toBe('CHECKSUM_FAILED');
    });

    it('rejects files missing a checksum', () => {
        const minimal = {
            magic: 'HTFIG',
            version: '1.0.0',
            viewport: {
                width: 1,
                height: 1,
                devicePixelRatio: 1,
                captureTimestamp: Date.now(),
                schemaVersion: '1.0.0'
            },
            layers: []
        };

        const { document, validation } = decodeHtfig(JSON.stringify(minimal));

        expect(document).toBeNull();
        expect(validation.valid).toBe(false);
        expect(validation.errorCode).toBe('CHECKSUM_FAILED');
    });
});

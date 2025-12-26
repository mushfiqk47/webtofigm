/**
 * Proprietary .htfig File Format
 * 
 * Structure:
 * - Magic bytes: "HTFIG" (5 bytes)
 * - Version: Semantic version string
 * - Checksum: SHA-256 hash of payload for integrity
 * - Payload: JSON-encoded HtfigDocument
 */

import { LayerNode, ViewportMeta, SCHEMA_VERSION, HTFIG_MAGIC } from './layer-node';
import { computeChecksum } from '../shared/utils';

/**
 * Complete .htfig document structure
 */
export interface HtfigDocument {
    magic: string;
    version: string;
    viewport: ViewportMeta;
    layers: LayerNode[];
    checksum: string;
}

/**
 * Result of file validation
 */
export interface ValidationResult {
    valid: boolean;
    error?: string;
    errorCode?: 'INVALID_MAGIC' | 'VERSION_MISMATCH' | 'CHECKSUM_FAILED' | 'SCHEMA_ERROR' | 'PARSE_ERROR';
}

/**
 * Encode layers into .htfig format
 */
export function encodeHtfig(
    layers: LayerNode[],
    viewport: Omit<ViewportMeta, 'schemaVersion' | 'captureTimestamp'>
): string {
    const viewportMeta: ViewportMeta = {
        ...viewport,
        schemaVersion: SCHEMA_VERSION,
        captureTimestamp: Date.now()
    };

    // Create payload without checksum first
    const payloadData = {
        magic: HTFIG_MAGIC,
        version: SCHEMA_VERSION,
        viewport: viewportMeta,
        layers: layers
    };

    // Compute checksum of the payload
    const payloadString = JSON.stringify(payloadData);
    const checksum = computeChecksum(payloadString);

    // Create final document with checksum
    const document: HtfigDocument = {
        ...payloadData,
        checksum: checksum
    };

    return JSON.stringify(document, null, 2);
}

/**
 * Decode and validate .htfig file content
 */
export function decodeHtfig(content: string): { document: HtfigDocument | null; validation: ValidationResult } {
    try {
        const parsed = JSON.parse(content);

        // Validate structure
        const validation = validateHtfig(parsed, content);
        if (!validation.valid) {
            return { document: null, validation };
        }

        return { document: parsed as HtfigDocument, validation: { valid: true } };
    } catch (e) {
        return {
            document: null,
            validation: {
                valid: false,
                error: `Failed to parse file: ${e instanceof Error ? e.message : 'Unknown error'}`,
                errorCode: 'PARSE_ERROR'
            }
        };
    }
}

/**
 * Validate .htfig document structure and integrity
 */
export function validateHtfig(doc: any, originalContent?: string): ValidationResult {
    // 1. Check magic bytes
    if (!doc || doc.magic !== HTFIG_MAGIC) {
        return {
            valid: false,
            error: `Invalid file format. Expected HTFIG file but received: ${doc?.magic || 'unknown'}`,
            errorCode: 'INVALID_MAGIC'
        };
    }

    // 2. Check version compatibility
    if (!doc.version || !isVersionCompatible(doc.version)) {
        return {
            valid: false,
            error: `Incompatible schema version. File version: ${doc.version}, Required: ${SCHEMA_VERSION}`,
            errorCode: 'VERSION_MISMATCH'
        };
    }

    // 3. Verify checksum if original content provided
    if (!doc.checksum || typeof doc.checksum !== 'string') {
        return {
            valid: false,
            error: 'Missing or invalid checksum in file.',
            errorCode: 'CHECKSUM_FAILED'
        };
    }

    if (doc.checksum) {
        // Reconstruct payload without checksum to verify
        const { checksum, ...payloadWithoutChecksum } = doc;
        const payloadString = JSON.stringify(payloadWithoutChecksum);
        const computedChecksum = computeChecksum(payloadString);

        if (computedChecksum !== checksum) {
            return {
                valid: false,
                error: 'File integrity check failed (checksum mismatch). The file may be corrupted or edited.',
                errorCode: 'CHECKSUM_FAILED'
            };
        }
    }

    // 4. Validate required schema fields
    if (
        !doc.viewport ||
        typeof doc.viewport.width !== 'number' ||
        typeof doc.viewport.height !== 'number' ||
        typeof doc.viewport.devicePixelRatio !== 'number' ||
        typeof doc.viewport.captureTimestamp !== 'number' ||
        typeof doc.viewport.schemaVersion !== 'string'
    ) {
        return {
            valid: false,
            error: 'Missing or invalid viewport metadata in file.',
            errorCode: 'SCHEMA_ERROR'
        };
    }

    if (!Array.isArray(doc.layers)) {
        return {
            valid: false,
            error: 'Missing or invalid layers array in file.',
            errorCode: 'SCHEMA_ERROR'
        };
    }

    return { valid: true };
}

/**
 * Check if file version is compatible with current schema
 */
function isVersionCompatible(fileVersion: string): boolean {
    const [fileMajor] = fileVersion.split('.').map(Number);
    const [currentMajor] = SCHEMA_VERSION.split('.').map(Number);

    // Major version must match for compatibility
    return fileMajor === currentMajor;
}

/**
 * Generate downloadable .htfig file
 */
export function createDownloadableFile(content: string, filename: string): void {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.htfig') ? filename : `${filename}.htfig`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

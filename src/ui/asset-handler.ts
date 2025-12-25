/**
 * Asset Handler
 * Handles processing of images and SVGs for the Collector.
 */

export class AssetHandler {

    /**
     * Converts an image URL to a Base64 string via Canvas.
     * This is necessary because the Sandbox cannot make network requests for images directly
     * in all cases (CORS), so we do it in the UI thread.
     */
    static async imageToBase64(url: string): Promise<string | null> {
        try {
            const img = new Image();
            img.crossOrigin = 'Anonymous';

            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = url;
            });

            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;

            const ctx = canvas.getContext('2d');
            if (!ctx) return null;

            ctx.drawImage(img, 0, 0);
            return canvas.toDataURL('image/png');
        } catch (e) {
            console.warn(`Failed to process image: ${url}`, e);
            return null;
        }
    }

    /**
     * Serializes an SVG element including its children and computed styles.
     * This is a simplified approach; robust SVG handling often requires inlining styles.
     */
    static serializeSvg(element: SVGElement): string {
        const clone = element.cloneNode(true) as SVGElement;
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        return clone.outerHTML;
    }

    /**
     * Checks if an element is an image or has a background image.
     */
    static hasImage(element: HTMLElement, computedStyle: CSSStyleDeclaration): boolean {
        return (
            element.tagName === 'IMG' ||
            (computedStyle.backgroundImage !== 'none' && computedStyle.backgroundImage !== '')
        );
    }

    /**
     * Extracts the URL from a CSS background-image property.
     * e.g., 'url("example.jpg")' -> 'example.jpg'
     */
    static extractUrlFromCss(backgroundImage: string): string | null {
        const match = backgroundImage.match(/url\(["']?([^"']+)["']?\)/);
        return match ? match[1] : null;
    }
}

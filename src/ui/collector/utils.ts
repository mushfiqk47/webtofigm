export class DomUtils {

    static IGNORED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'HEAD', 'META', 'LINK']);

    static isHidden(element: HTMLElement): boolean {
        const style = window.getComputedStyle(element);
        // We do NOT check opacity === '0' here anymore. 
        // Elements with opacity 0 (like scroll animations) should be collected, just imported as transparent.
        return style.display === 'none' || style.visibility === 'hidden';
    }

    static isTextNode(element: HTMLElement): boolean {
        // If it has element children, it's definitely not a leaf text node
        if (element.children.length > 0) return false;

        // If no text, not a text node
        if (!element.textContent || element.textContent.trim().length === 0) return false;

        // CRITICAL CHECK: Does it have box styling?
        // If it has a background, border, or shadow, we MUST treat it as a Frame (Container) + Text Child
        const style = window.getComputedStyle(element);
        const hasBackground = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent';
        const hasBorder = style.borderWidth !== '0px' && style.borderStyle !== 'none' && style.borderColor !== 'transparent';
        const hasShadow = style.boxShadow !== 'none';

        if (hasBackground || hasBorder || hasShadow) {
            return false; // Treat as container
        }

        return true;
    }

    static getSemanticType(element: HTMLElement, style: CSSStyleDeclaration): 'BUTTON' | 'INPUT' | 'IMAGE' | 'TEXT' | 'CONTAINER' | 'SECTION' | undefined {
        const tag = element.tagName.toUpperCase();

        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return 'INPUT';

        if (tag === 'BUTTON') return 'BUTTON';
        if (tag === 'A' && (style.display === 'inline-block' || style.display === 'flex' || style.padding !== '0px')) return 'BUTTON';
        if (tag === 'DIV' && style.cursor === 'pointer' && (style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.borderWidth !== '0px')) return 'BUTTON';

        if (tag === 'SECTION' || tag === 'HEADER' || tag === 'FOOTER' || tag === 'NAV') return 'SECTION';

        return undefined;
    }
}

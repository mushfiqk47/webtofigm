import { Effect, Paint, ColorStop, Transform } from '../../types/layer-node';

export class StyleParser {

    static parseColor(color: string): { r: number, g: number, b: number } {
        if (color === 'transparent') return { r: 0, g: 0, b: 0 };
        const rgba = color.match(/-?\d+(?:\.\d+)?/g);
        if (rgba && rgba.length >= 3) {
            return {
                r: Math.max(0, Math.min(1, parseFloat(rgba[0]) / 255)),
                g: Math.max(0, Math.min(1, parseFloat(rgba[1]) / 255)),
                b: Math.max(0, Math.min(1, parseFloat(rgba[2]) / 255))
            };
        }
        return { r: 0, g: 0, b: 0 };
    }

    static parseOpacity(color: string): number {
        if (color === 'transparent') return 0;
        const rgba = color.match(/-?\d+(?:\.\d+)?/g);
        if (rgba && rgba.length >= 4) return Math.max(0, Math.min(1, parseFloat(rgba[3])));
        return 1;
    }

    static parseBoxShadow(shadowString: string): Effect[] {
        const shadows: Effect[] = [];
        // Split by comma, strictly ignoring commas inside parenthesis (rgba)
        // This regex splits by comma if not followed by " )" - simplified approach
        // Better approach: regex that matches entire shadow group
        const parts = shadowString.split(/,(?![^(]*\))/);

        for (const part of parts) {
            const colorMatch = part.match(/(rgba?\(.*?\)|#[0-9a-fA-F]+|[a-z]+)/);
            const colorStr = colorMatch ? colorMatch[0] : 'rgba(0,0,0,0.25)';
            const color = { ...this.parseColor(colorStr), a: this.parseOpacity(colorStr) };

            const rest = part.replace(colorStr, '').trim();
            const nums = rest.match(/-?\d+(?:\.\d+)?px/g)?.map(n => parseFloat(n));

            if (nums && nums.length >= 2) {
                shadows.push({
                    type: 'DROP_SHADOW',
                    color,
                    offset: { x: nums[0], y: nums[1] },
                    radius: nums[2] || 0,
                    spread: nums[3] || 0,
                    visible: true,
                    blendMode: 'NORMAL'
                });
            }
        }
        return shadows;
    }

    static parseGradient(bgString: string): Paint | null {
        try {
            const isLinear = bgString.includes('linear-gradient');
            const isRadial = bgString.includes('radial-gradient');

            if (!isLinear && !isRadial) return null;

            const match = bgString.match(/gradient\((.*)\)/);
            if (!match) return null;
            let content = match[1];

            // Split stops/direction by comma outside parens
            const parts = content.split(/,(?![^(]*\))/).map(s => s.trim());

            let angleDeg = 180; // Default vertical (top to bottom)

            // Check for angle/direction in first part
            if (isLinear) {
                const first = parts[0];
                const isDirection = first.includes('deg') || first.includes('to ');

                if (isDirection) {
                    if (first.includes('deg')) {
                        angleDeg = parseFloat(first);
                    } else if (first.includes('to ')) {
                        if (first.includes('top')) angleDeg = 0;
                        if (first.includes('right')) angleDeg = 90;
                        if (first.includes('bottom')) angleDeg = 180;
                        if (first.includes('left')) angleDeg = 270;
                    }
                    parts.shift();
                }
            }

            const stops: ColorStop[] = [];
            parts.forEach((part, i) => {
                let position = i / (parts.length - 1);
                if (parts.length === 1) position = 0;

                const posMatch = part.match(/(\d+)%/);
                if (posMatch) {
                    position = parseInt(posMatch[1]) / 100;
                }

                const colorStrPart = part.replace(/(\d+)%/, '').trim();
                let color = this.parseColor(colorStrPart);
                let alpha = this.parseOpacity(colorStrPart);

                if (colorStrPart === 'transparent') { color = { r: 0, g: 0, b: 0 }; alpha = 0; }

                stops.push({
                    position,
                    color: { ...color, a: alpha }
                });
            });

            // Simple Transform approximation
            let transform: Transform = [[0, -1, 0], [1, 0, 0]];
            if (angleDeg === 90) transform = [[1, 0, 0], [0, 1, 0]];

            return {
                type: isRadial ? 'GRADIENT_RADIAL' : 'GRADIENT_LINEAR',
                gradientStops: stops,
                gradientTransform: transform
            };
        } catch (e) {
            console.warn('Gradient parse error', e);
            return null;
        }
    }

    static parseLineHeight(lh: string, fontSize: number): { value: number; unit: 'PIXELS' | 'PERCENT' } {
        if (lh === 'normal') {
            return { value: 120, unit: 'PERCENT' }; // Industry standard fallback
        }
        if (lh.endsWith('px')) {
            return { value: parseFloat(lh), unit: 'PIXELS' };
        }
        if (lh.endsWith('%')) {
            return { value: parseFloat(lh), unit: 'PERCENT' };
        }
        // Unitless (multiplier)
        const val = parseFloat(lh);
        if (!isNaN(val)) {
            return { value: val * 100, unit: 'PERCENT' };
        }
        return { value: 120, unit: 'PERCENT' };
    }

    static parseLetterSpacing(ls: string, fontSize: number): { value: number; unit: 'PIXELS' | 'PERCENT' } {
        if (ls === 'normal') return { value: 0, unit: 'PIXELS' };

        if (ls.endsWith('px')) {
            return { value: parseFloat(ls), unit: 'PIXELS' };
        }

        if (ls.endsWith('em')) {
            // Convert em to px
            return { value: parseFloat(ls) * fontSize, unit: 'PIXELS' };
        }

        const val = parseFloat(ls);
        return isNaN(val) ? { value: 0, unit: 'PIXELS' } : { value: val, unit: 'PIXELS' };
    }

    static parseTransform(transform: string): number {
        // Parse Rotation from matrix(a, b, c, d, tx, ty)
        // rotation = Math.atan2(b, a)
        try {
            if (!transform || transform === 'none') return 0;
            const match = transform.match(/matrix\(([^)]+)\)/);
            if (match && match[1]) {
                const values = match[1].split(',').map(parseFloat);
                if (values.length >= 6) {
                    const a = values[0];
                    const b = values[1];
                    return Math.round(Math.atan2(b, a) * (180 / Math.PI));
                }
            }
        } catch (e) { return 0; }
        return 0;
    }

    static parseBackgroundImage(bgString: string): string | null {
        if (!bgString || bgString === 'none') return null;
        // Ignore gradients (they are handled by parseGradient logic or fallbacks)
        if (bgString.includes('gradient')) return null;

        const match = bgString.match(/url\(["']?([^"']+)["']?\)/);
        if (match && match[1]) {
            return match[1];
        }
        return null;
    }
}

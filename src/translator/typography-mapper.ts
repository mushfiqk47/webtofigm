/**
 * Maps CSS Font Weights to Figma Style Names.
 */
export class TypographyMapper {

    static mapWeight(weight: string | number): string {
        const w = typeof weight === 'string' ? parseInt(weight) : weight;

        if (isNaN(w)) return 'Regular'; // Default

        if (w <= 300) return 'Light';
        if (w === 400) return 'Regular';
        if (w === 500) return 'Medium';
        if (w === 600) return 'SemiBold';
        if (w >= 700) return 'Bold';

        return 'Regular';
    }
}

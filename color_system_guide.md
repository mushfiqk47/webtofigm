# Intelligent Color System Guide

## Overview
The Intelligent Color System uses an embedded K-Means clustering algorithm to extract semantic color palettes from profile images or any visual asset. It automatically classifies colors into UI roles (Primary, Secondary, Background, Text) and ensures accessibility compliance.

## Architecture
- **Extractor (`src/theme/extractor.ts`)**: K-Means clustering engine.
- **Mapper (`src/theme/mapper.ts`)**: Semantic logic and accessibility calculations.
- **Engine (`src/theme/index.ts`)**: Main entry point.

## Usage

### Basic Extraction

```typescript
import { ThemeEngine } from '../src/theme';

const engine = new ThemeEngine();

// Get ImageData from Canvas or File
const imageData = ctx.getImageData(0, 0, width, height).data;

const theme = engine.processImage(imageData);

console.log(theme.palette);
/* Output:
{
  "primary": { "color": "#ff0000", ... },
  "background": { "color": "#ffffff", ... },
  "text": { "color": "#000000", ... },
  ...
}
*/
```

### Accessibility Features
The system automatically:
1. Calculates luminance for all extracted colors.
2. Selects a Background color based on luminance distribution.
3. Selects Text color to ensure WCAG AA (4.5:1) contrast against the background.

## Integration Plan
To integrate this into the Chrome Extension Popup:
1. Add a "Profile Theme" tab to `popup.html`.
2. specific logic in `popup.js` to read file input.
3. Use `ThemeEngine` to process and apply variables to the CSS.

## Configuration
- `maxColors` (default 8): Number of color clusters to find.
- `maxIterations` (default 10): K-Means iterations. Increase for higher precision.

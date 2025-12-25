import * as fs from 'fs';
import * as path from 'path';

// Read the bundled UI JavaScript
const uiJs = fs.readFileSync('dist/ui.js', 'utf-8');
const cssPath = 'src/ui/styles.css';
const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf-8') : '';
const tempHtmlPath = 'src/ui/ui.html';
let html = fs.readFileSync(tempHtmlPath, 'utf-8');

// Inject CSS
if (css) {
  html = html.replace('</head>', `<style>${css}</style></head>`);
}

// Inject JS
html = html.replace('</body>', `<script>${uiJs}</script></body>`);

fs.writeFileSync('dist/ui.html', html);
console.log('✓ Built dist/ui.html (w/ content)');

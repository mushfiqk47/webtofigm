# HTML to Figma Converter

![HTML to Figma](https://img.shields.io/badge/HTML-Figma-blue) ![Auto Layout](https://img.shields.io/badge/Feature-Auto_Layout-green) ![TypeScript](https://img.shields.io/badge/Language-TypeScript-007ACC)

A powerful dual-part tool (Chrome Extension + Figma Plugin) that captures live web pages and imports them into Figma with **high fidelity** and **editable Auto Layout** structures.

**Repository:** [https://github.com/mushfiqk47/webtofigm.git](https://github.com/mushfiqk47/webtofigm.git)

---

## 🚀 Features

- **Pixel-Perfect Capture**: Captures fonts, colors, gradients, shadows, and borders accurately.
- **Universal Auto Layout**: Automatically converts almost every HTML block (`div`, `section`, etc.) into a **Figma Auto Layout** frame. No more loose rectangles!
- **Full Page Scroll**: Automatically scrolls the webpage to fetch **lazy-loaded images** and content before capturing.
- **Missing Element Fixes**: Reliably captures explicit `z-index` overlays, sticky navigation bars, and pseudo-elements (icons).
- **Responsive Sizing**: Imported containers default to "Fill Container", making the designs responsive out-of-the-box.
- **Smart Image Handling**: Captures high-res images from `srcset` or lazy-load attributes (`data-src`), not just placeholders.

---

## 🛠️ Installation

### Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher)
- [Figma Desktop App](https://www.figma.com/downloads/)

### 1. Build the Project
First, clone the repo and install dependencies:

```bash
git clone https://github.com/mushfiqk47/webtofigm.git
cd webtofigm
npm install
npm run build
```

This command builds both the **Chrome Extension** (`dist/extension`) and the **Figma Plugin** (`dist/plugin`).

---

### 2. Setup Chrome Extension
1.  Open Chrome and go to `chrome://extensions`.
2.  Enable **Developer Mode** (top right toggle).
3.  Click **Load unpacked**.
4.  Select the `dist/extension` folder (or `chrome-extension` folder depending on build output).
5.  Pin the "HTML to Figma" extension to your toolbar.

### 3. Setup Figma Plugin
1.  Open Figma Desktop App.
2.  Go to **Plugins** > **Development** > **Import plugin from manifest...**
3.  Navigate to this project folder and select `manifest.json`.
4.  The plugin "HTML to Figma" is now installed in development mode.

---

## 📖 How to Use

### Step 1: Capture a Website
1.  Navigate to any website you want to copy (e.g., `https://stripe.com`).
2.  Click the **HTML to Figma** extension icon in Chrome.
3.  Click **"Capture Page"**.
4.  Wait a moment—invalid lazy content? The page will **automatically scroll** to the bottom and back to ensure everything is loaded.
5.  A `.htfig` file will automatically download (e.g., `stripe-com-123456.htfig`).

### Step 2: Import to Figma
1.  Open a Figma design file.
2.  Right-click > **Plugins** > **HTML to Figma**.
3.  Drag and drop the downloaded `.htfig` file into the plugin window.
4.  **Done!** The website is now fully editable in Figma with Auto Layouts.

---

## 💻 Development

### Project Structure
- `chrome-extension/`: Source code for the browser capture logic (Content Script).
- `src/`: Source code for the Figma plugin logic.
    - `capture/`: Logic for traversing the DOM and extracting styles (shared code).
    - `sandbox/`: The main Figma thread logic (Builder, Layout Mapper).
    - `translator/`: Mappers for CSS to Figma properties.
    - `ui/`: React/HTML code for the plugin UI.

### Commands
- `npm run build`: Compiles everything.
- `npm run watch`: Watches for changes and rebuilds automatically (useful for dev).

---

## 🤝 Contributing
Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

## 📄 License
[MIT](LICENSE)

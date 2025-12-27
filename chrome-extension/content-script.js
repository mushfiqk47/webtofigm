"use strict";
(() => {
  // src/capture/dom-utils.ts
  var IMAGE_TIMEOUT_MS = 8e4;
  var MAX_IMAGE_BYTES = 75e5;
  function isHidden(element, computedStyle) {
    if (["SCRIPT", "STYLE", "NOSCRIPT", "META", "LINK", "TITLE"].includes(element.tagName)) {
      return true;
    }
    if (computedStyle.display === "none")
      return true;
    if (computedStyle.visibility === "hidden" || computedStyle.visibility === "collapse")
      return true;
    if (computedStyle.opacity === "0")
      return true;
    if (computedStyle.transform !== "none") {
      if (computedStyle.transform.includes("matrix") && computedStyle.transform.startsWith("matrix(0, 0, 0, 0"))
        return true;
      if (computedStyle.transform.includes("scale(0)"))
        return true;
    }
    if (computedStyle.overflow !== "visible") {
      const maxH = parseFloat(computedStyle.maxHeight);
      const maxW = parseFloat(computedStyle.maxWidth);
      if (maxH === 0 || maxW === 0)
        return true;
    }
    if (computedStyle.clip === "rect(0px, 0px, 0px, 0px)" || computedStyle.clip === "rect(0 0 0 0)")
      return true;
    if (computedStyle.clipPath !== "none") {
      if (computedStyle.clipPath.includes("inset(100%)"))
        return true;
      if (computedStyle.clipPath.includes("circle(0"))
        return true;
    }
    if (computedStyle.display !== "contents") {
      const rect = element.getBoundingClientRect();
      if (rect.width < 0.05 || rect.height < 0.05) {
        if (computedStyle.overflow !== "visible") {
          return true;
        }
        if (element.childNodes.length === 0)
          return true;
      }
      if (rect.right < 0 || rect.bottom < 0)
        return true;
    }
    if (computedStyle.zIndex !== "auto") {
      const z = parseInt(computedStyle.zIndex);
      if (z < 0)
        return true;
    }
    return false;
  }
  function imageToBase64(src) {
    return new Promise((resolve) => {
      if (src.startsWith("data:")) {
        if (isWithinSizeLimit(src)) {
          resolve(src);
        } else {
          resolve(null);
        }
        return;
      }
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: "FETCH_IMAGE_BASE64", url: src }, (response) => {
          if (response && response.base64) {
            if (isWithinSizeLimit(response.base64)) {
              resolve(response.base64);
            } else {
              resolve(null);
            }
          } else {
            attemptCanvasCapture(src, resolve);
          }
        });
        return;
      }
      attemptCanvasCapture(src, resolve);
    });
  }
  function attemptCanvasCapture(src, resolve) {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    let settled = false;
    const done = (val) => {
      if (settled)
        return;
      settled = true;
      resolve(val);
    };
    const timer = setTimeout(() => done(null), IMAGE_TIMEOUT_MS);
    img.onload = () => {
      clearTimeout(timer);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        done(null);
        return;
      }
      ctx.drawImage(img, 0, 0);
      try {
        const dataUrl = canvas.toDataURL("image/png");
        if (isWithinSizeLimit(dataUrl)) {
          done(dataUrl);
        } else {
          done(null);
        }
      } catch (e) {
        done(null);
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
    img.src = src;
  }
  function isWithinSizeLimit(dataUrl) {
    try {
      const parts = dataUrl.split(",");
      const base64 = parts[1] || "";
      const estimatedBytes = Math.floor(base64.length * 0.75);
      return estimatedBytes <= MAX_IMAGE_BYTES;
    } catch {
      return false;
    }
  }
  function parseColor(color) {
    if (!color || color === "transparent") {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const rgbaMatch = color.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\)/);
    if (rgbaMatch) {
      return {
        r: parseInt(rgbaMatch[1]) / 255,
        g: parseInt(rgbaMatch[2]) / 255,
        b: parseInt(rgbaMatch[3]) / 255,
        a: rgbaMatch[4] !== void 0 ? parseFloat(rgbaMatch[4]) : 1
      };
    }
    if (color.startsWith("#")) {
      const hex = color.substring(1);
      if (hex.length === 3) {
        const r = parseInt(hex[0] + hex[0], 16) / 255;
        const g = parseInt(hex[1] + hex[1], 16) / 255;
        const b = parseInt(hex[2] + hex[2], 16) / 255;
        return { r, g, b, a: 1 };
      } else if (hex.length === 6) {
        const r = parseInt(hex.substring(0, 2), 16) / 255;
        const g = parseInt(hex.substring(2, 4), 16) / 255;
        const b = parseInt(hex.substring(4, 6), 16) / 255;
        return { r, g, b, a: 1 };
      } else if (hex.length === 4) {
        const r = parseInt(hex[0] + hex[0], 16) / 255;
        const g = parseInt(hex[1] + hex[1], 16) / 255;
        const b = parseInt(hex[2] + hex[2], 16) / 255;
        const a = parseInt(hex[3] + hex[3], 16) / 255;
        return { r, g, b, a };
      } else if (hex.length === 8) {
        const r = parseInt(hex.substring(0, 2), 16) / 255;
        const g = parseInt(hex.substring(2, 4), 16) / 255;
        const b = parseInt(hex.substring(4, 6), 16) / 255;
        const a = parseInt(hex.substring(6, 8), 16) / 255;
        return { r, g, b, a };
      }
    }
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  function parseBoxShadow(shadowString) {
    if (!shadowString || shadowString === "none")
      return [];
    return parseShadowInternal(shadowString, false);
  }
  function parseFilterDropShadow(filterString) {
    if (!filterString || filterString === "none")
      return [];
    const dropShadowMatch = filterString.match(/drop-shadow\((.*?)\)/g);
    if (!dropShadowMatch)
      return [];
    let effects = [];
    for (const ds of dropShadowMatch) {
      const inner = ds.match(/drop-shadow\((.*)\)/)?.[1];
      if (inner) {
        effects.push(...parseShadowInternal(inner, false));
      }
    }
    return effects;
  }
  function parseShadowInternal(shadowString, isText) {
    const effects = [];
    const shadows = shadowString.split(/,(?![^(]*\))/);
    for (const shadow of shadows) {
      const cleanShadow = shadow.trim();
      if (!cleanShadow)
        continue;
      const parts = [];
      let current = "";
      let depth = 0;
      for (const char of cleanShadow) {
        if (char === "(")
          depth++;
        else if (char === ")")
          depth--;
        if (char === " " && depth === 0) {
          if (current)
            parts.push(current);
          current = "";
        } else {
          current += char;
        }
      }
      if (current)
        parts.push(current);
      let colorStr = "rgb(0,0,0)";
      let lengths = [];
      let inset = false;
      for (const part of parts) {
        if (part === "inset") {
          inset = true;
        } else if (part.startsWith("rgb") || part.startsWith("#") || part.match(/^[a-z]+$/i)) {
          colorStr = part;
        } else if (part.match(/px|em|rem|%/)) {
          lengths.push(part);
        } else if (part === "0") {
          lengths.push("0px");
        }
      }
      if (lengths.length >= 2) {
        const color = parseColor(colorStr);
        const x = parseFloat(lengths[0]);
        const y = parseFloat(lengths[1]);
        const blur = lengths.length > 2 ? parseFloat(lengths[2]) : 0;
        const spread = lengths.length > 3 ? parseFloat(lengths[3]) : 0;
        effects.push({
          type: inset ? "INNER_SHADOW" : "DROP_SHADOW",
          color,
          offset: { x, y },
          radius: blur,
          spread,
          visible: true,
          blendMode: "NORMAL"
        });
      }
    }
    return effects;
  }
  function cleanText(text, whiteSpaceStyle) {
    if (!text)
      return null;
    let clean = text.replace(/[\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, " ");
    if (whiteSpaceStyle && ["pre", "pre-wrap", "pre-line"].includes(whiteSpaceStyle)) {
      if (clean.trim().length === 0)
        return null;
      return clean;
    }
    clean = clean.replace(/\s+/g, " ").trim();
    if (clean.length === 0)
      return null;
    return clean;
  }
  function parseGap(gap) {
    if (!gap || gap === "normal")
      return { row: 0, col: 0 };
    const parts = gap.trim().split(/\s+/);
    const row = parseFloat(parts[0]) || 0;
    const col = parts.length > 1 ? parseFloat(parts[1]) : row;
    return { row, col };
  }
  function parseGradient(bgString) {
    try {
      const isLinear = bgString.includes("linear-gradient");
      const isRadial = bgString.includes("radial-gradient");
      if (!isLinear && !isRadial)
        return null;
      const match = bgString.match(/gradient\((.*)\)/);
      if (!match)
        return null;
      const content = match[1];
      const parts = content.split(/,(?![^(]*\))/).map((s) => s.trim());
      let angleDeg = 180;
      if (isLinear && parts.length > 0) {
        const first = parts[0];
        if (first.includes("deg")) {
          angleDeg = parseFloat(first) || 180;
          parts.shift();
        } else if (first.includes("to ")) {
          if (first.includes("right") && first.includes("bottom"))
            angleDeg = 135;
          else if (first.includes("left") && first.includes("bottom"))
            angleDeg = 225;
          else if (first.includes("right") && first.includes("top"))
            angleDeg = 45;
          else if (first.includes("left") && first.includes("top"))
            angleDeg = 315;
          else if (first.includes("top"))
            angleDeg = 0;
          else if (first.includes("right"))
            angleDeg = 90;
          else if (first.includes("bottom"))
            angleDeg = 180;
          else if (first.includes("left"))
            angleDeg = 270;
          parts.shift();
        }
      }
      const stops = [];
      parts.forEach((part, i) => {
        let position = parts.length > 1 ? i / (parts.length - 1) : 0;
        const posMatch = part.match(/([\d.]+)%/);
        if (posMatch) {
          position = parseFloat(posMatch[1]) / 100;
        }
        const colorPart = part.replace(/([\d.]+)%/, "").trim();
        const rgba = parseColor(colorPart);
        stops.push({
          position: Math.max(0, Math.min(1, position)),
          color: {
            r: rgba.r,
            g: rgba.g,
            b: rgba.b,
            a: colorPart === "transparent" ? 0 : rgba.a
          }
        });
      });
      const rad = (angleDeg - 90) * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const transform = [
        [cos, sin, 0.5 - cos * 0.5 - sin * 0.5],
        [-sin, cos, 0.5 + sin * 0.5 - cos * 0.5]
      ];
      return {
        type: isRadial ? "GRADIENT_RADIAL" : "GRADIENT_LINEAR",
        gradientStops: stops,
        gradientTransform: transform
      };
    } catch (e) {
      console.warn("Gradient parse error:", e);
      return null;
    }
  }
  function parseTransform(transformStr) {
    const result = { rotation: 0, scaleX: 1, scaleY: 1 };
    if (!transformStr || transformStr === "none")
      return result;
    const rotateMatch = transformStr.match(/rotate\(([-\d.]+)deg\)/);
    if (rotateMatch) {
      result.rotation = parseFloat(rotateMatch[1]) || 0;
    }
    const matrixMatch = transformStr.match(/matrix\(([^)]+)\)/);
    if (matrixMatch) {
      const values = matrixMatch[1].split(",").map((v) => parseFloat(v.trim()));
      if (values.length >= 4) {
        result.rotation = Math.atan2(values[1], values[0]) * 180 / Math.PI;
        result.scaleX = Math.sqrt(values[0] * values[0] + values[1] * values[1]);
        result.scaleY = Math.sqrt(values[2] * values[2] + values[3] * values[3]);
      }
    }
    const scaleMatch = transformStr.match(/scale\(([-\d.]+)(?:,\s*([-\d.]+))?\)/);
    if (scaleMatch) {
      result.scaleX = parseFloat(scaleMatch[1]) || 1;
      result.scaleY = scaleMatch[2] ? parseFloat(scaleMatch[2]) : result.scaleX;
    }
    return result;
  }
  function parseLineHeight(lineHeight, fontSize) {
    if (!lineHeight || lineHeight === "normal") {
      return void 0;
    }
    if (lineHeight.endsWith("%")) {
      return { value: parseFloat(lineHeight), unit: "PERCENT" };
    }
    if (lineHeight.endsWith("px")) {
      return { value: parseFloat(lineHeight), unit: "PIXELS" };
    }
    const multiplier = parseFloat(lineHeight);
    if (!isNaN(multiplier)) {
      return { value: multiplier * 100, unit: "PERCENT" };
    }
    return void 0;
  }
  function parseLetterSpacing(letterSpacing, fontSize) {
    if (!letterSpacing || letterSpacing === "normal") {
      return void 0;
    }
    if (letterSpacing.endsWith("%")) {
      return { value: parseFloat(letterSpacing), unit: "PERCENT" };
    }
    if (letterSpacing.endsWith("em")) {
      return { value: parseFloat(letterSpacing) * 100, unit: "PERCENT" };
    }
    return { value: parseFloat(letterSpacing) || 0, unit: "PIXELS" };
  }
  function parseTextCase(textTransform) {
    switch (textTransform) {
      case "uppercase":
        return "UPPER";
      case "lowercase":
        return "LOWER";
      case "capitalize":
        return "TITLE";
      default:
        return "ORIGINAL";
    }
  }
  function parseTextDecoration(textDecoration) {
    if (textDecoration.includes("underline"))
      return "UNDERLINE";
    if (textDecoration.includes("line-through"))
      return "LINE_THROUGH";
    return "NONE";
  }
  function parseBackdropFilter(backdropFilter) {
    if (!backdropFilter || backdropFilter === "none")
      return null;
    const blurMatch = backdropFilter.match(/blur\(([\d.]+)px\)/);
    if (blurMatch) {
      return {
        type: "BACKGROUND_BLUR",
        radius: parseFloat(blurMatch[1]) || 0,
        visible: true
      };
    }
    return null;
  }
  function shouldClipContent(style) {
    return style.overflow === "hidden" || style.overflowX === "hidden" || style.overflowY === "hidden";
  }

  // src/capture/component-detector.ts
  var ComponentDetector = class {
    /**
     * Analyze the layer tree and identify components
     * @param root The root layer node
     * @returns Map of component hash to instances
     */
    detectComponents(root) {
      const componentMap = /* @__PURE__ */ new Map();
      const hashCounts = /* @__PURE__ */ new Map();
      this.countStructures(root, hashCounts);
      this.collectComponents(root, hashCounts, componentMap);
      for (const [hash, nodes] of componentMap) {
        if (nodes.length < 2) {
          componentMap.delete(hash);
        }
      }
      return componentMap;
    }
    /**
     * Mark detected components in the tree
     * Adds component metadata to repeated elements
     */
    markComponents(root) {
      const components = this.detectComponents(root);
      let componentIndex = 1;
      for (const [hash, instances] of components) {
        const componentName = this.generateComponentName(instances[0]);
        for (let i = 0; i < instances.length; i++) {
          const node = instances[i];
          node.name = `${componentName} (${i + 1}/${instances.length})`;
        }
        componentIndex++;
      }
    }
    /**
     * Generate a structural hash for a node
     * Similar structures will have the same hash
     */
    getStructuralHash(node) {
      const parts = [];
      parts.push(node.type);
      if (node.children && node.children.length > 0) {
        parts.push(`children:${node.children.length}`);
        const childTypes = node.children.map((c) => c.type).join(",");
        parts.push(`childTypes:${childTypes}`);
      }
      const sizeCategory = this.getSizeCategory(node.width, node.height);
      parts.push(`size:${sizeCategory}`);
      if (node.layoutMode) {
        parts.push(`layout:${node.layoutMode}`);
      }
      if (node.semanticType) {
        parts.push(`semantic:${node.semanticType}`);
      }
      return parts.join("|");
    }
    /**
     * Get a size category (small, medium, large)
     * This allows grouping similarly-sized elements
     */
    getSizeCategory(width, height) {
      const area = width * height;
      if (area < 2500)
        return "xs";
      if (area < 1e4)
        return "sm";
      if (area < 4e4)
        return "md";
      if (area < 16e4)
        return "lg";
      return "xl";
    }
    /**
     * Count occurrences of each structure
     */
    countStructures(node, counts) {
      const hash = this.getStructuralHash(node);
      counts.set(hash, (counts.get(hash) || 0) + 1);
      if (node.children) {
        for (const child of node.children) {
          this.countStructures(child, counts);
        }
      }
    }
    /**
     * Collect nodes that match repeated patterns
     */
    collectComponents(node, counts, componentMap) {
      const hash = this.getStructuralHash(node);
      const count = counts.get(hash) || 0;
      if (count >= 2 && node.children && node.children.length > 0) {
        if (!componentMap.has(hash)) {
          componentMap.set(hash, []);
        }
        componentMap.get(hash).push(node);
      }
      if (node.children) {
        for (const child of node.children) {
          this.collectComponents(child, counts, componentMap);
        }
      }
    }
    /**
     * Generate a readable component name from the first instance
     */
    generateComponentName(node) {
      if (node.semanticType) {
        return `${node.semanticType} Component`;
      }
      if (node.name && !node.name.startsWith("div") && !node.name.startsWith("span")) {
        return node.name;
      }
      if (node.children && node.children.length > 0) {
        const childTypes = node.children.map((c) => c.type);
        if (childTypes.includes("IMAGE") && childTypes.includes("TEXT")) {
          return "Card";
        }
        if (childTypes.every((t) => t === "TEXT")) {
          return "Text Group";
        }
        if (node.children.length === 1 && childTypes[0] === "IMAGE") {
          return "Image Container";
        }
      }
      if (node.layoutMode === "HORIZONTAL") {
        return "Row";
      }
      if (node.layoutMode === "VERTICAL") {
        return "Stack";
      }
      return "Component";
    }
  };
  function detectAndMarkComponents(root) {
    const detector = new ComponentDetector();
    detector.markComponents(root);
  }

  // src/capture/design-tokens.ts
  var DesignTokenExtractor = class {
    constructor() {
      this.colorMap = /* @__PURE__ */ new Map();
      this.typographyMap = /* @__PURE__ */ new Map();
      this.spacingMap = /* @__PURE__ */ new Map();
    }
    /**
     * Extract all design tokens from the layer tree
     */
    extract(root) {
      this.reset();
      this.traverse(root);
      return {
        colors: this.getColorTokens(),
        typography: this.getTypographyTokens(),
        spacing: this.getSpacingTokens(),
        summary: {
          totalColors: this.colorMap.size,
          totalFonts: this.typographyMap.size,
          spacingScale: this.detectSpacingScale()
        }
      };
    }
    reset() {
      this.colorMap.clear();
      this.typographyMap.clear();
      this.spacingMap.clear();
    }
    traverse(node) {
      if (node.fills) {
        for (const fill of node.fills) {
          if (fill.type === "SOLID" && fill.color) {
            this.addColor(fill.color, "fill");
          }
        }
      }
      if (node.strokes) {
        for (const stroke of node.strokes) {
          if (stroke.type === "SOLID" && stroke.color) {
            this.addColor(stroke.color, "stroke");
          }
        }
      }
      if (node.type === "TEXT" && node.fontFamily && node.fontSize) {
        this.addTypography(node);
      }
      if (node.padding) {
        this.addSpacing(node.padding.top, "padding");
        this.addSpacing(node.padding.right, "padding");
        this.addSpacing(node.padding.bottom, "padding");
        this.addSpacing(node.padding.left, "padding");
      }
      if (node.itemSpacing && node.itemSpacing > 0) {
        this.addSpacing(node.itemSpacing, "gap");
      }
      if (node.children) {
        for (const child of node.children) {
          this.traverse(child);
        }
      }
    }
    addColor(rgb, usage) {
      const hex = this.rgbToHex(rgb);
      if (this.colorMap.has(hex)) {
        this.colorMap.get(hex).count++;
      } else {
        this.colorMap.set(hex, {
          name: this.generateColorName(rgb),
          hex,
          rgb,
          usage,
          count: 1
        });
      }
    }
    addTypography(node) {
      const key = `${node.fontFamily}|${node.fontSize}|${node.fontWeight}`;
      if (this.typographyMap.has(key)) {
        this.typographyMap.get(key).count++;
      } else {
        this.typographyMap.set(key, {
          name: this.generateTypographyName(node.fontSize),
          fontFamily: node.fontFamily,
          fontSize: node.fontSize,
          fontWeight: node.fontWeight || 400,
          lineHeight: node.lineHeight,
          count: 1
        });
      }
    }
    addSpacing(value, usage) {
      if (value <= 0)
        return;
      const rounded = Math.round(value);
      if (this.spacingMap.has(rounded)) {
        this.spacingMap.get(rounded).count++;
      } else {
        this.spacingMap.set(rounded, {
          value: rounded,
          count: 1,
          usage
        });
      }
    }
    rgbToHex(rgb) {
      const r = Math.round(rgb.r * 255);
      const g = Math.round(rgb.g * 255);
      const b = Math.round(rgb.b * 255);
      return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`.toUpperCase();
    }
    generateColorName(rgb) {
      const r = Math.round(rgb.r * 255);
      const g = Math.round(rgb.g * 255);
      const b = Math.round(rgb.b * 255);
      if (r === 255 && g === 255 && b === 255)
        return "White";
      if (r === 0 && g === 0 && b === 0)
        return "Black";
      if (r > 200 && g < 100 && b < 100)
        return "Red";
      if (r < 100 && g > 200 && b < 100)
        return "Green";
      if (r < 100 && g < 100 && b > 200)
        return "Blue";
      if (r > 200 && g > 200 && b < 100)
        return "Yellow";
      if (r === g && g === b)
        return `Gray-${Math.round(r / 25.5) * 10}`;
      return `Color-${this.rgbToHex(rgb).slice(1, 5)}`;
    }
    generateTypographyName(fontSize) {
      if (fontSize >= 48)
        return "Display";
      if (fontSize >= 36)
        return "Heading 1";
      if (fontSize >= 28)
        return "Heading 2";
      if (fontSize >= 22)
        return "Heading 3";
      if (fontSize >= 18)
        return "Heading 4";
      if (fontSize >= 16)
        return "Body Large";
      if (fontSize >= 14)
        return "Body";
      if (fontSize >= 12)
        return "Caption";
      return "Small";
    }
    detectSpacingScale() {
      const values = Array.from(this.spacingMap.values()).filter((s) => s.count >= 2).map((s) => s.value).sort((a, b) => a - b);
      const base4 = [4, 8, 12, 16, 20, 24, 32, 40, 48, 64];
      const base8 = [8, 16, 24, 32, 40, 48, 64, 80, 96];
      const matchesBase4 = values.filter((v) => base4.some((b) => Math.abs(v - b) <= 2)).length;
      const matchesBase8 = values.filter((v) => base8.some((b) => Math.abs(v - b) <= 2)).length;
      if (matchesBase8 > matchesBase4) {
        return base8.filter((v) => values.some((val) => Math.abs(val - v) <= 4));
      }
      if (matchesBase4 > 0) {
        return base4.filter((v) => values.some((val) => Math.abs(val - v) <= 4));
      }
      return values.slice(0, 10);
    }
    getColorTokens() {
      return Array.from(this.colorMap.values()).sort((a, b) => b.count - a.count);
    }
    getTypographyTokens() {
      return Array.from(this.typographyMap.values()).sort((a, b) => b.count - a.count);
    }
    getSpacingTokens() {
      return Array.from(this.spacingMap.values()).filter((s) => s.count >= 2).sort((a, b) => a.value - b.value);
    }
  };
  function extractDesignTokens(root) {
    const extractor = new DesignTokenExtractor();
    return extractor.extract(root);
  }

  // src/capture/svg-sanitize.ts
  function sanitizeSvg(svgText) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgText, "image/svg+xml");
      const root = doc.documentElement;
      if (!root || root.nodeName.toLowerCase() !== "svg") {
        return "";
      }
      const walker = (node) => {
        if (node.tagName.toLowerCase() === "script") {
          node.remove();
          return;
        }
        const attrs = Array.from(node.attributes);
        for (const attr of attrs) {
          const name = attr.name.toLowerCase();
          const value = attr.value || "";
          if (name.startsWith("on")) {
            node.removeAttribute(attr.name);
            continue;
          }
          if (name === "href" || name === "xlink:href" || name === "src") {
            if (/^\s*javascript:/i.test(value) || /^\s*data:text\/html/i.test(value)) {
              node.removeAttribute(attr.name);
              continue;
            }
          }
        }
        const children = Array.from(node.children);
        for (const child of children) {
          walker(child);
        }
      };
      walker(root);
      const serializer = new XMLSerializer();
      return serializer.serializeToString(root);
    } catch (e) {
      return "";
    }
  }

  // src/capture/collector.ts
  var ContentCollector = class {
    constructor(root, options) {
      this.enableComponentDetection = true;
      this.enableDesignTokens = true;
      this.nodesVisited = 0;
      this.startedAt = 0;
      this.limitHit = false;
      this.limitFlags = {
        MAX_NODES: false,
        MAX_DEPTH: false,
        MAX_DURATION: false
      };
      this.warnings = [];
      this.root = root;
      this.enableComponentDetection = options?.detectComponents ?? true;
      this.enableDesignTokens = options?.extractTokens ?? true;
      this.maxNodes = !options?.maxNodes || options.maxNodes === 0 ? Number.MAX_SAFE_INTEGER : options.maxNodes;
      this.maxDepth = !options?.maxDepth || options.maxDepth === 0 ? Number.MAX_SAFE_INTEGER : options.maxDepth;
      this.maxDurationMs = !options?.maxDurationMs || options.maxDurationMs === 0 ? Number.MAX_SAFE_INTEGER : options.maxDurationMs;
      if (options?.maxNodes === void 0)
        this.maxNodes = 15e3;
      if (options?.maxDepth === void 0)
        this.maxDepth = 50;
      if (options?.maxDurationMs === void 0)
        this.maxDurationMs = 3e4;
    }
    /**
     * Collect the entire page with components and design tokens
     */
    async collectPage() {
      const root = await this.collect(this.root, 0);
      if (!root)
        return null;
      if (this.enableComponentDetection) {
        detectAndMarkComponents(root);
      }
      let designTokens;
      if (this.enableDesignTokens) {
        designTokens = extractDesignTokens(root);
      }
      return { root, designTokens };
    }
    getWarnings() {
      return [...this.warnings];
    }
    getStats() {
      return {
        nodesVisited: this.nodesVisited,
        limitHit: this.limitHit
      };
    }
    async collect(element, depth = 0) {
      try {
        if (!this.startedAt) {
          this.startedAt = Date.now();
        }
        if (this.shouldStopTraversal(depth)) {
          return null;
        }
        if (!this.reserveNode("element", element, depth)) {
          return null;
        }
        const style = window.getComputedStyle(element);
        if (isHidden(element, style)) {
          return null;
        }
        const isDisplayContents = style.display === "contents";
        const rect = element.getBoundingClientRect();
        const isDocumentRoot = element === document.documentElement || element === document.body;
        const scrollX = window.scrollX || window.pageXOffset || 0;
        const scrollY = window.scrollY || window.pageYOffset || 0;
        const width = isDocumentRoot ? Math.max(rect.width, document.documentElement.scrollWidth, document.documentElement.clientWidth) : rect.width;
        const height = isDocumentRoot ? Math.max(rect.height, document.documentElement.scrollHeight, document.documentElement.clientHeight) : rect.height;
        const opacity = parseFloat(style.opacity);
        const node = {
          type: "FRAME",
          name: element.tagName.toLowerCase(),
          x: isDocumentRoot ? 0 : rect.x + scrollX,
          // Document-relative X
          y: isDocumentRoot ? 0 : rect.y + scrollY,
          // Document-relative Y
          width,
          height,
          opacity: isNaN(opacity) ? 1 : opacity,
          blendMode: this.getBlendMode(style),
          fills: [],
          strokes: [],
          effects: [],
          children: [],
          isContentOnly: isDisplayContents,
          zIndex: style.zIndex !== "auto" ? parseInt(style.zIndex) : 0
        };
        this.assignSemanticType(node, element);
        const isVisible = style.visibility !== "hidden";
        if (!isDisplayContents && isVisible) {
          this.extractBackgrounds(node, style);
          this.extractBorders(node, style);
          this.extractShadows(node, style);
          this.extractFilters(node, style);
          this.extractRadius(node, style);
          this.extractTransform(node, style);
          this.extractClipping(node, style);
          this.extractLayout(node, style, element);
          const tagName = element.tagName.toUpperCase();
          if (tagName === "IMG") {
            await this.handleImage(node, element);
          } else if (tagName === "SVG" || element instanceof SVGSVGElement) {
            this.handleSvg(node, element);
          } else if (tagName === "VIDEO") {
            await this.handleVideo(node, element);
          } else if (tagName === "CANVAS") {
            await this.handleCanvas(node, element);
          } else if (tagName === "PICTURE") {
            await this.handlePicture(node, element);
          } else if (tagName === "IFRAME") {
            await this.handleIframe(node, element);
          } else if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
            await this.handleInput(node, element);
          }
        } else if (!isVisible && !isDisplayContents) {
          node.fills = [];
          node.strokes = [];
          node.effects = [];
        }
        if (node.type !== "IMAGE" && node.type !== "SVG") {
          await this.processChildren(node, element, depth + 1);
        }
        if (this.shouldPrune(node)) {
        }
        if (node.layoutPositioning !== "ABSOLUTE" && !isDocumentRoot) {
          const margins = {
            top: parseFloat(style.marginTop) || 0,
            right: parseFloat(style.marginRight) || 0,
            bottom: parseFloat(style.marginBottom) || 0,
            left: parseFloat(style.marginLeft) || 0
          };
          if (margins.top > 1 || margins.right > 1 || margins.bottom > 1 || margins.left > 1) {
            return this.createMarginWrapper(node, margins);
          }
        }
        return node;
      } catch (e) {
        console.warn("Error collecting node", element, e);
        return null;
      }
    }
    createMarginWrapper(node, margins) {
      const wrapper = {
        type: "FRAME",
        name: "Container",
        x: node.x - margins.left,
        y: node.y - margins.top,
        width: node.width + margins.left + margins.right,
        height: node.height + margins.top + margins.bottom,
        opacity: 1,
        blendMode: "NORMAL",
        fills: [],
        // Transparent
        strokes: [],
        effects: [],
        children: [node],
        layoutMode: "VERTICAL",
        // Default to vertical to hold the child
        layoutSizingHorizontal: node.layoutSizingHorizontal === "FIXED" ? "HUG" : node.layoutSizingHorizontal,
        // Hug the child
        layoutSizingVertical: node.layoutSizingVertical === "FIXED" ? "HUG" : node.layoutSizingVertical,
        padding: margins,
        itemSpacing: 0
      };
      if (node.layoutSizingHorizontal === "FILL")
        wrapper.layoutSizingHorizontal = "FILL";
      if (node.layoutSizingVertical === "FILL")
        wrapper.layoutSizingVertical = "FILL";
      return wrapper;
    }
    extractFilters(node, style) {
      if (style.filter && style.filter !== "none") {
        const filterEffects = parseFilterDropShadow(style.filter);
        if (filterEffects.length > 0) {
          if (!node.effects)
            node.effects = [];
          node.effects.push(...filterEffects);
        }
      }
    }
    extractTextShadows(node, style) {
      if (style.textShadow && style.textShadow !== "none") {
        const textShadows = parseFilterDropShadow(style.textShadow);
        if (textShadows.length > 0) {
          if (!node.effects)
            node.effects = [];
          node.effects.push(...textShadows);
        }
      }
    }
    assignSemanticType(node, element) {
      const tag = element.tagName;
      if (tag === "BUTTON" || tag === "A" && element.classList.contains("btn"))
        node.semanticType = "BUTTON";
      else if (tag === "INPUT")
        node.semanticType = "INPUT";
      else if (tag === "IMG")
        node.semanticType = "IMAGE";
      else if (tag === "SECTION" || tag === "HEADER" || tag === "FOOTER" || tag === "NAV" || tag === "MAIN" || tag === "ARTICLE" || tag === "ASIDE")
        node.semanticType = "SECTION";
      node.name = "Container";
    }
    extractLayout(node, style, element) {
      const display = style.display;
      const pos = style.position;
      const isAbsolute = pos === "absolute" || pos === "fixed";
      const isFlex = display === "flex" || display === "inline-flex";
      const isGrid = display === "grid" || display === "inline-grid";
      const isBlock = display === "block" || display === "list-item";
      node.layoutPositioning = isAbsolute ? "ABSOLUTE" : "AUTO";
      node.padding = {
        top: parseFloat(style.paddingTop) || 0,
        right: parseFloat(style.paddingRight) || 0,
        bottom: parseFloat(style.paddingBottom) || 0,
        left: parseFloat(style.paddingLeft) || 0
      };
      if (isFlex) {
        node.layoutMode = style.flexDirection.includes("column") ? "VERTICAL" : "HORIZONTAL";
        const gap = parseGap(style.gap);
        node.itemSpacing = node.layoutMode === "VERTICAL" ? gap.row : gap.col;
        const jc = style.justifyContent;
        if (jc.includes("center"))
          node.primaryAxisAlignItems = "CENTER";
        else if (jc.includes("end") || jc.includes("flex-end"))
          node.primaryAxisAlignItems = "MAX";
        else if (jc.includes("between"))
          node.primaryAxisAlignItems = "SPACE_BETWEEN";
        else
          node.primaryAxisAlignItems = "MIN";
        const ai = style.alignItems;
        if (ai.includes("center"))
          node.counterAxisAlignItems = "CENTER";
        else if (ai.includes("end") || ai.includes("flex-end"))
          node.counterAxisAlignItems = "MAX";
        else if (ai.includes("baseline"))
          node.counterAxisAlignItems = "BASELINE";
        else
          node.counterAxisAlignItems = "MIN";
        if (style.flexWrap === "wrap") {
          node.layoutWrap = "WRAP";
          node.counterAxisSpacing = node.layoutMode === "VERTICAL" ? gap.col : gap.row;
        }
      } else if (isGrid) {
        node.layoutMode = "HORIZONTAL";
        node.layoutWrap = "WRAP";
        const gap = parseGap(style.gap);
        node.itemSpacing = gap.col;
        node.counterAxisSpacing = gap.row;
        node.primaryAxisAlignItems = "MIN";
        node.counterAxisAlignItems = "MIN";
      } else if (isBlock && !isAbsolute) {
        node.layoutMode = "VERTICAL";
        node.itemSpacing = 0;
        node.primaryAxisAlignItems = "MIN";
        node.counterAxisAlignItems = "MIN";
      } else {
        node.layoutMode = "NONE";
      }
      const styleW = element.style.width;
      const styleH = element.style.height;
      const isContentSizedW = styleW === "fit-content" || styleW === "max-content" || styleW === "auto";
      const isContentSizedH = styleH === "fit-content" || styleH === "max-content" || styleH === "auto";
      let hSizing = "FIXED";
      let vSizing = "FIXED";
      if (isFlex || isGrid) {
        hSizing = display.includes("inline") ? "HUG" : "FILL";
        vSizing = "HUG";
      } else if (isBlock) {
        hSizing = "FILL";
        vSizing = "HUG";
      }
      if (styleW && styleW !== "auto" && !styleW.includes("%"))
        hSizing = "FIXED";
      if (styleH && styleH !== "auto" && !styleH.includes("%"))
        vSizing = "FIXED";
      if (styleW?.includes("%"))
        hSizing = "FILL";
      if (styleH?.includes("%"))
        vSizing = "FILL";
      if (node.layoutMode === "HORIZONTAL") {
        node.layoutSizingHorizontal = hSizing;
        node.layoutSizingVertical = vSizing;
      } else if (node.layoutMode === "VERTICAL") {
        node.layoutSizingHorizontal = hSizing;
        node.layoutSizingVertical = vSizing;
      } else {
        node.layoutSizingHorizontal = "FIXED";
        node.layoutSizingVertical = "FIXED";
      }
    }
    async extractBackgrounds(node, style) {
      const color = parseColor(style.backgroundColor);
      if (color.a > 0) {
        node.fills?.push({
          type: "SOLID",
          color: { r: color.r, g: color.g, b: color.b },
          opacity: color.a
        });
      }
      if (style.backgroundImage && style.backgroundImage !== "none") {
        if (style.backgroundImage.includes("gradient")) {
          const gradient = parseGradient(style.backgroundImage);
          if (gradient) {
            node.fills?.push(gradient);
            node.isContentOnly = false;
          }
        }
        const regex = /url\(['"]?(.*?)['"]?\)/g;
        let match;
        const urls = [];
        while ((match = regex.exec(style.backgroundImage)) !== null) {
          if (match[1]) {
            urls.push(match[1]);
          }
        }
        urls.reverse();
        const imagePromises = urls.map(async (urlStr) => {
          const url = this.normalizeUrl(urlStr);
          try {
            const base64 = await imageToBase64(url);
            if (base64) {
              return {
                type: "IMAGE",
                scaleMode: "FILL",
                imageHash: "",
                _base64: base64
              };
            }
          } catch (e) {
            console.warn("Failed to extract background image", url, e);
          }
          return null;
        });
        const imageFills = (await Promise.all(imagePromises)).filter((fill) => fill !== null);
        if (imageFills.length > 0) {
          node.fills?.push(...imageFills);
          node.isContentOnly = false;
        }
      }
      if (style.webkitMaskImage && style.webkitMaskImage !== "none") {
        const urlMatch = style.webkitMaskImage.match(/url\(['"]?(.*?)['"]?\)/);
        if (urlMatch && urlMatch[1]) {
          const url = this.normalizeUrl(urlMatch[1]);
          try {
            const base64 = await imageToBase64(url);
            if (base64) {
              node.fills?.push({
                type: "IMAGE",
                scaleMode: "FILL",
                imageHash: "",
                _base64: base64
              });
              node.isContentOnly = false;
            }
          } catch (e) {
            console.warn("Failed to extract mask image", url, e);
          }
        }
      }
      if (style.listStyleImage && style.listStyleImage !== "none") {
        const urlMatch = style.listStyleImage.match(/url\(['"]?(.*?)['"]?\)/);
        if (urlMatch && urlMatch[1]) {
          const url = this.normalizeUrl(urlMatch[1]);
          try {
            const base64 = await imageToBase64(url);
            if (base64) {
              node.fills?.push({
                type: "IMAGE",
                scaleMode: "FILL",
                imageHash: "",
                _base64: base64
              });
              node.isContentOnly = false;
            }
          } catch (e) {
            console.warn("Failed to extract list style image", url, e);
          }
        }
      }
    }
    extractBorders(node, style) {
      if (style.borderStyle !== "none" && parseFloat(style.borderWidth) > 0) {
        const color = parseColor(style.borderColor);
        node.strokes?.push({
          type: "SOLID",
          color: { r: color.r, g: color.g, b: color.b },
          opacity: color.a
        });
        node.strokeWeight = parseFloat(style.borderWidth);
      }
    }
    extractShadows(node, style) {
      if (style.boxShadow && style.boxShadow !== "none") {
        node.effects = parseBoxShadow(style.boxShadow);
      }
    }
    extractRadius(node, style) {
      const tl = parseFloat(style.borderTopLeftRadius);
      const tr = parseFloat(style.borderTopRightRadius);
      const bl = parseFloat(style.borderBottomLeftRadius);
      const br = parseFloat(style.borderBottomRightRadius);
      if (tl === tr && tr === bl && bl === br) {
        node.cornerRadius = tl;
      } else {
        node.cornerRadius = { topLeft: tl, topRight: tr, bottomLeft: bl, bottomRight: br };
      }
    }
    extractTransform(node, style) {
      const transform = parseTransform(style.transform);
      if (transform.rotation !== 0) {
        node.rotation = transform.rotation;
      }
    }
    extractClipping(node, style) {
      node.clipsContent = shouldClipContent(style);
      const backdropBlur = parseBackdropFilter(style.backdropFilter);
      if (backdropBlur) {
        if (!node.effects)
          node.effects = [];
        node.effects.push(backdropBlur);
      }
    }
    getBlendMode(style) {
      const map = {
        "normal": "NORMAL",
        "multiply": "MULTIPLY",
        "screen": "SCREEN",
        "overlay": "OVERLAY",
        "darken": "DARKEN",
        "lighten": "LIGHTEN",
        "color-dodge": "COLOR_DODGE",
        "color-burn": "COLOR_BURN",
        "hard-light": "HARD_LIGHT",
        "soft-light": "SOFT_LIGHT",
        "difference": "DIFFERENCE",
        "exclusion": "EXCLUSION",
        "hue": "HUE",
        "saturation": "SATURATION",
        "color": "COLOR",
        "luminosity": "LUMINOSITY"
      };
      return map[style.mixBlendMode] || "NORMAL";
    }
    async handleImage(node, img) {
      node.type = "IMAGE";
      let url = img.currentSrc || img.src;
      const dataset = img.dataset;
      if (dataset.src)
        url = dataset.src;
      else if (dataset.lazySrc)
        url = dataset.lazySrc;
      else if (dataset.original)
        url = dataset.original;
      else if (dataset.sysimg)
        url = dataset.sysimg;
      if (img.srcset) {
        try {
          const sources = img.srcset.split(",").map((s) => {
            const parts = s.trim().split(" ");
            return {
              url: parts[0],
              w: parts[1] ? parseInt(parts[1]) : 0
            };
          });
          sources.sort((a, b) => b.w - a.w);
          if (sources.length > 0 && sources[0].url) {
            url = sources[0].url;
          }
        } catch (e) {
          console.warn("Failed to parse srcset", e);
        }
      }
      if (url && url.startsWith("data:")) {
        if (url.includes("svg")) {
          try {
            const svgData = decodeURIComponent(url.split(",")[1] || "");
            if (svgData.includes("<svg")) {
              const sanitized = sanitizeSvg(svgData);
              if (sanitized) {
                node.type = "SVG";
                node.svgContent = sanitized;
                return;
              } else {
                this.addWarning("Dropped unsafe inline SVG image");
              }
            }
          } catch (e) {
            console.warn("Failed to decode inline SVG", e);
          }
        }
        node.imageBase64 = url;
        node.fills?.push({
          type: "IMAGE",
          scaleMode: "FILL",
          imageHash: "",
          _base64: url
        });
        return;
      }
      url = this.normalizeUrl(url);
      if (url.toLowerCase().endsWith(".svg") || url.includes(".svg?")) {
        try {
          const response = await fetch(url);
          if (response.ok) {
            const svgText = await response.text();
            if (svgText.includes("<svg")) {
              const sanitized = sanitizeSvg(svgText);
              if (sanitized) {
                node.type = "SVG";
                node.svgContent = sanitized;
                return;
              } else {
                this.addWarning(`Dropped unsafe SVG from ${url}`);
              }
            }
          }
        } catch (e) {
          console.warn("Failed to fetch SVG source for image, falling back to raster", url, e);
        }
      }
      const base64 = await imageToBase64(url);
      if (base64) {
        node.imageBase64 = base64;
        node.fills?.push({
          type: "IMAGE",
          scaleMode: "FILL",
          imageHash: "",
          _base64: base64
        });
      }
    }
    async handleSvg(node, svg) {
      node.type = "SVG";
      this.inlineSvgStyles(svg);
      try {
        const useTags = Array.from(svg.querySelectorAll("use"));
        for (const use of useTags) {
          const href = use.getAttribute("href") || use.getAttribute("xlink:href");
          if (href && href.startsWith("#")) {
            const targetId = href.substring(1);
            const target = document.getElementById(targetId);
            if (target) {
              const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
              Array.from(use.attributes).forEach((attr) => {
                if (attr.name !== "href" && attr.name !== "xlink:href") {
                  group.setAttribute(attr.name, attr.value);
                }
              });
              group.innerHTML = target.innerHTML;
              use.parentNode?.replaceChild(group, use);
            }
          }
        }
      } catch (e) {
        console.warn("Failed to inline SVG use tags", e);
      }
      let svgHtml = svg.outerHTML;
      if (svgHtml.includes("currentColor")) {
        const style = window.getComputedStyle(svg);
        const color = style.color || "black";
        svgHtml = svgHtml.replace(/currentColor/g, color);
      }
      const sanitized = sanitizeSvg(svgHtml);
      if (sanitized) {
        node.svgContent = sanitized;
      } else {
        await this.rasterizeSvg(node, svg);
      }
    }
    inlineSvgStyles(svg) {
      const walker = (el) => {
        if (el instanceof SVGElement) {
          const style = window.getComputedStyle(el);
          const fill = style.fill;
          if (fill && fill !== "none" && !el.hasAttribute("fill")) {
            el.setAttribute("fill", fill);
          }
          const stroke = style.stroke;
          if (stroke && stroke !== "none" && !el.hasAttribute("stroke")) {
            el.setAttribute("stroke", stroke);
          }
          const strokeWidth = style.strokeWidth;
          if (strokeWidth && strokeWidth !== "0px" && !el.hasAttribute("stroke-width")) {
            el.setAttribute("stroke-width", strokeWidth);
          }
          const opacity = style.opacity;
          if (opacity && opacity !== "1" && !el.hasAttribute("opacity")) {
            el.setAttribute("opacity", opacity);
          }
          if (style.visibility === "hidden") {
            el.setAttribute("visibility", "hidden");
          }
          if (style.display === "none") {
            el.setAttribute("display", "none");
          }
        }
        for (const child of Array.from(el.children)) {
          walker(child);
        }
      };
      try {
        walker(svg);
      } catch (e) {
        console.warn("Failed to inline SVG styles", e);
      }
    }
    async rasterizeSvg(node, svg) {
      try {
        const rect = svg.getBoundingClientRect();
        const width = rect.width || 24;
        const height = rect.height || 24;
        const xml = new XMLSerializer().serializeToString(svg);
        const svg64 = btoa(unescape(encodeURIComponent(xml)));
        const b64Start = `data:image/svg+xml;base64,${svg64}`;
        const base64 = await this.loadImageToCanvas(b64Start, width, height);
        if (base64) {
          node.type = "IMAGE";
          node.imageBase64 = base64;
          node.fills = [{
            type: "IMAGE",
            scaleMode: "FILL",
            imageHash: "",
            _base64: base64
          }];
          node.name = (node.name || "SVG") + " (Raster)";
        } else {
          node.type = "FRAME";
          node.name = "SVG (Failed)";
        }
      } catch (e) {
        console.warn("Rasterize SVG failed", e);
      }
    }
    loadImageToCanvas(url, width, height) {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const scale = 2;
          canvas.width = width * scale;
          canvas.height = height * scale;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.scale(scale, scale);
            ctx.drawImage(img, 0, 0, width, height);
            try {
              resolve(canvas.toDataURL("image/png"));
            } catch {
              resolve(null);
            }
          } else {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = url;
      });
    }
    async handleVideo(node, video) {
      let posterUrl = video.poster;
      let base64 = null;
      if (posterUrl) {
        posterUrl = this.normalizeUrl(posterUrl);
        base64 = await imageToBase64(posterUrl);
      }
      if (!base64) {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth || video.clientWidth;
          canvas.height = video.videoHeight || video.clientHeight;
          const ctx = canvas.getContext("2d");
          if (ctx && video.readyState >= 2) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            base64 = canvas.toDataURL("image/png");
          }
        } catch (e) {
          console.warn("Failed to capture video frame", e);
        }
      }
      if (base64) {
        node.type = "IMAGE";
        node.imageBase64 = base64;
        if (!node.fills)
          node.fills = [];
        node.fills.push({
          type: "IMAGE",
          scaleMode: "FILL",
          imageHash: "",
          _base64: base64
        });
      } else {
        node.type = "FRAME";
        node.name = "Video Player";
        if (!node.fills || node.fills.length === 0) {
          if (!node.fills)
            node.fills = [];
          node.fills.push({
            type: "SOLID",
            color: { r: 0.2, g: 0.2, b: 0.2 },
            opacity: 1
          });
        }
      }
    }
    async handleCanvas(node, canvas) {
      try {
        node.type = "IMAGE";
        const dataUrl = canvas.toDataURL("image/png");
        if (dataUrl) {
          node.imageBase64 = dataUrl;
          if (!node.fills)
            node.fills = [];
          node.fills.push({
            type: "IMAGE",
            scaleMode: "FILL",
            imageHash: "",
            _base64: dataUrl
          });
        }
      } catch (e) {
        console.warn("Failed to capture canvas content", e);
        node.type = "FRAME";
        node.name = "Canvas (Tainted)";
      }
    }
    async handleIframe(node, iframe) {
      node.type = "FRAME";
      node.name = "Iframe";
      try {
        const doc = iframe.contentDocument;
        if (doc && doc.body) {
          await this.processChildren(node, doc.body, 0);
          if (node.children && node.children.length > 0) {
            return;
          }
        }
      } catch (e) {
        this.addWarning(`Cannot capture cross-origin iframe: ${iframe.src}`);
      }
      node.fills = [{
        type: "SOLID",
        color: { r: 0.9, g: 0.9, b: 0.9 },
        opacity: 1
      }];
      const label = {
        type: "TEXT",
        name: "Label",
        x: node.x + 10,
        y: node.y + 10,
        width: node.width - 20,
        height: 20,
        text: `IFRAME: ${iframe.src || "Embedded Content"}`,
        fontFamily: "Inter",
        fontSize: 12,
        fontWeight: "normal",
        textAlign: "LEFT",
        fills: [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 1 }]
      };
      if (!node.children)
        node.children = [];
      node.children.push(label);
    }
    async handleInput(node, element) {
      let text = "";
      let isPlaceholder = false;
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        text = element.value;
        if (!text && element.placeholder) {
          text = element.placeholder;
          isPlaceholder = true;
        }
      } else if (element instanceof HTMLSelectElement) {
        text = element.options[element.selectedIndex]?.text || "";
      }
      if (!text)
        return;
      const style = window.getComputedStyle(element);
      const fontSize = parseFloat(style.fontSize);
      const paddingTop = parseFloat(style.paddingTop) || 0;
      const paddingLeft = parseFloat(style.paddingLeft) || 0;
      const paddingRight = parseFloat(style.paddingRight) || 0;
      const paddingBottom = parseFloat(style.paddingBottom) || 0;
      const contentX = node.x + paddingLeft;
      const contentY = node.y + paddingTop;
      const contentWidth = node.width - paddingLeft - paddingRight;
      const contentHeight = node.height - paddingTop - paddingBottom;
      const textNode = {
        type: "TEXT",
        name: isPlaceholder ? "Placeholder" : "Value",
        x: contentX,
        y: contentY,
        width: contentWidth,
        height: contentHeight,
        // Text node height usually matches content height for inputs
        text,
        fontFamily: style.fontFamily.split(",")[0].replace(/['"]/g, ""),
        fontWeight: style.fontWeight,
        fontSize,
        textAlign: "LEFT",
        // Inputs are usually left-aligned, but check style
        lineHeight: parseLineHeight(style.lineHeight, fontSize),
        letterSpacing: parseLetterSpacing(style.letterSpacing, fontSize),
        textCase: parseTextCase(style.textTransform),
        fills: await this.resolveTextFills(style)
      };
      if (isPlaceholder) {
        if (textNode.fills && textNode.fills[0] && textNode.fills[0].color) {
          textNode.fills[0].opacity = (textNode.fills[0].opacity || 1) * 0.6;
        }
      }
      const textAlign = style.textAlign.toUpperCase();
      if (textAlign === "CENTER" || textAlign === "RIGHT" || textAlign === "JUSTIFY") {
        textNode.textAlign = textAlign === "JUSTIFY" ? "JUSTIFIED" : textAlign;
      }
      if (!node.children)
        node.children = [];
      node.children.push(textNode);
    }
    async handlePicture(node, picture) {
      const img = picture.querySelector("img");
      if (img) {
        await this.handleImage(node, img);
      } else {
        node.type = "FRAME";
        node.name = "Picture";
      }
    }
    async processChildren(node, element, depth) {
      const style = window.getComputedStyle(element);
      let childNodes;
      let rootElement = element;
      if (element.shadowRoot) {
        childNodes = Array.from(element.shadowRoot.childNodes);
        rootElement = element.shadowRoot;
      } else {
        childNodes = Array.from(element.childNodes);
      }
      const collectedChildren = [];
      if (this.shouldStopTraversal(depth))
        return;
      const beforeNode = await this.collectPseudoElement(node, element, "::before", depth + 1);
      if (beforeNode)
        collectedChildren.push(beforeNode);
      for (const child of childNodes) {
        if (this.shouldStopTraversal(depth))
          break;
        if (child.nodeType === Node.TEXT_NODE) {
          const textNode = await this.createTextLeaf(child, element, depth + 1);
          if (textNode)
            collectedChildren.push(textNode);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const childElement = child;
          if (childElement instanceof SVGSVGElement) {
            const svgNode = await this.collect(childElement, depth + 1);
            if (svgNode)
              collectedChildren.push(svgNode);
          } else if (childElement instanceof HTMLElement) {
            const childLayer = await this.collect(childElement, depth + 1);
            if (childLayer) {
              collectedChildren.push(childLayer);
            }
          }
        }
      }
      if (this.shouldStopTraversal(depth))
        return;
      const afterNode = await this.collectPseudoElement(node, element, "::after", depth + 1);
      if (afterNode)
        collectedChildren.push(afterNode);
      this.sortChildrenByZIndex(collectedChildren);
      if (style.flexDirection === "row-reverse" || style.flexDirection === "column-reverse") {
        collectedChildren.reverse();
      }
      if (!node.children)
        node.children = [];
      node.children.push(...collectedChildren);
    }
    sortChildrenByZIndex(children) {
      const indexed = children.map((child, index) => ({ child, index }));
      indexed.sort((a, b) => {
        const az = a.child.zIndex || 0;
        const bz = b.child.zIndex || 0;
        if (az !== bz)
          return az - bz;
        return a.index - b.index;
      });
      children.splice(0, children.length, ...indexed.map((i) => i.child));
    }
    async collectPseudoElement(parentNode, element, pseudoType, depth) {
      if (this.shouldStopTraversal(depth))
        return null;
      if (!this.reserveNode("pseudo", element, depth))
        return null;
      const style = window.getComputedStyle(element, pseudoType);
      const content = style.content;
      if (!content || content === "none" || content === "normal")
        return null;
      const width = parseFloat(style.width);
      const height = parseFloat(style.height);
      const hasSize = width > 0 && height > 0;
      const hasContentString = content.replace(/['"]/g, "").length > 0;
      const urlMatch = content.match(/url\(['"]?(.*?)['"]?\)/);
      const hasBackground = style.backgroundImage !== "none" || style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent";
      const hasBorder = style.borderStyle !== "none" && parseFloat(style.borderWidth) > 0;
      if (!hasContentString && !urlMatch && !(hasSize && (hasBackground || hasBorder)))
        return null;
      const pseudoNode = {
        type: "FRAME",
        name: pseudoType,
        x: parentNode.x,
        // Inherit parent's document-relative X
        y: parentNode.y,
        // Inherit parent's document-relative Y
        width: width || 0,
        height: height || 0,
        opacity: parseFloat(style.opacity),
        blendMode: this.getBlendMode(style),
        fills: [],
        strokes: [],
        effects: [],
        children: [],
        isContentOnly: false,
        zIndex: style.zIndex !== "auto" ? parseInt(style.zIndex) : pseudoType === "::after" ? 1 : -1
      };
      if (style.position === "absolute" || style.position === "fixed") {
        pseudoNode.layoutPositioning = "ABSOLUTE";
        const top = parseFloat(style.top);
        const left = parseFloat(style.left);
        const right = parseFloat(style.right);
        const bottom = parseFloat(style.bottom);
        if (!isNaN(top)) {
          pseudoNode.y = parentNode.y + top;
        }
        if (!isNaN(left)) {
          pseudoNode.x = parentNode.x + left;
        }
        if (isNaN(left) && !isNaN(right)) {
          pseudoNode.x = parentNode.x + parentNode.width - pseudoNode.width - right;
        }
        if (isNaN(top) && !isNaN(bottom)) {
          pseudoNode.y = parentNode.y + parentNode.height - pseudoNode.height - bottom;
        }
      }
      await this.extractBackgrounds(pseudoNode, style);
      if (urlMatch && urlMatch[1]) {
        const url = this.normalizeUrl(urlMatch[1]);
        const base64 = await imageToBase64(url);
        if (base64) {
          pseudoNode.type = "IMAGE";
          pseudoNode.fills?.push({
            type: "IMAGE",
            scaleMode: "FILL",
            imageHash: "",
            _base64: base64
          });
          if (pseudoNode.width === 0)
            pseudoNode.width = 24;
          if (pseudoNode.height === 0)
            pseudoNode.height = 24;
        }
      }
      this.extractBorders(pseudoNode, style);
      this.extractShadows(pseudoNode, style);
      this.extractFilters(pseudoNode, style);
      this.extractRadius(pseudoNode, style);
      const cleanContent = content.replace(/['"]/g, "");
      if (cleanContent && cleanContent.length > 0 && !urlMatch) {
        const fontFamily = style.fontFamily.toLowerCase();
        const isIconFont = fontFamily.includes("icon") || fontFamily.includes("awesome") || fontFamily.includes("material") || fontFamily.includes("glyph");
        const isSingleChar = cleanContent.length === 1 && !/[a-zA-Z0-9]/.test(cleanContent);
        if (isIconFont || isSingleChar) {
          const fontSize = parseFloat(style.fontSize) || 16;
          const fontWeight = style.fontWeight || "normal";
          const font = `${fontWeight} ${fontSize}px ${style.fontFamily}`;
          const color = style.color || "#000000";
          const drawW = pseudoNode.width || fontSize * 1.5;
          const drawH = pseudoNode.height || fontSize * 1.5;
          const base64 = await this.textToImage(cleanContent, font, color, drawW, drawH);
          if (base64) {
            pseudoNode.type = "IMAGE";
            pseudoNode.name = `${pseudoType} (Icon)`;
            pseudoNode.imageBase64 = base64;
            if (!pseudoNode.fills)
              pseudoNode.fills = [];
            pseudoNode.fills.push({
              type: "IMAGE",
              scaleMode: "FILL",
              imageHash: "",
              _base64: base64
            });
            if (pseudoNode.width === 0)
              pseudoNode.width = drawW;
            if (pseudoNode.height === 0)
              pseudoNode.height = drawH;
          } else {
            pseudoNode.type = "TEXT";
            pseudoNode.text = cleanContent;
            pseudoNode.fontFamily = style.fontFamily.split(",")[0].replace(/['"]/g, "");
            pseudoNode.fontSize = fontSize;
            pseudoNode.fontWeight = style.fontWeight;
            pseudoNode.textAlign = "CENTER";
            pseudoNode.fills = await this.resolveTextFills(style);
          }
        } else {
          pseudoNode.type = "TEXT";
          pseudoNode.text = cleanContent;
          pseudoNode.fontFamily = style.fontFamily.split(",")[0].replace(/['"]/g, "");
          pseudoNode.fontSize = parseFloat(style.fontSize);
          pseudoNode.fontWeight = style.fontWeight;
          pseudoNode.textAlign = style.textAlign.toUpperCase();
          pseudoNode.fills = await this.resolveTextFills(style);
          this.extractTextShadows(pseudoNode, style);
        }
      }
      return pseudoNode;
    }
    textToImage(text, font, color, width, height) {
      return new Promise((resolve) => {
        try {
          const canvas = document.createElement("canvas");
          const scale = 2;
          canvas.width = width * scale;
          canvas.height = height * scale;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.scale(scale, scale);
          ctx.font = font;
          ctx.fillStyle = color;
          ctx.textBaseline = "middle";
          ctx.textAlign = "center";
          ctx.fillText(text, width / 2, height / 2);
          resolve(canvas.toDataURL("image/png"));
        } catch (e) {
          resolve(null);
        }
      });
    }
    normalizeUrl(url) {
      try {
        return new URL(url, document.baseURI).href;
      } catch (e) {
        return url;
      }
    }
    async resolveTextFills(style) {
      const fills = [];
      const bgClip = style.backgroundClip || style.webkitBackgroundClip;
      const isTextClip = bgClip === "text";
      const webkitFill = style.webkitTextFillColor;
      const hasWebkitFill = webkitFill && webkitFill !== "currentcolor";
      if (isTextClip) {
        if (style.backgroundImage && style.backgroundImage !== "none") {
          if (style.backgroundImage.includes("gradient")) {
            const gradient = parseGradient(style.backgroundImage);
            if (gradient) {
              fills.push(gradient);
            }
          }
          const regex = /url\(['"]?(.*?)['"]?\)/g;
          let match;
          const urls = [];
          while ((match = regex.exec(style.backgroundImage)) !== null) {
            if (match[1])
              urls.push(match[1]);
          }
          urls.reverse();
          for (const urlStr of urls) {
            const url = this.normalizeUrl(urlStr);
            try {
              const base64 = await imageToBase64(url);
              if (base64) {
                fills.push({
                  type: "IMAGE",
                  scaleMode: "FILL",
                  imageHash: "",
                  _base64: base64
                });
              }
            } catch (e) {
              console.warn("Failed to load text texture", url);
            }
          }
        }
        const bgColor = parseColor(style.backgroundColor);
        if (bgColor.a > 0 && fills.length === 0) {
          fills.push({
            type: "SOLID",
            color: { r: bgColor.r, g: bgColor.g, b: bgColor.b },
            opacity: bgColor.a
          });
        }
      }
      if (fills.length === 0) {
        let colorStr = style.color;
        if (hasWebkitFill) {
          colorStr = webkitFill;
        }
        const color = parseColor(colorStr);
        fills.push({
          type: "SOLID",
          color: { r: color.r, g: color.g, b: color.b },
          opacity: color.a
        });
      }
      return fills;
    }
    async createTextLeaf(textNode, parent, depth) {
      if (this.shouldStopTraversal(depth))
        return null;
      if (!this.reserveNode("text", parent, depth))
        return null;
      const style = window.getComputedStyle(parent);
      const range = document.createRange();
      range.selectNode(textNode);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0)
        return null;
      const text = cleanText(textNode.textContent || "", style.whiteSpace);
      if (!text)
        return null;
      const fontSize = parseFloat(style.fontSize);
      const scrollX = window.scrollX || window.pageXOffset || 0;
      const scrollY = window.scrollY || window.pageYOffset || 0;
      const node = {
        type: "TEXT",
        name: "Text",
        x: rect.x + scrollX,
        y: rect.y + scrollY,
        width: rect.width,
        height: rect.height,
        text,
        fontFamily: style.fontFamily.split(",")[0].replace(/['"]/g, ""),
        fontWeight: style.fontWeight,
        fontSize,
        textAlign: (() => {
          const align = style.textAlign.toLowerCase();
          if (align === "center")
            return "CENTER";
          if (align === "right" || align === "end")
            return "RIGHT";
          if (align === "justify")
            return "JUSTIFIED";
          return "LEFT";
        })(),
        // Enhanced text properties
        lineHeight: parseLineHeight(style.lineHeight, fontSize),
        letterSpacing: parseLetterSpacing(style.letterSpacing, fontSize),
        textDecoration: parseTextDecoration(style.textDecorationLine || style.textDecoration),
        textCase: parseTextCase(style.textTransform),
        fills: await this.resolveTextFills(style)
      };
      this.extractTextShadows(node, style);
      return node;
    }
    /**
     * Traversal guard: returns true when traversal should stop for this subtree
     */
    shouldStopTraversal(depth) {
      const timedOut = this.maxDurationMs > 0 && this.startedAt > 0 && Date.now() - this.startedAt > this.maxDurationMs;
      if (timedOut) {
        this.recordLimit("MAX_DURATION", `Capture timed out after ${this.maxDurationMs}ms`);
        return true;
      }
      if (depth > this.maxDepth) {
        this.recordLimit("MAX_DEPTH", `Max depth ${this.maxDepth} exceeded`);
        return true;
      }
      if (this.nodesVisited >= this.maxNodes) {
        this.recordLimit("MAX_NODES", `Max nodes ${this.maxNodes} reached`);
        return true;
      }
      return false;
    }
    /**
     * Reserve a node slot; returns false if limits exceeded.
     */
    reserveNode(kind, element, depth) {
      if (this.shouldStopTraversal(depth))
        return false;
      this.nodesVisited += 1;
      if (this.nodesVisited > this.maxNodes) {
        this.recordLimit("MAX_NODES", `Max nodes ${this.maxNodes} reached (while adding ${kind} ${element.tagName || "node"})`);
        return false;
      }
      return true;
    }
    recordLimit(type, message) {
      if (!this.limitFlags[type]) {
        this.limitFlags[type] = true;
        this.warnings.push(message);
      }
      this.limitHit = true;
    }
    addWarning(message) {
      this.warnings.push(message);
    }
    shouldPrune(node) {
      if (node.isContentOnly)
        return true;
      const hasVisibleBg = (node.fills?.length ?? 0) > 0;
      const hasBorder = (node.strokes?.length ?? 0) > 0;
      const hasShadow = (node.effects?.length ?? 0) > 0;
      const isLayout = node.layoutMode !== "NONE";
      const hasPadding = node.padding && (node.padding.top > 0 || node.padding.right > 0 || node.padding.bottom > 0 || node.padding.left > 0);
      const isSemantic = node.semanticType && node.semanticType !== "CONTAINER";
      const hasOpacity = node.opacity !== void 0 && !isNaN(node.opacity) && node.opacity < 1;
      const hasBlendMode = node.blendMode !== void 0 && node.blendMode !== "NORMAL";
      const hasRotation = node.rotation !== void 0 && !isNaN(node.rotation) && node.rotation !== 0;
      const clipsContent = node.clipsContent === true;
      if (hasVisibleBg || hasBorder || hasShadow || isLayout || isSemantic || hasPadding || hasOpacity || hasBlendMode || hasRotation || clipsContent || node.type === "IMAGE" || node.type === "SVG" || node.type === "TEXT") {
        return false;
      }
      return true;
    }
  };

  // src/types/layer-node.ts
  var SCHEMA_VERSION = "1.0.0";
  var HTFIG_MAGIC = "HTFIG";

  // src/shared/utils.ts
  function computeChecksum(data) {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    const hashHex = Math.abs(hash).toString(16).padStart(8, "0");
    const lengthComponent = data.length.toString(16).padStart(8, "0");
    return `${hashHex}${lengthComponent}`;
  }

  // src/types/file-format.ts
  function encodeHtfig(layers, viewport) {
    const viewportMeta = {
      ...viewport,
      schemaVersion: SCHEMA_VERSION,
      captureTimestamp: Date.now()
    };
    const payloadData = {
      magic: HTFIG_MAGIC,
      version: SCHEMA_VERSION,
      viewport: viewportMeta,
      layers
    };
    const payloadString = JSON.stringify(payloadData);
    const checksum = computeChecksum(payloadString);
    const document2 = {
      ...payloadData,
      checksum
    };
    return JSON.stringify(document2, null, 2);
  }

  // chrome-extension/content-script.ts
  console.log("HTML-to-Figma Content Script Loaded");
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "CAPTURE_PAGE") {
      capturePage().then((result) => {
        sendResponse(result);
      }).catch((err) => {
        console.error("Capture failed:", err);
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }
  });
  async function autoScroll() {
    return new Promise((resolve) => {
      const distance = 200;
      const intervalMs = 40;
      const maxDurationMs = 15e3;
      const maxSteps = 400;
      let lastScrollHeight = 0;
      let stableHeightTicks = 0;
      let steps = 0;
      const start = Date.now();
      const timer = setInterval(() => {
        const scrollHeight = Math.max(
          document.documentElement?.scrollHeight || 0,
          document.body?.scrollHeight || 0
        );
        window.scrollBy(0, distance);
        steps += 1;
        if (scrollHeight === lastScrollHeight) {
          stableHeightTicks += 1;
        } else {
          stableHeightTicks = 0;
          lastScrollHeight = scrollHeight;
        }
        const atBottom = window.scrollY + window.innerHeight >= scrollHeight - 4;
        const timedOut = Date.now() - start > maxDurationMs;
        const tooManySteps = steps >= maxSteps;
        const heightStable = stableHeightTicks >= 5;
        if (atBottom || timedOut || tooManySteps || heightStable) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          setTimeout(resolve, 500);
        }
      }, intervalMs);
    });
  }
  async function capturePage() {
    try {
      await autoScroll();
      const root = document.documentElement;
      const collector = new ContentCollector(root);
      const rootLayer = await collector.collect(root);
      if (!rootLayer) {
        throw new Error("No content captured from page");
      }
      const layers = [rootLayer];
      const warnings = collector.getWarnings();
      const stats = collector.getStats();
      const viewport = {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        sourceUrl: window.location.href
      };
      const fileContent = encodeHtfig(layers, viewport);
      if (warnings.length > 0) {
        console.warn("Capture completed with warnings:", warnings, stats);
      }
      return { success: true, data: fileContent, warnings, stats };
    } catch (e) {
      console.error("HTML-to-Figma Capture Error:", e);
      return { success: false, error: e instanceof Error ? e.message : "Unknown error" };
    }
  }
})();

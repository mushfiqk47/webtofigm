"use strict";
(() => {
  // src/capture/dom-utils.ts
  function isHidden(element, computedStyle) {
    if (element.tagName === "SCRIPT" || element.tagName === "STYLE" || element.tagName === "NOSCRIPT" || element.tagName === "META") {
      return true;
    }
    if (computedStyle.display === "none")
      return true;
    if (computedStyle.visibility === "hidden")
      return false;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && computedStyle.overflow === "hidden" && computedStyle.display !== "contents") {
      return true;
    }
    return false;
  }
  function imageToBase64(src) {
    return new Promise((resolve) => {
      if (src.startsWith("data:")) {
        resolve(src);
        return;
      }
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: "FETCH_IMAGE_BASE64", url: src }, (response) => {
          if (response && response.base64) {
            resolve(response.base64);
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
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0);
      try {
        const dataUrl = canvas.toDataURL("image/png");
        resolve(dataUrl);
      } catch (e) {
        resolve(null);
      }
    };
    img.onerror = () => {
      resolve(null);
    };
    img.src = src;
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

  // src/capture/collector.ts
  var ContentCollector = class {
    constructor(root) {
      this.root = root;
    }
    async collect(element) {
      try {
        const style = window.getComputedStyle(element);
        if (isHidden(element, style)) {
          return null;
        }
        const isDisplayContents = style.display === "contents";
        const rect = element.getBoundingClientRect();
        const node = {
          type: "FRAME",
          name: element.tagName.toLowerCase(),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          opacity: parseFloat(style.opacity),
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
          this.extractLayout(node, style);
          if (element.tagName === "IMG") {
            await this.handleImage(node, element);
          } else if (element.tagName === "SVG") {
            this.handleSvg(node, element);
          } else if (element.tagName === "VIDEO") {
            await this.handleVideo(node, element);
          } else if (element.tagName === "CANVAS") {
            await this.handleCanvas(node, element);
          } else if (element.tagName === "PICTURE") {
            await this.handlePicture(node, element);
          }
        } else if (!isVisible && !isDisplayContents) {
          node.fills = [];
          node.strokes = [];
          node.effects = [];
        }
        if (node.type !== "IMAGE" && node.type !== "SVG") {
          await this.processChildren(node, element);
        }
        if (this.shouldPrune(node)) {
          node.isContentOnly = true;
        }
        return node;
      } catch (e) {
        console.warn("Error collecting node", element, e);
        return null;
      }
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
      else if (tag === "SECTION" || tag === "HEADER" || tag === "FOOTER")
        node.semanticType = "SECTION";
      if (node.semanticType) {
        node.name = `${node.semanticType.toLowerCase()}`;
      }
      if (element.id)
        node.name += `#${element.id}`;
      else if (element.className && typeof element.className === "string")
        node.name += `.${element.className.split(" ")[0]}`;
    }
    extractLayout(node, style) {
      const display = style.display;
      node.padding = {
        top: parseFloat(style.paddingTop) || 0,
        right: parseFloat(style.paddingRight) || 0,
        bottom: parseFloat(style.paddingBottom) || 0,
        left: parseFloat(style.paddingLeft) || 0
      };
      const isFlex = display === "flex" || display === "inline-flex";
      const isGrid = display === "grid" || display === "inline-grid";
      if (isFlex || isGrid) {
        node.layoutMode = style.flexDirection === "row" || style.flexDirection === "row-reverse" || isGrid && style.gridAutoFlow.includes("column") ? "HORIZONTAL" : "VERTICAL";
        const gaps = parseGap(style.gap);
        if (gaps.row === 0 && style.rowGap && style.rowGap !== "normal")
          gaps.row = parseFloat(style.rowGap);
        if (gaps.col === 0 && style.columnGap && style.columnGap !== "normal")
          gaps.col = parseFloat(style.columnGap);
        if (node.layoutMode === "HORIZONTAL") {
          node.itemSpacing = gaps.col;
          node.counterAxisSpacing = gaps.row;
        } else {
          node.itemSpacing = gaps.row;
          node.counterAxisSpacing = gaps.col;
        }
        const align = style.alignItems;
        if (align === "flex-start" || align === "start")
          node.counterAxisAlignItems = "MIN";
        else if (align === "flex-end" || align === "end")
          node.counterAxisAlignItems = "MAX";
        else if (align === "center")
          node.counterAxisAlignItems = "CENTER";
        else if (align === "baseline")
          node.counterAxisAlignItems = "BASELINE";
        else if (align === "stretch")
          node.counterAxisAlignItems = "MIN";
        const justify = style.justifyContent;
        if (justify === "flex-start" || justify === "start")
          node.primaryAxisAlignItems = "MIN";
        else if (justify === "flex-end" || justify === "end")
          node.primaryAxisAlignItems = "MAX";
        else if (justify === "center")
          node.primaryAxisAlignItems = "CENTER";
        else if (justify === "space-between")
          node.primaryAxisAlignItems = "SPACE_BETWEEN";
        if (style.flexWrap === "wrap" || isGrid) {
          node.layoutWrap = "WRAP";
        }
      } else {
        node.layoutMode = "VERTICAL";
        node.primaryAxisAlignItems = "MIN";
        node.counterAxisAlignItems = "MIN";
        node.itemSpacing = parseFloat(style.rowGap) || 0;
      }
      const isWidthFill = style.width === "100%" || style.width === "100vw" || parseFloat(style.flexGrow) > 0;
      const isHeightFill = style.height === "100%" || style.height === "100vh";
      node.layoutSizingHorizontal = isWidthFill ? "FILL" : "HUG";
      node.layoutSizingVertical = isHeightFill ? "FILL" : "HUG";
      if (node.layoutMode === "VERTICAL" && !isFlex && !isGrid) {
        if (display !== "inline" && display !== "inline-block" && display !== "inline-flex" && display !== "inline-grid") {
          node.layoutSizingHorizontal = "FILL";
        }
      }
      if (style.position === "absolute" || style.position === "fixed") {
        node.layoutPositioning = "ABSOLUTE";
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
        const regex = /url\(['"]?(.*?)['"]?\)/g;
        let match;
        const urls = [];
        while ((match = regex.exec(style.backgroundImage)) !== null) {
          if (match[1]) {
            urls.push(match[1]);
          }
        }
        urls.reverse();
        for (const urlStr of urls) {
          const url = this.normalizeUrl(urlStr);
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
            console.warn("Failed to extract background image", url, e);
          }
        }
      }
      if (style.webkitMaskImage && style.webkitMaskImage !== "none") {
        const urlMatch = style.webkitMaskImage.match(/url\(['"]?(.*?)['"]?\)/);
        if (urlMatch && urlMatch[1]) {
          const url = this.normalizeUrl(urlMatch[1]);
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
        }
      }
      if (style.listStyleImage && style.listStyleImage !== "none") {
        const urlMatch = style.listStyleImage.match(/url\(['"]?(.*?)['"]?\)/);
        if (urlMatch && urlMatch[1]) {
          const url = this.normalizeUrl(urlMatch[1]);
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
              node.type = "SVG";
              node.svgContent = svgData;
              return;
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
              node.type = "SVG";
              node.svgContent = svgText;
              return;
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
    handleSvg(node, svg) {
      node.type = "SVG";
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
      node.svgContent = svg.outerHTML;
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
        node.fills?.push({
          type: "SOLID",
          color: { r: 0.2, g: 0.2, b: 0.2 },
          opacity: 1
        });
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
    async handlePicture(node, picture) {
      const img = picture.querySelector("img");
      if (img) {
        await this.handleImage(node, img);
      } else {
        node.type = "FRAME";
        node.name = "Picture";
      }
    }
    async processChildren(node, element) {
      await this.collectPseudoElement(node, element, "::before");
      const childNodes = Array.from(element.childNodes);
      const collectedChildren = [];
      for (const child of childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const textNode = this.createTextLeaf(child, element);
          if (textNode)
            collectedChildren.push(textNode);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const childLayer = await this.collect(child);
          if (childLayer) {
            collectedChildren.push(childLayer);
          }
        }
      }
      await this.collectPseudoElement(node, element, "::after");
      this.sortChildrenByZIndex(collectedChildren);
      if (!node.children)
        node.children = [];
      node.children.push(...collectedChildren);
    }
    sortChildrenByZIndex(children) {
      children.sort((a, b) => {
        const az = a.zIndex || 0;
        const bz = b.zIndex || 0;
        if (az !== bz)
          return az - bz;
        return 0;
      });
    }
    async collectPseudoElement(parentNode, element, pseudoType) {
      const style = window.getComputedStyle(element, pseudoType);
      const content = style.content;
      if (!content || content === "none" || content === "normal")
        return;
      const width = parseFloat(style.width);
      const height = parseFloat(style.height);
      const hasSize = width > 0 && height > 0;
      const hasContentString = content.replace(/['"]/g, "").length > 0;
      const urlMatch = content.match(/url\(['"]?(.*?)['"]?\)/);
      const hasBackground = style.backgroundImage !== "none" || style.backgroundColor !== "rgba(0, 0, 0, 0)";
      const hasBorder = style.borderStyle !== "none" && parseFloat(style.borderWidth) > 0;
      if (!hasContentString && !urlMatch && !(hasSize && (hasBackground || hasBorder)))
        return;
      const pseudoNode = {
        type: "FRAME",
        name: pseudoType,
        x: 0,
        y: 0,
        width: width || 0,
        height: height || 0,
        opacity: parseFloat(style.opacity),
        blendMode: this.getBlendMode(style),
        fills: [],
        strokes: [],
        effects: [],
        children: [],
        isContentOnly: false,
        zIndex: style.zIndex !== "auto" ? parseInt(style.zIndex) : 0
      };
      if (style.position === "absolute") {
        pseudoNode.layoutPositioning = "ABSOLUTE";
        const top = parseFloat(style.top);
        const left = parseFloat(style.left);
        if (!isNaN(top))
          pseudoNode.y = parentNode.y + top;
        if (!isNaN(left))
          pseudoNode.x = parentNode.x + left;
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
        pseudoNode.type = "TEXT";
        pseudoNode.text = cleanContent;
        pseudoNode.fontFamily = style.fontFamily;
        pseudoNode.fontSize = parseFloat(style.fontSize);
        pseudoNode.fontWeight = style.fontWeight;
        pseudoNode.textAlign = style.textAlign.toUpperCase();
        const color = parseColor(style.color);
        if (!pseudoNode.fills)
          pseudoNode.fills = [];
        pseudoNode.fills.push({ type: "SOLID", color: { r: color.r, g: color.g, b: color.b }, opacity: color.a });
        this.extractTextShadows(pseudoNode, style);
      }
      parentNode.children?.push(pseudoNode);
    }
    normalizeUrl(url) {
      try {
        return new URL(url, document.baseURI).href;
      } catch (e) {
        return url;
      }
    }
    createTextLeaf(textNode, parent) {
      const style = window.getComputedStyle(parent);
      const range = document.createRange();
      range.selectNode(textNode);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0)
        return null;
      const text = cleanText(textNode.textContent || "", style.whiteSpace);
      if (!text)
        return null;
      const color = parseColor(style.color);
      const node = {
        type: "TEXT",
        name: "Text",
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        text,
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        fontSize: parseFloat(style.fontSize),
        textAlign: style.textAlign.toUpperCase(),
        fills: [{
          type: "SOLID",
          color: { r: color.r, g: color.g, b: color.b },
          opacity: color.a
        }]
      };
      this.extractTextShadows(node, style);
      return node;
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
      if (hasVisibleBg || hasBorder || hasShadow || isLayout || isSemantic || hasPadding || node.type === "IMAGE" || node.type === "SVG" || node.type === "TEXT") {
        return false;
      }
      return true;
    }
  };

  // src/types/layer-node.ts
  var SCHEMA_VERSION = "1.0.0";
  var HTFIG_MAGIC = "HTFIG";

  // src/types/file-format.ts
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
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          setTimeout(resolve, 500);
        }
      }, 20);
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
      const viewport = {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        sourceUrl: window.location.href
      };
      const fileContent = encodeHtfig(layers, viewport);
      return { success: true, data: fileContent };
    } catch (e) {
      console.error("HTML-to-Figma Capture Error:", e);
      return { success: false, error: e instanceof Error ? e.message : "Unknown error" };
    }
  }
})();

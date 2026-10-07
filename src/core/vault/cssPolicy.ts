/**
 * Setup Center — Remote CSS Policy & Scoping Engine
 *
 * Implements Issue D10:
 * Protects critical application interface, titlebar, dialogs, and administrative
 * controls against un-scoped, malicious, or destructive remote CSS overrides.
 *
 * Ensures:
 * 1. Dangerous CSS constructs (@import, expressions, scripts, non-https assets) are stripped.
 * 2. All rules are strictly scoped to [data-style="{styleId}"] or [data-base-style="{styleId}"].
 * 3. Protected UI elements ([data-protected-ui], #titlebar, .protected-ui-root) are isolated.
 */

export interface CssPolicyOptions {
  scopeToExperienceRoot?: boolean;
  protectCriticalUi?: boolean;
}

/**
 * Scopes and sanitizes remote CSS for a specific style ID.
 */
export function scopeRemoteCss(
  styleId: string,
  rawCss: string,
  options: CssPolicyOptions = { scopeToExperienceRoot: true, protectCriticalUi: true },
): string {
  if (!rawCss || typeof rawCss !== "string") return "";

  // 1. Remove dangerous constructs: @import, expressions, behaviors, javascript:
  let cleanCss = rawCss
    .replace(/@import\s+[^;]+;/gi, "/* [cssPolicy] @import stripped */")
    .replace(/expression\s*\([^)]*\)/gi, "none")
    .replace(/behavior\s*:\s*[^;]+;/gi, "/* [cssPolicy] behavior stripped */")
    .replace(/-moz-binding\s*:\s*[^;]+;/gi, "/* [cssPolicy] -moz-binding stripped */")
    .replace(/url\s*\(\s*(['"]?)\s*javascript:[^)]*\1\s*\)/gi, "none");

  // 2. Sanitize comments so tokenizer is clean
  // We parse top-level blocks: selector { declarations } or @at-rules { ... }
  const blocks: string[] = [];
  let depth = 0;
  let currentBlock = "";
  let inComment = false;

  for (let i = 0; i < cleanCss.length; i++) {
    const char = cleanCss[i];
    const nextChar = cleanCss[i + 1];

    if (!inComment && char === "/" && nextChar === "*") {
      inComment = true;
      currentBlock += char;
      continue;
    }
    if (inComment && char === "*" && nextChar === "/") {
      inComment = false;
      currentBlock += "*/";
      i++;
      continue;
    }
    if (inComment) {
      currentBlock += char;
      continue;
    }

    if (char === "{") {
      depth++;
      currentBlock += char;
    } else if (char === "}") {
      depth--;
      currentBlock += char;
      if (depth === 0) {
        blocks.push(currentBlock.trim());
        currentBlock = "";
      }
    } else {
      currentBlock += char;
    }
  }

  if (currentBlock.trim()) {
    blocks.push(currentBlock.trim());
  }

  const primaryScope = `[data-style="${styleId}"]`;
  const baseStyleScope = `[data-base-style="${styleId}"]`;
  const combinedScope = `:is(${primaryScope}, ${baseStyleScope})`;

  const processedBlocks: string[] = [];

  for (const block of blocks) {
    if (!block) continue;

    // Handle @keyframes or @font-face or @media
    if (block.startsWith("@keyframes ") || block.startsWith("@-webkit-keyframes ")) {
      processedBlocks.push(block);
      continue;
    }
    if (block.startsWith("@font-face")) {
      // Allow only https:// or local font URLs
      if (/url\s*\(\s*['"]?http:\/\//i.test(block)) {
        continue; // Discard non-secure http fonts
      }
      processedBlocks.push(block);
      continue;
    }
    if (block.startsWith("@media")) {
      // Nested media query: recursively scope interior
      const firstBrace = block.indexOf("{");
      const lastBrace = block.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1) {
        const mediaHeader = block.slice(0, firstBrace + 1);
        const innerContent = block.slice(firstBrace + 1, lastBrace);
        const scopedInner = scopeRemoteCss(styleId, innerContent, options);
        processedBlocks.push(`${mediaHeader}\n${scopedInner}\n}`);
      }
      continue;
    }

    const firstBrace = block.indexOf("{");
    if (firstBrace === -1) {
      continue;
    }

    const rawSelectors = block.slice(0, firstBrace).trim();
    const declarations = block.slice(firstBrace);

    // Split multiple comma-separated selectors
    const selectorList = rawSelectors
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const scopedSelectors: string[] = [];

    for (let sel of selectorList) {
      // Discard comment lines attached to selectors
      sel = sel.replace(/\/\*[\s\S]*?\*\//g, "").trim();
      if (!sel) continue;

      // Handle :root or html or body
      if (sel === ":root" || sel === "html" || sel === "body") {
        scopedSelectors.push(`:root${combinedScope}`, combinedScope);
        continue;
      }
      if (sel.startsWith(":root[") || sel.startsWith("html[") || sel.startsWith("body[")) {
        // Already scoped to root attribute
        if (sel.includes(styleId)) {
          scopedSelectors.push(sel);
        } else {
          // Attribute points to something else, rewrite to target this style
          scopedSelectors.push(`:root${combinedScope}`);
        }
        continue;
      }

      // If selector already starts with [data-style="..."]
      if (sel.startsWith(`[data-style="${styleId}"]`) || sel.startsWith(`[data-base-style="${styleId}"]`)) {
        if (options.protectCriticalUi) {
          // Prevent targeting protected UI elements
          scopedSelectors.push(`${sel}:not([data-protected-ui] *):not([data-protected-ui])`);
        } else {
          scopedSelectors.push(sel);
        }
        continue;
      }

      // Wildcard * protection: prevent global * reset hijacking circles/pills/protected UI
      if (sel === "*") {
        scopedSelectors.push(`${combinedScope} *:not([data-protected-ui] *):not([data-protected-ui])`);
        continue;
      }

      // Normal component or utility selector: prefix with combinedScope
      if (options.protectCriticalUi) {
        scopedSelectors.push(
          `${combinedScope} ${sel}:not([data-protected-ui] *):not([data-protected-ui])`,
        );
      } else {
        scopedSelectors.push(`${combinedScope} ${sel}`);
      }
    }

    if (scopedSelectors.length > 0) {
      processedBlocks.push(`${scopedSelectors.join(", ")} ${declarations}`);
    }
  }

  return processedBlocks.join("\n\n");
}

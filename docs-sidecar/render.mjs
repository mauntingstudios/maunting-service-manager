import * as Y from "yjs";

import { extractText } from "./persist.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function linkHref(attrs) {
  const link = attrs?.link;
  if (!link) return null;
  if (typeof link === "string") return link;
  if (typeof link === "object" && typeof link.href === "string") return link.href;
  return null;
}

function inlineHtml(xmlText) {
  const ops = typeof xmlText.toDelta === "function" ? xmlText.toDelta() : [];
  if (!ops.length) return escapeHtml(xmlText.toString());
  let html = "";
  for (const op of ops) {
    let stueck = escapeHtml(op.insert);
    const attrs = op.attributes || {};
    if (attrs.code) stueck = `<code>${stueck}</code>`;
    if (attrs.bold) stueck = `<strong>${stueck}</strong>`;
    if (attrs.italic) stueck = `<em>${stueck}</em>`;
    if (attrs.underline) stueck = `<u>${stueck}</u>`;
    if (attrs.strike) stueck = `<s>${stueck}</s>`;
    if (attrs.highlight) stueck = `<mark>${stueck}</mark>`;
    const href = linkHref(attrs);
    if (href) {
      stueck = `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${stueck}</a>`;
    }
    html += stueck;
  }
  return html;
}

function inlineMarkdown(xmlText) {
  const ops = typeof xmlText.toDelta === "function" ? xmlText.toDelta() : [];
  if (!ops.length) return xmlText.toString();
  let text = "";
  for (const op of ops) {
    let stueck = String(op.insert ?? "");
    const attrs = op.attributes || {};
    const href = linkHref(attrs);
    if (attrs.code) stueck = `\`${stueck}\``;
    if (attrs.bold) stueck = `**${stueck}**`;
    if (attrs.italic) stueck = `*${stueck}*`;
    if (attrs.underline) stueck = `<u>${stueck}</u>`;
    if (attrs.strike) stueck = `~~${stueck}~~`;
    if (attrs.highlight) stueck = `<mark>${stueck}</mark>`;
    if (href) stueck = `[${stueck}](${href})`;
    text += stueck;
  }
  return text;
}

function kinderHtml(node) {
  return node.toArray().map((kind) => blockHtml(kind)).join("");
}

function kinderMarkdown(node, einzug = "") {
  return node.toArray().map((kind) => blockMarkdown(kind, einzug)).join("");
}

function blockHtml(node) {
  if (node instanceof Y.XmlText) return inlineHtml(node);
  if (!(node instanceof Y.XmlElement)) return "";
  const name = node.nodeName;
  const attrs = node.getAttributes?.() || {};
  switch (name) {
    case "paragraph":
      return `<p>${kinderHtml(node)}</p>`;
    case "heading": {
      const level = Math.min(Math.max(Number(attrs.level) || 1, 1), 6);
      return `<h${level}>${kinderHtml(node)}</h${level}>`;
    }
    case "blockquote":
      return `<blockquote>${kinderHtml(node)}</blockquote>`;
    case "bulletList":
      return `<ul>${kinderHtml(node)}</ul>`;
    case "orderedList":
      return `<ol>${kinderHtml(node)}</ol>`;
    case "listItem":
      return `<li>${kinderHtml(node)}</li>`;
    case "taskList":
      return `<ul class="task-list">${kinderHtml(node)}</ul>`;
    case "taskItem":
      return `<li class="task-item"><input type="checkbox" disabled${
        attrs.checked ? " checked" : ""
      }> ${kinderHtml(node)}</li>`;
    case "codeBlock":
      return `<pre><code>${escapeHtml(node.toString())}</code></pre>`;
    case "horizontalRule":
      return "<hr>";
    case "hardBreak":
      return "<br>";
    case "image": {
      const src = attrs.src || "";
      const alt = attrs.alt || "";
      const title = attrs.title ? ` title="${escapeHtml(attrs.title)}"` : "";
      // Die Asset-UID bleibt am Knoten, damit der Backend-Export Bilder als
      // Data-URL einbetten kann statt einer abgelaufenen signed URL.
      const asset = attrs.assetUid
        ? ` data-asset-uid="${escapeHtml(String(attrs.assetUid))}"`
        : "";
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${title}${asset}>`;
    }
    case "table":
      return `<table><tbody>${kinderHtml(node)}</tbody></table>`;
    case "tableRow":
      return `<tr>${kinderHtml(node)}</tr>`;
    case "tableHeader":
      return `<th>${kinderHtml(node)}</th>`;
    case "tableCell":
      return `<td>${kinderHtml(node)}</td>`;
    default:
      return kinderHtml(node);
  }
}

function blockMarkdown(node, einzug = "") {
  if (node instanceof Y.XmlText) return inlineMarkdown(node);
  if (!(node instanceof Y.XmlElement)) return "";
  const name = node.nodeName;
  const attrs = node.getAttributes?.() || {};
  switch (name) {
    case "paragraph":
      return `${einzug}${kinderMarkdown(node, einzug)}\n\n`;
    case "heading": {
      const level = Math.min(Math.max(Number(attrs.level) || 1, 1), 6);
      return `${einzug}${"#".repeat(level)} ${kinderMarkdown(node, einzug)}\n\n`;
    }
    case "blockquote":
      return `${kinderMarkdown(node, einzug)
        .split("\n")
        .map((zeile) => `${einzug}> ${zeile}`)
        .join("\n")}\n\n`;
    case "bulletList":
      return `${node
        .toArray()
        .map((item) => `${einzug}- ${kinderMarkdown(item, `${einzug}  `).trim()}\n`)
        .join("")}\n`;
    case "orderedList":
      return `${node
        .toArray()
        .map(
          (item, index) =>
            `${einzug}${index + 1}. ${kinderMarkdown(item, `${einzug}   `).trim()}\n`,
        )
        .join("")}\n`;
    case "listItem":
      return kinderMarkdown(node, einzug);
    case "taskList":
      return `${node
        .toArray()
        .map((item) => {
          const checked = item.getAttributes?.().checked ? "x" : " ";
          return `${einzug}- [${checked}] ${kinderMarkdown(item, `${einzug}  `).trim()}\n`;
        })
        .join("")}\n`;
    case "taskItem":
      return kinderMarkdown(node, einzug);
    case "codeBlock":
      return `\`\`\`\n${node.toString()}\n\`\`\`\n\n`;
    case "horizontalRule":
      return "---\n\n";
    case "hardBreak":
      return "  \n";
    case "image": {
      const src = attrs.src || "";
      const alt = attrs.alt || "";
      return `![${alt}](${src})\n\n`;
    }
    case "table":
      return `${kinderMarkdown(node, einzug)}\n`;
    case "tableRow":
      return `| ${node
        .toArray()
        .map((zelle) => kinderMarkdown(zelle, "").trim() || " ")
        .join(" | ")} |\n`;
    case "tableHeader":
    case "tableCell":
      return kinderMarkdown(node, einzug);
    default:
      return kinderMarkdown(node, einzug);
  }
}

export function renderDocument(ydoc, format = "html", titel = "Dokument") {
  const fragment = ydoc.getXmlFragment("default");
  if (format === "txt") {
    return extractText(ydoc);
  }
  if (format === "md") {
    return fragment
      .toArray()
      .map((kind) => blockMarkdown(kind))
      .join("")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  const inhalt = fragment
    .toArray()
    .map((kind) => blockHtml(kind))
    .join("\n");
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(titel)}</title>
<style>
  body { font-family: Inter, system-ui, -apple-system, sans-serif; line-height: 1.65; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 0.6em; }
  p { margin: 0 0 1em; }
  blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid #ccc; color: #555; }
  pre { background: #f5f5f5; padding: 1em; overflow-x: auto; border-radius: 6px; }
  code { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 0.92em; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 0.4em 0.6em; text-align: left; }
  img { max-width: 100%; height: auto; }
  ul.task-list { list-style: none; padding-left: 1.2em; }
  @media print {
    body { margin: 0; max-width: none; color: #000; }
    a { color: #000; text-decoration: underline; }
    pre, blockquote, table, img { break-inside: avoid; }
  }
</style>
</head>
<body>
<article class="docs-prose">
${inhalt}
</article>
</body>
</html>`;
}

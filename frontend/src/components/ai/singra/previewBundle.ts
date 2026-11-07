/**
 * Baut aus den Projektdateien ein eigenständiges HTML-Dokument für die
 * Live-Vorschau (iframe `srcDoc`).
 *
 * Unterstützt:
 * - reine HTML/CSS/JS-Seiten (klassische Skripte werden nur eingebettet, wenn
 *   die HTML-Datei sie per `<script src>` einbindet),
 * - ES-Module in `.js`, `.ts`, `.jsx`, `.tsx`: jede Datei läuft im iframe über
 *   einen kleinen CommonJS-Lader mit Babel in ihrem eigenen Gültigkeitsbereich.
 *   Mehrere `export default` kollidieren dadurch nicht mehr.
 *
 * Backend-, Test- und Konfigurationsdateien kommen nie in den Browser.
 * Laufzeit-, Compile- und Ladefehler sowie eine leer gebliebene Seite meldet
 * das Dokument per `postMessage({ type: 'singra-preview-error' })` an das
 * Elternfenster.
 */

export interface PreviewSourceFile {
  path: string
  content: string
}

export interface PreviewErrorMessage {
  type: 'singra-preview-error'
  kind: 'runtime' | 'compile' | 'module' | 'blank'
  message: string
  detail?: string
}

const SERVER_DIR_PREFIXES = [
  'backend/',
  'server/',
  'api/',
  'migrations/',
  'prisma/',
  'db/',
  'database/',
  'tests/',
  'test/',
  '__tests__/',
  'e2e/',
  'scripts/',
  'node_modules/',
  'dist/',
  'build/',
]

const SERVER_ROOT_FILES = new Set([
  'server.js',
  'server.ts',
  'server.mjs',
  'app.py',
  'main.py',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
])

const NODE_ONLY_IMPORT =
  /(?:\brequire\(\s*['"](?:express|fs|path|http|https|net|child_process|pg|mysql2?|sqlite3|better-sqlite3|dotenv|cors)['"]\s*\)|\bfrom\s+['"](?:express|fs|path|http|https|child_process|pg|sqlite3|better-sqlite3|dotenv|cors|node:[a-z_/]+)['"])/

/** Gehört die Datei in den Browser? */
export function isBrowserPreviewFile(path: string, content: string): boolean {
  const lower = path.replace(/^\.?\/+/, '').toLowerCase()
  if (SERVER_DIR_PREFIXES.some((p) => lower.startsWith(p))) return false
  if (lower.includes('/__tests__/') || lower.includes('/tests/')) return false
  if (/\.(test|spec)\.[a-z]+$/.test(lower)) return false
  const base = lower.split('/').pop() ?? lower
  if (!lower.includes('/') && SERVER_ROOT_FILES.has(base)) return false
  if (/\.config\.(c|m)?(js|ts)$/.test(base) || base.endsWith('.cjs')) return false
  if (/\.(m?js|jsx|ts|tsx)$/.test(lower) && NODE_ONLY_IMPORT.test(content)) return false
  return true
}

/** Fehlerfalle — steht als erstes Skript im `<head>`. */
const PREVIEW_ERROR_HARNESS = `<script id="__singra_preview_harness__">
(function () {
  var sent = {};
  function report(kind, message, detail) {
    var key = kind + '|' + message;
    if (sent[key]) return;
    sent[key] = true;
    try {
      window.parent.postMessage({
        type: 'singra-preview-error',
        kind: kind,
        message: String(message || 'Unbekannter Fehler').slice(0, 500),
        detail: detail ? String(detail).slice(0, 4000) : ''
      }, '*');
    } catch (e) {
      void e;
    }
  }
  window.__singraReport = report;
  window.addEventListener('error', function (e) {
    if (e && e.target && e.target !== window) {
      var tag = (e.target.tagName || '').toUpperCase();
      if (tag === 'LINK' && (e.target.rel || '').indexOf('icon') !== -1) return;
      if (tag === 'IMG' || tag === 'AUDIO' || tag === 'VIDEO') return;
      return;
    }
    var msg = (e && e.message) || (e && e.error && e.error.message) || '';
    if (!msg || msg === 'Script error.' || msg === 'Skriptfehler') {
      if (!e || (!e.filename && !e.error)) return;
    }
    var where = e.filename ? (e.filename + ':' + e.lineno + ':' + e.colno) : '';
    report('runtime', msg || 'Skriptfehler', (e.error && e.error.stack) || where);
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    report('runtime', 'Unbehandelter Promise-Fehler: ' + ((r && r.message) || r), r && r.stack);
  });
  var origError = console.error;
  console.error = function () {
    try {
      var first = arguments[0];
      var text = first && first.message ? first.message : String(first);
      if (/The above error occurred|Uncaught|Minified React error|is not defined|Cannot read/.test(text)) {
        report('runtime', text.split('\\n')[0], first && first.stack);
      }
    } catch (e) {
      void e;
    }
    return origError.apply(console, arguments);
  };
})();
</script>`

/** Leere Seite erkennen (nach dem Laden + kurzer Wartezeit). */
const PREVIEW_BLANK_CHECK = `
setTimeout(function () {
  try {
    var body = document.body;
    if (!body) return;
    var text = (body.innerText || '').trim();
    var visual = body.querySelector('img,svg,canvas,video,input,button,textarea,iframe');
    if (!text && !visual) {
      window.__singraReport && window.__singraReport(
        'blank',
        'Die Vorschau ist leer',
        'Nach dem Laden wurde nichts angezeigt. Prüfe, ob die Einstiegsdatei Inhalte rendert (z. B. ob das #root-Element befüllt wird).'
      );
    }
  } catch (e) {
    void e;
  }
}, 2500);
`

/** Modul-Lader: Babel-Transform je Datei, `require` mit Pfadauflösung. */
const PREVIEW_MODULE_LOADER = `
(function () {
  var report = window.__singraReport || function () {};
  var bundle = window.__SINGRA_BUNDLE__ || { files: {}, entries: [] };
  var files = bundle.files;
  var lowerIndex = {};
  Object.keys(files).forEach(function (p) { lowerIndex[p.toLowerCase()] = p; });
  var cache = {};
  var missing = {};
  var EXT = ['', '.tsx', '.ts', '.jsx', '.js', '.mjs', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];

  if (!window.React || !window.ReactDOM || !window.Babel) {
    report('module', 'Vorschau-Laufzeit konnte nicht geladen werden', 'React, ReactDOM oder Babel wurden nicht vom CDN geladen. Prüfe die Internetverbindung.');
    return;
  }

  function normalize(path) {
    var out = [];
    path.split('/').forEach(function (seg) {
      if (!seg || seg === '.') return;
      if (seg === '..') out.pop(); else out.push(seg);
    });
    return out.join('/');
  }
  function dirname(p) { var i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
  function findFile(base) {
    for (var i = 0; i < EXT.length; i++) {
      var hit = lowerIndex[(base + EXT[i]).toLowerCase()];
      if (hit) return hit;
    }
    return null;
  }
  var externals = {
    'react': window.React,
    'react-dom': window.ReactDOM,
    'react-dom/client': window.ReactDOM,
    'react/jsx-runtime': {
      jsx: function (t, p, k) { var c = p && p.children; var props = Object.assign({}, p, k !== undefined ? { key: k } : {}); delete props.children; return window.React.createElement(t, props, c); },
      jsxs: function (t, p, k) { var c = (p && p.children) || []; var props = Object.assign({}, p, k !== undefined ? { key: k } : {}); delete props.children; return window.React.createElement.apply(null, [t, props].concat(c)); },
      Fragment: window.React.Fragment
    }
  };
  function makeRequire(from) {
    return function (spec) {
      if (externals[spec]) return externals[spec];
      if (/\\.(css|scss|sass|less)$/i.test(spec)) return {};
      if (/\\.(png|jpe?g|gif|svg|webp|ico)$/i.test(spec)) return { __esModule: true, default: spec };
      var base = null;
      if (spec.charAt(0) === '.') base = normalize(dirname(from) + '/' + spec);
      else if (spec.charAt(0) === '/') base = normalize(spec);
      else if (spec.indexOf('@/') === 0) base = 'src/' + spec.slice(2);
      else if (spec.indexOf('~/') === 0) base = 'src/' + spec.slice(2);
      if (base !== null) {
        var target = findFile(base);
        if (!target) throw new Error('Modul "' + spec + '" (importiert in ' + from + ') wurde nicht gefunden.');
        return load(target);
      }
      if (!missing[spec]) {
        missing[spec] = true;
        report('module', 'Paket "' + spec + '" ist in der Browser-Vorschau nicht verfügbar', 'Importiert in ' + from + '. Die Vorschau stellt nur react und react-dom bereit. Ersetze das Paket durch eigenen Code oder lade es per <script> von einem CDN in index.html.');
      }
      return new Proxy({}, { get: function (_t, key) { if (key === '__esModule') return false; return undefined; } });
    };
  }
  function load(path) {
    if (cache[path]) return cache[path].exports;
    var module = { exports: {} };
    cache[path] = module;
    var code;
    try {
      var isTs = /\\.(ts|tsx)$/i.test(path);
      var presets = [['react', { runtime: 'classic' }]];
      if (isTs) presets.push('typescript');
      code = window.Babel.transform(files[path], {
        filename: path,
        presets: presets,
        plugins: ['transform-modules-commonjs'],
        sourceType: 'module'
      }).code;
    } catch (err) {
      report('compile', 'Kompilierfehler in ' + path + ': ' + String(err && err.message || err).split('\\n')[0], err && err.message);
      throw err;
    }
    var fn = new Function('require', 'module', 'exports', 'React', code + '\\n//# sourceURL=singra:///' + path);
    fn(makeRequire(path), module, module.exports, window.React);
    return module.exports;
  }

  function rootElement() { return document.getElementById('root') || document.getElementById('app'); }

  bundle.entries.forEach(function (entry) {
    try {
      var selfMounts = /createRoot\\s*\\(|hydrateRoot\\s*\\(|ReactDOM\\.render\\s*\\(/.test(files[entry] || '');
      var exp = load(entry);
      var root = rootElement();
      var Comp = exp && (exp.default || exp.App);
      if (!selfMounts && root && root.childNodes.length === 0 && typeof Comp === 'function') {
        window.ReactDOM.createRoot(root).render(window.React.createElement(Comp));
      }
    } catch (err) {
      report('runtime', String(err && err.message || err), err && err.stack);
    }
  });
})();
` + PREVIEW_BLANK_CHECK

/**
 * Baut das Vorschau-Dokument. Liefert `null`, wenn es weder eine HTML-Datei
 * noch einen Modul-Einstieg gibt (Vorschau nicht konfiguriert).
 */
export function buildPreviewDocument(
  allFiles: PreviewSourceFile[],
  configuredEntryFile?: string | null,
): string | null {
  if (!allFiles || allFiles.length === 0) return null

  const browserFiles = allFiles.filter((f) => isBrowserPreviewFile(f.path, f.content))
  const byLower = new Map(browserFiles.map((f) => [f.path.replace(/^\.?\/+/, '').toLowerCase(), f]))
  const configuredEntry = configuredEntryFile?.replace(/^\.?\/+/, '').toLowerCase() ?? null

  const htmlFile =
    (configuredEntry?.endsWith('.html') ? byLower.get(configuredEntry) : undefined) ||
    byLower.get('index.html') ||
    byLower.get('public/index.html') ||
    browserFiles.find((f) => f.path.toLowerCase().endsWith('.html'))

  const codeFiles = browserFiles.filter((f) => /\.(m?js|jsx|ts|tsx)$/i.test(f.path))
  const hasModuleSyntax = (content: string) => /^\s*(import|export)\s/m.test(content)

  let doc =
    htmlFile?.content ||
    '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>'
  if (!/<head(\s[^>]*)?>/i.test(doc)) doc = `<head></head>${doc}`
  if (!/<\/body>/i.test(doc)) doc = `${doc}<body></body>`
  const htmlDir =
    htmlFile && htmlFile.path.includes('/') ? htmlFile.path.slice(0, htmlFile.path.lastIndexOf('/') + 1) : ''

  const resolveRef = (src: string) => {
    const clean = src.split(/[?#]/)[0].replace(/^\.\//, '')
    if (clean.startsWith('/')) return clean.slice(1).toLowerCase()
    return `${htmlDir}${clean}`.toLowerCase()
  }

  // Skript-Tags der HTML-Datei: Module werden Einstiege, klassische Skripte
  // werden eingebettet, nicht vorhandene lokale Quellen entfernt.
  const moduleEntries: string[] = []
  doc = doc.replace(
    /<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi,
    (full, before: string, src: string, after: string) => {
      if (/^(https?:)?\/\//i.test(src)) return full
      const target = byLower.get(resolveRef(src)) || byLower.get(src.replace(/^\.?\/+/, '').toLowerCase())
      if (!target) return `<!-- Vorschau: ${src} nicht gefunden -->`
      const isModule = /type=["']module["']/i.test(`${before} ${after}`)
      if (isModule || /\.(tsx|jsx|ts)$/i.test(target.path) || hasModuleSyntax(target.content)) {
        if (!moduleEntries.includes(target.path)) moduleEntries.push(target.path)
        return ''
      }
      return `<script>/* ${target.path} */\n${target.content.replace(/<\/script/gi, '<\\/script')}</script>`
    },
  )

  if (moduleEntries.length === 0) {
    const configuredModule =
      configuredEntry && /\.(m?js|jsx|ts|tsx)$/.test(configuredEntry) ? byLower.get(configuredEntry) : undefined
    const autoEntry =
      configuredModule ||
      [
        'src/main.tsx',
        'src/main.jsx',
        'src/index.tsx',
        'src/index.jsx',
        'main.tsx',
        'main.jsx',
        'index.tsx',
        'index.jsx',
        'src/app.tsx',
        'src/app.jsx',
        'app.tsx',
        'app.jsx',
      ]
        .map((p) => byLower.get(p))
        .find(Boolean) ||
      codeFiles.find((f) => /\.(jsx|tsx)$/i.test(f.path))
    if (autoEntry) moduleEntries.push(autoEntry.path)
  }

  if (!htmlFile && moduleEntries.length === 0) return null

  const usesTailwind =
    browserFiles.some((f) => /class(Name)?=["'][^"']*(flex|grid|bg-|text-|rounded-|px-|py-|border-)/i.test(f.content)) ||
    allFiles.some((f) => f.path.toLowerCase().includes('tailwind'))

  let headInject = PREVIEW_ERROR_HARNESS
  if (usesTailwind && !doc.includes('cdn.tailwindcss.com')) {
    headInject += '<script src="https://cdn.tailwindcss.com"></script>'
  }

  browserFiles
    .filter((f) => f.path.toLowerCase().endsWith('.css'))
    .forEach((css) => {
      const baseName = css.path.split('/').pop() || css.path
      const cleanCss = css.content.replace(/@tailwind\s+(base|components|utilities);?/g, '')
      const styleTag = `<style>/* ${css.path} */\n${cleanCss.replace(/<\/style/gi, '<\\/style')}</style>`
      const linkRegex = new RegExp(
        `<link[^>]+href=["'][^"']*${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`,
        'gi',
      )
      if (linkRegex.test(doc)) {
        doc = doc.replace(linkRegex, () => styleTag)
      } else {
        headInject += styleTag
      }
    })

  if (moduleEntries.length > 0) {
    if (!/id=["'](root|app)["']/.test(doc)) {
      doc = doc.replace(/<body(\s[^>]*)?>/i, (m) => `${m}<div id="root"></div>`)
    }
    headInject += `
<script crossorigin="anonymous" src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin="anonymous" src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script crossorigin="anonymous" src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
`
    const registry: Record<string, string> = {}
    for (const f of codeFiles) registry[f.path] = f.content
    const payload = JSON.stringify({ files: registry, entries: moduleEntries })
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029')
    const loader = `<script>window.__SINGRA_BUNDLE__ = ${payload};</script><script>${PREVIEW_MODULE_LOADER}</script>`
    doc = doc.replace(/<\/body>/i, () => `${loader}</body>`)
  } else {
    doc = doc.replace(/<\/body>/i, () => `<script>${PREVIEW_BLANK_CHECK}</script></body>`)
  }

  doc = doc.replace(/<head(\s[^>]*)?>/i, (m) => `${m}${headInject}`)
  if (!doc.includes('__singra_preview_harness__')) doc = `${headInject}${doc}`
  return doc
}

/** Typprüfung einer iframe-Nachricht. */
export function isPreviewErrorMessage(data: unknown): data is PreviewErrorMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'singra-preview-error' &&
    typeof (data as { message?: unknown }).message === 'string'
  )
}

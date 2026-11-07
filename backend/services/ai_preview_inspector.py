"""Visuelle Vorschau-Inspektion und Headless-Rendering fuer Singra-Projekte.

Ermoeglicht der KI (und dem Benutzer), Web-Apps und Oberflaechen visuell auf
verschiedenen Displaygroessen (insbesondere Smartphone vs. Desktop) zu pruefen,
Screenshots aufzunehmen, horizontalen Overflow zu erkennen und JavaScript-
Laufzeitfehler abzufangen.

Nutzt die auf dem Host installierten Browser (Google Chrome oder Microsoft Edge)
im Headless-Modus ohne schwere Zusatzbibliotheken.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Standard-Pfade fuer Chrome und Edge auf Windows
_WINDOWS_BROWSER_PATHS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

_VIEWPORT_PRESETS = {
    "mobile": {"width": 375, "height": 667, "label": "Smartphone (375x667)"},
    "tablet": {"width": 768, "height": 1024, "label": "Tablet (768x1024)"},
    "desktop": {"width": 1280, "height": 800, "label": "Desktop (1280x800)"},
}

_SERVER_DIR_PREFIXES = (
    "backend/",
    "server/",
    "api/",
    "migrations/",
    "prisma/",
    "db/",
    "database/",
    "tests/",
    "test/",
    "__tests__/",
    "e2e/",
    "scripts/",
    "node_modules/",
    "dist/",
    "build/",
)

_SERVER_ROOT_FILES = {
    "server.js",
    "server.ts",
    "server.mjs",
    "app.py",
    "main.py",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
}


def find_browser_executable() -> Path | None:
    """Findet Google Chrome oder Microsoft Edge auf dem System."""
    for env_var in ("CHROME_BIN", "EDGE_BIN", "CHROMIUM_BIN"):
        val = os.environ.get(env_var)
        if val and os.path.isfile(val):
            return Path(val)

    if os.name == "nt":
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            user_chrome = Path(local_app_data) / "Google" / "Chrome" / "Application" / "chrome.exe"
            if user_chrome.is_file():
                return user_chrome
            user_edge = Path(local_app_data) / "Microsoft" / "Edge" / "Application" / "msedge.exe"
            if user_edge.is_file():
                return user_edge

        for candidate in _WINDOWS_BROWSER_PATHS:
            p = Path(candidate)
            if p.is_file():
                return p

    for binary_name in (
        "google-chrome",
        "google-chrome-stable",
        "chrome",
        "chromium",
        "chromium-browser",
        "microsoft-edge",
        "msedge",
    ):
        which_path = shutil.which(binary_name)
        if which_path and os.path.isfile(which_path):
            return Path(which_path)

    mac_chrome = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    if mac_chrome.is_file():
        return mac_chrome

    return None


def is_browser_available() -> bool:
    """Prueft, ob ein Browser fuer Headless-Rendering vorhanden ist."""
    return find_browser_executable() is not None


def is_browser_preview_file(rel_path: str, content: str) -> bool:
    """Filtert Server-, Test- und Backend-Dateien aus der Vorschau heraus."""
    lower = rel_path.replace("\\", "/").strip().lstrip("./").lower()
    if any(lower.startswith(prefix) for prefix in _SERVER_DIR_PREFIXES):
        return False
    if "/__tests__/" in lower or "/tests/" in lower:
        return False
    if re.search(r"\.(test|spec)\.[a-z]+$", lower):
        return False
    base = lower.split("/")[-1]
    if "/" not in lower and base in _SERVER_ROOT_FILES:
        return False
    if re.search(r"\.config\.(c|m)?(js|ts)$", base) or base.endswith(".cjs"):
        return False
    if re.search(r"\.(m?js|jsx|ts|tsx)$", lower):
        if re.search(
            r"(?:\brequire\(\s*['\"](?:express|fs|path|http|https|net|child_process|pg|mysql2?|sqlite3|better-sqlite3|dotenv|cors)['\"]\s*\)|\bfrom\s+['\"](?:express|fs|path|http|https|child_process|pg|sqlite3|better-sqlite3|dotenv|cors|node:[a-z_/]+)['\"])",
            content,
        ):
            return False
    return True


_INSPECTOR_HARNESS_JS = """
<script id="__singra_inspector_harness__">
(function() {
  window.__singraCapturedErrors = [];
  window.addEventListener('error', function(e) {
    var msg = (e && e.message) || 'Unbekannter Skriptfehler';
    var src = (e && e.filename) ? (e.filename + ':' + e.lineno) : '';
    window.__singraCapturedErrors.push(msg + (src ? ' (' + src + ')' : ''));
  }, true);
  window.addEventListener('unhandledrejection', function(e) {
    var r = e && e.reason;
    var msg = (r && r.message) || String(r || 'Unbehandelter Promise-Fehler');
    window.__singraCapturedErrors.push('Promise: ' + msg);
  });
})();
</script>
"""

_LAYOUT_COLLECTOR_SNIPPET = """
<script id="__singra_layout_collector__">
(function() {
  function collect() {
    try {
      var docEl = document.documentElement;
      var body = document.body;
      var scrollW = Math.max(docEl ? docEl.scrollWidth : 0, body ? body.scrollWidth : 0);
      var innerW = window.innerWidth || 1;
      var hasOverflow = scrollW > (innerW + 1);

      var rootEl = document.getElementById('root') || document.getElementById('app') || body;
      var isBlank = false;
      if (rootEl) {
        var text = (rootEl.innerText || '').trim();
        var visual = rootEl.querySelector('img,svg,canvas,video,input,button,textarea,table,ul,ol,div,p,span');
        isBlank = (!text && !visual);
      }

      var report = {
        overflow: hasOverflow,
        scroll_width: scrollW,
        viewport_width: innerW,
        viewport_height: window.innerHeight,
        root_empty: isBlank,
        title: document.title || '',
        errors: window.__singraCapturedErrors || []
      };

      var existing = document.getElementById('__singra_report_data__');
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }
      var scriptTag = document.createElement('script');
      scriptTag.id = '__singra_report_data__';
      scriptTag.type = 'application/json';
      scriptTag.textContent = JSON.stringify(report);
      document.body.appendChild(scriptTag);
    } catch (e) {
      var errTag = document.createElement('script');
      errTag.id = '__singra_report_data__';
      errTag.type = 'application/json';
      errTag.textContent = JSON.stringify({
        overflow: false,
        scroll_width: 0,
        viewport_width: window.innerWidth,
        viewport_height: window.innerHeight,
        root_empty: false,
        title: 'Fehler bei Messung',
        errors: [String(e && e.message || e)]
      });
      document.body.appendChild(errTag);
    }
  }

  collect();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', collect);
  }
  window.addEventListener('load', collect);
})();
</script>
"""


def build_preview_html_document(
    files: list[dict[str, Any]],
    configured_entry: str | None = None,
    interactions: list[dict[str, Any]] | None = None,
) -> str:
    """Baut ein vollstaendiges Offline-HTML-Dokument aus den Projektdateien."""
    browser_files = [f for f in files if is_browser_preview_file(f["path"], f["content"])]
    by_lower = {f["path"].replace("\\", "/").strip().lstrip("./").lower(): f for f in browser_files}

    cfg = configured_entry.replace("\\", "/").strip().lstrip("./").lower() if configured_entry else None
    html_file = (
        (by_lower.get(cfg) if cfg and cfg.endswith(".html") else None)
        or by_lower.get("index.html")
        or by_lower.get("public/index.html")
        or next((f for f in browser_files if f["path"].lower().endswith(".html")), None)
    )

    code_files = [f for f in browser_files if re.search(r"\.(m?js|jsx|ts|tsx)$", f["path"], re.I)]

    def _has_module(content: str) -> bool:
        return bool(re.search(r"^\s*(import|export)\s", content, re.M))

    doc = (
        html_file["content"]
        if html_file
        else '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>'
    )
    if "<head" not in doc.lower():
        doc = f"<head></head>{doc}"
    if "</body" not in doc.lower():
        doc = f"{doc}<body></body>"

    html_dir = ""
    if html_file and "/" in html_file["path"]:
        html_dir = html_file["path"][: html_file["path"].rfind("/") + 1]

    def _resolve(src: str) -> str:
        clean = re.split(r"[?#]", src)[0].lstrip("./")
        if clean.startswith("/"):
            return clean.lstrip("/").lower()
        return f"{html_dir}{clean}".lower()

    module_entries: list[str] = []

    def _replace_script(match: re.Match) -> str:
        full = match.group(0)
        before = match.group(1) or ""
        src = match.group(2) or ""
        after = match.group(3) or ""
        if re.match(r"^(https?:)?//", src, re.I):
            return full
        target = by_lower.get(_resolve(src)) or by_lower.get(src.strip().lstrip("./").lower())
        if not target:
            return f"<!-- Vorschau: {src} nicht gefunden -->"
        is_module = bool(re.search(r'type=["\']module["\']', f"{before} {after}", re.I))
        if is_module or re.search(r"\.(tsx|jsx|ts)$", target["path"], re.I) or _has_module(target["content"]):
            if target["path"] not in module_entries:
                module_entries.append(target["path"])
            return ""
        escaped = target["content"].replace("</script", "<\\/script")
        return f"<script>/* {target['path']} */\n{escaped}</script>"

    doc = re.sub(
        r'<script\b([^>]*)\bsrc=["\']([^"\']+)["\']([^>]*)>\s*</script>',
        _replace_script,
        doc,
        flags=re.I,
    )

    if not module_entries:
        if cfg and re.search(r"\.(m?js|jsx|ts|tsx)$", cfg, re.I) and cfg in by_lower:
            module_entries.append(by_lower[cfg]["path"])
        else:
            candidates = [
                "src/main.tsx",
                "src/main.jsx",
                "src/index.tsx",
                "src/index.jsx",
                "main.tsx",
                "main.jsx",
                "index.tsx",
                "index.jsx",
                "src/app.tsx",
                "src/app.jsx",
                "app.tsx",
                "app.jsx",
            ]
            for cand in candidates:
                if cand in by_lower:
                    module_entries.append(by_lower[cand]["path"])
                    break
            if not module_entries:
                first_jsx = next((f["path"] for f in code_files if re.search(r"\.(jsx|tsx)$", f["path"], re.I)), None)
                if first_jsx:
                    module_entries.append(first_jsx)

    uses_tailwind = any(
        re.search(r'class(Name)?=["\'][^"\']*(flex|grid|bg-|text-|rounded-|px-|py-|border-)', f["content"], re.I)
        for f in browser_files
    ) or any("tailwind" in f["path"].lower() for f in files)

    head_inject = _INSPECTOR_HARNESS_JS
    if uses_tailwind and "cdn.tailwindcss.com" not in doc:
        head_inject += '<script src="https://cdn.tailwindcss.com"></script>\n'

    for css in (f for f in browser_files if f["path"].lower().endswith(".css")):
        base_name = css["path"].split("/")[-1]
        clean_css = re.sub(r"@tailwind\s+(base|components|utilities);?", "", css["content"])
        clean_css = clean_css.replace("</style", "<\\/style")
        style_tag = f"<style>/* {css['path']} */\n{clean_css}</style>"
        link_pat = re.compile(rf'<link[^>]+href=["\'][^"\']*{re.escape(base_name)}["\'][^>]*>', re.I)
        if link_pat.search(doc):
            doc = link_pat.sub(style_tag, doc)
        else:
            head_inject += f"{style_tag}\n"

    if module_entries:
        if not re.search(r'id=["\'](root|app)["\']', doc):
            doc = re.sub(r"<body(\s[^>]*)?>", r"<body\1><div id=\"root\"></div>", doc, flags=re.I)

        head_inject += """
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
"""
        registry = {f["path"]: f["content"] for f in code_files}
        payload = json.dumps({"files": registry, "entries": module_entries}).replace("<", "\\u003c")
        module_loader_template = """
<script>window.__SINGRA_BUNDLE__ = __PAYLOAD__;</script>
<script>
(function() {
  var bundle = window.__SINGRA_BUNDLE__ || { files: {}, entries: [] };
  var files = bundle.files;
  var lowerIndex = {};
  Object.keys(files).forEach(function(p) { lowerIndex[p.toLowerCase()] = p; });
  var cache = {};
  var EXT = ['', '.tsx', '.ts', '.jsx', '.js', '.mjs', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];

  function normalize(path) {
    var out = [];
    path.split('/').forEach(function(seg) {
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
      jsx: function(t, p, k) { var c = p && p.children; var props = Object.assign({}, p, k !== undefined ? { key: k } : {}); delete props.children; return window.React.createElement(t, props, c); },
      jsxs: function(t, p, k) { var c = (p && p.children) || []; var props = Object.assign({}, p, k !== undefined ? { key: k } : {}); delete props.children; return window.React.createElement.apply(null, [t, props].concat(c)); },
      Fragment: window.React.Fragment
    }
  };
  function makeRequire(from) {
    return function(spec) {
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
        if (target) return load(target);
      }
      return new Proxy({}, { get: function() { return undefined; } });
    };
  }
  function load(path) {
    if (cache[path]) return cache[path].exports;
    var module = { exports: {} };
    cache[path] = module;
    try {
      var code = window.Babel.transform(files[path], {
        filename: path,
        presets: [['react', { runtime: 'classic' }], ['typescript', { isTSX: /\\.(tsx|jsx|js|mjs)$/i.test(path), allExtensions: true }]],
        plugins: ['transform-modules-commonjs'],
        sourceType: 'module'
      }).code;
      var fn = new Function('require', 'module', 'exports', 'React', code + '\\n//# sourceURL=singra:///' + path);
      fn(makeRequire(path), module, module.exports, window.React);
    } catch (err) {
      if (window.__singraCapturedErrors) {
        window.__singraCapturedErrors.push('Kompilierfehler in ' + path + ': ' + (err && err.message || err));
      }
    }
    return module.exports;
  }
  function rootElement() { return document.getElementById('root') || document.getElementById('app'); }

  bundle.entries.forEach(function(entry) {
    try {
      var selfMounts = /createRoot\\s*\\(|hydrateRoot\\s*\\(|ReactDOM\\.render\\s*\\(/.test(files[entry] || '');
      var exp = load(entry);
      var root = rootElement();
      var Comp = exp && (exp.default || exp.App);
      if (!selfMounts && root && root.childNodes.length === 0 && typeof Comp === 'function') {
        window.ReactDOM.createRoot(root).render(window.React.createElement(Comp));
      }
    } catch (err) {
      if (window.__singraCapturedErrors) {
        window.__singraCapturedErrors.push(String(err && err.message || err));
      }
    }
  });
})();
</script>
"""
        module_loader_script = module_loader_template.replace("__PAYLOAD__", payload)
        doc = re.sub(r"</body>", f"{module_loader_script}</body>", doc, flags=re.I)

    # Optionale Interaktionen einbetten
    if interactions:
        interact_payload = json.dumps(interactions).replace("<", "\\u003c")
        interact_template = """
<script id="__singra_interactions__">
(async function() {
  var list = __INTERACT_PAYLOAD__;
  for (var i = 0; i < list.length; i++) {
    var step = list[i];
    try {
      var el = document.querySelector(step.selector);
      if (el) {
        if (!step.action || step.action === 'click') {
          el.click();
        } else if (step.action === 'input' && step.value !== undefined) {
          el.value = step.value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    } catch (e) {
      if (window.__singraCapturedErrors) {
        window.__singraCapturedErrors.push('Interaktion fehlgeschlagen (' + step.selector + '): ' + (e && e.message || e));
      }
    }
    await new Promise(function(r) { setTimeout(r, 120); });
  }
})();
</script>
"""
        interact_snippet = interact_template.replace("__INTERACT_PAYLOAD__", interact_payload)
        doc = re.sub(r"</body>", f"{interact_snippet}</body>", doc, flags=re.I)

    doc = re.sub(r"</body>", f"{_LAYOUT_COLLECTOR_SNIPPET}</body>", doc, flags=re.I)
    doc = re.sub(r"<head(\s[^>]*)?>", rf"\g<0>{head_inject}", doc, flags=re.I)
    return doc


def inspect_project_preview_viewports(
    files: list[dict[str, Any]],
    configured_entry: str | None = None,
    viewports: list[str] | None = None,
    interactions: list[dict[str, Any]] | None = None,
    timeout_seconds: int = 12,
) -> dict[str, Any]:
    """Rendert die Vorschau auf gewaehlten Displaygroessen, misst Layout-Metriken und erzeugt Screenshots."""
    browser_bin = find_browser_executable()
    if not browser_bin:
        return {
            "ok": False,
            "browser_available": False,
            "error": "Kein Google Chrome oder Microsoft Edge auf dem Server fuer visuelle Headless-Sichtpruefung gefunden.",
            "viewports": {},
            "issues": ["Browser fuer visuelle Pruefung nicht verfuegbar."],
        }

    vp_keys = [v.lower() for v in (viewports or ["mobile", "desktop"]) if v.lower() in _VIEWPORT_PRESETS]
    if not vp_keys:
        vp_keys = ["mobile", "desktop"]

    html_content = build_preview_html_document(
        files, configured_entry=configured_entry, interactions=interactions
    )

    tmp_dir = Path(tempfile.mkdtemp(prefix="msm_preview_"))
    try:
        html_file = tmp_dir / "preview.html"
        html_file.write_text(html_content, encoding="utf-8")
        file_url = f"file:///{str(html_file).replace(os.sep, '/')}"

        results_by_vp: dict[str, Any] = {}
        all_issues: list[str] = []

        for key in vp_keys:
            vp_cfg = _VIEWPORT_PRESETS[key]
            width = vp_cfg["width"]
            height = vp_cfg["height"]
            shot_file = tmp_dir / f"shot_{key}.png"
            user_data_dir = tmp_dir / f"user_data_{key}"
            user_data_dir.mkdir(parents=True, exist_ok=True)

            cmd = [
                str(browser_bin),
                "--headless=old",
                "--no-sandbox",
                "--disable-gpu",
                "--hide-scrollbars",
                f"--user-data-dir={user_data_dir}",
                f"--screenshot={shot_file}",
                "--dump-dom",
                f"--window-size={width},{height}",
                file_url,
            ]

            try:
                proc = subprocess.run(
                    cmd,
                    capture_output=True,
                    timeout=timeout_seconds,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                )
                dom_output = proc.stdout or ""

                report: dict[str, Any] = {
                    "overflow": False,
                    "scroll_width": width,
                    "viewport_width": width,
                    "viewport_height": height,
                    "root_empty": False,
                    "title": "",
                    "errors": [],
                }

                report_match = re.search(
                    r'<script id="__singra_report_data__" type="application/json">\s*(\{.*?\})\s*</script>',
                    dom_output,
                    re.S,
                )
                if report_match:
                    try:
                        parsed = json.loads(report_match.group(1))
                        if isinstance(parsed, dict):
                            report.update(parsed)
                    except Exception:
                        pass

                b64_image: str | None = None
                if shot_file.is_file() and shot_file.stat().st_size > 0:
                    raw_bytes = shot_file.read_bytes()
                    b64_image = f"data:image/png;base64,{base64.b64encode(raw_bytes).decode('ascii')}"

                vp_issues: list[str] = []
                if report.get("overflow"):
                    diff = int(report.get("scroll_width", width)) - width
                    msg = (
                        f"Horizontaler Überlauf auf {vp_cfg['label']}: Der Inhalt ist {report.get('scroll_width')}px breit "
                        f"({diff}px breiter als das Display). Auf Smartphones führt dies zu unschönem seitlichen Wackeln."
                    )
                    vp_issues.append(msg)
                    all_issues.append(msg)

                if report.get("root_empty"):
                    msg = f"Vorschau ist leer auf {vp_cfg['label']}: Es wurden keine visuellen Elemente in #root gerendert."
                    vp_issues.append(msg)
                    all_issues.append(msg)

                for err in report.get("errors") or []:
                    msg = f"JavaScript-Fehler auf {vp_cfg['label']}: {err}"
                    vp_issues.append(msg)
                    all_issues.append(msg)

                results_by_vp[key] = {
                    "width": width,
                    "height": height,
                    "label": vp_cfg["label"],
                    "overflow": bool(report.get("overflow")),
                    "scroll_width": report.get("scroll_width", width),
                    "root_empty": bool(report.get("root_empty")),
                    "errors": report.get("errors", []),
                    "issues": vp_issues,
                    "screenshot_base64": b64_image,
                }
            except subprocess.TimeoutExpired:
                err_msg = f"Timeout beim Rendern der {vp_cfg['label']}-Vorschau nach {timeout_seconds}s."
                all_issues.append(err_msg)
                results_by_vp[key] = {
                    "width": width,
                    "height": height,
                    "label": vp_cfg["label"],
                    "overflow": False,
                    "scroll_width": width,
                    "root_empty": True,
                    "errors": [err_msg],
                    "issues": [err_msg],
                    "screenshot_base64": None,
                }

        summary_parts = []
        for k, v in results_by_vp.items():
            st = "OK" if not v["issues"] else f"Probleme: {len(v['issues'])}"
            summary_parts.append(f"{v['label']}: {st}")
        summary_text = " | ".join(summary_parts)

        return {
            "ok": len(all_issues) == 0,
            "browser_available": True,
            "browser_name": browser_bin.name,
            "viewports": results_by_vp,
            "issues": all_issues,
            "summary": summary_text,
        }
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

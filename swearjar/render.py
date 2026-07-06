"""
Swear Jar — rendering. Turns a stats dict into a self-contained HTML report.

Deliberately the ONLY module that knows about HTML. The engine produces data;
this turns data into a page. Swap this out to render anything else.
"""
import os, json, base64

# report_template.html lives at the repo root, one level above this package.
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_TEMPLATE = os.path.join(_ROOT, "report_template.html")

# Drop a logo at docs/logo.png (or .webp/.jpg/.svg) and it's embedded automatically.
_LOGO_CANDIDATES = ["docs/logo.png", "docs/logo.webp", "docs/logo.jpg", "docs/logo.svg"]
_MIME = {".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg",
         ".jpeg": "image/jpeg", ".svg": "image/svg+xml"}


def _embed_logo():
    """Return the logo as a self-contained data URI, or '' (falls back to the emoji)."""
    for rel in _LOGO_CANDIDATES:
        p = os.path.join(_ROOT, rel)
        if os.path.isfile(p):
            mime = _MIME.get(os.path.splitext(p)[1].lower(), "image/png")
            with open(p, "rb") as f:
                b64 = base64.b64encode(f.read()).decode("ascii")
            return f"data:{mime};base64,{b64}"
    return ""


def render_html(stats, template_path=DEFAULT_TEMPLATE):
    """Inject `stats` (plus an embedded logo, if present) into the template."""
    with open(template_path, encoding="utf-8") as f:
        template = f.read()
    payload = {**stats, "logo": _embed_logo()}
    return template.replace("/*__DATA__*/{}", json.dumps(payload))

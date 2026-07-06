"""
Swear Jar — rendering. Turns a stats dict into a self-contained HTML report.

Deliberately the ONLY module that knows about HTML. The engine produces data;
this turns data into a page. Swap this out to render anything else.
"""
import os, json

# report_template.html lives at the repo root, one level above this package.
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_TEMPLATE = os.path.join(_ROOT, "report_template.html")


def render_html(stats, template_path=DEFAULT_TEMPLATE):
    """Inject `stats` into the HTML template's data island and return the page."""
    with open(template_path, encoding="utf-8") as f:
        template = f.read()
    return template.replace("/*__DATA__*/{}", json.dumps(stats))

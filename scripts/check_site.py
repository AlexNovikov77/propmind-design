"""Check every public HTML file, local link, fragment and module import."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = [ROOT / 'index.html', *(ROOT / 'evidence').rglob('*.html'), *(ROOT / 'concepts').rglob('*.html'), *(ROOT / 'b24').rglob('*.html')]
errors = []


class Page(HTMLParser):
    def __init__(self, path):
        super().__init__(convert_charrefs=True)
        self.path, self.ids, self.links, self.title = path, set(), [], False
        self.lang, self.viewport = False, False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'html':
            self.lang = bool(a.get('lang'))
        if tag == 'title':
            self.title = True
        if tag == 'meta' and a.get('name') == 'viewport':
            self.viewport = True
        if a.get('id'):
            if a['id'] in self.ids:
                errors.append(f'{self.path.relative_to(ROOT)}: duplicate id {a["id"]}')
            self.ids.add(a['id'])
        for key in ('href', 'src'):
            if a.get(key):
                self.links.append(a[key])


pages = {}
for path in PUBLIC:
    parser = Page(path)
    parser.feed(path.read_text(encoding='utf-8'))
    pages[path] = parser
    for name in ('title', 'lang', 'viewport'):
        if not getattr(parser, name):
            errors.append(f'{path.relative_to(ROOT)}: missing {name}')

for path, page in pages.items():
    for link in page.links:
        url = urlsplit(link)
        if url.scheme or url.netloc:
            if url.scheme not in ('https', 'mailto', 'tel', 'data'):
                errors.append(f'{path.relative_to(ROOT)}: unsafe scheme {link}')
            continue
        if url.path.startswith('/'):
            errors.append(f'{path.relative_to(ROOT)}: root-absolute URL breaks project Pages: {link}')
            continue
        target = (path.parent / unquote(url.path)).resolve() if url.path else path
        if target.is_dir():
            target /= 'index.html'
        if not target.is_relative_to(ROOT) or not target.is_file():
            errors.append(f'{path.relative_to(ROOT)}: missing local target {link}')
        elif url.fragment and target in pages and unquote(url.fragment) not in pages[target].ids:
            errors.append(f'{path.relative_to(ROOT)}: missing anchor {link}')

for module in (ROOT / 'assets').glob('*.mjs'):
    subprocess.run(['node', '--check', str(module)], check=True)
    for imported in re.findall(r"from\s+['\"](\.[^'\"]+)['\"]", module.read_text()):
        if not (module.parent / imported).is_file():
            errors.append(f'{module.name}: missing import {imported}')

if errors:
    print('\n'.join(errors), file=sys.stderr)
    raise SystemExit(1)
print(f'OK: {len(pages)} HTML pages; local links, anchors and JavaScript modules checked.')

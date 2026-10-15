"""Serve public files on localhost under the real GitHub Pages project prefix."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
import argparse

ROOT = Path(__file__).resolve().parents[1]
PREFIX = '/propmind-design/'


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        url = urlsplit(self.path)
        if url.path in ('/', PREFIX[:-1]):
            self.send_response(302)
            self.send_header('Location', PREFIX)
            self.end_headers()
            return
        relative = unquote(url.path.removeprefix(PREFIX))
        parts = Path(relative).parts
        if not url.path.startswith(PREFIX) or any(p.startswith('.') for p in parts):
            self.send_error(404)
            return
        if relative and parts[0] not in ('index.html', 'assets', 'evidence', 'b24', 'concepts'):
            self.send_error(404)
            return
        target = (ROOT / relative).resolve()
        if not target.is_relative_to(ROOT) or (target.is_dir() and not (target / 'index.html').exists()):
            self.send_error(404)
            return
        if target.is_dir() and not url.path.endswith('/'):
            self.send_response(301)
            self.send_header('Location', url.path + '/' + (('?' + url.query) if url.query else ''))
            self.end_headers()
            return
        self.path = '/' + relative + (('?' + url.query) if url.query else '')
        super().do_GET()

    def do_HEAD(self):
        self.send_error(405)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8080)
    args = parser.parse_args()
    print(f'PropMind: http://127.0.0.1:{args.port}{PREFIX}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(ROOT))).serve_forever()

"""MIDNIGHT entry point: the polished music app, with optional Tkinter versions."""

from __future__ import annotations

import json
import errno
import mimetypes
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.error import URLError
from urllib.parse import quote, unquote, urlparse
from urllib.request import Request, urlopen

from services.youtube_service import YouTubeSearchError, search_music


PROJECT_ROOT = Path(__file__).resolve().parent
UI_ROOT = PROJECT_ROOT / "app" / "ui"
UI_PORT = 38427


class MusicAPI:
    """Small Python bridge used by the interface; the API key stays in Python."""

    def search(self, query: str) -> dict:
        query = str(query or "").strip()[:180]
        if not query:
            return {"items": [], "error": "Type a song, artist, or album to search."}
        try:
            return {"items": search_music(query, max_results=18), "error": ""}
        except YouTubeSearchError as exc:
            return {"items": [], "error": str(exc)}
        except Exception:
            return {"items": [], "error": "Search could not finish. Please try again."}

    def suggestions(self, query: str) -> list[str]:
        """Return YouTube query completions without spending Data API quota."""
        query = str(query or "").strip()[:100]
        if len(query) < 2:
            return []
        url = "https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=" + quote(query)
        request = Request(url, headers={"User-Agent": "MIDNIGHT-Desktop/1.0", "Accept": "application/json"})
        try:
            with urlopen(request, timeout=5) as response:
                payload = json.loads(response.read().decode("utf-8"))
            suggestions = payload[1] if isinstance(payload, list) and len(payload) > 1 else []
            return [str(item)[:140] for item in suggestions[:7] if str(item).strip()]
        except (URLError, TimeoutError, ValueError, UnicodeDecodeError):
            return []

def start_ui_server() -> ThreadingHTTPServer | None:
    """Serve local assets, reusing MIDNIGHT's existing server if already running."""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requested = unquote(urlparse(self.path).path).lstrip("/") or "index.html"
            target = (UI_ROOT / requested).resolve()
            if target != UI_ROOT and UI_ROOT not in target.parents:
                self.send_error(403)
                return
            if not target.is_file():
                self.send_error(404)
                return
            try:
                content = target.read_bytes()
            except OSError:
                self.send_error(404)
                return
            content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if content_type.startswith("text/") or content_type in ("application/javascript", "application/json"):
                content_type += "; charset=utf-8"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
            self.end_headers()
            self.wfile.write(content)

        def log_message(self, _format, *_args):
            return

    # Keep a stable origin for localStorage. If another MIDNIGHT instance owns
    # it already, share that server; if an unrelated program owns it, use a free port.
    try:
        server = ThreadingHTTPServer(("127.0.0.1", UI_PORT), Handler)
    except OSError as exc:
        if exc.errno != errno.EADDRINUSE:
            raise
        try:
            with urlopen(f"http://127.0.0.1:{UI_PORT}/", timeout=1) as response:
                existing_page = response.read(8192)
            if b"<title>MIDNIGHT" in existing_page:
                return None
        except (URLError, TimeoutError, OSError):
            pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    return server


def run_web_app() -> int:
    try:
        import webview
    except ImportError:
        print("MIDNIGHT needs its app packages. In the project terminal, run: python -m pip install -r requirements.txt")
        return 1

    if not (UI_ROOT / "index.html").is_file():
        print(f"The app interface is missing: {UI_ROOT / 'index.html'}")
        return 1

    server = start_ui_server()
    port = UI_PORT if server is None else server.server_port
    address = f"http://127.0.0.1:{port}/"
    webview.create_window(
        "MIDNIGHT — Music, after dark",
        address,
        js_api=MusicAPI(),
        width=1540,
        height=980,
        min_size=(1120, 740),
        background_color="#f1f2ff",
    )
    try:
        webview.start()
    finally:
        if server is not None:
            server.shutdown()
            server.server_close()
    return 0


def main() -> int:
    if sys.argv[1:] == ["--tkinter-app"]:
        from tkinter_music_app import MidnightMusicApp

        MidnightMusicApp().mainloop()
        return 0
    if sys.argv[1:] == ["--web-app"]:
        return run_web_app()
    return run_web_app()


if __name__ == "__main__":
    raise SystemExit(main())

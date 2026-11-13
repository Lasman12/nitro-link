"""Local web server for NITRO LINK (used by start.bat).

Same as `python -m http.server`, but tells the browser not to cache files,
so a normal refresh always loads the latest version of the game.
"""
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler) as httpd:
        print(f"NITRO LINK is running at http://localhost:{port}  (Ctrl+C to stop)")
        httpd.serve_forever()

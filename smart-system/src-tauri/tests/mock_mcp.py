"""Mock eines MCP-Servers über stdin/stdout — nur für die Rust-Tests.

`antwort` beantwortet jede Anfrage mit einer JSON-RPC-Antwort; `haengen`
liest und antwortet nie, damit die Frist greift.
"""

import json
import sys
import time


def main() -> None:
    modus = sys.argv[1] if len(sys.argv) > 1 else "antwort"
    for zeile in sys.stdin:
        zeile = zeile.strip()
        if not zeile:
            continue
        try:
            anfrage = json.loads(zeile)
        except json.JSONDecodeError:
            break
        if modus == "haengen":
            time.sleep(3600)
        kennung = anfrage.get("id")
        if kennung is None:
            continue
        methode = anfrage.get("method")
        if methode == "tools/list":
            ergebnis = {"tools": [{"name": "echo", "inputSchema": {"type": "object"}}]}
        else:
            ergebnis = {"protocolVersion": "2025-06-18", "capabilities": {}}
        print(json.dumps({"jsonrpc": "2.0", "id": kennung, "result": ergebnis}), flush=True)


if __name__ == "__main__":
    main()

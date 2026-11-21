"""Connect the Chai-Emet "Noga" server-side encryption to the satellite layers.

Noga encrypts on the server (AES-256-GCM, chip-signed, optional GNSS stamp)
and returns a token. Here that token becomes the innermost payload of the
satellite onion, so the message is protected by Noga, then by the end-to-end
layer, then by one layer per satellite. The receiving ground station peels the
satellite layers and asks Noga to decrypt the token.

The client mirrors the `mcp()` helper in the /home/crypt page: a JSON-RPC
`tools/call` POST to /mcp-engine/. Run it on the server, against the local
engine (e.g. base_url="http://127.0.0.1:4126"), not from a client: if the
query string or cookie carries the master key (`?k=...`), it ends up in URLs,
proxy logs and shell history. The Noga layer's AES key is derived from that
master key, so the end-to-end layer, which has its own keys, is the layer that
actually protects confidentiality until the master key is rotated.
"""

from __future__ import annotations

import json
import urllib.request

from satellite_crypt import Constellation, GroundStation

CHIP_MARK = "🔲"


class NogaError(Exception):
    pass


def parse_tool_response(payload: dict) -> dict:
    result = payload.get("result")
    if not result:
        raise NogaError((payload.get("error") or {}).get("message", "error"))
    text = result["content"][0]["text"]
    cut = text.find(CHIP_MARK)
    if cut > 0:
        text = text[:cut]
    if result.get("isError"):
        raise NogaError(text.strip())
    return json.loads(text.strip())


class NogaClient:
    def __init__(self, base_url: str = "https://chai-emet-5d.ai", query: str = "",
                 cookie: str | None = None, timeout: float = 15):
        self.base_url = base_url.rstrip("/")
        self.query = query if not query or query.startswith("?") else "?" + query
        self.cookie = cookie
        self.timeout = timeout

    def call(self, tool: str, arguments: dict) -> dict:
        body = json.dumps({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": tool, "arguments": arguments},
        }).encode()
        headers = {"content-type": "application/json"}
        if self.cookie:
            headers["cookie"] = self.cookie
        req = urllib.request.Request(
            f"{self.base_url}/mcp-engine/{self.query}", data=body, headers=headers, method="POST"
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            return parse_tool_response(json.load(resp))

    def encrypt(self, text: str, rakia: int = 0) -> dict:
        return self.call("noga_encrypt", {"text": text, "rakia": rakia})

    def decrypt(self, token: str) -> dict:
        return self.call("noga_decrypt", {"token": token})


def send_text(sky: Constellation, sender: GroundStation, receiver_id: str, text: str,
              noga, rakia: int = 0, paths: int = 2) -> tuple[list[dict], dict]:
    """Noga-encrypt `text`, then carry the token over the satellite onion."""
    sealed = noga.encrypt(text, rakia)
    results = sky.send(sender, receiver_id, sealed["token"].encode(), paths=paths)
    return results, sealed


def open_delivered(results: list[dict], noga) -> dict | None:
    """Take the first copy that arrived and ask Noga to decrypt it."""
    for r in results:
        delivered = r.get("delivered")
        if delivered:
            return noga.decrypt(delivered[2].decode())
    return None

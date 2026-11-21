import base64
import json
import unittest

import noga_bridge as nb
import satellite_crypt as sc


class FakeNoga:
    """Stands in for the server: the real one needs a logged-in session."""

    def encrypt(self, text, rakia=0):
        token = base64.b64encode(json.dumps({"t": text, "r": rakia}).encode()).decode()
        return {"token": token, "rakia": rakia}

    def decrypt(self, token):
        d = json.loads(base64.b64decode(token))
        return {"text": d["t"], "rakia": d["r"], "verified": True}


def tool_reply(obj, is_error=False, chip=True):
    text = json.dumps(obj) if isinstance(obj, dict) else obj
    if chip:
        text += "\n🔲 chip-sealed"
    return {"result": {"content": [{"type": "text", "text": text}], "isError": is_error}}


class ParseTest(unittest.TestCase):
    def test_strips_chip_suffix(self):
        self.assertEqual(nb.parse_tool_response(tool_reply({"token": "abc"})), {"token": "abc"})

    def test_tool_error(self):
        with self.assertRaises(nb.NogaError):
            nb.parse_tool_response(tool_reply("bad token", is_error=True))

    def test_rpc_error(self):
        with self.assertRaises(nb.NogaError):
            nb.parse_tool_response({"error": {"message": "unauthorized"}})


class BridgeTest(unittest.TestCase):
    def test_round_trip_over_satellites(self):
        sky = sc.Constellation(planes=6, per_plane=11)
        a = sky.add_ground_station("GS-A", ["P0-S0", "P1-S0"])
        sky.add_ground_station("GS-B", ["P3-S5", "P4-S5"])
        noga = FakeNoga()
        results, sealed = nb.send_text(sky, a, "GS-B", "שלום", noga, rakia=3)
        self.assertEqual(len(results), 2)
        out = nb.open_delivered(results, noga)
        self.assertEqual((out["text"], out["rakia"]), ("שלום", 3))

    def test_client_builds_request_url(self):
        c = nb.NogaClient("https://example.test/", query="k=1")
        self.assertEqual(c.query, "?k=1")
        self.assertEqual(c.base_url, "https://example.test")


if __name__ == "__main__":
    unittest.main()

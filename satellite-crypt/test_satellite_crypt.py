import time
import unittest

import satellite_crypt as sc


class SatelliteCryptTest(unittest.TestCase):
    def setUp(self):
        self.sky = sc.Constellation(planes=6, per_plane=11)
        self.a = self.sky.add_ground_station("GS-A", ["P0-S0", "P1-S0"])
        self.b = self.sky.add_ground_station("GS-B", ["P3-S5", "P4-S5"])

    def test_delivers_over_two_disjoint_routes_and_dedupes(self):
        results = self.sky.send(self.a, "GS-B", b"hello", paths=2)
        self.assertEqual(len(results), 2)
        interiors = [set(r["route"][:-1]) for r in results]
        self.assertFalse(interiors[0] & interiors[1])
        delivered = [r["delivered"] for r in results]
        self.assertEqual(delivered[0][0], "GS-A")
        self.assertEqual(delivered[0][2], b"hello")
        self.assertIsNone(delivered[1])

    def test_satellite_cannot_open_other_layers(self):
        route = self.sky.find_routes("GS-A", "GS-B", min_sats=3)[0]
        packet = sc.build_onion(route, self.sky.directory, b"x" * 40)
        second = self.sky.nodes[route[1]]
        with self.assertRaises(sc.CryptError):
            second.peel(packet)

    def test_each_hop_learns_only_next_hop(self):
        route = self.sky.find_routes("GS-A", "GS-B", min_sats=3)[0]
        packet = sc.build_onion(route, self.sky.directory, b"payload")
        for i, hop in enumerate(route[:-1]):
            kind, nxt, packet = self.sky.nodes[hop].peel(packet)
            self.assertEqual(kind, sc.RELAY)
            self.assertEqual(nxt, route[i + 1])
            self.assertNotIn(b"payload", packet)
        kind, _, body = self.sky.nodes[route[-1]].peel(packet)
        self.assertEqual((kind, body), (sc.DELIVER, b"payload"))

    def test_tampering_is_detected(self):
        route = self.sky.find_routes("GS-A", "GS-B")[0]
        packet = bytearray(sc.build_onion(route, self.sky.directory, b"p"))
        packet[-1] ^= 1
        with self.assertRaises(sc.CryptError):
            self.sky.nodes[route[0]].peel(bytes(packet))

    def test_replay_rejected(self):
        route = self.sky.find_routes("GS-A", "GS-B")[0]
        packet = sc.build_onion(route, self.sky.directory, b"p")
        self.sky.nodes[route[0]].peel(packet)
        with self.assertRaises(sc.ReplayError):
            self.sky.nodes[route[0]].peel(packet)

    def test_forged_sender_rejected(self):
        mallory = sc.GroundStation("GS-M")
        env = mallory.make_envelope("GS-B", b"evil", b"\0" * 16)
        env = sc._enc_id("GS-A") + env[sc.ID_LEN:]
        with self.assertRaises(sc.CryptError):
            self.b.open_envelope(env, self.sky.directory)

    def test_reroutes_around_failed_satellite(self):
        self.sky.failed.add("P1-S0")
        results = self.sky.send(self.a, "GS-B", b"ok", paths=2)
        self.assertTrue(results)
        for r in results:
            self.assertNotIn("P1-S0", r["route"])
        self.assertEqual(results[0]["delivered"][2], b"ok")

    def test_unreachable_destination_fails_fast(self):
        sky = sc.Constellation(planes=24, per_plane=24)
        sky.add_ground_station("GS-A", ["P0-S0"])
        sky.add_ground_station("GS-Z", [])
        start = time.monotonic()
        with self.assertRaises(sc.RoutingError):
            sky.find_routes("GS-A", "GS-Z", count=2, min_sats=5)
        self.assertLess(time.monotonic() - start, 2.0)

    def test_min_sats_respected_when_shortest_is_shorter(self):
        self.sky.add_ground_station("GS-C", ["P0-S1"])
        route = self.sky.find_routes("GS-A", "GS-C", min_sats=4)[0]
        self.assertGreaterEqual(len(route) - 1, 4)
        self.assertEqual(len(route), len(set(route)))
        prev = "GS-A"
        for hop in route:
            self.assertIn(hop, self.sky.links[prev])
            prev = hop

    def test_large_constellation_routes_quickly(self):
        sky = sc.Constellation(planes=40, per_plane=40)
        a = sky.add_ground_station("GS-A", ["P0-S0"])
        sky.add_ground_station("GS-B", ["P20-S20"])
        start = time.monotonic()
        results = sky.send(a, "GS-B", b"far", paths=2)
        self.assertLess(time.monotonic() - start, 5.0)
        self.assertEqual(results[0]["delivered"][2], b"far")

    def test_padding_hides_exact_length(self):
        self.assertEqual(len(sc.pad(b"a")), len(sc.pad(b"a" * 200)))
        self.assertEqual(sc.unpad(sc.pad(b"abc")), b"abc")


if __name__ == "__main__":
    unittest.main()

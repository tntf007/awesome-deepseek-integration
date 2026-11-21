"""Layered (onion) encryption over a satellite constellation.

Every satellite and ground station holds an X25519 key. The sender wraps the
message once per hop, innermost layer first, so each satellite can remove only
its own layer and learns only the previous and next hop. The innermost layer
is addressed to the receiving ground station and carries an Ed25519 signature
from the sender, giving end-to-end confidentiality and sender authentication
on top of the per-hop layers. The same message can be sent over several
node-disjoint routes so one failed or compromised satellite does not stop it.
"""

from __future__ import annotations

import os
import secrets
import struct
from collections import deque
from dataclasses import dataclass

from cryptography.exceptions import InvalidSignature, InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.asymmetric.x25519 import (
    X25519PrivateKey,
    X25519PublicKey,
)
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

PROTO = b"sat-onion-v1"
ID_LEN = 16
MSG_ID_LEN = 16
SIG_LEN = 64
PAD_BLOCK = 256
RELAY = 1
DELIVER = 2


class CryptError(Exception):
    pass


class ReplayError(CryptError):
    pass


class RoutingError(Exception):
    pass


def _raw(pub: X25519PublicKey | Ed25519PublicKey) -> bytes:
    return pub.public_bytes(Encoding.Raw, PublicFormat.Raw)


def _enc_id(node_id: str) -> bytes:
    data = node_id.encode()
    if len(data) > ID_LEN:
        raise ValueError(f"node id longer than {ID_LEN} bytes: {node_id!r}")
    return data.ljust(ID_LEN, b"\0")


def _dec_id(data: bytes) -> str:
    return data.rstrip(b"\0").decode()


def _layer_key(shared: bytes, eph_pub: bytes, node_pub: bytes) -> bytes:
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=eph_pub + node_pub,
        info=PROTO + b"/layer",
    ).derive(shared)


def seal_layer(recipient: X25519PublicKey, plaintext: bytes, aad: bytes) -> bytes:
    """eph_pub(32) | nonce(12) | ChaCha20-Poly1305 ciphertext+tag."""
    eph = X25519PrivateKey.generate()
    eph_pub = _raw(eph.public_key())
    key = _layer_key(eph.exchange(recipient), eph_pub, _raw(recipient))
    nonce = os.urandom(12)
    return eph_pub + nonce + ChaCha20Poly1305(key).encrypt(nonce, plaintext, aad)


def open_layer(priv: X25519PrivateKey, blob: bytes, aad: bytes) -> tuple[bytes, bytes]:
    if len(blob) < 32 + 12 + 16:
        raise CryptError("packet too short")
    eph_pub, nonce, ct = blob[:32], blob[32:44], blob[44:]
    key = _layer_key(
        priv.exchange(X25519PublicKey.from_public_bytes(eph_pub)),
        eph_pub,
        _raw(priv.public_key()),
    )
    try:
        return eph_pub, ChaCha20Poly1305(key).decrypt(nonce, ct, aad)
    except InvalidTag as exc:
        raise CryptError("layer authentication failed") from exc


def pad(message: bytes) -> bytes:
    body = struct.pack(">I", len(message)) + message
    return body + b"\0" * (-len(body) % PAD_BLOCK)


def unpad(data: bytes) -> bytes:
    (length,) = struct.unpack(">I", data[:4])
    if length > len(data) - 4:
        raise CryptError("bad padding")
    return data[4 : 4 + length]


class Node:
    """A satellite: peels exactly one layer and forwards."""

    def __init__(self, node_id: str):
        _enc_id(node_id)
        self.id = node_id
        self._priv = X25519PrivateKey.generate()
        self.public_key = self._priv.public_key()
        self._seen: set[bytes] = set()

    def peel(self, packet: bytes) -> tuple[int, str, bytes]:
        if packet[:32] in self._seen:
            raise ReplayError(f"{self.id}: replayed packet")
        eph_pub, pt = open_layer(self._priv, packet, _enc_id(self.id))
        self._seen.add(eph_pub)
        return pt[0], _dec_id(pt[1 : 1 + ID_LEN]), pt[1 + ID_LEN :]


class GroundStation(Node):
    """Endpoint: also signs outgoing messages and verifies incoming ones."""

    def __init__(self, node_id: str):
        super().__init__(node_id)
        self._sign = Ed25519PrivateKey.generate()
        self.signing_key = self._sign.public_key()
        self._delivered: set[bytes] = set()

    def make_envelope(self, recipient_id: str, message: bytes, msg_id: bytes) -> bytes:
        padded = pad(message)
        sig = self._sign.sign(
            PROTO + _enc_id(self.id) + _enc_id(recipient_id) + msg_id + padded
        )
        return _enc_id(self.id) + msg_id + sig + padded

    def open_envelope(self, envelope: bytes, directory: "Directory") -> tuple[str, bytes, bytes] | None:
        """Returns (sender, msg_id, message), or None for a duplicate copy."""
        sender = _dec_id(envelope[:ID_LEN])
        msg_id = envelope[ID_LEN : ID_LEN + MSG_ID_LEN]
        sig = envelope[ID_LEN + MSG_ID_LEN : ID_LEN + MSG_ID_LEN + SIG_LEN]
        padded = envelope[ID_LEN + MSG_ID_LEN + SIG_LEN :]
        try:
            directory.signing_key(sender).verify(
                sig, PROTO + _enc_id(sender) + _enc_id(self.id) + msg_id + padded
            )
        except InvalidSignature as exc:
            raise CryptError("sender signature invalid") from exc
        if msg_id in self._delivered:
            return None
        self._delivered.add(msg_id)
        return sender, msg_id, unpad(padded)


@dataclass
class Directory:
    """Public keys of every node. Distribute it over an authenticated channel."""

    nodes: dict[str, Node]

    def public_key(self, node_id: str) -> X25519PublicKey:
        return self.nodes[node_id].public_key

    def signing_key(self, node_id: str) -> Ed25519PublicKey:
        node = self.nodes.get(node_id)
        if not isinstance(node, GroundStation):
            raise CryptError(f"unknown sender {node_id!r}")
        return node.signing_key


def build_onion(route: list[str], directory: Directory, final_payload: bytes) -> bytes:
    """route = [first satellite, ..., last satellite, receiving ground station]."""
    if len(route) < 2:
        raise RoutingError("route needs at least one satellite and a receiver")
    dest = route[-1]
    packet = seal_layer(
        directory.public_key(dest),
        bytes([DELIVER]) + _enc_id("") + final_payload,
        _enc_id(dest),
    )
    for hop, nxt in zip(reversed(route[:-1]), reversed(route[1:])):
        packet = seal_layer(
            directory.public_key(hop),
            bytes([RELAY]) + _enc_id(nxt) + packet,
            _enc_id(hop),
        )
    return packet


class Constellation:
    """A Walker-style grid: `planes` orbital planes x `per_plane` satellites.

    Each satellite links to its two in-plane neighbours and the satellite in
    the same slot of the adjacent planes. Ground stations link to the
    satellites they can currently see.
    """

    def __init__(self, planes: int, per_plane: int):
        self.planes, self.per_plane = planes, per_plane
        self.nodes: dict[str, Node] = {}
        self.links: dict[str, set[str]] = {}
        for p in range(planes):
            for s in range(per_plane):
                self._add(Node(self.sat_id(p, s)))
        for p in range(planes):
            for s in range(per_plane):
                me = self.sat_id(p, s)
                self.link(me, self.sat_id(p, (s + 1) % per_plane))
                if planes > 1:
                    self.link(me, self.sat_id((p + 1) % planes, s))
        self.directory = Directory(self.nodes)
        self.failed: set[str] = set()

    @staticmethod
    def sat_id(plane: int, slot: int) -> str:
        return f"P{plane}-S{slot}"

    def _add(self, node: Node) -> None:
        if node.id in self.nodes:
            raise ValueError(f"duplicate node id {node.id}")
        self.nodes[node.id] = node
        self.links[node.id] = set()

    def link(self, a: str, b: str) -> None:
        if a != b:
            self.links[a].add(b)
            self.links[b].add(a)

    def add_ground_station(self, gs_id: str, visible: list[str]) -> GroundStation:
        gs = GroundStation(gs_id)
        self._add(gs)
        for sat in visible:
            self.link(gs_id, sat)
        return gs

    def find_routes(self, src: str, dst: str, count: int = 1, min_sats: int = 1) -> list[list[str]]:
        """Up to `count` node-disjoint satellite routes from src to dst.

        Returned routes exclude src and include dst. Neighbour order is
        shuffled so repeated sends do not always take the same path.
        """
        rng = secrets.SystemRandom()
        used: set[str] = set()
        routes: list[list[str]] = []
        for _ in range(count):
            route = self._bfs(src, dst, used, rng, min_sats)
            if route is None:
                break
            routes.append(route)
            used.update(route[:-1])
        if not routes:
            raise RoutingError(f"no route from {src} to {dst}")
        return routes

    def _bfs(self, src, dst, banned, rng, min_sats):
        """Shortest simple route with at least `min_sats` satellites.

        Searches states (node, satellites so far capped at min_sats) with a
        visited set, so work is bounded by nodes x min_sats even when dst is
        unreachable.
        """
        start = (src, 0)
        parent = {start: None}
        queue = deque([start])
        while queue:
            state = queue.popleft()
            node, depth = state
            path = self._path_to(state, parent)
            neighbours = list(self.links[node])
            rng.shuffle(neighbours)
            for nxt in neighbours:
                if nxt in path or nxt in banned or nxt in self.failed:
                    continue
                if nxt == dst:
                    if depth >= min_sats:
                        return path[1:] + [dst]
                    continue
                if isinstance(self.nodes[nxt], GroundStation):
                    continue
                child = (nxt, min(depth + 1, min_sats))
                if child not in parent:
                    parent[child] = state
                    queue.append(child)
        return None

    @staticmethod
    def _path_to(state, parent) -> list[str]:
        path = []
        while state is not None:
            path.append(state[0])
            state = parent[state]
        return path[::-1]

    def send(self, sender: GroundStation, receiver_id: str, message: bytes,
             paths: int = 2, min_sats: int = 3) -> list[dict]:
        """Encrypt and transmit over up to `paths` disjoint routes."""
        msg_id = os.urandom(MSG_ID_LEN)
        envelope = sender.make_envelope(receiver_id, message, msg_id)
        sealed = seal_layer(
            self.directory.public_key(receiver_id), envelope, PROTO + b"/e2e"
        )
        results = []
        for route in self.find_routes(sender.id, receiver_id, paths, min_sats):
            packet = build_onion(route, self.directory, sealed)
            results.append(self.transmit(sender.id, route, packet))
        return results

    def transmit(self, sender_id: str, route: list[str], packet: bytes) -> dict:
        """Carry a packet hop by hop. Each node only sees its own layer."""
        trace, current, next_id = [sender_id], sender_id, route[0]
        while True:
            if next_id not in self.links[current]:
                return {"route": route, "trace": trace, "error": f"no link {current}->{next_id}"}
            if next_id in self.failed:
                return {"route": route, "trace": trace, "error": f"{next_id} is down"}
            node = self.nodes[next_id]
            kind, forward_to, packet = node.peel(packet)
            trace.append(node.id)
            current = node.id
            if kind == DELIVER:
                return {"route": route, "trace": trace, "delivered": self._deliver(node, packet)}
            if kind != RELAY:
                raise CryptError(f"unknown layer type {kind}")
            next_id = forward_to

    def _deliver(self, gs: Node, sealed: bytes):
        if not isinstance(gs, GroundStation):
            raise CryptError(f"{gs.id} is not a ground station")
        _, envelope = open_layer(gs._priv, sealed, PROTO + b"/e2e")
        return gs.open_envelope(envelope, self.directory)


def _show(results: list[dict]) -> None:
    for r in results:
        if "error" in r:
            outcome = "ERROR: " + r["error"]
        elif r["delivered"] is None:
            outcome = "duplicate copy (dropped)"
        else:
            sender, _, message = r["delivered"]
            outcome = f"from {sender}: {message.decode(errors='replace')}"
        print("  " + " -> ".join(r["trace"]) + "  |  " + outcome)


def demo() -> None:
    sky = Constellation(planes=6, per_plane=11)
    alice = sky.add_ground_station("GS-A", ["P0-S0", "P1-S0"])
    sky.add_ground_station("GS-B", ["P3-S5", "P4-S5"])

    print("Two disjoint routes:")
    _show(sky.send(alice, "GS-B", "שלום מהלוויין".encode(), paths=2))

    sky.failed.add("P1-S0")
    print("With P1-S0 down:")
    _show(sky.send(alice, "GS-B", b"still connected", paths=2))


if __name__ == "__main__":
    demo()

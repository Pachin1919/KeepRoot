"""Text-only Gemini share RPC decoding; no networking or media extraction.

Framing and positional paths adapted from convolvger, commit
8bffa6767bbff442716a65cf3477084162b009b1 (MIT).
Copyright (c) 2026 Fahad Bilal Saleem.
See assets/licenses/convolvger-LICENSE.txt in the distribution.
"""

import json
import sys

LIMIT = 8 * 1024 * 1024
INPUT_LIMIT = 16 * 1024 * 1024
PREFIX = ")]}'"


def _invalid_constant(_value):
    raise ValueError("Invalid JSON constant")


def _at(node, *indices):
    for index in indices:
        if not isinstance(node, list) or len(node) <= index:
            return None
        node = node[index]
    return node


def parse(body, share_id):
    if (not isinstance(body, str) or len(body.encode("utf-8")) > LIMIT
            or not body.startswith(PREFIX) or not isinstance(share_id, str)
            or not 1 <= len(share_id) <= 256 or any(ord(c) < 32 for c in share_id)):
        raise ValueError("Invalid request")
    decoder = json.JSONDecoder(parse_constant=_invalid_constant)
    position = len(PREFIX)
    payloads = []
    frames = 0
    while position < len(body):
        while position < len(body) and body[position].isspace():
            position += 1
        # Gemini's frame length is a UTF-16 count plus surrounding newlines.
        # Decode the JSON document itself rather than slicing using that count.
        length_start = position
        while position < len(body) and body[position] in "0123456789":
            position += 1
        has_length = position > length_start
        while position < len(body) and body[position].isspace():
            position += 1
        if position == len(body):
            if has_length:
                raise ValueError("Missing frame")
            break
        rows, position = decoder.raw_decode(body, position)
        frames += 1
        if not isinstance(rows, list):
            raise ValueError("Invalid frame")
        for row in rows:
            if not isinstance(row, list) or not row:
                raise ValueError("Invalid row")
            if row[0] != "wrb.fr":
                continue
            if len(row) < 3 or not isinstance(row[1], str) or not isinstance(row[2], (str, type(None))):
                raise ValueError("Invalid RPC")
            if row[1] == "ujx1Bf":
                payloads.append(None if row[2] is None else json.loads(row[2], parse_constant=_invalid_constant))
    if not frames or len(payloads) != 1 or payloads[0] is None:
        raise ValueError("Missing conversation")
    root = _at(payloads[0], 0)
    turns = _at(root, 1)
    if not isinstance(turns, list) or not turns or _at(root, 3) != share_id:
        raise ValueError("Invalid conversation")
    messages = []
    for turn in turns:
        prompt = _at(turn, 2, 0, 0)
        answer = _at(turn, 3, 0, 0, 1, 0)
        if not isinstance(prompt, str) or not prompt.strip() or not isinstance(answer, str) or not answer.strip():
            raise ValueError("Incomplete turn")
        for role, content in (("user", prompt), ("assistant", answer)):
            messages.append({"message_id": None, "parent_message_id": None,
                             "role": role, "content": content})
    title = _at(root, 2, 1)
    return {"schema": "keeproot.gemini-share.v1", "title": title if isinstance(title, str) else None,
            "conversation_id": share_id, "messages": messages, "completeness": "shared_text_only"}


def main():
    try:
        # Bound the outer JSON separately from its decoded RPC body.
        raw = sys.stdin.buffer.read(INPUT_LIMIT + 1)
        if len(raw) > INPUT_LIMIT:
            raise ValueError("Oversized request")
        request = json.loads(raw.decode("utf-8"), parse_constant=_invalid_constant)
        if not isinstance(request, dict):
            raise ValueError("Invalid request")
        result = parse(request.get("body"), request.get("share_id"))
        output = json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(output) > LIMIT:
            raise ValueError("Oversized output")
        sys.stdout.buffer.write(output)
    except Exception:
        # Never print provider content, interpreter diagnostics, or partial text.
        sys.stderr.write("format_unrecognized\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

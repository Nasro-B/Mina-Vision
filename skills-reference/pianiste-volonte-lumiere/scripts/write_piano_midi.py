#!/usr/bin/env python3
"""Convert a compact piano-performance JSON document to a Standard MIDI file."""

from __future__ import annotations

import json
import math
import re
import struct
import sys
from pathlib import Path


NOTE_RE = re.compile(r"^([A-Ga-g])([#b]?)(-1|[0-9])$")
PITCH_CLASSES = {
    "C": 0,
    "D": 2,
    "E": 4,
    "F": 5,
    "G": 7,
    "A": 9,
    "B": 11,
}


def fail(message: str) -> "NoReturn":
    raise ValueError(message)


def vlq(value: int) -> bytes:
    if value < 0:
        fail("MIDI delta time cannot be negative")
    buffer = value & 0x7F
    output = bytearray([buffer])
    while value >> 7:
        value >>= 7
        buffer = (value & 0x7F) | 0x80
        output.insert(0, buffer)
    return bytes(output)


def midi_pitch(value: str | int) -> int:
    if isinstance(value, int):
        pitch = value
    elif isinstance(value, str):
        match = NOTE_RE.fullmatch(value.strip())
        if not match:
            fail(f"Invalid pitch: {value!r}")
        letter, accidental, octave_text = match.groups()
        pitch = (int(octave_text) + 1) * 12 + PITCH_CLASSES[letter.upper()]
        pitch += 1 if accidental == "#" else -1 if accidental == "b" else 0
    else:
        fail(f"Pitch must be a note name or integer, got {value!r}")
    if not 0 <= pitch <= 127:
        fail(f"Pitch out of MIDI range: {value!r}")
    return pitch


def bounded_int(value: object, field: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        fail(f"{field} must be numeric")
    result = int(value)
    if result != value or not minimum <= result <= maximum:
        fail(f"{field} must be an integer from {minimum} to {maximum}")
    return result


def beat_to_tick(value: object, field: str, ticks_per_beat: int) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        fail(f"{field} must be numeric")
    number = float(value)
    if not math.isfinite(number) or number < 0:
        fail(f"{field} must be finite and non-negative")
    return round(number * ticks_per_beat)


def meta_event(kind: int, payload: bytes) -> bytes:
    return bytes([0xFF, kind]) + vlq(len(payload)) + payload


def build_track(data: dict) -> tuple[bytes, int, float]:
    tempo = float(data.get("tempo_bpm", 72))
    if not math.isfinite(tempo) or not 20 <= tempo <= 300:
        fail("tempo_bpm must be from 20 to 300")

    ticks = bounded_int(data.get("ticks_per_beat", 480), "ticks_per_beat", 96, 9600)
    program = bounded_int(data.get("program", 0), "program", 0, 127)
    signature = data.get("time_signature", [4, 4])
    if (
        not isinstance(signature, list)
        or len(signature) != 2
        or signature[1] not in (1, 2, 4, 8, 16, 32)
    ):
        fail("time_signature must be [numerator, denominator]")
    numerator = bounded_int(signature[0], "time_signature numerator", 1, 32)
    denominator = int(signature[1])
    denominator_power = int(math.log2(denominator))

    title = str(data.get("title", "Piano")).encode("utf-8")
    microseconds = round(60_000_000 / tempo)
    events: list[tuple[int, int, bytes]] = [
        (0, 0, meta_event(0x03, title)),
        (0, 0, meta_event(0x51, microseconds.to_bytes(3, "big"))),
        (0, 0, meta_event(0x58, bytes([numerator, denominator_power, 24, 8]))),
        (0, 0, bytes([0xC0, program])),
    ]

    notes = data.get("notes")
    if not isinstance(notes, list) or not notes:
        fail("notes must be a non-empty array")

    final_tick = 0
    for index, note in enumerate(notes):
        if not isinstance(note, dict):
            fail(f"notes[{index}] must be an object")
        pitch = midi_pitch(note.get("pitch"))
        start = beat_to_tick(note.get("start"), f"notes[{index}].start", ticks)
        duration = beat_to_tick(note.get("duration"), f"notes[{index}].duration", ticks)
        if duration <= 0:
            fail(f"notes[{index}].duration must be positive")
        velocity = bounded_int(note.get("velocity", 72), f"notes[{index}].velocity", 1, 127)
        end = start + duration
        events.append((start, 3, bytes([0x90, pitch, velocity])))
        events.append((end, 2, bytes([0x80, pitch, 0])))
        final_tick = max(final_tick, end)

    pedal_items = data.get("pedal", [])
    if not isinstance(pedal_items, list):
        fail("pedal must be an array")
    for index, pedal in enumerate(pedal_items):
        if not isinstance(pedal, dict):
            fail(f"pedal[{index}] must be an object")
        start = beat_to_tick(pedal.get("start"), f"pedal[{index}].start", ticks)
        duration = beat_to_tick(pedal.get("duration"), f"pedal[{index}].duration", ticks)
        if duration <= 0:
            fail(f"pedal[{index}].duration must be positive")
        value = bounded_int(pedal.get("value", 96), f"pedal[{index}].value", 64, 127)
        end = start + duration
        events.append((start, 1, bytes([0xB0, 64, value])))
        events.append((end, 1, bytes([0xB0, 64, 0])))
        final_tick = max(final_tick, end)

    events.sort(key=lambda item: (item[0], item[1]))
    track = bytearray()
    previous_tick = 0
    for event_tick, _, payload in events:
        track.extend(vlq(event_tick - previous_tick))
        track.extend(payload)
        previous_tick = event_tick
    track.extend(vlq(max(1, final_tick - previous_tick + 1)))
    track.extend(meta_event(0x2F, b""))
    return bytes(track), ticks, tempo


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: write_piano_midi.py INPUT.json OUTPUT.mid", file=sys.stderr)
        return 2

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    try:
        data = json.loads(input_path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            fail("The JSON root must be an object")
        track, ticks, tempo = build_track(data)
        header = b"MThd" + struct.pack(">IHHH", 6, 0, 1, ticks)
        midi = header + b"MTrk" + struct.pack(">I", len(track)) + track
        output_path.write_bytes(midi)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    print(
        f"Created {output_path} | notes={len(data['notes'])} "
        f"| tempo={tempo:g} BPM | ticks_per_beat={ticks} | bytes={len(midi)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

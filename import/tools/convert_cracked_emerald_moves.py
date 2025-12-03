#!/usr/bin/env python3
"""
Convert cracked-emerald moves (moves_info.h) into calc-style move definitions.

Usage:
  python import/tools/convert_cracked_emerald_moves.py \
      --emerald-dir ../cracked-emerald \
      --out import/dist/cracked-emerald-moves.json
"""

import argparse
import json
import os
import re
import sys
from typing import Any, Dict, List, Optional


def load_helpers(emerald_dir: str):
    species_dir = os.path.join(emerald_dir, "src", "data", "pokemon", "species_info")
    sys.path.insert(0, species_dir)
    try:
        import parse_species as ce  # type: ignore
    except ImportError as exc:  # pragma: no cover
        raise SystemExit(f"Could not import parse_species from {species_dir}: {exc}")
    return ce


def eval_int(expr: str) -> Optional[int]:
    expr = expr.strip()
    expr = expr.replace("TRUE", "1").replace("FALSE", "0")
    expr = re.sub(r"GEN_(\d+)", r"\1", expr)

    defaults = {
        "B_UPDATED_MOVE_DATA": "9",
        "B_UPDATED_MOVE_FLAGS": "9",
        "B_EXTRAPOLATED_MOVE_FLAGS": "1",
    }

    def repl(match):
        token = match.group(0)
        return defaults.get(token, "0")

    expr = re.sub(r"\b[A-Z][A-Z0-9_]*\b", repl, expr)
    try:
        return int(eval(expr))
    except Exception:
        return None


def parse_move_block(lines: List[str], type_map: Dict[str, str]) -> Optional[Dict[str, Any]]:
    fields: Dict[str, Any] = {}
    text_block = "\n".join(lines)

    # Name
    m = re.search(r'\.name\s*=\s*COMPOUND_STRING\("([^"]+)"\)', text_block)
    if not m:
        return None
    name = m.group(1).strip()
    fields["name"] = name

    capture_keys = {
        "power": "bp",
        "type": "type",
        "category": "category",
        "priority": "priority",
        "makesContact": "contact",
        "punchingMove": "isPunch",
        "bitingMove": "isBite",
        "soundMove": "isSound",
        "ballisticMove": "isBullet",
        "pulseMove": "isPulse",
        "slicingMove": "isSlicing",
        "windMove": "isWind",
        "strikeCount": "strikeCount",
        "effect": "effect",
    }

    seen = set()
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"\.(\w+)\s*=\s*([^,]+)", line)
        if not m:
            continue
        key, raw_val = m.group(1), m.group(2).strip()
        if key not in capture_keys or key in seen:
            continue
        seen.add(key)
        out_key = capture_keys[key]
        if key == "type":
            fields[out_key] = type_map.get(raw_val, raw_val)
        elif key == "category":
            if "PHYSICAL" in raw_val:
                fields[out_key] = "Physical"
            elif "SPECIAL" in raw_val:
                fields[out_key] = "Special"
            else:
                fields[out_key] = "Status"
        elif key in ("makesContact", "punchingMove", "bitingMove", "soundMove", "ballisticMove", "pulseMove", "slicingMove", "windMove"):
            fields[out_key] = raw_val.startswith("TRUE")
        elif key in ("power", "priority", "strikeCount"):
            num = eval_int(raw_val)
            if num is not None:
                fields[out_key] = num
        elif key == "effect":
            fields[out_key] = raw_val

    # Argument parsing for recoil/drain.
    m_recoil = re.search(r"recoilPercentage\s*=\s*(\d+)", text_block)
    if m_recoil:
        fields["recoil"] = int(m_recoil.group(1))
    m_absorb = re.search(r"absorbPercentage\s*=\s*(\d+)", text_block)
    if m_absorb:
        fields["drain"] = int(m_absorb.group(1))

    return fields


def build_moves(emerald_dir: str, ce) -> Dict[str, Dict[str, Any]]:
    moves_path = os.path.join(emerald_dir, "src", "data", "moves_info.h")
    with open(moves_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    moves: Dict[str, Dict[str, Any]] = {}
    i = 0
    total = len(lines)
    while i < total:
        line = lines[i]
        m = re.match(r"\s*\[\s*MOVE_([A-Z0-9_]+)\s*\]\s*=", line)
        if not m:
            i += 1
            continue
        i += 1
        # Find opening brace
        while i < total and "{" not in lines[i]:
            i += 1
        if i >= total:
            break
        brace_count = 0
        block_lines: List[str] = []
        while i < total:
            brace_count += lines[i].count("{") - lines[i].count("}")
            block_lines.append(lines[i])
            i += 1
            if brace_count <= 0:
                break

        parsed = parse_move_block(block_lines, ce.TYPE_MAPPING)
        if not parsed:
            continue
        name = parsed.pop("name")
        move_obj: Dict[str, Any] = {}
        bp = parsed.get("bp")
        if bp is not None:
            move_obj["bp"] = bp
        move_type = parsed.get("type")
        if move_type:
            move_obj["type"] = move_type
        category = parsed.get("category")
        if category:
            move_obj["category"] = category
        priority = parsed.get("priority")
        if priority:
            move_obj["priority"] = priority

        flags: Dict[str, int] = {}
        if parsed.get("contact"):
            flags["makesContact"] = True
        if parsed.get("isPunch"):
            flags["isPunch"] = True
        if parsed.get("isBite"):
            flags["isBite"] = True
        if parsed.get("isSound"):
            flags["isSound"] = True
        if parsed.get("isBullet"):
            flags["isBullet"] = True
        if parsed.get("isPulse"):
            flags["isPulse"] = True
        if parsed.get("isSlicing"):
            flags["isSlicing"] = True
        if parsed.get("isWind"):
            flags["isWind"] = True
        move_obj.update(flags)

        # Multihit
        multihit = None
        if parsed.get("strikeCount"):
            multihit = parsed["strikeCount"]
        elif parsed.get("effect") == "EFFECT_MULTI_HIT":
            multihit = [2, 5]
        if multihit:
            move_obj["multihit"] = multihit

        # Drain / recoil
        if parsed.get("drain"):
            move_obj["drain"] = [parsed["drain"], 100]
        if parsed.get("recoil"):
            move_obj["recoil"] = [parsed["recoil"], 100]

        moves[name] = move_obj

    return dict(sorted(moves.items(), key=lambda item: item[0].lower()))


def main():
    parser = argparse.ArgumentParser(description="Convert cracked-emerald moves into calc-style move definitions.")
    parser.add_argument(
        "--emerald-dir",
        default=os.path.join("..", "cracked-emerald"),
        help="Path to cracked-emerald repo (default: ../cracked-emerald)",
    )
    parser.add_argument(
        "--out",
        default=os.path.join("import", "dist", "cracked-emerald-moves.json"),
        help="Where to write JSON output (default: import/dist/cracked-emerald-moves.json)",
    )
    args = parser.parse_args()

    emerald_dir = os.path.abspath(args.emerald_dir)
    out_path = os.path.abspath(args.out)

    ce = load_helpers(emerald_dir)
    moves = build_moves(emerald_dir, ce)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(moves, f, indent=2, ensure_ascii=False)

    print(f"Wrote {len(moves)} moves to {out_path}")


if __name__ == "__main__":
    main()

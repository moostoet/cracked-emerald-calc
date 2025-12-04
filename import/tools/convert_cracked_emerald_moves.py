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

    # Initialize config from the emerald directory
    ce.reset_config()
    ce.get_config(emerald_dir)

    return ce


def parse_battle_config(emerald_dir: str, gen_constants: Dict[str, int]) -> Dict[str, int]:
    """
    Parse B_UPDATED_* config values from include/config/battle.h.
    Resolves references like GEN_LATEST to their numeric values.
    """
    battle_h = os.path.join(emerald_dir, "include", "config", "battle.h")
    config: Dict[str, int] = {}

    # Fallback: assume all B_UPDATED_* are GEN_LATEST
    latest = gen_constants.get("GEN_LATEST", 8)
    for key in ["B_UPDATED_MOVE_DATA", "B_UPDATED_MOVE_TYPES", "B_UPDATED_MOVE_FLAGS"]:
        config[key] = latest
    config["B_EXTRAPOLATED_MOVE_FLAGS"] = 1  # TRUE

    if not os.path.exists(battle_h):
        return config

    with open(battle_h, "r", encoding="utf-8") as f:
        content = f.read()

    # Match patterns like: #define B_UPDATED_MOVE_DATA GEN_LATEST
    pattern = re.compile(r"#define\s+(B_[A-Z_]+)\s+(GEN_\w+|TRUE|FALSE|\d+)")
    for match in pattern.finditer(content):
        key = match.group(1)
        value_str = match.group(2)

        if value_str == "TRUE":
            config[key] = 1
        elif value_str == "FALSE":
            config[key] = 0
        elif value_str.isdigit():
            config[key] = int(value_str)
        elif value_str in gen_constants:
            config[key] = gen_constants[value_str]

    return config


def evaluate_battle_condition(condition: str, battle_config: Dict[str, int], gen_constants: Dict[str, int]) -> bool:
    """
    Evaluate a preprocessor condition like 'B_UPDATED_MOVE_DATA >= GEN_6'.
    Returns True if the condition is met, False otherwise.
    """
    condition = condition.strip()

    # Match comparison: B_UPDATED_X >= GEN_Y (or other operators)
    cmp_pattern = re.compile(
        r"(B_[A-Z_]+)\s*(>=|<=|>|<|==|!=)\s*(GEN_\w+|\d+)"
    )
    match = cmp_pattern.match(condition)
    if match:
        left_name = match.group(1)
        operator = match.group(2)
        right_str = match.group(3)

        left_val = battle_config.get(left_name)
        if left_val is None:
            # Unknown config, assume true (modern)
            return True

        if right_str.isdigit():
            right_val = int(right_str)
        else:
            right_val = gen_constants.get(right_str, 0)

        if operator == ">=":
            return left_val >= right_val
        elif operator == "<=":
            return left_val <= right_val
        elif operator == ">":
            return left_val > right_val
        elif operator == "<":
            return left_val < right_val
        elif operator == "==":
            return left_val == right_val
        elif operator == "!=":
            return left_val != right_val

    # For unrecognized conditions, assume true
    return True


def preprocess_move_conditionals(
    block_text: str,
    battle_config: Dict[str, int],
    gen_constants: Dict[str, int]
) -> str:
    """
    Process #if/#elif/#else/#endif blocks in the text, keeping only the branches
    that match the current config.
    """
    lines = block_text.split('\n')
    result_lines = []

    # Stack to track nested conditionals: [(condition_met, already_matched), ...]
    condition_stack = []

    for line in lines:
        stripped = line.strip()

        # Check for #if directive
        if_match = re.match(r'#if\s+(.+)', stripped)
        if if_match:
            condition = if_match.group(1).strip()
            condition_met = evaluate_battle_condition(condition, battle_config, gen_constants)
            condition_stack.append((condition_met, condition_met))
            continue

        # Check for #elif directive
        elif_match = re.match(r'#elif\s+(.+)', stripped)
        if elif_match and condition_stack:
            _, already_matched = condition_stack[-1]
            if already_matched:
                # A previous branch was already matched, skip this one
                condition_stack[-1] = (False, True)
            else:
                # Check this condition
                condition = elif_match.group(1).strip()
                condition_met = evaluate_battle_condition(condition, battle_config, gen_constants)
                condition_stack[-1] = (condition_met, condition_met)
            continue

        # Check for #else directive
        if stripped == '#else' and condition_stack:
            _, already_matched = condition_stack[-1]
            # In else branch, include only if no previous branch matched
            condition_stack[-1] = (not already_matched, True)
            continue

        # Check for #endif directive
        if stripped == '#endif' and condition_stack:
            condition_stack.pop()
            continue

        # For regular lines, include if all conditions in stack are met
        should_include = all(met for met, _ in condition_stack) if condition_stack else True
        if should_include:
            result_lines.append(line)

    return '\n'.join(result_lines)


def eval_int(
    expr: str,
    battle_config: Optional[Dict[str, int]] = None,
    gen_constants: Optional[Dict[str, int]] = None
) -> Optional[int]:
    """
    Evaluate an integer expression, handling ternary operators with config awareness.
    """
    expr = expr.strip()
    expr = expr.replace("TRUE", "1").replace("FALSE", "0")

    # Build replacement map from config
    replacements: Dict[str, str] = {}
    if gen_constants:
        for key, val in gen_constants.items():
            replacements[key] = str(val)
    if battle_config:
        for key, val in battle_config.items():
            replacements[key] = str(val)

    # Fallback defaults for any missing configs
    defaults = {
        "B_UPDATED_MOVE_DATA": "8",
        "B_UPDATED_MOVE_TYPES": "8",
        "B_UPDATED_MOVE_FLAGS": "8",
        "B_EXTRAPOLATED_MOVE_FLAGS": "1",
    }
    for key, val in defaults.items():
        if key not in replacements:
            replacements[key] = val

    def repl(match):
        token = match.group(0)
        return replacements.get(token, "0")

    expr = re.sub(r"\b[A-Z][A-Z0-9_]+\b", repl, expr)

    # Convert C-style ternary "cond ? a : b" to Python "(a if cond else b)"
    ternary_match = re.match(r"(.+?)\s*\?\s*(.+?)\s*:\s*(.+)", expr)
    if ternary_match:
        cond, true_val, false_val = ternary_match.groups()
        expr = f"({true_val} if {cond} else {false_val})"

    try:
        return int(eval(expr))
    except Exception:
        return None


def parse_move_block(
    lines: List[str],
    type_map: Dict[str, str],
    battle_config: Optional[Dict[str, int]] = None,
    gen_constants: Optional[Dict[str, int]] = None
) -> Optional[Dict[str, Any]]:
    fields: Dict[str, Any] = {}
    text_block = "\n".join(lines)

    # Preprocess to handle #if/#elif/#else/#endif conditionals
    if battle_config and gen_constants:
        text_block = preprocess_move_conditionals(text_block, battle_config, gen_constants)
        lines = text_block.split('\n')

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
            num = eval_int(raw_val, battle_config, gen_constants)
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


def build_moves(
    emerald_dir: str,
    ce,
    battle_config: Dict[str, int],
    gen_constants: Dict[str, int]
) -> Dict[str, Dict[str, Any]]:
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

        parsed = parse_move_block(block_lines, ce.TYPE_MAPPING, battle_config, gen_constants)
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
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress config info output",
    )
    args = parser.parse_args()

    emerald_dir = os.path.abspath(args.emerald_dir)
    out_path = os.path.abspath(args.out)

    ce = load_helpers(emerald_dir)

    # Parse configuration
    gen_constants = ce.parse_gen_constants(emerald_dir)
    battle_config = parse_battle_config(emerald_dir, gen_constants)

    if not args.quiet:
        # Display detected configuration
        print("Configuration detected from cracked-emerald:")
        print(f"  GEN_LATEST = GEN_{gen_constants.get('GEN_LATEST', 8) + 1}")
        for key in sorted(battle_config.keys()):
            if key.startswith("B_UPDATED_MOVE") or key == "B_EXTRAPOLATED_MOVE_FLAGS":
                val = battle_config[key]
                if key == "B_EXTRAPOLATED_MOVE_FLAGS":
                    val_str = "TRUE" if val else "FALSE"
                else:
                    val_str = f"GEN_{val + 1}" if val < 10 else str(val)
                print(f"  {key} = {val_str} ({val})")
        print()

    moves = build_moves(emerald_dir, ce, battle_config, gen_constants)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(moves, f, indent=2, ensure_ascii=False)

    print(f"Wrote {len(moves)} moves to {out_path}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Convert cracked-emerald species data (species_info headers) into
calc-style species definitions consumable by this repository.

Usage:
  python import/tools/convert_cracked_emerald_species.py \
      --emerald-dir ../cracked-emerald \
      --out import/dist/cracked-emerald-species.json
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from typing import Any, Dict, List, Set


def with_unknown_suffix(identifier: str, raw_name: str, formatter) -> str:
    """
    Use the upstream formatter; if it returns the raw name (no suffix) but the
    identifier has a trailing token (e.g., SPECIES_SPINDA_DRUNKEN), append that
    token as a hyphenated suffix.
    """
    formatted = formatter(identifier, raw_name)
    if formatted != raw_name:
        return formatted

    ident = identifier
    if ident.startswith("SPECIES_"):
        ident = ident[len("SPECIES_") :]
    raw_key = raw_name.upper().replace(" ", "_").replace("-", "_")
    if ident.startswith(raw_key) and len(ident) > len(raw_key) + 1:
        suffix = ident[len(raw_key) + 1 :]
        suffix_clean = "-".join(part.title() for part in suffix.split("_") if part)
        if suffix_clean:
            return f"{raw_name}-{suffix_clean}"
    return formatted


def build_species_data(
    entries: List[Dict[str, Any]], formatter, species_with_evos: Set[str]
) -> Dict[str, Dict[str, Any]]:
    """
    Transform parsed cracked-emerald entries into calc-style species data.
    Only the first listed ability is kept (calc format supports a single slot).
    """
    species: Dict[str, Dict[str, Any]] = {}
    forms_by_base: defaultdict[str, List[str]] = defaultdict(list)

    for entry in entries:
        raw_name = (entry.get("name") or "").strip()
        if not raw_name:
            continue

        identifier = entry.get("identifier", "")
        formatted_name = with_unknown_suffix(identifier, raw_name, formatter)

        # Map types to display strings (TYPE_NORMAL -> "Normal")
        type_tokens = entry.get("types") or []
        types: List[str] = [entry["type_map"].get(t, t) for t in type_tokens if t]

        base_stats = entry.get("baseStats") or {}
        bs = {
            "hp": base_stats.get("HP", 0),
            "at": base_stats.get("Attack", 0),
            "df": base_stats.get("Defense", 0),
            "sa": base_stats.get("Sp. Attack", 0),
            "sd": base_stats.get("Sp. Defense", 0),
            "sp": base_stats.get("Speed", 0),
        }

        weightkg = (entry.get("weight") or 0) / 10.0

        ability_tokens = entry.get("abilities") or []
        abilities = [entry["convert_ability"](a) for a in ability_tokens]
        # Filter out None/empty abilities but preserve positions
        # Slot 0 = primary, Slot 1 = secondary, Slot 2 = hidden
        abilities_dict: Dict[str, str] = {}
        for i, ability in enumerate(abilities):
            if ability and ability.lower() != "none":
                if i == 0:
                    abilities_dict["0"] = ability
                elif i == 1:
                    # Only add slot 1 if different from slot 0
                    if ability != abilities_dict.get("0"):
                        abilities_dict["1"] = ability
                elif i == 2:
                    # Hidden ability
                    abilities_dict["H"] = ability

        # Check if this species can evolve (NFE = Not Fully Evolved)
        # Use both parsed evolution data AND direct scan for .evolutions field
        identifier = entry.get("identifier", "")
        is_nfe = entry.get("evolution") is not None or identifier in species_with_evos

        species_entry: Dict[str, Any] = {
            "types": types if len(types) == 2 else [types[0]] if types else [],
            "bs": bs,
            "weightkg": weightkg,
        }
        if abilities_dict:
            species_entry["abilities"] = abilities_dict
        if is_nfe:
            species_entry["nfe"] = True

        # Track form relationships when formatter adds a suffix.
        if formatted_name != raw_name:
            base_name = raw_name
            species_entry["baseSpecies"] = base_name
            forms_by_base[base_name].append(formatted_name)

        species[formatted_name] = species_entry

    # Populate otherFormes on base species entries.
    # If a base species doesn't exist, create a synthetic entry from the first forme.
    for base_name, forms in forms_by_base.items():
        unique_forms = sorted(set(forms))  # Remove duplicates
        if unique_forms:
            if base_name not in species:
                # Create synthetic base entry from the first forme
                first_forme = unique_forms[0]
                if first_forme in species:
                    base_entry = dict(species[first_forme])
                    base_entry.pop("baseSpecies", None)
                    base_entry["otherFormes"] = unique_forms
                    species[base_name] = base_entry
            else:
                species[base_name]["otherFormes"] = unique_forms

    return dict(sorted(species.items(), key=lambda item: item[0].lower()))


def scan_species_with_evolutions(emerald_dir: str) -> Set[str]:
    """
    Directly scan header files for species that have .evolutions defined.
    This catches complex evolution definitions that parse_species.py regex misses.
    """
    species_dir = os.path.join(emerald_dir, "src", "data", "pokemon", "species_info")
    species_with_evos: Set[str] = set()

    headers = [os.path.join(species_dir, f"gen_{gen}_families.h") for gen in range(1, 10)]
    headers.append(os.path.join(emerald_dir, "src", "data", "pokemon", "species_info.h"))

    for header in headers:
        if not os.path.exists(header):
            continue
        with open(header, "r", encoding="utf-8") as f:
            content = f.read()

        # Find all species blocks and check if they contain .evolutions
        # Pattern: [SPECIES_XXX] = { ... }
        # The file structure has an outer array brace, so species are at depth 1
        species_pattern = re.compile(r'\[\s*(SPECIES_[A-Z0-9_]+)\s*\]\s*=')
        evolutions_pattern = re.compile(r'\.evolutions\s*=')

        lines = content.split('\n')
        current_species = None
        brace_depth = 0
        in_block = False

        for line in lines:
            # Track brace depth FIRST
            prev_depth = brace_depth
            brace_depth += line.count('{') - line.count('}')

            # Check for new species definition (at array level, depth <= 1)
            match = species_pattern.search(line)
            if match and prev_depth <= 1:
                current_species = match.group(1)
                in_block = False  # Will become True when we enter the block

            # Enter block when depth increases from 1 to 2
            if current_species and not in_block and brace_depth > 1:
                in_block = True

            # Check for .evolutions in the current species block
            if current_species and in_block and evolutions_pattern.search(line):
                species_with_evos.add(current_species)

            # Exit block when depth returns to 1 or less
            if in_block and brace_depth <= 1:
                current_species = None
                in_block = False

    return species_with_evos


def parse_cracked_emerald_species(emerald_dir: str):
    """
    Load cracked-emerald's parse_species helpers and parse all gen_*_families.h files.
    """
    species_dir = os.path.join(emerald_dir, "src", "data", "pokemon", "species_info")
    sys.path.insert(0, species_dir)
    try:
        import parse_species as ce  # type: ignore
    except ImportError as exc:  # pragma: no cover - runtime guard
        raise SystemExit(f"Could not import parse_species from {species_dir}: {exc}")

    entries_by_id: Dict[str, Dict[str, Any]] = {}
    for gen in range(1, 10):
        header = os.path.join(species_dir, f"gen_{gen}_families.h")
        if not os.path.exists(header):
            continue
        for entry in ce.parse_file(header):
            ident = entry.get("identifier")
            if ident:
                entries_by_id[ident] = entry

    # Capture any extra species defined directly in species_info.h (e.g., custom forms)
    root_header = os.path.join(emerald_dir, "src", "data", "pokemon", "species_info.h")
    if os.path.exists(root_header):
        for entry in ce.parse_file(root_header):
            ident = entry.get("identifier")
            if ident:
                entries_by_id[ident] = entry

    # Deduplicate exception families exactly the way parse_species main does.
    unique_entries: List[Dict[str, Any]] = []
    seen_exceptions = set()
    for entry in entries_by_id.values():
        fam = ce.get_exception_family(entry.get("identifier", ""))
        if fam:
            if fam in seen_exceptions:
                continue
            seen_exceptions.add(fam)
        entry["type_map"] = ce.TYPE_MAPPING
        entry["convert_ability"] = ce.convert_ability
        unique_entries.append(entry)

    return unique_entries, ce.format_species_name


def main():
    parser = argparse.ArgumentParser(
        description="Convert cracked-emerald species_info headers into calc-style species JSON."
    )
    parser.add_argument(
        "--emerald-dir",
        default=os.path.join("..", "cracked-emerald"),
        help="Path to the cracked-emerald repository (default: ../cracked-emerald)",
    )
    parser.add_argument(
        "--out",
        default=os.path.join("import", "dist", "cracked-emerald-species.json"),
        help="Where to write the converted JSON (default: import/dist/cracked-emerald-species.json)",
    )
    args = parser.parse_args()

    emerald_dir = os.path.abspath(args.emerald_dir)
    out_path = os.path.abspath(args.out)

    if not os.path.isdir(emerald_dir):
        raise SystemExit(f"emerald-dir does not exist: {emerald_dir}")

    entries, formatter = parse_cracked_emerald_species(emerald_dir)
    species_with_evos = scan_species_with_evolutions(emerald_dir)
    species_data = build_species_data(entries, formatter, species_with_evos)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(species_data, f, indent=2, ensure_ascii=False)

    print(f"Wrote {len(species_data)} species entries to {out_path}")


if __name__ == "__main__":
    main()

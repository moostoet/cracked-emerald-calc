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
import sys
from collections import defaultdict
from typing import Any, Dict, List


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


def build_species_data(entries: List[Dict[str, Any]], formatter) -> Dict[str, Dict[str, Any]]:
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
        abilities = [entry["convert_ability"](a) for a in ability_tokens if a]
        primary_ability = next((a for a in abilities if a and a.lower() != "none"), None)

        is_nfe = entry.get("evolution") is not None

        species_entry: Dict[str, Any] = {
            "types": types if len(types) == 2 else [types[0]] if types else [],
            "bs": bs,
            "weightkg": weightkg,
        }
        if primary_ability:
            species_entry["abilities"] = {0: primary_ability}
        if is_nfe:
            species_entry["nfe"] = True

        # Track form relationships when formatter adds a suffix.
        if formatted_name != raw_name:
            base_name = raw_name
            species_entry["baseSpecies"] = base_name
            forms_by_base[base_name].append(formatted_name)

        species[formatted_name] = species_entry

    # Populate otherFormes on base species entries.
    for base_name, forms in forms_by_base.items():
        if base_name in species and forms:
            species[base_name]["otherFormes"] = sorted(forms)

    return dict(sorted(species.items(), key=lambda item: item[0].lower()))


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
    species_data = build_species_data(entries, formatter)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(species_data, f, indent=2, ensure_ascii=False)

    print(f"Wrote {len(species_data)} species entries to {out_path}")


if __name__ == "__main__":
    main()

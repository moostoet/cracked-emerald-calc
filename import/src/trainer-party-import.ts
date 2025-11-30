import fs from 'fs';
import path from 'path';

type StatID = 'hp' | 'at' | 'df' | 'sa' | 'sd' | 'sp';
type StatTable = Partial<Record<StatID, number>>;

interface TrainerSet {
  ability: string;
  index: number;
  item: string;
  ivs?: StatTable;
  evs?: StatTable;
  level: number;
  moves: string[];
  nature: string;
}

interface ParsedPokemon {
  species: string;
  set: TrainerSet;
}

interface ParsedTrainer {
  id: string;
  className: string;
  name: string;
  pokemon: ParsedPokemon[];
}

type Setdex = Record<string, Record<string, TrainerSet>>;

const DEFAULT_LEVEL = 100;

const STAT_MAP: Record<string, StatID> = {
  hp: 'hp',
  atk: 'at',
  attack: 'at',
  def: 'df',
  spa: 'sa',
  spatk: 'sa',
  spc: 'sa',
  spd: 'sd',
  spdef: 'sd',
  spe: 'sp',
  sp: 'sp',
  speed: 'sp',
};

function stripComments(contents: string): string {
  return contents.replace(/\/\*[\s\S]*?\*\//g, '');
}

function toTitleCase(value: string): string {
  return value.replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

function normalizeText(raw: string): string {
  return toTitleCase(raw.replace(/_/g, ' ').replace(/\s+/g, ' ').trim());
}

function capitalizeWord(word: string): string {
  return word.split('-').map(part => part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part).join('-');
}

function smartNormalize(raw: string): string {
  let value = raw.replace(/^(SPECIES_|ITEM_|ABILITY_|MOVE_|NATURE_|TYPE_)/i, '');
  value = value.replace(/[_\s]+/g, ' ').trim();
  if (!value) return '';

  const alpha = value.replace(/[^A-Za-z]/g, '');
  const isAllUpper = alpha && alpha === alpha.toUpperCase();
  const isAllLower = alpha && alpha === alpha.toLowerCase();
  if (isAllUpper || isAllLower) {
    value = value
      .split(' ')
      .map(piece => piece ? capitalizeWord(piece) : piece)
      .join(' ');
  }
  return value;
}

function normalizeEntity(raw: string, _kind: 'species' | 'ability' | 'item' | 'move' | 'nature'): string {
  return smartNormalize(raw);
}

function parseStatLine(raw: string): StatTable {
  const stats: StatTable = {};
  const afterColon = raw.includes(':') ? raw.split(':')[1] : raw;
  const parts = afterColon.split('/');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\s+([A-Za-z]+)/);
    if (!match) continue;
    const statKey = match[2].toLowerCase().replace(/[^a-z]/g, '');
    const stat = STAT_MAP[statKey];
    if (!stat) continue;
    stats[stat] = Number(match[1]);
  }
  return stats;
}

function parseLeadLine(raw: string): {species: string; item?: string} {
  const [lead, ...itemParts] = raw.split('@');
  const item = itemParts.length ? normalizeEntity(itemParts.join('@').trim(), 'item') : undefined;
  let speciesToken = lead.trim().replace(/\(\s*[MFN]\s*\)\s*$/i, '').trim();
  const speciesMatch = speciesToken.match(/\(([^()]*)\)\s*$/);
  if (speciesMatch && speciesMatch[1]) {
    speciesToken = speciesMatch[1];
  }
  const species = normalizeEntity(speciesToken, 'species');
  return {species, item};
}

function parsePokemon(block: string[], index: number): ParsedPokemon | undefined {
  if (!block.length) return undefined;
  const [lead, ...rest] = block;
  const {species, item} = parseLeadLine(lead);
  if (!species) return undefined;

  const set: TrainerSet = {
    ability: '',
    index,
    item: item ?? '',
    level: DEFAULT_LEVEL,
    moves: [],
    nature: '',
  };

  for (const rawLine of rest) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('Ability:')) {
      set.ability = normalizeEntity(line.split(':')[1] ?? '', 'ability');
      continue;
    }
    if (line.startsWith('Level:')) {
      const levelVal = Number((line.split(':')[1] ?? '').trim());
      set.level = Number.isFinite(levelVal) ? levelVal : DEFAULT_LEVEL;
      continue;
    }
    if (line.startsWith('EVs:')) {
      const evs = parseStatLine(line);
      if (Object.keys(evs).length) set.evs = evs;
      continue;
    }
    if (line.startsWith('IVs:')) {
      const ivs = parseStatLine(line);
      if (Object.keys(ivs).length) set.ivs = ivs;
      continue;
    }
    if (/Nature$/i.test(line)) {
      set.nature = normalizeEntity(line.replace(/Nature/i, '').trim(), 'nature');
      continue;
    }
    if (line.startsWith('-')) {
      const moveName = normalizeEntity(line.slice(1).trim(), 'move');
      if (moveName) set.moves.push(moveName);
    }
  }

  return {species, set};
}

function parseTrainer(lines: string[], start: number): {trainer?: ParsedTrainer; next: number} {
  const header = lines[start].trim();
  const idMatch = header.match(/^===\s*TRAINER_(.+?)\s*===/i);
  if (!idMatch) return {next: start + 1};

  const id = idMatch[1];
  const meta: Record<string, string> = {};
  let cursor = start + 1;

  for (; cursor < lines.length; cursor++) {
    const line = lines[cursor];
    if (!line.trim()) {
      cursor++;
      break;
    }
    if (line.startsWith('===')) break;
    const [key, ...rest] = line.split(':');
    if (!rest.length) continue;
    meta[key.trim().toLowerCase()] = rest.join(':').trim();
  }

  const pokemonBlocks: string[][] = [];
  let current: string[] = [];

  for (; cursor < lines.length; cursor++) {
    const line = lines[cursor];
    if (line.startsWith('===')) break;
    if (!line.trim()) {
      if (current.length) {
        pokemonBlocks.push(current);
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length) pokemonBlocks.push(current);

  const pokemon = pokemonBlocks
    .map((block, i) => parsePokemon(block, i))
    .filter((mon): mon is ParsedPokemon => !!mon);

  if (!pokemon.length) {
    return {next: cursor};
  }

  return {
    trainer: {
      id,
      className: meta.class ?? '',
      name: meta.name ?? '',
      pokemon,
    },
    next: cursor,
  };
}

function buildTrainerLabel(trainer: ParsedTrainer): string {
  const className = normalizeText(trainer.className);
  const trainerName = normalizeText(trainer.name || trainer.id);
  const tail = normalizeText(trainer.id);
  const base = [className, trainerName].filter(Boolean).join(' ').trim();

  let suffix = '';
  const baseLower = base.toLowerCase();
  const tailLower = tail.toLowerCase();

  if (tailLower.startsWith(baseLower)) {
    suffix = tail.slice(base.length).trim();
  } else {
    let remainder = tail;
    if (remainder.toLowerCase().startsWith(trainerName.toLowerCase())) {
      remainder = remainder.slice(trainerName.length).trim();
    }
    if (className && remainder.toLowerCase().startsWith(className.toLowerCase())) {
      remainder = remainder.slice(className.length).trim();
    }
    suffix = remainder.trim();
    if (suffix.toLowerCase() === trainerName.toLowerCase()) suffix = '';
  }

  return [className, trainerName, suffix].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function addSet(
  setdex: Setdex,
  species: string,
  trainerLabel: string,
  set: TrainerSet
): void {
  if (!setdex[species]) {
    setdex[species] = {};
  }
  let setName = trainerLabel;
  let counter = 2;
  while (setdex[species][setName]) {
    setName = `${trainerLabel} (${counter})`;
    counter++;
  }
  setdex[species][setName] = set;
}

function sortSetdex(setdex: Setdex): Setdex {
  const sorted: Setdex = {};
  for (const species of Object.keys(setdex).sort()) {
    sorted[species] = {};
    for (const setName of Object.keys(setdex[species]).sort()) {
      sorted[species][setName] = setdex[species][setName];
    }
  }
  return sorted;
}

function buildSetdex(contents: string): Setdex {
  const lines = stripComments(contents).split(/\r?\n/);
  const setdex: Setdex = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }
    if (!line.startsWith('===')) {
      i++;
      continue;
    }
    const {trainer, next} = parseTrainer(lines, i);
    i = next;
    if (!trainer) continue;
    const trainerLabel = buildTrainerLabel(trainer);
    for (const mon of trainer.pokemon) {
      addSet(setdex, mon.species, trainerLabel, mon.set);
    }
  }

  return setdex;
}

function countSets(setdex: Setdex): number {
  let total = 0;
  for (const species of Object.keys(setdex)) {
    total += Object.keys(setdex[species]).length;
  }
  return total;
}

function main() {
  const [, , inputArg, outputArg] = process.argv;
  if (!inputArg) {
    console.error('Usage: node dist/trainer-party-import.js <path-to-trainers.party> [output-file]');
    process.exit(1);
  }

  const inputPath = path.resolve(process.cwd(), inputArg);
  const contents = fs.readFileSync(inputPath, 'utf8');
  const setdex = sortSetdex(buildSetdex(contents));
  const output = `var SETDEX_SV = ${JSON.stringify(setdex, null, '\t')}\n`;

  if (outputArg) {
    const outputPath = path.resolve(process.cwd(), outputArg);
    fs.writeFileSync(outputPath, output);
    console.log(
      `Wrote ${countSets(setdex)} trainer sets for ${Object.keys(setdex).length} species to ${outputPath}`
    );
  } else {
    console.log(output);
  }
}

main();

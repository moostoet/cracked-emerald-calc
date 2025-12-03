// Override Gen 9 data with Cracked Emerald species/moves and custom abilities.
(function () {
  function loadJSON(url) {
    var request = new XMLHttpRequest();
    request.open('GET', url, false);
    request.send(null);
    if (request.status < 200 || request.status >= 300) return null;
    try {
      return JSON.parse(request.responseText);
    } catch (err) {
      console.warn('Failed to parse JSON at', url, err);
      return null;
    }
  }

  function rebuildIdMap(list, Ctor) {
    var map = {};
    for (var i = 0; i < list.length; i++) {
      var obj = new Ctor(list[i]);
      map[obj.id] = obj;
    }
    return map;
  }

  function applyOverrides() {
    if (typeof calc === 'undefined' || !calc.SPECIES || !calc.MOVES) {
      console.warn('Cracked Emerald loader: calc object not ready');
      return;
    }

    // Species
    var speciesData = loadJSON('./import/dist/cracked-emerald-species.json');
    if (speciesData) {
      calc.SPECIES[9] = speciesData;
      if (calc.SPECIES_BY_ID && calc.Specie) {
        var speciesMap = {};
        for (var name in speciesData) {
          if (!Object.prototype.hasOwnProperty.call(speciesData, name)) continue;
          var def = speciesData[name];
          if (def && def.bs && def.bs.sl) delete def.bs.sl;
          speciesMap[calc.toID(name)] = new calc.Specie(name, def);
        }
        calc.SPECIES_BY_ID[9] = speciesMap;
      }
    } else {
      console.warn('Cracked Emerald species JSON failed to load');
    }

    // Abilities
    var customAbilities = ['Drunken Fist'];
    if (Array.isArray(calc.ABILITIES)) {
      if (!calc.ABILITIES[9]) calc.ABILITIES[9] = [];
      customAbilities.forEach(function (name) {
        if (!calc.ABILITIES[9].includes(name)) calc.ABILITIES[9].push(name);
      });
      if (calc.ABILITIES_BY_ID && calc.Ability) {
        calc.ABILITIES_BY_ID[9] = rebuildIdMap(calc.ABILITIES[9], calc.Ability);
      }
    }

    // Moves
    var moveData = loadJSON('./import/dist/cracked-emerald-moves.json');
    if (!moveData) {
      console.warn('Cracked Emerald moves JSON failed to load; using base move data.');
    }
    if (moveData) {
      calc.MOVES[9] = moveData;
    }
    if (calc.MOVES_BY_ID) {
      // Start from existing Gen 9 moves so we don't drop any vanilla entries the hack doesn't override.
      var moveMap = {};
      var base = calc.MOVES_BY_ID[9] || {};
      for (var k in base) {
        if (Object.prototype.hasOwnProperty.call(base, k)) {
          moveMap[k] = base[k];
        }
      }
      if (moveData) {
        for (var moveName in moveData) {
          if (!Object.prototype.hasOwnProperty.call(moveData, moveName)) continue;
          var def = moveData[moveName] || {};
          var obj = { kind: 'Move', id: calc.toID(moveName), name: moveName, flags: {} };
          obj.basePower = def.bp;
          obj.type = def.type;
          obj.category = def.category || 'Status';
          obj.zMove = def.zp ? { basePower: def.zp } : undefined;
          obj.maxMove = def.maxPower ? { basePower: def.maxPower } : undefined;
          obj.multihit = def.multihit;
          obj.multiaccuracy = def.multiaccuracy;
          obj.drain = def.drain;
          obj.recoil = def.recoil;
          obj.hasCrashDamage = def.hasCrashDamage;
          obj.mindBlownRecoil = def.mindBlownRecoil;
          obj.struggleRecoil = def.struggleRecoil;
          obj.secondaries = def.secondaries;
          obj.target = def.target;
          obj.priority = def.priority || 0;
          obj.self = def.self;
          obj.ignoreDefensive = def.ignoreDefensive;
          obj.overrideOffensiveStat = def.overrideOffensiveStat;
          obj.overrideDefensiveStat = def.overrideDefensiveStat;
          obj.overrideOffensivePokemon = def.overrideOffensivePokemon;
          obj.overrideDefensivePokemon = def.overrideDefensivePokemon;
          obj.breaksProtect = def.breaksProtect;
          obj.isZ = def.isZ;
          obj.isMax = def.isMax;
          if (def.makesContact) obj.flags.contact = 1;
          if (def.isPunch) obj.flags.punch = 1;
          if (def.isBite) obj.flags.bite = 1;
          if (def.isBullet) obj.flags.bullet = 1;
          if (def.isSound) obj.flags.sound = 1;
          if (def.isPulse) obj.flags.pulse = 1;
          if (def.isSlicing) obj.flags.slicing = 1;
          if (def.isWind) obj.flags.wind = 1;
          moveMap[obj.id] = obj;
        }
      }
      // Explicit fallback patch for Cut in case moves JSON is missing or cached.
      moveMap['cut'] = moveMap['cut'] || {};
      moveMap['cut'] = Object.assign(
        { kind: 'Move', id: 'cut', name: 'Cut', flags: {} },
        moveMap['cut'],
        {
          basePower: 60,
          type: 'Grass',
          category: 'Physical'
        }
      );
      moveMap['cut'].flags.contact = 1;
      moveMap['cut'].flags.slicing = 1;

      calc.MOVES_BY_ID[9] = moveMap;
      // Keep calc.MOVES in sync so future reads of the plain table see the override too.
      if (calc.MOVES && !calc.MOVES[9].Cut) {
        calc.MOVES[9].Cut = { bp: 60, type: 'Grass', category: 'Physical', makesContact: true, isSlicing: true };
      }
    }

    console.log('Cracked Emerald data loaded successfully');
  }

  // Run immediately since this script is loaded after all calc data files
  try {
    applyOverrides();
  } catch (err) {
    console.warn('Cracked Emerald loader failed:', err);
  }
})();

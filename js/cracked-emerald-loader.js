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
    if (typeof calc === 'undefined' || !calc.SPECIES || !calc.MOVES) return;

    // Species
    var speciesData = loadJSON('./import/dist/cracked-emerald-species.json');
    if (speciesData) {
      calc.SPECIES[9] = speciesData;
      if (typeof SPECIES_BY_ID !== 'undefined' && typeof Specie !== 'undefined') {
        var speciesMap = {};
        for (var name in speciesData) {
          if (!Object.prototype.hasOwnProperty.call(speciesData, name)) continue;
          var def = speciesData[name];
          if (def && def.bs && def.bs.sl) delete def.bs.sl;
          speciesMap[calc.toID(name)] = new Specie(name, def);
        }
        SPECIES_BY_ID[9] = speciesMap;
      }
    }

    // Abilities
    var customAbilities = ['Drunken Fist'];
    if (Array.isArray(calc.ABILITIES)) {
      if (!calc.ABILITIES[9]) calc.ABILITIES[9] = [];
      customAbilities.forEach(function (name) {
        if (!calc.ABILITIES[9].includes(name)) calc.ABILITIES[9].push(name);
      });
      if (typeof ABILITIES_BY_ID !== 'undefined' && typeof Ability !== 'undefined') {
        ABILITIES_BY_ID[9] = rebuildIdMap(calc.ABILITIES[9], Ability);
      }
    }

    // Moves
    var moveData = loadJSON('./import/dist/cracked-emerald-moves.json');
    if (moveData) {
      calc.MOVES[9] = moveData;
      if (typeof MOVES_BY_ID !== 'undefined') {
        var moveMap = {};
        for (var moveName in moveData) {
          if (!Object.prototype.hasOwnProperty.call(moveData, moveName)) continue;
          if (typeof Move === 'function') {
            moveMap[calc.toID(moveName)] = new Move(moveName, moveData[moveName], 9);
          } else {
            // Fallback shape if Move constructor is unavailable.
            var def = moveData[moveName] || {};
            var obj = { kind: 'Move', id: calc.toID(moveName), name: moveName, flags: {} };
            obj.basePower = def.bp;
            obj.type = def.type;
            obj.category = def.category || 'Status';
            obj.multihit = def.multihit;
            obj.multiaccuracy = def.multiaccuracy;
            obj.drain = def.drain;
            obj.recoil = def.recoil;
            obj.priority = def.priority || 0;
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
        MOVES_BY_ID[9] = moveMap;
      }
    }
  }

  if (document.readyState === 'complete') {
    try {
      applyOverrides();
    } catch (err) {
      console.warn('Cracked Emerald loader failed:', err);
    }
  } else {
    window.addEventListener(
      'load',
      function () {
        try {
          applyOverrides();
        } catch (err) {
          console.warn('Cracked Emerald loader failed:', err);
        }
      },
      { once: true }
    );
  }
})();

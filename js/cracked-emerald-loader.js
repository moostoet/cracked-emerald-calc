// Override the Gen 9 species list with Cracked Emerald data.
(function loadCrackedEmeraldSpecies() {
  var request = new XMLHttpRequest();
  request.open('GET', './import/dist/cracked-emerald-species.json', false);
  try {
    request.send(null);
  } catch (err) {
    console.warn('Cracked Emerald species load failed:', err);
    return;
  }

  if (request.status < 200 || request.status >= 300) {
    console.warn('Cracked Emerald species load failed with status:', request.status);
    return;
  }

  var data;
  try {
    data = JSON.parse(request.responseText);
  } catch (err) {
    console.warn('Cracked Emerald species JSON parse failed:', err);
    return;
  }

  if (!Array.isArray(calc.SPECIES)) {
    console.warn('calc.SPECIES is not initialized; cannot apply Cracked Emerald data.');
    return;
  }

  // Replace Gen 9 species list.
  calc.SPECIES[9] = data;

  // Rebuild the ID map used by the Species helper.
  if (typeof SPECIES_BY_ID !== 'undefined' && typeof Specie !== 'undefined') {
    var map = {};
    for (var name in data) {
      if (!Object.prototype.hasOwnProperty.call(data, name)) continue;
      var def = data[name];
      if (def && def.bs && def.bs.sl) delete def.bs.sl;
      map[calc.toID(name)] = new Specie(name, def);
    }
    SPECIES_BY_ID[9] = map;
  }
})();

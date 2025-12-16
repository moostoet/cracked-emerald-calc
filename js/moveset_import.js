// Global array to track imported Pokemon for Team/Box display
var importedPokemonList = [];

function placeBsBtn() {
	var importBtn = "<button id='import' class='bs-btn bs-btn-default'>Import</button>";
	$("#import-1_wrapper").append(importBtn);

	$("#import.bs-btn").click(function () {
		var pokes = document.getElementsByClassName("import-team-text")[0].value;
		var name = document.getElementsByClassName("import-name-text")[0].value.trim() === "" ? "Custom Set" : document.getElementsByClassName("import-name-text")[0].value;
		addSets(pokes, name);
	});
}

// Render the Team/Box display with imported Pokemon
function showPlayerTeamBox() {
	var teamContainer = document.querySelector("#player-team-list");
	var boxContainer = document.querySelector("#player-box-list");

	if (!teamContainer || !boxContainer) return;

	teamContainer.innerHTML = "";
	boxContainer.innerHTML = "";

	// Migrate old data: add section property if missing
	var teamCount = 0;
	for (var i = 0; i < importedPokemonList.length; i++) {
		var pokemon = importedPokemonList[i];
		if (!pokemon.section) {
			// Backward compatibility: first 6 are team, rest are box
			pokemon.section = (teamCount < 6) ? 'team' : 'box';
		}
		if (pokemon.section === 'team') {
			teamCount++;
		}
	}

	for (var i = 0; i < importedPokemonList.length; i++) {
		var pokemon = importedPokemonList[i];
		var speciesName = pokemon.name;
		var cleanSpecies = speciesName.replace("%", "%25");

		var img = document.createElement("img");
		img.className = "player-pok";
		img.src = "https://raw.githubusercontent.com/May8th1995/sprites/master/" + cleanSpecies + ".png";
		img.title = speciesName + (pokemon.setName ? " (" + pokemon.setName + ")" : "");
		img.dataset.pokemonIndex = i;
		img.dataset.setName = speciesName + " (" + (pokemon.setName || "Custom Set") + ")";

		// On click, load this Pokemon into #p1's set-selector
		img.addEventListener("click", function () {
			$("#p1 .set-selector").val(this.dataset.setName).change();
		});

		// Use section property to determine placement
		if (pokemon.section === 'team') {
			teamContainer.appendChild(img);
		} else {
			boxContainer.appendChild(img);
		}
	}

	// Initialize drag and drop functionality
	initDragDrop();
}

// Clear the Team/Box display
function clearPlayerTeamBox() {
	importedPokemonList = [];
	localStorage.removeItem('importedTeamList');
	showPlayerTeamBox();
}

// Save imported team list to localStorage
function saveImportedTeamToStorage() {
	localStorage.setItem('importedTeamList', JSON.stringify(importedPokemonList));
}

// Load imported team list from localStorage
function loadImportedTeamFromStorage() {
	var stored = localStorage.getItem('importedTeamList');
	if (stored) {
		importedPokemonList = JSON.parse(stored);
		showPlayerTeamBox();
		updateTeamBoxMatchupColors();
	}
}

// Create a Pokemon object directly from imported set data
// This bypasses the normal setdex lookup which can fail in randoms mode
function createPokemonFromImportedSet(pokemonName, setName) {
	// Look up the set directly in the current generation's setdex
	// We use setdex (which is SETDEX[gen]) since custom sets are added there
	var set = null;

	// Try to find the set in setdex first (where custom sets are stored)
	if (setdex && setdex[pokemonName] && setdex[pokemonName][setName]) {
		set = setdex[pokemonName][setName];
	}

	// Fallback: check SETDEX_SV directly (custom sets are always added here)
	if (!set && typeof SETDEX_SV !== 'undefined' && SETDEX_SV[pokemonName] && SETDEX_SV[pokemonName][setName]) {
		set = SETDEX_SV[pokemonName][setName];
	}

	if (!set) {
		console.warn("Could not find set for", pokemonName, setName);
		return null;
	}

	var ability = set.ability;
	var item = set.item;

	// Build IVs and EVs
	var ivs = {};
	var evs = {};
	var LEGACY_STATS_MAP = {hp: 'hp', at: 'atk', df: 'def', sa: 'spa', sd: 'spd', sp: 'spe'};

	for (var legacyStat in LEGACY_STATS_MAP) {
		var stat = LEGACY_STATS_MAP[legacyStat];
		ivs[stat] = (set.ivs && typeof set.ivs[legacyStat] !== "undefined") ? set.ivs[legacyStat] : 31;
		evs[stat] = (set.evs && typeof set.evs[legacyStat] !== "undefined") ? set.evs[legacyStat] : 0;
	}

	// Build moves
	var moveNames = set.moves || [];
	var pokemonMoves = [];
	for (var i = 0; i < 4; i++) {
		var moveName = moveNames[i];
		var moveExists = moves && moves[moveName];
		pokemonMoves.push(new calc.Move(gen, moveExists ? moveName : "(No Move)", { ability: ability, item: item }));
	}

	// Filter out mega stones (items ending in "ite" except "Eviolite")
	var finalItem = "";
	if (item && typeof item === "string") {
		if (item === "Eviolite" || item.indexOf("ite") < 0) {
			finalItem = item;
		}
	}

	return new calc.Pokemon(gen, pokemonName, {
		level: set.level || 100,
		ability: ability,
		abilityOn: true,
		item: finalItem,
		nature: set.nature || "Serious",
		ivs: ivs,
		evs: evs,
		moves: pokemonMoves
	});
}

// Calculate and apply matchup colors to Team/Box Pokemon
function updateTeamBoxMatchupColors() {
	// Check if we have imported Pokemon and an opponent selected
	if (importedPokemonList.length === 0) return;

	var opponentSetName = $("#p2 .set-selector").val();
	if (!opponentSetName || opponentSetName.trim() === "") return;

	// Get opponent Pokemon object
	var opponent;
	try {
		opponent = createPokemon($("#p2"));
	} catch (e) {
		console.warn("Could not create opponent Pokemon for matchup calculation:", e);
		return;
	}

	if (!opponent) return;

	// Build field states so side conditions line up regardless of attacker/defender
	var playerField = createField();
	var opponentField = playerField.clone().swap();

	// Get all player Pokemon images
	var teamImages = document.querySelectorAll("#player-team-list .player-pok");
	var boxImages = document.querySelectorAll("#player-box-list .player-pok");
	var allImages = Array.prototype.slice.call(teamImages).concat(Array.prototype.slice.call(boxImages));

	allImages.forEach(function(img) {
		// Use stored pokemonIndex to get correct data regardless of DOM order
		var pokemonIndex = parseInt(img.dataset.pokemonIndex, 10);
		if (isNaN(pokemonIndex) || pokemonIndex >= importedPokemonList.length) return;

		var pokemonData = importedPokemonList[pokemonIndex];
		var setName = pokemonData.setName || "Custom Set";

		// Create player Pokemon object using our direct lookup function
		var playerPokemon;
		try {
			playerPokemon = createPokemonFromImportedSet(pokemonData.name, setName);
		} catch (e) {
			console.warn("Could not create player Pokemon:", pokemonData.name, e);
			return;
		}

		if (!playerPokemon) return;

		// Clear previous classes
		img.className = "player-pok";

		// Calculate best moves in both directions using the correct field sides
		var playerToOpponentResult = getBestMoveResult(playerPokemon, opponent, playerField);
		var opponentToPlayerResult = getBestMoveResult(opponent, playerPokemon, opponentField);

		// Use computed final speeds (includes items, abilities, Tailwind, etc.) when available
		var playerSpeed = playerToOpponentResult && playerToOpponentResult.attacker && playerToOpponentResult.attacker.stats
			? playerToOpponentResult.attacker.stats.spe
			: playerPokemon.stats.spe;

		var opponentSpeed = playerToOpponentResult && playerToOpponentResult.defender && playerToOpponentResult.defender.stats
			? playerToOpponentResult.defender.stats.spe
			: opponent.stats.spe;

		if (!playerToOpponentResult && opponentToPlayerResult && opponentToPlayerResult.attacker && opponentToPlayerResult.attacker.stats) {
			opponentSpeed = opponentToPlayerResult.attacker.stats.spe;
		}
		if (!playerToOpponentResult && opponentToPlayerResult && opponentToPlayerResult.defender && opponentToPlayerResult.defender.stats) {
			playerSpeed = opponentToPlayerResult.defender.stats.spe;
		}

		if (playerSpeed > opponentSpeed) {
			img.classList.add("speed-faster");
		} else if (playerSpeed === opponentSpeed) {
			img.classList.add("speed-tie");
		} else {
			img.classList.add("speed-slower");
		}

		// Determine left color (what player does to opponent)
		var leftColor = getLeftColorClass(playerToOpponentResult, opponentToPlayerResult);

		// Determine right color (what opponent does to player)
		var rightColor = getRightColorClass(opponentToPlayerResult);

		// Apply combined OHKO class
		var ohkoClass = getOhkoClass(leftColor, rightColor);
		if (ohkoClass) {
			img.classList.add(ohkoClass);
		}
	});
}

// Get the best offensive move result from attacker to defender
function getBestMoveResult(attacker, defender, field) {
	var bestResult = null;
	var bestDamagePercent = 0;

	// Default to current UI field state if none provided
	var calcField = field || createField();

	for (var i = 0; i < attacker.moves.length; i++) {
		var move = attacker.moves[i];
		if (!move || move.name === "(No Move)" || move.category === "Status") continue;

		try {
			var result = calc.calculate(gen, attacker, defender, move, calcField);
			if (result && result.range) {
				var range = result.range();
				var maxDamage = range[1];
				var damagePercent = (maxDamage / defender.maxHP()) * 100;

				if (damagePercent > bestDamagePercent) {
					bestDamagePercent = damagePercent;
					bestResult = result;
				}
			}
		} catch (e) {
			// Skip moves that fail to calculate
		}
	}

	return bestResult;
}

// Determine left color class based on what player does to opponent
function getLeftColorClass(playerResult, opponentResult) {
	if (!playerResult) return "none";

	var ALWAYS_OHKO_THRESHOLD = 0.999; // treat 99.9%+ as guaranteed for coloring
	var HAS_CHANCE_THRESHOLD = 0.0001;
	var damageRange = playerResult.range ? playerResult.range() : null;
	var playerMin = damageRange ? damageRange[0] : 0;
	var playerMax = damageRange ? damageRange[damageRange.length - 1] : 0;
	var defenderHP = playerResult.defender ? playerResult.defender.maxHP() : 1;

	var koChance = playerResult.kochance();
	var playerKoTurns = koChance ? koChance.n : 999;
	var playerKoChance = koChance ? (koChance.chance || 0) : 0;

	// Check opponent's KO potential for Hard Counter/Walls calculation
	var opponentKoTurns = 999;
	if (opponentResult) {
		var oppKoChance = opponentResult.kochance();
		opponentKoTurns = oppKoChance ? oppKoChance.n : 999;
	}

	// Hard Counter: Gets 4HKO'd at worst AND may OHKO
	if (opponentKoTurns >= 4 && playerKoTurns === 1 && playerKoChance > HAS_CHANCE_THRESHOLD) {
		return "lightblue";
	}

	// Walls: Gets 4HKO'd at worst AND does more damage (but doesn't OHKO)
	if (opponentKoTurns >= 4 && playerKoTurns > 1) {
		// Compare damage dealt vs received
		var playerRange = playerResult.range();
		var playerMaxDmgPercent = playerRange ? (playerRange[1] / playerResult.defender.maxHP()) * 100 : 0;

		if (opponentResult) {
			var oppRange = opponentResult.range();
			var oppMaxDmgPercent = oppRange ? (oppRange[1] / opponentResult.defender.maxHP()) * 100 : 0;

			if (playerMaxDmgPercent > oppMaxDmgPercent) {
				return "blue";
			}
		}
	}

	// Always OHKOs (guaranteed)
	if ((playerKoTurns === 1 && playerKoChance >= ALWAYS_OHKO_THRESHOLD) || playerMin >= defenderHP) {
		return "green";
	}

	// Might OHKO (chance > 0 but not guaranteed)
	if ((playerKoTurns === 1 && playerKoChance > HAS_CHANCE_THRESHOLD && playerKoChance < ALWAYS_OHKO_THRESHOLD) || (playerMax >= defenderHP && playerMin < defenderHP)) {
		return "yellow";
	}

	return "none";
}

// Determine right color class based on what opponent does to player
function getRightColorClass(opponentResult) {
	if (!opponentResult) return "none";

	var ALWAYS_OHKO_THRESHOLD = 0.999;
	var HAS_CHANCE_THRESHOLD = 0.0001;
	var damageRange = opponentResult.range ? opponentResult.range() : null;
	var oppMin = damageRange ? damageRange[0] : 0;
	var oppMax = damageRange ? damageRange[damageRange.length - 1] : 0;
	var defenderHP = opponentResult.defender ? opponentResult.defender.maxHP() : 1;

	var koChance = opponentResult.kochance();
	var koTurns = koChance ? koChance.n : 999;
	var koChanceValue = koChance ? (koChance.chance || 0) : 0;

	// Always gets OHKO'd (guaranteed)
	if ((koTurns === 1 && koChanceValue >= ALWAYS_OHKO_THRESHOLD) || oppMin >= defenderHP) {
		return "red";
	}

	// Might get OHKO'd (chance > 0 but not guaranteed)
	if ((koTurns === 1 && koChanceValue > HAS_CHANCE_THRESHOLD && koChanceValue < ALWAYS_OHKO_THRESHOLD) || (oppMax >= defenderHP && oppMin < defenderHP)) {
		return "orange";
	}

	return "none";
}

// Get combined OHKO CSS class
function getOhkoClass(leftColor, rightColor) {
	if (leftColor === "none" && rightColor === "none") return null;

	var classMap = {
		"green-red": "ohko-green-red",
		"green-orange": "ohko-green-orange",
		"green-none": "ohko-green-none",
		"yellow-red": "ohko-yellow-red",
		"yellow-orange": "ohko-yellow-orange",
		"yellow-none": "ohko-yellow-none",
		"lightblue-red": "ohko-lightblue-red",
		"lightblue-orange": "ohko-lightblue-orange",
		"lightblue-none": "ohko-lightblue-none",
		"blue-red": "ohko-blue-red",
		"blue-orange": "ohko-blue-orange",
		"blue-none": "ohko-blue-none",
		"none-red": "ohko-none-red",
		"none-orange": "ohko-none-orange"
	};

	var key = leftColor + "-" + rightColor;
	return classMap[key] || null;
}

// ============================================
// DRAG AND DROP FUNCTIONALITY
// ============================================

var draggedPokemonIndex = null;

function initDragDrop() {
	var teamContainer = document.getElementById('player-team-list');
	var boxContainer = document.getElementById('player-box-list');

	if (!teamContainer || !boxContainer) return;

	// Remove old event listeners by cloning containers (prevents memory leaks)
	var newTeamContainer = teamContainer.cloneNode(false);
	var newBoxContainer = boxContainer.cloneNode(false);

	// Move children to new containers
	while (teamContainer.firstChild) {
		newTeamContainer.appendChild(teamContainer.firstChild);
	}
	while (boxContainer.firstChild) {
		newBoxContainer.appendChild(boxContainer.firstChild);
	}

	// Replace old containers
	teamContainer.parentNode.replaceChild(newTeamContainer, teamContainer);
	boxContainer.parentNode.replaceChild(newBoxContainer, boxContainer);

	// Update references
	teamContainer = newTeamContainer;
	boxContainer = newBoxContainer;

	// Set draggable attribute on all Pokemon images
	var allPokemon = document.querySelectorAll('.player-pok');
	allPokemon.forEach(function(img) {
		img.setAttribute('draggable', 'true');
	});

	// Use event delegation on containers instead of individual listeners
	[teamContainer, boxContainer].forEach(function(container) {
		container.addEventListener('dragstart', handleDragStart);
		container.addEventListener('dragend', handleDragEnd);
		container.addEventListener('dragover', handleDragOver);
		container.addEventListener('dragenter', handleDragEnter);
		container.addEventListener('dragleave', handleDragLeave);
		container.addEventListener('drop', handleDrop);
	});
}

function handleDragStart(e) {
	// Only handle drag start on Pokemon images
	if (!e.target.classList.contains('player-pok')) return;

	var pokemonIndex = parseInt(e.target.dataset.pokemonIndex, 10);

	// Validate parsed index
	if (isNaN(pokemonIndex)) {
		console.error('Invalid pokemon index:', e.target.dataset.pokemonIndex);
		return;
	}

	draggedPokemonIndex = pokemonIndex;
	e.dataTransfer.setData('text/plain', draggedPokemonIndex.toString());
	e.dataTransfer.effectAllowed = 'move';

	// Use requestAnimationFrame instead of setTimeout to avoid race conditions
	requestAnimationFrame(function() {
		e.target.classList.add('dragging');
	});

	document.getElementById('player-team-list').classList.add('drag-active');
	document.getElementById('player-box-list').classList.add('drag-active');
}

function handleDragEnd(e) {
	// Only handle drag end on Pokemon images
	if (!e.target.classList.contains('player-pok')) return;

	e.target.classList.remove('dragging');
	cleanupDragStates();
	draggedPokemonIndex = null;
}

function handleDragOver(e) {
	e.preventDefault();
	e.dataTransfer.dropEffect = 'move';

	// Add visual feedback for valid drop targets
	if (e.target.classList.contains('player-pok') ||
	    e.target.id === 'player-team-list' ||
	    e.target.id === 'player-box-list') {
		e.currentTarget.classList.add('drag-valid');
	}
}

function handleDragEnter(e) {
	e.preventDefault();

	// Only handle drag enter on Pokemon images
	if (!e.target.classList.contains('player-pok')) return;

	var targetIndex = parseInt(e.target.dataset.pokemonIndex, 10);

	// Validate parsed index
	if (isNaN(targetIndex)) {
		console.error('Invalid target index:', e.target.dataset.pokemonIndex);
		return;
	}

	if (targetIndex === draggedPokemonIndex) return;
	e.target.classList.add('drag-over');
}

function handleDragLeave(e) {
	// Only handle drag leave on Pokemon images
	if (!e.target.classList.contains('player-pok')) return;

	e.target.classList.remove('drag-over');

	// Remove drag-valid class from container
	if (e.currentTarget.id === 'player-team-list' || e.currentTarget.id === 'player-box-list') {
		e.currentTarget.classList.remove('drag-valid');
	}
}

function handleDrop(e) {
	e.preventDefault();
	e.stopPropagation();

	var sourceIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);

	// Validate source index
	if (isNaN(sourceIndex)) {
		console.error('Invalid source index from drag data');
		cleanupDragStates();
		return;
	}

	// Handle drops on Pokemon images (SWAP behavior)
	if (e.target.classList.contains('player-pok')) {
		var targetIndex = parseInt(e.target.dataset.pokemonIndex, 10);

		// Validate target index
		if (isNaN(targetIndex)) {
			console.error('Invalid target index:', e.target.dataset.pokemonIndex);
			cleanupDragStates();
			return;
		}

		e.target.classList.remove('drag-over');
		cleanupDragStates();

		if (sourceIndex !== targetIndex) {
			swapPokemonPositions(sourceIndex, targetIndex);
		}
	} else {
		// Handle drops on empty container space (MOVE behavior)
		var targetContainer = e.currentTarget;
		var targetSection = null;

		if (targetContainer.id === 'player-team-list') {
			targetSection = 'team';
		} else if (targetContainer.id === 'player-box-list') {
			targetSection = 'box';
		}

		cleanupDragStates();

		if (targetSection) {
			movePokemonToSection(sourceIndex, targetSection);
		}
	}
}

function cleanupDragStates() {
	document.querySelectorAll('.player-pok').forEach(function(img) {
		img.classList.remove('dragging', 'drag-over');
	});

	var teamContainer = document.getElementById('player-team-list');
	var boxContainer = document.getElementById('player-box-list');

	if (teamContainer) {
		teamContainer.classList.remove('drag-active', 'drag-valid', 'drag-invalid');
	}
	if (boxContainer) {
		boxContainer.classList.remove('drag-active', 'drag-valid', 'drag-invalid');
	}
}

function swapPokemonPositions(sourceIndex, targetIndex) {
	if (sourceIndex < 0 || sourceIndex >= importedPokemonList.length) return false;
	if (targetIndex < 0 || targetIndex >= importedPokemonList.length) return false;
	if (sourceIndex === targetIndex) return false;

	var sourcePokemon = importedPokemonList[sourceIndex];
	var targetPokemon = importedPokemonList[targetIndex];

	// Swap section properties (so they trade places in Team/Box)
	var tempSection = sourcePokemon.section;
	sourcePokemon.section = targetPokemon.section;
	targetPokemon.section = tempSection;

	// Swap array positions
	importedPokemonList[sourceIndex] = targetPokemon;
	importedPokemonList[targetIndex] = sourcePokemon;

	saveImportedTeamToStorage();
	showPlayerTeamBox();
	updateTeamBoxMatchupColors();

	return true;
}

function movePokemonToSection(sourceIndex, targetSection) {
	if (sourceIndex < 0 || sourceIndex >= importedPokemonList.length) return false;

	var pokemon = importedPokemonList[sourceIndex];
	var currentSection = pokemon.section || 'team';
	var movingToTeam = targetSection === 'team';

	// If already in target section, do nothing
	if (currentSection === targetSection) {
		return false;
	}

	// Check team capacity when moving to team
	if (movingToTeam) {
		var currentTeamSize = importedPokemonList.filter(function(p) {
			return p.section === 'team';
		}).length;

		if (currentTeamSize >= 6) {
			console.log('Team is full (6 Pokemon). Use swap by dropping on a Pokemon instead.');
			return false;
		}
	}

	// Simply change the section property
	pokemon.section = targetSection;

	saveImportedTeamToStorage();
	showPlayerTeamBox();
	updateTeamBoxMatchupColors();

	return true;
}

function ExportPokemon(pokeInfo) {
	var pokemon = createPokemon(pokeInfo);
	var EV_counter = 0;
	var finalText = "";
	finalText = pokemon.name + (pokemon.item ? " @ " + pokemon.item : "") + "\n";
	finalText += "Level: " + pokemon.level + "\n";
	finalText += pokemon.nature && gen > 2 ? pokemon.nature + " Nature" + "\n" : "";
	if (gen === 9) {
		var teraType = pokeInfo.find(".teraType").val();
		if (teraType !== undefined && teraType !== pokemon.types[0]) {
			finalText += "Tera Type: " + teraType + "\n";
		}
	}
	finalText += pokemon.ability ? "Ability: " + pokemon.ability + "\n" : "";
	if (gen > 2) {
		var EVs_Array = [];
		for (var stat in pokemon.evs) {
			var ev = pokemon.evs[stat] ? pokemon.evs[stat] : 0;
			if (ev > 0) {
				EVs_Array.push(ev + " " + calc.Stats.displayStat(stat));
			}
			EV_counter += ev;
			if (EV_counter > 510) break;
		}
		if (EVs_Array.length > 0) {
			finalText += "EVs: ";
			finalText += serialize(EVs_Array, " / ");
			finalText += "\n";
		}
	}

	var IVs_Array = [];
	for (var stat in pokemon.ivs) {
		var iv = pokemon.ivs[stat] ? pokemon.ivs[stat] : 0;
		if (iv < 31) {
			IVs_Array.push(iv + " " + calc.Stats.displayStat(stat));
		}
	}
	if (IVs_Array.length > 0) {
		finalText += "IVs: ";
		finalText += serialize(IVs_Array, " / ");
		finalText += "\n";
	}

	for (var i = 0; i < 4; i++) {
		var moveName = pokemon.moves[i].name;
		if (moveName !== "(No Move)") {
			finalText += "- " + moveName + "\n";
		}
	}
	finalText = finalText.trim();
	$("textarea.import-team-text").val(finalText);
}

$("#exportL").click(function () {
	ExportPokemon($("#p1"));
});

$("#exportR").click(function () {
	ExportPokemon($("#p2"));
});

function serialize(array, separator) {
	var text = "";
	for (var i = 0; i < array.length; i++) {
		if (i < array.length - 1) {
			text += array[i] + separator;
		} else {
			text += array[i];
		}
	}
	return text;
}

function getAbility(row) {
	var ability = row[1] ? row[1].trim() : '';
	if (calc.ABILITIES[9].indexOf(ability) !== -1) return ability;
}

function getTeraType(row) {
	var teraType = row[1] ? row[1].trim() : '';
	if (Object.keys(calc.TYPE_CHART[9]).slice(1).indexOf(teraType) !== -1) return teraType;
}

function statToLegacyStat(stat) {
	switch (stat) {
	case 'hp':
		return "hp";
	case 'atk':
		return "at";
	case 'def':
		return "df";
	case 'spa':
		return "sa";
	case 'spd':
		return "sd";
	case 'spe':
		return "sp";
	}
}

function getStats(currentPoke, rows, offset) {
	currentPoke.nature = "Serious";
	var currentEV;
	var currentIV;
	var currentAbility;
	var currentTeraType;
	var currentNature;
	currentPoke.level = 100;
	for (var x = offset; x < offset + 9; x++) {
		var currentRow = rows[x] ? rows[x].split(/[/:]/) : '';
		var evs = {};
		var ivs = {};
		var ev;
		var j;

		switch (currentRow[0]) {
		case 'Level':
			currentPoke.level = parseInt(currentRow[1].trim());
			break;
		case 'EVs':
			for (j = 1; j < currentRow.length; j++) {
				currentEV = currentRow[j].trim().split(" ");
				currentEV[1] = statToLegacyStat(currentEV[1].toLowerCase());
				evs[currentEV[1]] = parseInt(currentEV[0]);
			}
			currentPoke.evs = evs;
			break;
		case 'IVs':
			for (j = 1; j < currentRow.length; j++) {
				currentIV = currentRow[j].trim().split(" ");
				currentIV[1] = statToLegacyStat(currentIV[1].toLowerCase());
				ivs[currentIV[1]] = parseInt(currentIV[0]);
			}
			currentPoke.ivs = ivs;
			break;

		}
		currentAbility = rows[x] ? rows[x].trim().split(":") : '';
		if (currentAbility[0] == "Ability") {
			currentPoke.ability = currentAbility[1].trim();
		}

		currentTeraType = rows[x] ? rows[x].trim().split(":") : '';
		if (currentTeraType[0] == "Tera Type") {
			currentPoke.teraType = currentTeraType[1].trim();
		}

		currentNature = rows[x] ? rows[x].trim().split(" ") : '';
		if (currentNature[1] == "Nature") {
			currentPoke.nature = currentNature[0];
		}
	}
	return currentPoke;
}

function getItem(currentRow, j) {
	for (;j < currentRow.length; j++) {
		var item = currentRow[j].trim();
		if (calc.ITEMS[9].indexOf(item) != -1) {
			return item;
		}
	}
}

function getMoves(currentPoke, rows, offset) {
	var movesFound = false;
	var moves = [];
	for (var x = offset; x < offset + 12; x++) {
		if (rows[x]) {
			if (rows[x][0] == "-") {
				movesFound = true;
				var move = rows[x].substr(2, rows[x].length - 2).replace("[", "").replace("]", "").replace("  ", "");
				moves.push(move);
			} else {
				if (movesFound == true) {
					break;
				}
			}
		}
	}
	currentPoke.moves = moves;
	return currentPoke;
}

function addToDex(poke) {
	var dexObject = {};
	if ($("#randoms").prop("checked")) {
		if (GEN9RANDOMBATTLE[poke.name] == undefined) GEN9RANDOMBATTLE[poke.name] = {};
		if (GEN8RANDOMBATTLE[poke.name] == undefined) GEN8RANDOMBATTLE[poke.name] = {};
		if (GEN7RANDOMBATTLE[poke.name] == undefined) GEN7RANDOMBATTLE[poke.name] = {};
		if (GEN6RANDOMBATTLE[poke.name] == undefined) GEN6RANDOMBATTLE[poke.name] = {};
		if (GEN5RANDOMBATTLE[poke.name] == undefined) GEN5RANDOMBATTLE[poke.name] = {};
		if (GEN4RANDOMBATTLE[poke.name] == undefined) GEN4RANDOMBATTLE[poke.name] = {};
		if (GEN3RANDOMBATTLE[poke.name] == undefined) GEN3RANDOMBATTLE[poke.name] = {};
		if (GEN2RANDOMBATTLE[poke.name] == undefined) GEN2RANDOMBATTLE[poke.name] = {};
		if (GEN1RANDOMBATTLE[poke.name] == undefined) GEN1RANDOMBATTLE[poke.name] = {};
	} else {
		if (SETDEX_SV[poke.name] == undefined) SETDEX_SV[poke.name] = {};
		if (SETDEX_SS[poke.name] == undefined) SETDEX_SS[poke.name] = {};
		if (SETDEX_SM[poke.name] == undefined) SETDEX_SM[poke.name] = {};
		if (SETDEX_XY[poke.name] == undefined) SETDEX_XY[poke.name] = {};
		if (SETDEX_BW[poke.name] == undefined) SETDEX_BW[poke.name] = {};
		if (SETDEX_DPP[poke.name] == undefined) SETDEX_DPP[poke.name] = {};
		if (SETDEX_ADV[poke.name] == undefined) SETDEX_ADV[poke.name] = {};
		if (SETDEX_GSC[poke.name] == undefined) SETDEX_GSC[poke.name] = {};
		if (SETDEX_RBY[poke.name] == undefined) SETDEX_RBY[poke.name] = {};
	}
	if (poke.ability !== undefined) {
		dexObject.ability = poke.ability;
	}
	if (poke.teraType !== undefined) {
		dexObject.teraType = poke.teraType;
	}
	dexObject.level = poke.level;
	dexObject.evs = poke.evs;
	dexObject.ivs = poke.ivs;
	dexObject.moves = poke.moves;
	dexObject.nature = poke.nature;
	dexObject.item = poke.item;
	dexObject.isCustomSet = poke.isCustomSet;
	var customsets;
	if (localStorage.customsets) {
		customsets = JSON.parse(localStorage.customsets);
	} else {
		customsets = {};
	}
	if (!customsets[poke.name]) {
		customsets[poke.name] = {};
	}
	customsets[poke.name][poke.nameProp] = dexObject;
	if (poke.name === "Aegislash-Blade") {
		if (!customsets["Aegislash-Shield"]) {
			customsets["Aegislash-Shield"] = {};
		}
		customsets["Aegislash-Shield"][poke.nameProp] = dexObject;
	}
	updateDex(customsets);
}

function updateDex(customsets) {
	for (var pokemon in customsets) {
		for (var moveset in customsets[pokemon]) {
			if (!SETDEX_SV[pokemon]) SETDEX_SV[pokemon] = {};
			SETDEX_SV[pokemon][moveset] = customsets[pokemon][moveset];
			if (!SETDEX_SS[pokemon]) SETDEX_SS[pokemon] = {};
			SETDEX_SS[pokemon][moveset] = customsets[pokemon][moveset];
			if (!SETDEX_SM[pokemon]) SETDEX_SM[pokemon] = {};
			SETDEX_SM[pokemon][moveset] = customsets[pokemon][moveset];
			if (!SETDEX_XY[pokemon]) SETDEX_XY[pokemon] = {};
			SETDEX_XY[pokemon][moveset] = customsets[pokemon][moveset];
			if (!SETDEX_BW[pokemon]) SETDEX_BW[pokemon] = {};
			SETDEX_BW[pokemon][moveset] = customsets[pokemon][moveset];
			if (!SETDEX_DPP[pokemon]) SETDEX_DPP[pokemon] = {};
			SETDEX_DPP[pokemon][moveset] = customsets[pokemon][moveset];
			if (!SETDEX_ADV[pokemon]) SETDEX_ADV[pokemon] = {};
			SETDEX_ADV[pokemon][moveset] = customsets[pokemon][moveset];
			if (!SETDEX_GSC[pokemon]) SETDEX_GSC[pokemon] = {};
			SETDEX_GSC[pokemon][moveset] = customsets[pokemon][moveset];
			if (!SETDEX_RBY[pokemon]) SETDEX_RBY[pokemon] = {};
			SETDEX_RBY[pokemon][moveset] = customsets[pokemon][moveset];
		}
	}
	localStorage.customsets = JSON.stringify(customsets);
}

function addSets(pokes, name) {
	var rows = pokes.split("\n");
	var currentRow;
	var currentPoke;
	var addedpokes = 0;

	// Clear the imported Pokemon list for fresh import
	importedPokemonList = [];

	for (var i = 0; i < rows.length; i++) {
		currentRow = rows[i].split(/[()@]/);
		for (var j = 0; j < currentRow.length; j++) {
			currentRow[j] = checkExeptions(currentRow[j].trim());
			if (calc.SPECIES[9][currentRow[j].trim()] !== undefined) {
				currentPoke = JSON.parse(JSON.stringify(calc.SPECIES[9][currentRow[j].trim()]));
				currentPoke.name = currentRow[j].trim();
				currentPoke.item = getItem(currentRow, j + 1);
				if (j === 1 && currentRow[0].trim()) {
					currentPoke.nameProp = currentRow[0].trim();
				} else {
					currentPoke.nameProp = name;
				}
				currentPoke.isCustomSet = true;
				currentPoke.ability = getAbility(rows[i + 1].split(":"));
				currentPoke.teraType = getTeraType(rows[i + 1].split(":"));
				currentPoke = getStats(currentPoke, rows, i + 1);
				currentPoke = getMoves(currentPoke, rows, i);
				addToDex(currentPoke);

				// Track this Pokemon for Team/Box display
				// Count current team size to determine section
				var currentTeamSize = importedPokemonList.filter(function(p) {
					return p.section === 'team';
				}).length;

				importedPokemonList.push({
					name: currentPoke.name,
					setName: currentPoke.nameProp,
					section: currentTeamSize < 6 ? 'team' : 'box'
				});

				addedpokes++;
			}
		}
	}

	// Update the Team/Box display
	showPlayerTeamBox();

	// Save team to localStorage for persistence
	saveImportedTeamToStorage();

	// Update matchup colors if opponent is selected
	updateTeamBoxMatchupColors();

	if (addedpokes == 1) {
		alert("Successfully imported 1 set");
		$(allPokemon("#importedSetsOptions")).css("display", "inline");
	} else if (addedpokes > 1) {
		alert("Successfully imported " + addedpokes + " sets");
		$(allPokemon("#importedSetsOptions")).css("display", "inline");
	} else {
		alert("No sets imported, please check your syntax and try again");
	}
}

function checkExeptions(poke) {
	switch (poke) {
	case 'Aegislash':
		poke = "Aegislash-Blade";
		break;
	case 'Basculin-Blue-Striped':
		poke = "Basculin";
		break;
	case 'Gastrodon-East':
		poke = "Gastrodon";
		break;
	case 'Mimikyu-Busted-Totem':
		poke = "Mimikyu-Totem";
		break;
	case 'Mimikyu-Busted':
		poke = "Mimikyu";
		break;
	case 'Pikachu-Belle':
	case 'Pikachu-Cosplay':
	case 'Pikachu-Libre':
	case 'Pikachu-Original':
	case 'Pikachu-Partner':
	case 'Pikachu-PhD':
	case 'Pikachu-Pop-Star':
	case 'Pikachu-Rock-Star':
		poke = "Pikachu";
		break;
	case 'Vivillon-Fancy':
	case 'Vivillon-Pokeball':
		poke = "Vivillon";
		break;
	case 'Florges-White':
	case 'Florges-Blue':
	case 'Florges-Orange':
	case 'Florges-Yellow':
		poke = "Florges";
		break;
	case 'Shellos-East':
		poke = "Shellos";
		break;
	case 'Deerling-Summer':
	case 'Deerling-Autumn':
	case 'Deerling-Winter':
		poke = "Deerling";
		break;
	}
	return poke;

}

$(allPokemon("#clearSets")).click(function () {
	if (confirm("Are you sure you want to delete your custom sets? This action cannot be undone.")) {
		localStorage.removeItem("customsets");
		alert("Custom Sets successfully cleared. Please refresh the page.");
		$(allPokemon("#importedSetsOptions")).hide();
		loadDefaultLists();
		// Clear the Team/Box display
		clearPlayerTeamBox();
	}
});

$(allPokemon("#importedSets")).click(function () {
	var pokeID = $(this).parent().parent().prop("id");
	var showCustomSets = $(this).prop("checked");
	if (showCustomSets) {
		loadCustomList(pokeID);
	} else {
		loadDefaultLists();
	}
});

$(document).ready(function () {
	var customSets;
	placeBsBtn();
	if (localStorage.customsets) {
		customSets = JSON.parse(localStorage.customsets);
		updateDex(customSets);
		$(allPokemon("#importedSetsOptions")).css("display", "inline");
	} else {
		loadDefaultLists();
	}

	// Load saved team list from localStorage
	loadImportedTeamFromStorage();

	// Update Team/Box matchup colors when opponent (P2) changes
	$("#p2 .set-selector").bind("change", function() {
		updateTeamBoxMatchupColors();
	});

	// Also update when trainer list changes (for trainer battles)
	$("#trainer-mon-list").bind("change", function() {
		// Small delay to allow the P2 selector to update first
		setTimeout(updateTeamBoxMatchupColors, 50);
	});
});

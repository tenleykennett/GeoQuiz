let countries = {};
let geojsonData = {};
let gameMode = "hard";
let worldContextLayers = [];

let currentCountry = null;
let countryLayer = null;

let hintCount = 0;
let currentRound = 1;

let neighborLayers = {};
let guessedNeighbors = new Set();

const SMALL_NEIGHBOR_AREA = 3000;

// Create map with all interaction disabled
const map = L.map("map", {
    zoomControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    touchZoom: false
}).setView([20, 0], 2);
map.createPane("smallNeighborPane");
map.getPane("smallNeighborPane").style.zIndex = 650;

let neighborLabelLayer = L.layerGroup().addTo(map);
let smallNeighborHintLayer = L.layerGroup().addTo(map);

document.getElementById("hint-remaining")
    .textContent = "Hints remaining: 3";

// Load game data
async function loadGameData() {

    const countriesResponse =
        await fetch("data/countries.json");

    countries =
        await countriesResponse.json();

    const geojsonResponse =
        await fetch("data/countries.geojson");

    geojsonData =
        await geojsonResponse.json();

    console.log(
        "Countries loaded:",
        Object.keys(countries).length
    );

    console.log(
        "GeoJSON countries loaded:",
        geojsonData.features.length
    );

    // Set up autocomplete independently.
    setupAutocomplete();

    // Populate the old testing dropdown separately.
    populateCountryDropdown();
}


// Populate the testing dropdown
function populateCountryDropdown() {

    const select = document.getElementById("country-select");

    if (!select) {
        return;
    }

    const playableCountries = Object.entries(countries)
        .filter(([code, country]) => country.playable)
        .filter(([code]) => {
            return geojsonData.features.some(
                feature => feature.properties.country_code === code
            );
    })

    .sort((a, b) => {

        return a[1].name.localeCompare(b[1].name);

    });

    for (const [code, country] of playableCountries) {

        const option = document.createElement("option");

        option.value = code;
        option.textContent = country.name;

        select.appendChild(option);
    }

    console.log(
        "Playable countries in dropdown:",
        playableCountries.length
    );
}

function setGameMode(mode) {


    // If already in this mode, do nothing.
    if (gameMode === mode) {
        return;
    }
    
    gameMode = mode;

    document
        .getElementById("easy-mode-button")
        .classList.toggle(
            "active",
            mode === "easy"
        );

    document
        .getElementById("hard-mode-button")
        .classList.toggle(
            "active",
            mode === "hard"
        );

    newCountry();
}

document
    .getElementById("easy-mode-button")
    .addEventListener("click", () => {
        setGameMode("easy");
    });

document
    .getElementById("hard-mode-button")
    .addEventListener("click", () => {
        setGameMode("hard");
    });

// Display a country and begin Round 1
function showCountry(code) {

    const feature = geojsonData.features.find(
        feature => feature.properties.country_code === code
    );

    if (!feature) {
        console.error("No GeoJSON found for:", code);
        return;
    }

    currentRound = 1;

    clearMapLayers();

    // Draw country
    countryLayer = L.geoJSON(feature, {
        style: {
            color: "#5e4c5a",
            weight: 1,
            fillColor: "#678d58",
            fillOpacity: 0.6
        }
    }).addTo(map);

    // Center country in the map
    map.fitBounds(countryLayer.getBounds(), {
        padding: [40, 40],
        maxZoom: 5
    });

    // Make selected country the current country
    currentCountry = {
        code: code,
        data: countries[code]
    };

    // Reset Round 1 interface
    resetGuessInterface();
}


// Start Round 2
function startNeighborRound() {

    if (!currentCountry) {
        return;
    }

    currentRound = 2;
    
    const hintArea =
        document.getElementById("hint-area");

    const hintList =
        document.getElementById("hint-list");

    const hintRemaining =
        document.getElementById("hint-remaining");

    const hintButton =
        document.getElementById("hint-button");

    const hintTitle =
        document.getElementById("hint-title");

    hintTitle.textContent =
        "Neighboring Countries";

    // Keep the hint box visible.
    hintArea.style.display = "block";

    // Clear the old hints.
    hintList.innerHTML = "";

    // Hide the hint button and remaining count.
    hintButton.style.display = "none";
    hintRemaining.style.display = "none";

    // Remove any previous map layout changes.
    document
        .querySelector(".map-section")
        .classList.remove("hints-hidden");
        
    guessedNeighbors = new Set();
    neighborLayers = {};

    // Clear previous layers and labels
    clearMapLayers();

    // Clear small-neighbor arrows
    smallNeighborHintLayer.clearLayers();

    const currentCode = currentCountry.code;
    const neighborCodes = currentCountry.data.neighbors || [];

    neighborCodes.forEach(() => {

        const item =
            document.createElement("li");

        item.textContent = "_____";

        hintList.appendChild(item);
    });

    if (neighborCodes.length === 0) {
        setupNeighborRoundUI();
        document.getElementById("message").textContent =
            `${currentCountry.data.name} has no neighbors... you get a free pass!`;

        document.getElementById("guess-input").parentElement.style.display =
            "none";

        document.getElementById("guess-button").style.display =
            "none";

        document.getElementById("give-up-button").style.display =
            "none";

        document.getElementById("continue-button").style.display =
            "inline-block";

        return;
    }
    // Find the main country
    const countryFeature = geojsonData.features.find(feature => {
        return feature.properties.country_code === currentCode;
    });

    if (!countryFeature) {
        console.error("No GeoJSON found for:", currentCode);
        return;
    }

    // Draw the main country in green
    countryLayer = L.geoJSON(countryFeature, {
        style: {
            color: "#5e4c5a",
            weight: 1,
            fillColor: "#678d58",
            fillOpacity: 0.8
        }
    }).addTo(map);

    // Draw neighboring countries in light grey
    neighborCodes.forEach(code => {

        const feature = geojsonData.features.find(feature => {
            return feature.properties.country_code === code;
        });

        if (!feature) {
            return;
        }

        const layer = L.geoJSON(feature, {
            style: {
                color: "#d0d0d0",
                weight: 1,
                fillColor: "#d9d9d9",
                fillOpacity: 0.8
            }
        }).addTo(map);

        neighborLayers[code] = layer;

        // ADD TINY NEIGHBOR CIRCLE
        const neighborData = countries[code];

        if (
            neighborData &&
            neighborData.area_km2 !== null &&
            neighborData.area_km2 <= SMALL_NEIGHBOR_AREA
        ) {

            const center = layer.getBounds().getCenter();

            L.circle(center, {
                radius: 40000,
                color: "#5e4c5a",
                weight: 2,
                fill: false,
                interactive: false,
                pane: "smallNeighborPane"
            }).addTo(smallNeighborHintLayer);
        }
    });

    countryLayer.bringToFront();

    // Fit map to the main country and its neighbors
    const allLayers = [
        countryLayer,
        ...Object.values(neighborLayers)
    ];

    const group = L.featureGroup(allLayers);

    map.fitBounds(group.getBounds(), {
        padding: [40, 40],
        maxZoom: 5
    });

    // Set up Round 2 controls
    setupNeighborRoundUI();
}


// Set up Round 2 interface
function setupNeighborRoundUI() {

    const inputWrapper =
        document.querySelector(".guess-input-wrapper");

    const guessButton =
        document.getElementById("guess-button");

    const giveUpButton =
        document.getElementById("give-up-button");

    const continueButton =
        document.getElementById("continue-button");

    const exploreButton =
        document.getElementById("explore-button");

    const hintArea =
        document.getElementById("hint-area");

    const message =
        document.getElementById("message");

    const input =
        document.getElementById("guess-input");

    // Show guessing controls
    inputWrapper.style.display = "block";
    guessButton.style.display = "inline-block";
    giveUpButton.style.display = "inline-block";

    // Hide things that don't belong in Round 2
    // hintArea.style.display = "none";
    exploreButton.style.display = "none";
    continueButton.style.display = "none";

    message.textContent = "";
    input.value = "";
    input.focus();
}


// Clear map layers from the previous round/country
function clearMapLayers() {

    if (countryLayer) {
        map.removeLayer(countryLayer);
        countryLayer = null;
    }

    Object.values(neighborLayers).forEach(layer => {
        map.removeLayer(layer);
    });

    neighborLayers = {};
    
    worldContextLayers.forEach(layer => {
        map.removeLayer(layer);
    });

    worldContextLayers = [];

    neighborLabelLayer.clearLayers();
    smallNeighborHintLayer.clearLayers();

    document.getElementById("country-info").style.display = "none";
}


// Start a new random country
function newCountry() {

    clearMapLayers();

    const playableCountries = Object.entries(countries)
        .filter(([code, country]) => {
            return country.playable;
        })
        .filter(([code]) => {
            return geojsonData.features.some(
                feature => feature.properties.country_code === code
            );
        });

    if (playableCountries.length === 0) {
        return;
    }

    // Pick a random country
    const randomIndex = Math.floor(
        Math.random() * playableCountries.length
    );

    const [code] = playableCountries[randomIndex];

    showCountry(code);

    if (gameMode === "easy") {
        showWorldContext();

        if (countryLayer) {
            countryLayer.bringToFront();
        }
    }

    neighborLabelLayer.bringToFront();

}


// Country dropdown
document
    .getElementById("country-select")
    .addEventListener("change", event => {

        const code = event.target.value;

        if (!code) {
            return;
        }

        showCountry(code);
    });


// Check Round 1 guess
function checkGuess() {

    const input = document.getElementById("guess-input");
    const message = document.getElementById("message");

    const guess = input.value.trim().toLowerCase();

    if (!guess) {
        return;
    }

    // Find a playable country matching the guess
    const guessedCountry = Object.entries(countries).find(
        ([code, country]) => {

            if (!country.playable) {
                return false;
            }

            const existsInGeoJSON = geojsonData.features.some(
                feature => feature.properties.country_code === code
            );

            if (!existsInGeoJSON) {
                return false;
            }

            return country.name.toLowerCase() === guess;
        }
    );

    // Not a valid country
    if (!guessedCountry) {
        message.textContent = "That is not a valid country.";
        return;
    }

    const guessedCode = guessedCountry[0];

    // Correct
    if (
        currentCountry &&
        guessedCode === currentCountry.code
    ) {

        message.textContent = "✓ Correct!";

        // Hide Submit
        document.getElementById("guess-button").style.display =
            "none";

        // Hide Give Up
        document.getElementById("give-up-button").style.display =
            "none";

        // Hide Hint button
        document.getElementById("hint-button").style.display =
            "none";

        // Show Continue On
        document.getElementById("continue-button").style.display =
            "inline-block";

        // Show Explore
        const exploreButton =
            document.getElementById("explore-button");

        const exploreName =
            document.getElementById("explore-country-name");

        exploreName.textContent =
            currentCountry.data.name;

        exploreButton.style.display = "block";

    } else {

        message.textContent = "Incorrect. Try again.";
    }

    input.value = "";
    input.focus();
}

function showWorldContext() {

    worldContextLayers = [];

    geojsonData.features.forEach(feature => {

        const code =
            feature.properties.country_code;

        // Don't draw the current country again
        if (
            currentCountry &&
            code === currentCountry.code
        ) {
            return;
        }

        const layer = L.geoJSON(feature, {
            style: {
                color: "#d0d0d0",
                weight: 1,
                fillColor: "#d9d9d9",
                fillOpacity: 0.6
            },
            interactive: false
        }).addTo(map);

        // Keep track of the layer so clearMapLayers()
        // can remove it later.
        worldContextLayers.push(layer);

        const country =
            countries[code];

        if (country) {
            addNeighborLabel(
                layer,
                country.name
            );
        }
    });

    if (countryLayer) {
        countryLayer.bringToFront();
    }

    neighborLabelLayer.bringToFront();
}

// Give up
function giveUp() {

    // Round 2
    if (currentRound === 2) {
        giveUpNeighborRound();
        return;
    }

    if (!currentCountry) {
        return;
    }

    const inputWrapper =
        document.querySelector(".guess-input-wrapper");

    const guessButton =
        document.getElementById("guess-button");

    const giveUpButton =
        document.getElementById("give-up-button");

    const exploreButton =
        document.getElementById("explore-button");

    const exploreName =
        document.getElementById("explore-country-name");

    const message =
        document.getElementById("message");

    // Hide guessing controls
    inputWrapper.style.display = "none";
    guessButton.style.display = "none";
    giveUpButton.style.display = "none";

    // Hide hints
    document.getElementById("hint-area").style.display = "none";

    // Reveal answer
    message.textContent =
        `The country was: ${currentCountry.data.name}`;

    // Set up Explore button
    exploreName.textContent =
        currentCountry.data.name;

    exploreButton.style.display = "inline-block";

    // Easy mode shows the world for context.
    // Hard mode also reveals the world when giving up.
    showWorldContext();

    if (countryLayer) {
        countryLayer.bringToFront();
    }

    neighborLabelLayer.bringToFront();
}


// Set up autocomplete
function setupAutocomplete() {

    const input =
        document.getElementById("guess-input");

    const list =
        document.getElementById("autocomplete-list");

    // Create alphabetized list of all countries and territories
    const countryNames = Object.values(countries)
        .map(country => country.name)
        .filter(name => name)
        .sort((a, b) => a.localeCompare(b));

    console.log("France:", countries["FRA"]);
    console.log("Norway:", countries["NOR"]);
    console.log("Kosovo:", countries["UNK"]);
    console.log("Total countries loaded:", Object.keys(countries).length);

    input.addEventListener("input", () => {

        const query =
            input.value.trim().toLowerCase();

        // Clear old suggestions
        list.innerHTML = "";

        if (!query) {
            list.style.display = "none";
            return;
        }

        // Only show names that START with the typed text
        const matches = countryNames.filter(name =>
            name.toLowerCase().startsWith(query)
        );

        if (matches.length === 0) {
            list.style.display = "none";
            return;
        }

        // Create suggestion items
        matches.forEach(name => {

            const item =
                document.createElement("div");

            item.className =
                "autocomplete-item";

            item.textContent = name;

            item.addEventListener("click", () => {

                input.value = name;
                list.style.display = "none";

                input.focus();
            });

            list.appendChild(item);
        });

        list.style.display = "block";
    });

    // Hide suggestions when clicking elsewhere
    document.addEventListener("click", event => {

        if (
            !event.target.closest(
                ".guess-input-wrapper"
            )
        ) {
            list.style.display = "none";
        }
    });
}


// Reset Round 1 interface
function resetGuessInterface() {

    hintCount = 0;

    const hintButton =
        document.getElementById("hint-button");

    const hintList =
        document.getElementById("hint-list");

    const hintArea =
        document.getElementById("hint-area");

    const hintRemaining =
        document.getElementById("hint-remaining");

    const inputWrapper =
        document.querySelector(".guess-input-wrapper");

    const guessButton =
        document.getElementById("guess-button");

    const giveUpButton =
        document.getElementById("give-up-button");

    const newCountryButton =
        document.getElementById("new-country-button");

    const continueButton =
        document.getElementById("continue-button");

    const exploreButton =
        document.getElementById("explore-button");

    const message =
        document.getElementById("message");

    const input =
        document.getElementById("guess-input");

    const list =
        document.getElementById("autocomplete-list");

    document.getElementById("hint-title").textContent =
        "Hints";

    // Round 1
    currentRound = 1;


    // Guess controls
    inputWrapper.style.display = "block";
    guessButton.style.display = "inline-block";
    giveUpButton.style.display = "inline-block";
    newCountryButton.style.display = "inline-block";


    // Continue / Explore
    continueButton.style.display = "none";
    exploreButton.style.display = "none";


    // Reset hints
    hintArea.style.display = "block";

    hintButton.style.display = "inline-block";

    hintRemaining.textContent =
        "Hints remaining: 3";

    hintList.innerHTML = "";


    // Make sure the hint panel is back beside the map
    document
        .querySelector(".map-section")
        .classList.remove("hints-hidden");


    // Messages / input
    message.textContent = "";

    input.value = "";

    list.innerHTML = "";

    list.style.display = "none";
}


// Give a hint
function giveHint() {

    if (!currentCountry) {
        return;
    }

    if (hintCount >= 3) {
        return;
    }

    hintCount++;

    const hintRemaining =
        document.getElementById("hint-remaining");

    const hintList =
        document.getElementById("hint-list");

    let hintText = "";

    if (hintCount === 1) {

        hintText =
            `The country is in ${currentCountry.data.continent}.`;

    }

    if (hintCount === 2) {

        const neighbors =
            currentCountry.data.neighbors || [];

        if (neighbors.length === 0) {

            hintText =
                "The country does not border another country.";

        } else {

            const randomNeighbor =
                neighbors[
                    Math.floor(
                        Math.random() * neighbors.length
                    )
                ];

            const neighborCountry =
                countries[randomNeighbor];

            if (neighborCountry) {

                hintText =
                    `The country borders ${neighborCountry.name}.`;

            } else {

                hintText =
                    "The country does not border another country.";

            }
        }
    }

    if (hintCount === 3) {

        if (currentCountry.data.capital) {

            hintText =
                `The country's capital is ${currentCountry.data.capital}.`;

        } else {

            hintText =
                "This country does not have a listed capital.";

        }
    }


    // Update remaining count.
    hintRemaining.textContent =
        `Hints remaining: ${3 - hintCount}`;


    // Add the new hint to the numbered list.
    const hintItem =
        document.createElement("li");

    hintItem.textContent = hintText;

    hintList.appendChild(hintItem);


    // Hide the button after the third hint.
    if (hintCount >= 3) {

        document.getElementById("hint-button")
            .style.display = "none";

    }
}


// Check Round 2 neighbor guess
function checkNeighborGuess() {

    const input =
        document.getElementById("guess-input");

    const message =
        document.getElementById("message");

    const guess =
        input.value.trim().toLowerCase();

    if (!guess) {
        return;
    }

    const neighborCodes =
        currentCountry.data.neighbors || [];

    const guessedCode =
        neighborCodes.find(code => {

            const country =
                countries[code];

            if (!country) {
                return false;
            }

            return (
                country.name.toLowerCase() === guess
            );
        });

    // Not a neighbor
    if (!guessedCode) {

        message.textContent =
            "That's not a neighboring country.";

        input.value = "";
        input.focus();

        return;
    }

    // Already guessed
    if (guessedNeighbors.has(guessedCode)) {

        message.textContent =
            "You already found that country.";

        input.value = "";
        input.focus();

        return;
    }

    // Correct neighbor
    guessedNeighbors.add(guessedCode);

    // Fill in the corresponding neighbor in the list
    const neighborIndex =
        neighborCodes.indexOf(guessedCode);

    const hintList =
        document.getElementById("hint-list");

    const hintItem =
        hintList.children[neighborIndex];

    if (hintItem) {
        hintItem.textContent =
            countries[guessedCode].name;
    }

    const layer =
        neighborLayers[guessedCode];
    if (layer) {

        layer.setStyle({
            color: "#e09f7d",
            weight: 2,
            fillColor: "#e09f7d",
            fillOpacity: 0.85
        });

        addNeighborLabel(
            layer,
            countries[guessedCode].name
        );
    }

    message.textContent = "Correct!";

    input.value = "";
    input.focus();

    // Check if all neighbors have been found
    if (
        guessedNeighbors.size === neighborCodes.length
    ) {
        finishNeighborRound();
    }
}


// Add a country name label to the map
function addNeighborLabel(layer, name) {

    const center =
        layer.getBounds().getCenter();

    const label =
        L.marker(center, {
            icon: L.divIcon({
                className: "country-label",
                html: `<span>${name}</span>`,
                iconSize: null
            }),
            interactive: false
        });

    neighborLabelLayer.addLayer(label);
}


// Finish Round 2
function finishNeighborRound() {

    const message =
        document.getElementById("message");

    const continueButton =
        document.getElementById("continue-button");

    const guessButton =
        document.getElementById("guess-button");

    const giveUpButton =
        document.getElementById("give-up-button");

    const inputWrapper =
        document.querySelector(".guess-input-wrapper");

    message.textContent =
        "✓ You found all the neighboring countries!";

    inputWrapper.style.display = "none";
    guessButton.style.display = "none";
    giveUpButton.style.display = "none";
    

    continueButton.style.display =
        "inline-block";
}


// Give up during Round 2
function giveUpNeighborRound() {

    if (!currentCountry) {
        return;
    }

    const message =
        document.getElementById("message");

    const neighborCodes =
        currentCountry.data.neighbors || [];

    // Reveal every neighbor
    neighborCodes.forEach(code => {

        const layer =
            neighborLayers[code];

        const country =
            countries[code];

        if (!layer || !country) {
            return;
        }

        // Don't add duplicate labels
        if (!guessedNeighbors.has(code)) {
            layer.setStyle({
                color: "#e09f7d",
                weight: 2,
                fillColor: "#e09f7d",
                fillOpacity: 0.85
            });

            addNeighborLabel(layer, country.name);

            const neighborIndex =
                neighborCodes.indexOf(code);

            const hintItem =
                document.getElementById("hint-list")
                    .children[neighborIndex];

            if (hintItem) {
                hintItem.textContent =
                    country.name;

                hintItem.classList.add(
                    "ungussed-neighbor"
                );
            }
        }
    });

    guessedNeighbors =
        new Set(neighborCodes);

    document.getElementById("give-up-button")
        .style.display = "none";

    document.getElementById("guess-button")
        .style.display = "none";

    message.textContent =
        "All neighboring countries revealed.";

    document.getElementById("continue-button")
        .style.display = "inline-block";
}


// Guess button
document
    .getElementById("guess-button")
    .addEventListener("click", () => {

        if (currentRound === 1) {

            checkGuess();

        } else if (currentRound === 2) {

            checkNeighborGuess();
        }
    });


// Give Up button
document
    .getElementById("give-up-button")
    .addEventListener("click", giveUp);


// Allow Enter to submit
document
    .getElementById("guess-input")
    .addEventListener("keydown", event => {

        if (event.key !== "Enter") {
            return;
        }

        if (currentRound === 1) {

            checkGuess();

        } else if (currentRound === 2) {

            checkNeighborGuess();
        }
    });


// New country button
document
    .getElementById("new-country-button")
    .addEventListener("click", newCountry);


// Explore button
document
    .getElementById("explore-button")
    .addEventListener("click", () => {

        document.getElementById("continue-button")
            .style.display = "none";

        document.getElementById("guess-button")
            .style.display = "none";

        document.getElementById("explore-button")
            .style.display = "none";

        const country =
            currentCountry.data;

        // Basic information
        document.getElementById("country-info-name")
            .textContent = country.name;

        document.getElementById("country-official-name")
            .textContent = country.official_name || "N/A";

        document.getElementById("country-capital")
            .textContent =
            country.capital || "No capital";

        document.getElementById("country-continent")
            .textContent =
            country.continent || "N/A";

        document.getElementById("country-subregion")
            .textContent =
            country.subregion || "N/A";

        document.getElementById("country-population")
            .textContent =
            country.population != null
                ? country.population.toLocaleString()
                : "N/A";

        document.getElementById("country-area")
            .textContent =
            country.area_km2 != null
                ? country.area_km2.toLocaleString()
                : "N/A";

        // Currency
        document.getElementById("country-currency")
            .textContent =
            country.currency
                ? `${country.currency.name} (${country.currency.code}) ${country.currency.symbol || ""}`
                : "N/A";

        // Languages
        document.getElementById("country-languages")
            .textContent =
            country.languages &&
            country.languages.length
                ? country.languages.join(", ")
                : "N/A";

        // Neighbors
        const neighborNames =
            (country.neighbors || [])
                .map(code => countries[code]?.name)
                .filter(Boolean);

        document.getElementById("country-neighbors")
            .textContent =
            neighborNames.length
                ? neighborNames.join(", ")
                : "None";

        // Landlocked
        document.getElementById("country-landlocked")
            .textContent =
            country.landlocked ? "Yes" : "No";

        // Flag
        const flag =
            document.getElementById("country-flag");

        flag.src = country.flag?.png || "";
        flag.alt = `${country.name} flag`;

        // Show the information panel
        document.getElementById("country-info")
            .style.display = "block";
    });


// Continue On button
document
    .getElementById("continue-button")
    .addEventListener("click", () => {

        if (currentRound === 1) {

            startNeighborRound();
        }

        // Round 3 will go here later.
    });


// Hint button
document
    .getElementById("hint-button")
    .addEventListener("click", giveHint);


// Load everything
loadGameData().then(() => {
    newCountry();
});
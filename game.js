let countries = {};
let geojsonData = {};
let currentCountry = null;
let countryLayer = null;


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


// Load game data
async function loadGameData() {

    const countriesResponse = await fetch("data/countries.json");
    countries = await countriesResponse.json();

    const geojsonResponse = await fetch("data/countries.geojson");
    geojsonData = await geojsonResponse.json();

    console.log(
        "Countries loaded:",
        Object.keys(countries).length
    );

    console.log(
        "GeoJSON countries loaded:",
        geojsonData.features.length
    );

    populateCountryDropdown();
    setupAutocomplete();
}


// Populate the testing dropdown
function populateCountryDropdown() {

    const select = document.getElementById("country-select");

    const playableCountries = Object.entries(countries)
        .filter(([code, country]) => country.playable)
        .filter(([code]) => {
            return geojsonData.features.some(
                feature => feature.properties.ISO_A3 === code
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


// Display a country
function showCountry(code) {

    const feature = geojsonData.features.find(feature => {
        return feature.properties.ISO_A3 === code;
    });

    if (!feature) {
        console.error("No GeoJSON found for:", code);
        return;
    }

    // Remove previous country
    if (countryLayer) {
        map.removeLayer(countryLayer);
    }

    // Draw country
    countryLayer = L.geoJSON(feature, {
        style: {
            color: "#5e4c5a",
            weight: 2,
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

    // Reset the guessing interface
    resetGuessInterface();
}

// Start a new random country
function newCountry() {

    const playableCountries = Object.entries(countries)
        .filter(([code, country]) => {
            return country.playable;
        })
        .filter(([code]) => {
            return geojsonData.features.some(
                feature => feature.properties.ISO_A3 === code
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


// Check the player's guess
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
                feature => feature.properties.ISO_A3 === code
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

    // Correct or incorrect
    if (currentCountry && guessedCode === currentCountry.code) {

        message.textContent = "✓ Correct!";

        // Hide Give Up
        document.getElementById("give-up-button").style.display = "none";

        // Show Continue On
        document.getElementById("continue-button").style.display = "inline-block";

        // Show Explore option
        const exploreButton = document.getElementById("explore-button");
        const exploreName = document.getElementById("explore-country-name");

        exploreName.textContent = currentCountry.data.name;
        exploreButton.style.display = "block";

    } else {

        message.textContent = "Incorrect. Try again.";
    }

    input.value = "";
    input.focus();
}


// Give up
function giveUp() {

    if (!currentCountry) {
        return;
    }

    const inputWrapper = document.querySelector(".guess-input-wrapper");
    const guessButton = document.getElementById("guess-button");
    const giveUpButton = document.getElementById("give-up-button");
    const message = document.getElementById("message");

    inputWrapper.style.display = "none";
    guessButton.style.display = "none";
    giveUpButton.style.display = "none";

    message.textContent =
        `The country was: ${currentCountry.data.name}`;
}


// Set up autocomplete
function setupAutocomplete() {

    const input = document.getElementById("guess-input");
    const list = document.getElementById("autocomplete-list");

    // Create alphabetized list of all countries and territories
    const countryNames = Object.values(countries)
        .map(country => country.name)
        .filter(name => name)
        .sort((a, b) => a.localeCompare(b));

    input.addEventListener("input", () => {

        const query = input.value.trim().toLowerCase();

        // Clear old suggestions
        list.innerHTML = "";

        if (!query) {
            list.style.display = "none";
            return;
        }

        // Find possible matches
        const matches = countryNames.filter(name =>
            name.toLowerCase().includes(query)
        );

        // No matches
        if (matches.length === 0) {
            list.style.display = "none";
            return;
        }

        // Create suggestion items
        matches.forEach(name => {

            const item = document.createElement("div");

            item.className = "autocomplete-item";
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

        if (!event.target.closest(".guess-input-wrapper")) {
            list.style.display = "none";
        }
    });
}


// Reset guessing interface
function resetGuessInterface() {

    const inputWrapper = document.querySelector(".guess-input-wrapper");
    const guessButton = document.getElementById("guess-button");
    const giveUpButton = document.getElementById("give-up-button");
    const newCountryButton = document.getElementById("new-country-button");
    const continueButton = document.getElementById("continue-button");
    const exploreButton = document.getElementById("explore-button");

    const message = document.getElementById("message");
    const input = document.getElementById("guess-input");
    const list = document.getElementById("autocomplete-list");

    inputWrapper.style.display = "block";
    guessButton.style.display = "inline-block";

    giveUpButton.style.display = "inline-block";
    newCountryButton.style.display = "inline-block";

    continueButton.style.display = "none";
    exploreButton.style.display = "none";

    message.textContent = "";
    input.value = "";

    list.innerHTML = "";
    list.style.display = "none";
}

// Guess button
document
    .getElementById("guess-button")
    .addEventListener("click", checkGuess);


// Give Up button
document
    .getElementById("give-up-button")
    .addEventListener("click", giveUp);


// Allow Enter to submit a guess
document
    .getElementById("guess-input")
    .addEventListener("keydown", event => {

        if (event.key === "Enter") {
            checkGuess();
        }

    });

// New country button
document
    .getElementById("new-country-button")
    .addEventListener("click", newCountry);

document
    .getElementById("explore-button")
    .addEventListener("click", () => {

        // Once the player chooses Explore,
        // Continue On is no longer available.
        document.getElementById("continue-button").style.display = "none";
        document.getElementById("guess-button").style.display = "none";

        // The country information panel will go here later.
        console.log(
            "Explore:",
            currentCountry.data.name
        );
    });


// Load everything
loadGameData().then(() => {
    newCountry();
});
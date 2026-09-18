import json
import os

import geopandas as gpd
import requests




API_URL = "https://api.restcountries.com/countries/v5"

PLAYABLE_FILE = "data/playable_countries.json"
COUNTRIES_OUTPUT = "data/countries.json"
GEOJSON_OUTPUT = "data/countries.geojson"

COUNTRIES_SHP = (
    "data/ne_10m_admin_0_countries/"
    "ne_10m_admin_0_countries.shp"
)

DISPUTED_SHP = (
    "data/ne_10m_admin_0_disputed_areas/"
    "ne_10m_admin_0_disputed_areas.shp"
)


# JetPunk display names
DISPLAY_NAMES = {
    "CPV": "Cape Verde",
    "CZE": "Czech Republic",
    "COD": "Democratic Republic of the Congo",
    "TLS": "East Timor",
    "FSM": "Federated States of Micronesia",
    "COG": "Republic of the Congo"
}


# -------------------------------------------------------------------
# DISPUTED AREA RULES
# -------------------------------------------------------------------
#
# These are Natural Earth feature names that we want to incorporate
# into a playable country's displayed outline.
#
# The values are ISO-3 country codes from countries.json.
#
DISPUTED_AREA_MAPPING = {
    "Somaliland": "SOM",
    "W. Sahara": "MAR",

    "Golan Heights": "ISR",
    "Shebaa Farms": "ISR",
    "East Jerusalem": "ISR",

    "Crimea": "RUS",

    "Taiwan": "TWN",

    "Kosovo": "SRB",

    "N. Cyprus": "CYP",

    "Georgia": "GEO",

    "Siachen Glacier": "IND",
    "India": "IND",

    "Pakistan": "PAK",

    "China": "CHN",

    "Bhutan": "BTN",

    "Ukraine": "UKR",
}


def get_countries():
    headers = {
        "Authorization": f"Bearer {os.environ['REST_COUNTRIES_API_KEY']}"
    }

    all_countries = []
    offset = 0
    limit = 100

    while True:
        params = {
            "limit": limit,
            "offset": offset
        }

        print(
            f"Downloading countries "
            f"{offset + 1}-{offset + limit}..."
        )

        response = requests.get(
            API_URL,
            headers=headers,
            params=params
        )

        response.raise_for_status()

        data = response.json()["data"]

        countries = data["objects"]
        all_countries.extend(countries)

        if not data["meta"]["more"]:
            break

        offset += limit

    return all_countries


def transform_country(country):
    code = country["codes"]["alpha_3"]

    name = DISPLAY_NAMES.get(
        code,
        country["names"]["common"]
    )

    capital = None

    if country.get("capitals"):
        primary_capitals = [
            c
            for c in country["capitals"]
            if c.get("primary")
        ]

        if primary_capitals:
            capital = primary_capitals[0]["name"]
        else:
            capital = country["capitals"][0]["name"]

    currency = None

    if country.get("currencies"):
        first_currency = country["currencies"][0]

        currency = {
            "code": first_currency.get("code"),
            "name": first_currency.get("name"),
            "symbol": first_currency.get("symbol")
        }

    languages = [
        language["name"]
        for language in country.get("languages", [])
    ]

    flag = country.get("flag", {})

    return {
        "name": name,
        "official_name": country["names"]["official"],
        "capital": capital,
        "continent": country.get("continents", [None])[0],
        "subregion": country.get("subregion"),
        "area_km2": country.get("area", {}).get("kilometers"),
        "population": country.get("population"),
        "currency": currency,
        "languages": languages,
        "neighbors": country.get("borders", []),
        "landlocked": country.get("landlocked", False),
        "flag": {
            "emoji": flag.get("emoji"),
            "svg": flag.get("url_svg"),
            "png": flag.get("url_png")
        }
    }

def build_geojson(country_metadata):
    print()
    print("Loading Natural Earth country boundaries...")

    countries_gdf = gpd.read_file(COUNTRIES_SHP)

    print(
        f"Base country features: {len(countries_gdf)}"
    )

    print()
    print("Loading Natural Earth disputed areas...")

    disputed_gdf = gpd.read_file(DISPUTED_SHP)

    print(
        f"Disputed features: {len(disputed_gdf)}"
    )

    # Make sure both datasets use the same coordinate system.
    if disputed_gdf.crs != countries_gdf.crs:
        disputed_gdf = disputed_gdf.to_crs(
            countries_gdf.crs
        )

    # ---------------------------------------------------------------
    # Disputed territories that should be merged explicitly.
    #
    # These are cases where the territory is not one of our
    # playable countries but should be represented as part of the
    # administering/claimed country for GeoQuiz.
    # ---------------------------------------------------------------

    special_merges = {
        "Somaliland": "SOM",
        "W. Sahara": "MAR",
    }

    # ---------------------------------------------------------------
    # Merge special cases.
    # ---------------------------------------------------------------

    for disputed_name, country_code in special_merges.items():

        rows = disputed_gdf[
            disputed_gdf["BRK_NAME"] == disputed_name
        ]

        if rows.empty:
            print(
                f"WARNING: Could not find "
                f"{disputed_name}"
            )
            continue

        matches = countries_gdf[
            countries_gdf["ISO_A3"] == country_code
        ]

        if matches.empty:
            print(
                f"WARNING: Could not find base country "
                f"{country_code}"
            )
            continue

        country_index = matches.index[0]

        for _, disputed in rows.iterrows():

            countries_gdf.at[
                country_index,
                "geometry"
            ] = (
                countries_gdf.loc[
                    country_index,
                    "geometry"
                ].union(
                    disputed.geometry
                )
            )

            print(
                f"Merged {disputed_name} "
                f"into {country_code}"
            )

    # ---------------------------------------------------------------
    # Automatically merge disputed areas where:
    #
    # 1. Natural Earth identifies the administering country
    # 2. That country is one of our playable countries
    # 3. The disputed feature is NOT itself a playable country
    #
    # ---------------------------------------------------------------

    playable_codes = {
        code
        for code, country in country_metadata.items()
        if country["playable"]
    }

    playable_names = {
        country["name"]
        for country in country_metadata.values()
        if country["playable"]
    }

    for _, disputed in disputed_gdf.iterrows():

        brk_name = disputed["BRK_NAME"]

        # Don't process the explicit special cases twice.
        if brk_name in special_merges:
            continue

        # ISO_A3 is often -99 in the disputed dataset.
        # ADM0_A3 is the Natural Earth administrative country code.
        country_code = disputed["ADM0_A3"]

        # Ignore features without a useful country code.
        if country_code in (None, "", "-99"):
            continue

        # Only merge into playable countries.
        if country_code not in playable_codes:
            continue

        # If the disputed feature is itself a playable country,
        # leave it alone.
        if brk_name in playable_names:
            continue

        matches = countries_gdf[
            countries_gdf["ISO_A3"] == country_code
        ]

        if matches.empty:
            continue

        country_index = matches.index[0]

        countries_gdf.at[
            country_index,
            "geometry"
        ] = (
            countries_gdf.loc[
                country_index,
                "geometry"
            ].union(
                disputed.geometry
            )
        )

        print(
            f"Merged {brk_name} "
            f"into {country_code}"
        )

    # ---------------------------------------------------------------
    # Keep only our 196 playable countries.
    # ---------------------------------------------------------------

    countries_gdf = countries_gdf[
        countries_gdf["ISO_A3"].isin(
            playable_codes
        )
    ].copy()

    # Make sure geometry is valid after unions.
    countries_gdf["geometry"] = (
        countries_gdf["geometry"].make_valid()
    )

    # Add simple properties for GeoQuiz.
    countries_gdf["country_code"] = (
        countries_gdf["ISO_A3"]
    )

    countries_gdf["country_name"] = (
        countries_gdf["ISO_A3"].map(
            lambda code:
            country_metadata[code]["name"]
        )
    )

    countries_gdf.to_file(
        GEOJSON_OUTPUT,
        driver="GeoJSON"
    )

    print()
    print(
        f"Created {GEOJSON_OUTPUT}"
    )

    print(
        f"Playable GeoJSON features: "
        f"{len(countries_gdf)}"
    )
    
# -------------------------------------------------------------------
# BUILD COUNTRIES.JSON
# -------------------------------------------------------------------

def build_country_metadata():
    print("Loading playable country list...")

    with open(
        PLAYABLE_FILE,
        "r",
        encoding="utf-8"
    ) as file:
        playable_names = set(json.load(file))

    print(
        f"Playable names loaded: "
        f"{len(playable_names)}"
    )

    print()
    print("Downloading country data...")

    countries = get_countries()

    print(
        f"Received {len(countries)} countries."
    )

    output = {}

    for country in countries:
        code = country["codes"].get("alpha_3")

        if not code:
            print(
                f"Skipping {country['names']['common']} "
                "because it has no alpha-3 code."
            )
            continue

        transformed = transform_country(country)

        transformed["playable"] = (
            transformed["name"] in playable_names
        )

        output[code] = transformed

    os.makedirs("data", exist_ok=True)

    with open(
        COUNTRIES_OUTPUT,
        "w",
        encoding="utf-8"
    ) as file:
        json.dump(
            output,
            file,
            indent=4,
            ensure_ascii=False
        )

    playable_count = sum(
        country["playable"]
        for country in output.values()
    )

    print()
    print(
        f"Created {COUNTRIES_OUTPUT}"
    )
    print(
        f"Countries written: {len(output)}"
    )
    print(
        f"Playable countries: {playable_count}"
    )

    return output


# -------------------------------------------------------------------
# BUILD COUNTRIES.GEOJSON
# -------------------------------------------------------------------

def build_geojson(country_metadata):

    print()
    print("Loading Natural Earth country boundaries...")

    countries_gdf = gpd.read_file(COUNTRIES_SHP)

    print(
        f"Base country features: "
        f"{len(countries_gdf)}"
    )

    print()
    print("Loading Natural Earth disputed areas...")

    disputed_gdf = gpd.read_file(DISPUTED_SHP)

    print(
        f"Disputed features: "
        f"{len(disputed_gdf)}"
    )

    # Make sure both datasets use the same CRS.
    if disputed_gdf.crs != countries_gdf.crs:
        disputed_gdf = disputed_gdf.to_crs(
            countries_gdf.crs
        )

    # Only keep disputed areas that we explicitly
    # decided to assign to a playable country.
    selected_disputed = disputed_gdf[
        disputed_gdf["NAME"].isin(
            DISPUTED_AREA_MAPPING.keys()
        )
    ].copy()

    print()
    print(
        f"Selected disputed features: "
        f"{len(selected_disputed)}"
    )

    # ----------------------------------------------------------------
    # Merge disputed geometry into country geometry.
    # ----------------------------------------------------------------

    for _, disputed in selected_disputed.iterrows():

        disputed_name = disputed["NAME"]
        country_code = DISPUTED_AREA_MAPPING[
            disputed_name
        ]

        # Only merge into playable countries.
        if not country_metadata.get(
            country_code,
            {}
        ).get("playable", False):
            print(
                f"Skipping {disputed_name}: "
                f"{country_code} is not playable."
            )
            continue

        # Find matching Natural Earth country.
        matches = countries_gdf[
            countries_gdf["ISO_A3"] == country_code
        ]

        if matches.empty:
            print(
                f"WARNING: Could not find base geometry "
                f"for {country_code} "
                f"({disputed_name})"
            )
            continue

        index = matches.index[0]

        countries_gdf.at[index, "geometry"] = (
            countries_gdf.loc[index, "geometry"]
            .union(disputed.geometry)
        )

        print(
            f"Merged {disputed_name} "
            f"into {country_code}"
        )

    # ----------------------------------------------------------------
    # Keep only playable countries.
    # ----------------------------------------------------------------

    playable_codes = {
        code
        for code, country in country_metadata.items()
        if country["playable"]
    }

    countries_gdf = countries_gdf[
        countries_gdf["ISO_A3"].isin(playable_codes)
    ].copy()

    # Make the GeoJSON properties simple and useful.
    countries_gdf["country_code"] = (
        countries_gdf["ISO_A3"]
    )

    countries_gdf["country_name"] = (
        countries_gdf["ISO_A3"]
        .map(
            lambda code:
            country_metadata[code]["name"]
        )
    )

    # Validate/fix geometry after unions.
    countries_gdf["geometry"] = (
        countries_gdf["geometry"].make_valid()
    )

    countries_gdf.to_file(
        GEOJSON_OUTPUT,
        driver="GeoJSON"
    )

    print()
    print(
        f"Created {GEOJSON_OUTPUT}"
    )
    print(
        f"Playable GeoJSON features: "
        f"{len(countries_gdf)}"
    )


# -------------------------------------------------------------------
# MAIN
# -------------------------------------------------------------------

def main():
    print("Loading playable country list...")

    with open(
        PLAYABLE_FILE,
        "r",
        encoding="utf-8"
    ) as file:
        playable_names = set(json.load(file))

    print(
        f"Playable names loaded: "
        f"{len(playable_names)}"
    )

    print()
    print("Downloading country data...")

    countries = get_countries()

    print(
        f"Received {len(countries)} countries."
    )
    print()

    output = {}

    for country in countries:
        code = country["codes"].get("alpha_3")

        if not code:
            print(
                f"Skipping {country['names']['common']} "
                "because it has no alpha-3 code."
            )
            continue

        transformed = transform_country(country)

        transformed["playable"] = (
            transformed["name"] in playable_names
        )

        output[code] = transformed

    os.makedirs("data", exist_ok=True)

    with open(
        COUNTRIES_OUTPUT,
        "w",
        encoding="utf-8"
    ) as file:
        json.dump(
            output,
            file,
            indent=4,
            ensure_ascii=False
        )

    playable_count = sum(
        country["playable"]
        for country in output.values()
    )

    print()
    print(
        f"Created {COUNTRIES_OUTPUT}"
    )

    print(
        f"Countries written: {len(output)}"
    )

    print(
        f"Playable countries: {playable_count}"
    )

    # Build the merged Natural Earth GeoJSON.
    build_geojson(output)
    
if __name__ == "__main__":
    main()
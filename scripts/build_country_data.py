import json
import os

import geopandas as gpd
import requests

# Countries where we only want the mainland geometry.
# The mainland is represented by the largest connected polygon.
MAINLAND_ONLY = {
    "FRA",  # France
    "RUS",  # Russia
    "NLD",  # Netherlands
    "NOR", # Norway
    "ESP", # Spain
    "USA", #USA
}

NATURAL_EARTH_CODE_MAPPING = {
    "KOS": "UNK",
}

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

def keep_mainland(geometry):
    """
    Keep the largest connected polygon in a country's geometry.

    This removes distant overseas territories/islands that cause
    the map to zoom way out.
    """

    if geometry.geom_type == "Polygon":
        return geometry

    if geometry.geom_type == "MultiPolygon":
        return max(
            geometry.geoms,
            key=lambda polygon: polygon.area
        )

    return geometry

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
        # Natural Earth sometimes uses ISO_A3 = "-99"
        # and stores the real code in ADM0_A3.
        matches = countries_gdf[
            (
                countries_gdf["ISO_A3"] == country_code
            )
            |
            (
                countries_gdf["ADM0_A3"] == country_code
            )
        ]

        if matches.empty:
            print(
                f"WARNING: Could not find base geometry "
                f"for {country_code} "
                f"({disputed_name})"
            )
            continue

        index = matches.index[0]

        countries_gdf.at[
            index,
            "geometry"
        ] = (
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

    # Natural Earth sometimes uses ISO_A3 = "-99".
    # In those cases, use ADM0_A3 instead.
    countries_gdf["country_code"] = (
        countries_gdf["ISO_A3"]
        .where(
            countries_gdf["ISO_A3"] != "-99",
            countries_gdf["ADM0_A3"]
        )
        .replace(
            NATURAL_EARTH_CODE_MAPPING
        )
    )

    countries_gdf = countries_gdf[
        countries_gdf["country_code"].isin(
            playable_codes
        )
    ].copy()

    # ----------------------------------------------------------------
    # Remove overseas territories for selected countries.
    # ----------------------------------------------------------------

    for country_code in MAINLAND_ONLY:

        matches = countries_gdf[
            countries_gdf["country_code"] == country_code
        ]

        if matches.empty:
            continue

        index = matches.index[0]

        countries_gdf.at[
            index,
            "geometry"
        ] = keep_mainland(
            countries_gdf.loc[index, "geometry"]
        )

        print(
            f"Kept mainland geometry for "
            f"{country_code}"
        )

    # ----------------------------------------------------------------
    # Make the GeoJSON properties simple and useful.
    # ----------------------------------------------------------------

    countries_gdf["country_name"] = (
        countries_gdf["country_code"]
        .map(
            lambda code:
            country_metadata[code]["name"]
        )
    )

    # ----------------------------------------------------------------
    # Validate/fix geometry after unions.
    # ----------------------------------------------------------------

    countries_gdf["geometry"] = (
        countries_gdf["geometry"].make_valid()
    )

    # ----------------------------------------------------------------
    # Write GeoJSON.
    # ----------------------------------------------------------------

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
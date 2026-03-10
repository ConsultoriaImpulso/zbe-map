import csv, json
from pathlib import Path

IN_PATH = Path("zbe_vertices.csv")   # CIUDAD, ORDEN, LAT, LNG
OUT_PATH = Path("zbe.geojson")

def norm(s: str) -> str:
    return " ".join((s or "").strip().split())

def read_csv_any(path: Path):
    raw = path.read_text(encoding="utf-8-sig", errors="replace")
    # autodetect delimiter (comma or ;)
    sample = "\n".join(raw.splitlines()[:10])
    dialect = csv.Sniffer().sniff(sample, delimiters=",;")
    reader = csv.DictReader(raw.splitlines(), delimiter=dialect.delimiter)
    return list(reader)

rows = read_csv_any(IN_PATH)

# detect column names (flexible)
def pick(row, keys):
    for k in keys:
        for rk in row.keys():
            if rk.strip().lower() == k:
                return row[rk]
    for k in keys:
        for rk in row.keys():
            if k in rk.strip().lower():
                return row[rk]
    return ""

groups = {}  # city -> list of (order, lng, lat) in GeoJSON order

for r in rows:
    city = norm(pick(r, ["ciudad", "city"]))
    if not city:
        continue
    order_raw = norm(pick(r, ["orden", "order", "idx", "index"]))
    lat_raw = norm(pick(r, ["lat", "latitud", "latitude"])).replace(",", ".")
    lng_raw = norm(pick(r, ["lng", "lon", "longitud", "longitude"])).replace(",", ".")
    try:
        order = int(float(order_raw)) if order_raw else 0
        lat = float(lat_raw)
        lng = float(lng_raw)
    except:
        continue
    groups.setdefault(city, []).append((order, lng, lat))

features = []
for city, pts in groups.items():
    pts.sort(key=lambda x: x[0])
    coords = [[lng, lat] for _, lng, lat in pts]

    # close polygon: first point == last point
    if coords and coords[0] != coords[-1]:
        coords.append(coords[0])

    # Need at least 4 points (including closure)
    if len(coords) < 4:
        continue

    features.append({
        "type": "Feature",
        "properties": {"city": city},
        "geometry": {"type": "Polygon", "coordinates": [coords]}
    })

geojson = {"type": "FeatureCollection", "features": features}
OUT_PATH.write_text(json.dumps(geojson, ensure_ascii=False), encoding="utf-8")
print(f"OK -> {OUT_PATH} ({len(features)} ciudades)")
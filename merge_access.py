import csv
from pathlib import Path

MAP_PATH = Path("mapa_zbe.csv")
DRIVE_PATH = Path("drive_zbe.csv")
OUT_PATH = Path("access.csv")

def norm(s: str) -> str:
    return " ".join((s or "").strip().split())

def find_col(cols, wanted):
    cols_l = [c.strip().lower() for c in cols]
    for w in wanted:
        w = w.lower()
        if w in cols_l:
            return cols_l.index(w)
    # fuzzy contains
    for i, c in enumerate(cols_l):
        for w in wanted:
            if w.lower() in c:
                return i
    return None

def read_csv(path: Path):
    # Lee CSV con autodetección de delimitador (coma/;). Maneja BOM.
    raw = path.read_text(encoding="utf-8-sig", errors="replace")
    sample = raw.splitlines()[0:10]
    sample_text = "\n".join(sample)
    dialect = csv.Sniffer().sniff(sample_text, delimiters=",;")
    reader = csv.reader(raw.splitlines(), dialect)
    rows = list(reader)
    if not rows:
        raise ValueError(f"{path} está vacío")
    header = rows[0]
    data = rows[1:]
    return header, data, dialect.delimiter

# 1) Cargar MAPA ZBE (CIUDAD -> lat/lng)
map_header, map_rows, _ = read_csv(MAP_PATH)

i_city_m = find_col(map_header, ["ciudad", "city"])
i_lat = find_col(map_header, ["lat", "latitud"])
i_lng = find_col(map_header, ["lng", "lon", "longitud", "longitude"])

if i_city_m is None or i_lat is None or i_lng is None:
    raise ValueError(
        "mapa_zbe.csv debe tener columnas CIUDAD + LAT/LATITUD + LNG/LONGITUD.\n"
        f"Columnas encontradas: {map_header}"
    )

coords = {}
for r in map_rows:
    city = norm(r[i_city_m])
    if not city:
        continue
    lat = norm(r[i_lat]).replace(",", ".")
    lng = norm(r[i_lng]).replace(",", ".")
    coords[city] = (lat, lng)

# 2) Cargar DRIVE ZBE (reglas)
drive_header, drive_rows, _ = read_csv(DRIVE_PATH)

i_city_d = find_col(drive_header, ["ciudad", "city"])
i_badge = find_col(drive_header, ["distintivo ambiental", "distintivo", "etiqueta"])
i_vehicle = find_col(drive_header, ["tipo vehículo", "tipo vehiculo", "vehículo", "vehiculo"])
i_access = find_col(drive_header, ["acceso"])
i_obs = find_col(drive_header, ["observaciones", "observación", "observacion"])

if i_city_d is None or i_access is None:
    raise ValueError(
        "drive_zbe.csv debe tener como mínimo CIUDAD y ACCESO.\n"
        f"Columnas encontradas: {drive_header}"
    )

# Si faltan badge/vehicle, avisamos (pero generamos igualmente)
missing = []
if i_badge is None:
    missing.append("DISTINTIVO AMBIENTAL")
if i_vehicle is None:
    missing.append("TIPO VEHÍCULO")
if missing:
    print("⚠️ AVISO: En drive_zbe.csv faltan columnas:", ", ".join(missing))
    print("   -> En ese caso, el HTML no podrá reproducir filtros por distintivo/tipo igual que Power BI.")
    print("   -> Aun así genero access.csv, dejando badge/vehicle vacíos.")

# 3) Escribir access.csv en el formato que usa el dashboard HTML
out_header = ["city", "badge", "vehicle", "access", "obs_access", "obs_mobility", "obs_parking", "lat", "lng"]
with OUT_PATH.open("w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(out_header)

    missing_coords = 0
    for r in drive_rows:
        city = norm(r[i_city_d])
        if not city:
            continue

        badge = norm(r[i_badge]) if i_badge is not None else ""
        vehicle = norm(r[i_vehicle]) if i_vehicle is not None else ""
        access = norm(r[i_access])
        obs = norm(r[i_obs]) if i_obs is not None else ""

        lat, lng = coords.get(city, ("", ""))
        if not lat or not lng:
            missing_coords += 1

        # Metemos OBSERVACIONES como obs_access (puedes repartirlo luego si quieres)
        w.writerow([city, badge, vehicle, access, obs, "", "", lat, lng])

print(f"✅ Generado {OUT_PATH} con éxito.")
print(f"Ciudades sin coordenadas encontradas: {missing_coords}")
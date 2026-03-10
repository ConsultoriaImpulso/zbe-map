import pandas as pd
import json

drive = pd.read_excel("ZBE.xlsx")
mapa = pd.read_csv("mapa_zbe.csv")

data = drive.merge(mapa, on="CIUDAD", how="left")

records = []

for _, r in data.iterrows():

    records.append({
        "city": r["CIUDAD"],
        "badge": r["DISTINTIVO AMBIENTAL"],
        "vehicle": r["TIPO VEHÍCULO"],
        "access": r["ACCESO"],
        "estado_zbe": r["ESTADO ZBE"],
        "observations_html": str(r["OBSERVACIONES"]),
        "lat": r.get("LAT"),
        "lng": r.get("LNG")
    })

with open("access.json","w",encoding="utf8") as f:
    json.dump(records,f,ensure_ascii=False,indent=2)

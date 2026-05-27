#!/usr/bin/env python3
"""Processa CSV TSE (seções PI) e gera data_pi.json para o dashboard estadual."""

import hashlib
import json
import math
import os
import re
import unicodedata

import pandas as pd

from parse_data import get_bairro

CSV_FILE = os.environ.get(
    "PI_CSV_FILE",
    os.path.join("data", "votacao_pi_bolsonaro_2022.csv"),
)
GEOJSON_FILE = os.path.join("geo", "pi-municipios.geojson")
TERESINA_DATA_JSON = "data.json"
OUTPUT_JSON = "data_pi.json"
TERESINA_IBGE = "2211001"


def norm_name(s):
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFD", s.upper())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s).strip()


def ring_centroid(coords):
    n = len(coords)
    if n < 3:
        return None
    area = 0.0
    cx = cy = 0.0
    for i in range(n - 1):
        x0, y0 = coords[i]
        x1, y1 = coords[i + 1]
        cross = x0 * y1 - x1 * y0
        area += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    area *= 0.5
    if abs(area) < 1e-12:
        xs = [c[0] for c in coords]
        ys = [c[1] for c in coords]
        return sum(ys) / len(ys), sum(xs) / len(xs)
    return cy / (6 * area), cx / (6 * area)


def load_geo_index():
    """Índice IBGE (malha oficial) por código e por nome — alinha mapa + CSV TSE."""
    if not os.path.exists(GEOJSON_FILE):
        print(f"Aviso: {GEOJSON_FILE} não encontrado. Coordenadas ficarão vazias.")
        return {}, {}
    with open(GEOJSON_FILE, "r", encoding="utf-8") as f:
        geo = json.load(f)
    coords_by_ibge = {}
    name_to_ibge = {}
    for feat in geo.get("features", []):
        mid = str(feat.get("properties", {}).get("id", "")).zfill(7)
        nome_geo = feat.get("properties", {}).get("name", "")
        name_to_ibge[norm_name(nome_geo)] = mid
        geom = feat.get("geometry") or {}
        lat = lon = None
        if geom.get("type") == "Polygon":
            lat, lon = ring_centroid(geom["coordinates"][0])
        elif geom.get("type") == "MultiPolygon":
            best_area = 0
            best = None
            for poly in geom["coordinates"]:
                ring = poly[0]
                a = 0.0
                for i in range(len(ring) - 1):
                    x0, y0 = ring[i]
                    x1, y1 = ring[i + 1]
                    a += x0 * y1 - x1 * y0
                a = abs(a)
                if a > best_area:
                    best_area = a
                    best = ring_centroid(ring)
            if best:
                lat, lon = best
        if lat is not None:
            coords_by_ibge[mid] = {"lat": float(lat), "lon": float(lon)}
    return coords_by_ibge, name_to_ibge


def score_opportunity(row, state_perc, median_aptos):
    """Pontuação 0–100: prioridade estratégica para campanha."""
    aptos = row["aptos"]
    if aptos <= 0:
        return 0.0
    abst = row["perc_abstencao"]
    comp = row["perc_comparecimento"]
    perc = row["perc_bolsonaro"]
    votos = row["votos_bolsonaro"]

    abst_excess = max(0, abst - 0.18) * 100
    perc_gap = max(0, state_perc - perc) * 100
    size_factor = min(2.0, math.log10(max(aptos, 10)) / 4.0)

    mobilizacao = abst_excess * size_factor * (1.2 if aptos >= median_aptos else 0.85)
    conversao = perc_gap * comp * 10 * size_factor
    expansao = perc_gap * (votos / max(aptos, 1)) * 500 * size_factor

    return round(min(100, mobilizacao * 0.35 + conversao * 0.4 + expansao * 0.25), 2)


def build_insights(munis, state_summary):
    state_perc = state_summary["percentual"]
    top_votos = sorted(munis, key=lambda m: m["votos_bolsonaro"], reverse=True)[:5]
    top_perc = sorted(
        [m for m in munis if m["votos_nominais"] >= 500],
        key=lambda m: m["perc_bolsonaro"],
        reverse=True,
    )[:5]
    top_abst = sorted(munis, key=lambda m: m["perc_abstencao"], reverse=True)[:5]
    top_opportunity = sorted(munis, key=lambda m: m["score_oportunidade"], reverse=True)[:8]

    insights = [
        {
            "title": "Panorama Estadual",
            "description": (
                f"No Piauí, Bolsonaro teve **{state_summary['votos_bolsonaro']:,} votos** "
                f"({state_summary['percentual']*100:.2f}% dos nominais válidos), com "
                f"**{state_summary['comparecimento']:,} comparecimentos** e "
                f"**{state_summary['abstencoes']:,} abstenções** "
                f"({state_summary['perc_abstencao']*100:.1f}% dos aptos)."
            ),
            "type": "info",
        },
        {
            "title": "Maior Volume de Votos",
            "description": (
                f"**{top_votos[0]['nm_municipio']}** lidera em votos absolutos "
                f"({top_votos[0]['votos_bolsonaro']:,}), seguido por "
                f"**{top_votos[1]['nm_municipio']}** ({top_votos[1]['votos_bolsonaro']:,}) e "
                f"**{top_votos[2]['nm_municipio']}** ({top_votos[2]['votos_bolsonaro']:,})."
            ),
            "type": "positive",
        },
        {
            "title": "Maior Percentual (mín. 500 nominais)",
            "description": (
                f"Destaque percentual em **{top_perc[0]['nm_municipio']}** "
                f"({top_perc[0]['perc_bolsonaro']*100:.1f}%), "
                f"**{top_perc[1]['nm_municipio']}** ({top_perc[1]['perc_bolsonaro']*100:.1f}%) e "
                f"**{top_perc[2]['nm_municipio']}** ({top_perc[2]['perc_bolsonaro']*100:.1f}%)."
            ),
            "type": "percent",
        },
        {
            "title": "Abstenção Elevada (mobilização)",
            "description": (
                f"Maior abstenção: **{top_abst[0]['nm_municipio']}** ({top_abst[0]['perc_abstencao']*100:.1f}%), "
                f"**{top_abst[1]['nm_municipio']}** ({top_abst[1]['perc_abstencao']*100:.1f}%). "
                "Cidades com abstencão alta são alvos para campanha de comparecimento."
            ),
            "type": "negative",
        },
    ]

    strategy_lines = []
    for i, m in enumerate(top_opportunity[:5], 1):
        tag = m["estrategia_principal"]
        strategy_lines.append(
            f"{i}. **{m['nm_municipio']}** — {tag} (score {m['score_oportunidade']:.0f}): "
            f"{m['votos_bolsonaro']:,} votos, {m['perc_bolsonaro']*100:.1f}% dos nominais, "
            f"abstenção {m['perc_abstencao']*100:.1f}%."
        )

    insights.append(
        {
            "title": "Onde atacar como Deputado Federal",
            "description": " ".join(strategy_lines),
            "type": "geo",
        }
    )
    return insights


def bairro_coords_jitter(muni_lat, muni_lon, bairro_name, index, total):
    """Coordenada aproximada por bairro quando não há geocodificação por local."""
    seed = int(hashlib.md5(bairro_name.encode("utf-8")).hexdigest()[:8], 16)
    angle = (seed % 360) * math.pi / 180.0
    ring = 0.025 + (index / max(total, 1)) * 0.02
    return (
        muni_lat + ring * math.cos(angle),
        muni_lon + ring * math.sin(angle) * 1.15,
    )


def build_bairros_teresina_from_dashboard():
    """Usa data.json (Teresina) para bairros com coordenadas reais por local."""
    if not os.path.exists(TERESINA_DATA_JSON):
        return None
    with open(TERESINA_DATA_JSON, "r", encoding="utf-8") as f:
        payload = json.load(f)
    buckets = {}
    for loc in payload.get("locations", []):
        b = str(loc.get("bairro") or "Outros")
        buckets.setdefault(b, []).append(loc)
    out = []
    for bairro, locs in buckets.items():
        aptos = sum(int(l.get("votos_nominais", 0)) for l in locs)
        votos = sum(int(l.get("qt_votos", 0)) for l in locs)
        nom = aptos
        out.append(
            {
                "bairro": bairro,
                "aptos": aptos,
                "comparecimento": aptos,
                "abstencoes": 0,
                "votos_nominais": nom,
                "votos_bolsonaro": votos,
                "secoes": len(locs),
                "locais": len(locs),
                "perc_bolsonaro": float(votos / nom) if nom else 0.0,
                "perc_comparecimento": 1.0,
                "perc_abstencao": 0.0,
                "lat": sum(l["lat"] for l in locs) / len(locs),
                "lon": sum(l["lon"] for l in locs) / len(locs),
            }
        )
    out.sort(key=lambda x: x["votos_bolsonaro"], reverse=True)
    return out


def build_bairros_por_municipio(df, name_to_ibge, coords_by_ibge, mun_by_ibge):
    """Agrega seções por bairro inferido (palavras-chave + 'BAIRRO X' no endereço)."""
    rows = []
    for _, r in df.iterrows():
        nome_mun = str(r["nm_municipio"]).strip()
        ibge = name_to_ibge.get(norm_name(nome_mun), str(int(r["cd_municipio"])).zfill(7))
        bairro = get_bairro(
            pd.Series(
                {
                    "_local_votacao": r["nm_local_votacao"],
                    "_local_endereco": r["ds_local_votacao_endereco"],
                    "nr_zona": int(r["nr_zona"]),
                }
            )
        )
        rows.append(
            {
                "ibge": ibge,
                "bairro": bairro,
                "aptos": int(r["qt_aptos"]),
                "comparecimento": int(r["qt_comparecimento"]),
                "abstencoes": int(r["qt_abstencoes"]),
                "votos_nominais": int(r["qt_votos_nominais"]),
                "votos_bolsonaro": int(r["qt_votos"]),
            }
        )
    if not rows:
        return {}

    bdf = pd.DataFrame(rows)
    grouped = (
        bdf.groupby(["ibge", "bairro"], as_index=False)
        .agg(
            aptos=("aptos", "sum"),
            comparecimento=("comparecimento", "sum"),
            abstencoes=("abstencoes", "sum"),
            votos_nominais=("votos_nominais", "sum"),
            votos_bolsonaro=("votos_bolsonaro", "sum"),
            secoes=("bairro", "count"),
        )
    )

    bairros_por = {}
    for ibge, chunk in grouped.groupby("ibge"):
        muni = mun_by_ibge.get(ibge, {})
        mlat = muni.get("lat")
        mlon = muni.get("lon")
        items = []
        sub = chunk.sort_values("votos_bolsonaro", ascending=False)
        total = len(sub)
        for idx, (_, row) in enumerate(sub.iterrows()):
            aptos = int(row["aptos"])
            comp = int(row["comparecimento"])
            abst = int(row["abstencoes"])
            nom = int(row["votos_nominais"])
            votos = int(row["votos_bolsonaro"])
            lat = lon = None
            if mlat is not None and mlon is not None:
                lat, lon = bairro_coords_jitter(mlat, mlon, str(row["bairro"]), idx, total)
            items.append(
                {
                    "bairro": str(row["bairro"]),
                    "aptos": aptos,
                    "comparecimento": comp,
                    "abstencoes": abst,
                    "votos_nominais": nom,
                    "votos_bolsonaro": votos,
                    "secoes": int(row["secoes"]),
                    "locais": int(row["secoes"]),
                    "perc_bolsonaro": float(votos / nom) if nom else 0.0,
                    "perc_comparecimento": float(comp / aptos) if aptos else 0.0,
                    "perc_abstencao": float(abst / aptos) if aptos else 0.0,
                    "lat": lat,
                    "lon": lon,
                }
            )
        bairros_por[ibge] = items

    teresina = build_bairros_teresina_from_dashboard()
    if teresina:
        bairros_por[TERESINA_IBGE] = teresina

    return bairros_por


def classify_strategy(row, state_perc):
    abst = row["perc_abstencao"]
    perc = row["perc_bolsonaro"]
    comp = row["perc_comparecimento"]
    if abst >= 0.22 and comp < 0.80:
        return "Mobilizar comparecimento"
    if perc < state_perc - 0.03 and comp >= 0.78:
        return "Converter voto no eleitor presente"
    if perc >= state_perc + 0.05:
        return "Consolidar base aliada"
    if row["aptos"] >= 15000 and perc < state_perc:
        return "Expandir votos em cidade grande"
    return "Crescimento tático local"


def main():
    if not os.path.exists(CSV_FILE):
        print(f"Erro: arquivo não encontrado: {CSV_FILE}")
        return

    print(f"Carregando {CSV_FILE}...")
    df = pd.read_csv(CSV_FILE, sep=";", encoding="latin-1", low_memory=False)
    print(f"Registros (seções): {len(df)}")

    coords_by_ibge, name_to_ibge = load_geo_index()
    print(f"Municípios na malha IBGE: {len(coords_by_ibge)}")

    agg = (
        df.groupby(["cd_municipio", "nm_municipio"], as_index=False)
        .agg(
            aptos=("qt_aptos", "sum"),
            comparecimento=("qt_comparecimento", "sum"),
            abstencoes=("qt_abstencoes", "sum"),
            votos_nominais=("qt_votos_nominais", "sum"),
            votos_bolsonaro=("qt_votos", "sum"),
            secoes=("nr_secao", "count"),
        )
    )

    state = {
        "aptos": int(agg["aptos"].sum()),
        "comparecimento": int(agg["comparecimento"].sum()),
        "abstencoes": int(agg["abstencoes"].sum()),
        "votos_nominais": int(agg["votos_nominais"].sum()),
        "votos_bolsonaro": int(agg["votos_bolsonaro"].sum()),
        "total_municipios": int(len(agg)),
        "total_secoes": int(len(df)),
    }
    state["percentual"] = (
        state["votos_bolsonaro"] / state["votos_nominais"]
        if state["votos_nominais"]
        else 0
    )
    state["perc_comparecimento"] = (
        state["comparecimento"] / state["aptos"] if state["aptos"] else 0
    )
    state["perc_abstencao"] = (
        state["abstencoes"] / state["aptos"] if state["aptos"] else 0
    )

    median_aptos = float(agg["aptos"].median())
    municipalities = []

    for _, row in agg.iterrows():
        cd_tse = str(int(row["cd_municipio"])).zfill(7)
        nome = str(row["nm_municipio"]).strip()
        cd = name_to_ibge.get(norm_name(nome), cd_tse)
        aptos = int(row["aptos"])
        comparecimento = int(row["comparecimento"])
        abstencoes = int(row["abstencoes"])
        votos_nominais = int(row["votos_nominais"])
        votos_bolsonaro = int(row["votos_bolsonaro"])
        perc = votos_bolsonaro / votos_nominais if votos_nominais else 0
        perc_comp = comparecimento / aptos if aptos else 0
        perc_abst = abstencoes / aptos if aptos else 0

        c = coords_by_ibge.get(cd)
        lat = c["lat"] if c else None
        lon = c["lon"] if c else None

        base = {
            "cd_municipio": cd,
            "cd_municipio_tse": cd_tse,
            "nm_municipio": nome,
            "aptos": aptos,
            "comparecimento": comparecimento,
            "abstencoes": abstencoes,
            "votos_nominais": votos_nominais,
            "votos_bolsonaro": votos_bolsonaro,
            "secoes": int(row["secoes"]),
            "perc_bolsonaro": float(perc),
            "perc_comparecimento": float(perc_comp),
            "perc_abstencao": float(perc_abst),
            "lat": lat,
            "lon": lon,
        }
        base["estrategia_principal"] = classify_strategy(
            {**base, "percentual": perc}, state["percentual"]
        )
        base["score_oportunidade"] = score_opportunity(
            {**base, "percentual": perc}, state["percentual"], median_aptos
        )
        municipalities.append(base)

    municipalities.sort(key=lambda m: m["votos_bolsonaro"], reverse=True)
    mun_by_ibge = {m["cd_municipio"]: m for m in municipalities}
    print("Agregando bairros por município...")
    bairros_por_municipio = build_bairros_por_municipio(
        df, name_to_ibge, coords_by_ibge, mun_by_ibge
    )
    total_bairros = sum(len(v) for v in bairros_por_municipio.values())
    print(f"Bairros gerados: {total_bairros} em {len(bairros_por_municipio)} municípios")

    insights = build_insights(municipalities, state)

    output = {
        "meta": {
            "fonte": "TSE - votação por seção (1º turno 2022)",
            "uf": "PI",
            "candidato": "Jair Messias Bolsonaro",
            "cargo": "Presidente",
        },
        "summary": state,
        "municipalities": municipalities,
        "bairros_por_municipio": bairros_por_municipio,
        "insights": insights,
        "rankings": {
            "top_votos": [m["nm_municipio"] for m in municipalities[:10]],
            "top_oportunidade": sorted(
                municipalities,
                key=lambda m: m["score_oportunidade"],
                reverse=True,
            )[:10],
        },
    }

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    sem_coords = sum(1 for m in municipalities if m["lat"] is None)
    print(f"\nSalvo em {OUTPUT_JSON}")
    print(f" - Municípios: {len(municipalities)}")
    print(f" - Votos Bolsonaro (PI): {state['votos_bolsonaro']:,}")
    print(f" - Percentual estadual: {state['percentual']*100:.2f}%")
    if sem_coords:
        print(f" - Aviso: {sem_coords} municípios sem coordenadas")


if __name__ == "__main__":
    main()

import os
import json
import time
import urllib.request
import urllib.parse
import ssl
import random
import pandas as pd
import numpy as np

# Excel file and output paths
EXCEL_FILE = 'Dados dos locais de votação por zona-1turno de 2022.xlsx'
CACHE_FILE = 'geocoding_cache.json'
OUTPUT_JSON = 'data.json'

# Global flag to bypass geocoding if rate limited
api_blocked = False

def clean_address(addr):
    """Clean address to improve geocoding results."""
    if not isinstance(addr, str):
        return ""
    # Remove common qualifiers that confuse geocoders
    addr = addr.upper()
    addr = addr.replace("S/N", "").replace(" S/N", "")
    addr = addr.replace("AV,", "AVENIDA").replace("PCA,", "PRACA").replace("R,", "RUA")
    
    # Take the street and number parts, discarding section/area info
    parts = addr.split(",")
    clean_parts = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        if "SETOR" in part or "POVOADO" in part or "RESIDENCIAL" in part or "ÁREA" in part or "CONFLUENCIA" in part or "PROXIMO" in part:
            continue
        clean_parts.append(part)
    
    if clean_parts:
        # Return first 2 parts (usually street and number)
        return ", ".join(clean_parts[:2])
    return addr

def clean_name(name):
    """Clean school/building name to improve geocoding results."""
    if not isinstance(name, str):
        return ""
    name = name.upper()
    name = name.replace("UNIDADE ESCOLAR", "ESCOLA")
    name = name.replace("CENTRO ESTADUAL DE EDUCAÇÃO PROFISSIONAL", "CEEP")
    name = name.replace("ESCOLAO DO", "ESCOLA")
    name = name.replace("ESCOLA MUNICIPAL", "ESCOLA")
    return name.strip()

# Dicionário de Bairros de Teresina
BAIRROS_KEYWORDS = {
    'Mocambinho': ['MOCAMBINHO'],
    'Dirceu': ['DIRCEU', 'ITARARE', 'ITARARÉ', 'RENASCENCA', 'RENASCENÇA'],
    'Santa Maria': ['SANTA MARIA', 'STA MA', 'CODIPI', 'PANTANAL'],
    'Jacinta Andrade': ['JACINTA ANDRADE', 'WALL FERRAZ'],
    'Centro': ['CENTRO', 'CABRAL', 'ACARAPE'],
    'Promorar': ['PROMORAR', 'MARIO COVAS', 'MÁRIO COVAS'],
    'Saci': ['SACI'],
    'Parque Piauí': ['PARQUE PIAUI', 'PARQUE PIAUÍ'],
    'Ininga': ['ININGA', 'PLANALTO ININGA'],
    'Fátima': ['FATIMA', 'FÁTIMA'],
    'Jóquei': ['JOQUEI', 'JÓQUEI'],
    'Ilhotas': ['ILHOTAS'],
    'Vermelha': ['VERMELHA'],
    'Mafrense': ['MAFRENSE'],
    'Uruguai': ['URUGUAI'],
    'Vale Quem Tem': ['VALE QUEM TEM'],
    'Esplanada': ['ESPLANADA'],
    'Porto Alegre': ['PORTO ALEGRE'],
    'Buenos Aires': ['BUENOS AIRES'],
    'Memorare': ['MEMORARE'],
    'Aeroporto': ['AEROPORTO'],
    'Bela Vista': ['BELA VISTA'],
    'Piçarra': ['PICARRA', 'PIÇARRA'],
    'Lourival Parente': ['LOURIVAL PARENTE'],
    'Morada Nova': ['MORADA NOVA'],
    'São Cristóvão': ['SAO CRISTOVAO', 'SÃO CRISTÓVÃO'],
    'São João': ['SAO JOAO', 'SÃO JOÃO'],
    'Cristo Rei': ['CRISTO REI'],
    'Pedra Mole': ['PEDRA MOLE'],
    'Água Mineral': ['AGUA MINERAL', 'ÁGUA MINERAL'],
    'São Pedro': ['SAO PEDRO', 'SÃO PEDRO'],
    'Santo Antônio': ['SANTO ANTONIO', 'SANTO ANTÔNIO'],
    'Gurupá': ['GURUPA', 'GURUPÁ'],
    'Satélite': ['SATELITE', 'SATÉLITE'],
    'Matadouro': ['MATADOURO'],
    'Nova Brasília': ['NOVA BRASILIA', 'NOVA BRASÍLIA'],
    'São Joaquim': ['SAO JOAQUIM', 'SÃO JOAQUIM'],
    'Monte Castelo': ['MONTE CASTELO'],
    'Macaúba': ['MACAUBA', 'MACAÚBA'],
    'Redenção': ['REDENCAO', 'REDENÇÃO'],
    'Pirajá': ['PIRAJÁ', 'PIRAJÁ'],
    'Povoado (Zona Rural)': ['POVOADO', 'POV.', 'RURAL', 'Fazenda', 'ESTRADA', 'KM ']
}

def get_bairro(row):
    text = (str(row['_local_votacao']) + ' ' + str(row['_local_endereco'])).upper()
    for name, keys in BAIRROS_KEYWORDS.items():
        for k in keys:
            if k in text:
                return name
    # Fallback structure based on Electoral Zone
    fallback_map = {
        1: 'Zona Norte (Outros)',
        2: 'Zona Leste/Centro (Outros)',
        63: 'Zona Sul (Outros)',
        97: 'Zona Sudeste (Outros)',
        98: 'Zona Oeste (Outros)'
    }
    return fallback_map.get(int(row['nr_zona']), 'Outros')

def main():
    global api_blocked
    print("Iniciando processamento dos dados de votação...")
    
    # 1. Load Excel file
    if not os.path.exists(EXCEL_FILE):
        print(f"Erro: Arquivo {EXCEL_FILE} não encontrado!")
        return
        
    df = pd.read_excel(EXCEL_FILE, sheet_name='completa')
    print(f"Planilha carregada. Total de registros: {len(df)}")
    
    # Ensure correct data types
    df['nr_zona'] = df['nr_zona'].astype(int)
    df['votos_nominais'] = df['votos_nominais'].astype(int)
    df['qt_votos'] = df['qt_votos'].astype(int)
    df['percentual de votos do bolsonaro'] = df['percentual de votos do bolsonaro'].astype(float)
    
    # Adicionar Bairro
    df['bairro'] = df.apply(get_bairro, axis=1)
    
    # 2. Load geocoding cache if exists
    cache = {}
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, 'r', encoding='utf-8') as f:
                cache = json.load(f)
            print(f"Cache de geocodificação carregado: {len(cache)} locais encontrados.")
        except Exception as e:
            print(f"Erro ao carregar cache: {e}. Criando novo cache.")
            
    # Setup SSL bypass for macOS certificate issues
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    
    # Geocoding function using Nominatim
    def geocode(name, address):
        global api_blocked
        # Unique key for cache
        cache_key = f"{name} | {address}"
        
        # Check cache first (always use cache if available!)
        if cache_key in cache:
            return cache[cache_key]
            
        # If API is blocked, bypass geocoding immediately
        if api_blocked:
            return None
            
        queries = [
            # 1. School name and city
            f"{clean_name(name)}, Teresina, Piaui, Brazil",
            # 2. Clean address and city
            f"{clean_address(address)}, Teresina, Piaui, Brazil",
            # 3. Just school name
            f"{name}, Teresina, Piaui, Brazil",
            # 4. First part of address (street name)
            f"{clean_address(address).split(',')[0]}, Teresina, Piaui, Brazil"
        ]
        
        for query in queries:
            if not query.strip() or "TERESINA" not in query.upper():
                continue
            try:
                # Sleep to respect rate limits
                time.sleep(0.25)
                
                url = "https://nominatim.openstreetmap.org/search?q=" + urllib.parse.quote(query) + "&format=json&limit=1"
                req = urllib.request.Request(url, headers={'User-Agent': 'TeresinaElectionDashboard/1.0'})
                
                with urllib.request.urlopen(req, context=ctx, timeout=5) as response:
                    res_data = json.loads(response.read())
                    if res_data:
                        lat = float(res_data[0]['lat'])
                        lon = float(res_data[0]['lon'])
                        print(f" Sucesso: '{name}' -> Lat {lat}, Lon {lon} (Busca: '{query}')")
                        result = {"lat": lat, "lon": lon}
                        cache[cache_key] = result
                        # Save cache progressively
                        with open(CACHE_FILE, 'w', encoding='utf-8') as f:
                            json.dump(cache, f, ensure_ascii=False, indent=2)
                        return result
            except urllib.error.HTTPError as he:
                if he.code == 429:
                    print("\n[ALERTA] Nominatim retornou erro 429. Limite de requisições excedido!")
                    print("Ativando modo bypass geográfico inteligente para evitar esperas...\n")
                    api_blocked = True
                    return None
                print(f" Erro HTTP ao geocodificar '{query}': {he}")
            except Exception as ex:
                print(f" Erro genérico ao geocodificar '{query}': {ex}")
                
        # If all queries fail
        print(f" Falhou: '{name}' | '{address}'")
        cache[cache_key] = None
        return None

    # 3. Geocode all locations
    print("Iniciando geocodificação dos locais de votação...")
    coordinates = []
    
    for idx, row in df.iterrows():
        name = row['_local_votacao']
        addr = row['_local_endereco']
        # If cache contains it, print progress and use it
        cache_key = f"{name} | {addr}"
        if cache_key in cache and cache[cache_key] is not None:
            c = cache[cache_key]
            print(f"[{idx+1}/{len(df)}] [CACHE] {name} -> Lat {c['lat']}, Lon {c['lon']}")
            coordinates.append(c)
        else:
            if api_blocked:
                # If API is already blocked, don't output too much clutter
                coordinates.append(None)
            else:
                print(f"[{idx+1}/{len(df)}] Processando: {name}")
                coords = geocode(name, addr)
                coordinates.append(coords)
        
    df['coords'] = coordinates

    # 4. Post-processing coordinates for failed lookups using electoral zone center fallbacks
    print("\nPós-processamento de coordenadas não resolvidas...")
    
    # Default centers of Teresina zones (very accurate bounding box mapping!)
    zone_fallbacks = {
        1:  {"lat": -5.0298, "lon": -42.8214}, # Norte (Mocambinho/Santa Maria da Codipi/Buenos Aires)
        2:  {"lat": -5.0745, "lon": -42.7845}, # Leste / Centro (Jóquei/Fátima/Centro)
        63: {"lat": -5.1385, "lon": -42.7915}, # Sul (Promorar/Parque Piauí/Lourival Parente)
        97: {"lat": -5.1154, "lon": -42.7532}, # Sudeste (Dirceu/Itararé)
        98: {"lat": -5.0925, "lon": -42.8252}  # Oeste / Rural (Uruguai/Vale Quem Tem/Rural)
    }
    
    # Calculate actual centers from successful queries per zone
    zone_centers = {}
    for zone in df['nr_zona'].unique():
        successful_zone_coords = [c for idx, c in enumerate(coordinates) if df.iloc[idx]['nr_zona'] == zone and c is not None]
        if successful_zone_coords:
            avg_lat = sum(c['lat'] for c in successful_zone_coords) / len(successful_zone_coords)
            avg_lon = sum(c['lon'] for c in successful_zone_coords) / len(successful_zone_coords)
            zone_centers[zone] = {"lat": avg_lat, "lon": avg_lon}
            print(f"Zona {zone}: Centro médio calculado a partir de {len(successful_zone_coords)} locais: Lat {avg_lat:.4f}, Lon {avg_lon:.4f}")
        else:
            zone_centers[zone] = zone_fallbacks.get(zone, {"lat": -5.0920, "lon": -42.8038})
            print(f"Zona {zone}: Sem locais geocodificados com sucesso. Usando fallback: Lat {zone_centers[zone]['lat']:.4f}, Lon {zone_centers[zone]['lon']:.4f}")

    # Assign calculated coordinates with slight random jitter to prevent overlaps
    final_coordinates = []
    jitter_std = 0.012 # Jitter of ~1.2km to disperse failed matches elegantly within the zone boundary
    
    random.seed(42) # Deterministic jitter
    
    for idx, row in df.iterrows():
        c = row['coords']
        zone = row['nr_zona']
        if c is not None:
            final_coordinates.append(c)
        else:
            center = zone_centers[zone]
            # Add small random offset inside the zone boundaries
            jitter_lat = random.gauss(0, jitter_std * 0.7) # Slightly compress vertically
            jitter_lon = random.gauss(0, jitter_std * 1.1) # Stretch horizontally (Teresina is wide)
            fallback_coord = {
                "lat": center["lat"] + jitter_lat,
                "lon": center["lon"] + jitter_lon,
                "is_fallback": True
            }
            final_coordinates.append(fallback_coord)

    df['lat'] = [c['lat'] for c in final_coordinates]
    df['lon'] = [c['lon'] for c in final_coordinates]
    df['is_fallback'] = [c.get('is_fallback', False) for c in final_coordinates]

    # 5. Calculate statistics and JSON structure
    total_votes = int(df['qt_votos'].sum())
    total_nominal = int(df['votos_nominais'].sum())
    percent_global = total_votes / total_nominal if total_nominal > 0 else 0
    
    # Group by Zone
    zone_stats = df.groupby('nr_zona').agg(
        qt_votos=('qt_votos', 'sum'),
        votos_nominais=('votos_nominais', 'sum')
    ).reset_index()
    zone_stats['percentual'] = zone_stats['qt_votos'] / zone_stats['votos_nominais']
    
    zones_list = []
    for _, zrow in zone_stats.iterrows():
        zones_list.append({
            "nr_zona": int(zrow['nr_zona']),
            "qt_votos": int(zrow['qt_votos']),
            "votos_nominais": int(zrow['votos_nominais']),
            "percentual": float(zrow['percentual'])
        })
        
    # Prepare locations list
    locations_list = []
    for _, lrow in df.iterrows():
        locations_list.append({
            "nr_zona": int(lrow['nr_zona']),
            "bairro": str(lrow['bairro']),
            "local_votacao": str(lrow['_local_votacao']),
            "local_endereco": str(lrow['_local_endereco']),
            "qt_votos": int(lrow['qt_votos']),
            "votos_nominais": int(lrow['votos_nominais']),
            "percentual": float(lrow['percentual de votos do bolsonaro']),
            "lat": float(lrow['lat']),
            "lon": float(lrow['lon']),
            "is_fallback": bool(lrow['is_fallback'])
        })
        
    # Generate static insights to display
    top_5_percent = df.sort_values(by='percentual de votos do bolsonaro', ascending=False).head(5)
    top_5_votes = df.sort_values(by='qt_votos', ascending=False).head(5)
    
    # Calculate which zone had the highest support
    best_zone = zone_stats.sort_values(by='percentual', ascending=False).iloc[0]
    worst_zone = zone_stats.sort_values(by='percentual', ascending=True).iloc[0]
    
    insights = [
        {
            "title": "Zona Mais Forte (Apoio)",
            "description": f"A **Zona {int(best_zone['nr_zona'])}** registrou a maior percentagem de apoio a Bolsonaro em Teresina, com **{best_zone['percentual']*100:.2f}%** dos votos válidos ({int(best_zone['qt_votos']):,} de {int(best_zone['votos_nominais']):,}).",
            "type": "positive"
        },
        {
            "title": "Zona Mais Fraca (Apoio)",
            "description": f"A **Zona {int(worst_zone['nr_zona'])}** registrou a menor percentagem de apoio, com **{worst_zone['percentual']*100:.2f}%** ({int(worst_zone['qt_votos']):,} de {int(worst_zone['votos_nominais']):,}).",
            "type": "negative"
        },
        {
            "title": "Recorde de Votação (Absoluto)",
            "description": f"O local com mais votos nominais para Bolsonaro foi o **{top_5_votes.iloc[0]['_local_votacao']}** (Zona {int(top_5_votes.iloc[0]['nr_zona'])}), com **{int(top_5_votes.iloc[0]['qt_votos']):,} votos** ({top_5_votes.iloc[0]['percentual de votos do bolsonaro']*100:.2f}% do local).",
            "type": "info"
        },
        {
            "title": "Recorde de Votação (Percentual)",
            "description": f"O maior percentual de votos foi registrado na **{top_5_percent.iloc[0]['_local_votacao']}** (Zona {int(top_5_percent.iloc[0]['nr_zona'])}), onde Bolsonaro obteve **{top_5_percent.iloc[0]['percentual de votos do bolsonaro']*100:.2f}%** dos votos válidos ({int(top_5_percent.iloc[0]['qt_votos']):,} de {int(top_5_percent.iloc[0]['votos_nominais']):,}).",
            "type": "percent"
        },
        {
            "title": "Distribuição Geográfica",
            "description": f"Dos 300 locais de votação de Teresina, **{sum(df['percentual de votos do bolsonaro'] >= 0.35)} locais** ({sum(df['percentual de votos do bolsonaro'] >= 0.35)/300*100:.1f}%) ultrapassaram a marca de 35% de votos para Bolsonaro.",
            "type": "geo"
        }
    ]

    # Combine everything
    output_data = {
        "summary": {
            "total_votes": total_votes,
            "votos_nominais": total_nominal,
            "percentual": percent_global,
            "total_zonas": len(zones_list),
            "total_locais": len(locations_list)
        },
        "zones": sorted(zones_list, key=lambda x: x['nr_zona']),
        "locations": sorted(locations_list, key=lambda x: x['qt_votos'], reverse=True),
        "insights": insights
    }
    
    # Save output data to data.json
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
        
    print(f"\nProcessamento concluído com sucesso!")
    print(f"Resumo salvo em '{OUTPUT_JSON}':")
    print(f" - Total Votos: {total_votes:,}")
    print(f" - Total Nominais: {total_nominal:,}")
    print(f" - Percentual Global: {percent_global*100:.4f}%")
    print(f" - Total de Zonas: {len(zones_list)}")
    print(f" - Total de Locais de Votação: {len(locations_list)}")

if __name__ == "__main__":
    main()

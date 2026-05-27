# BolsonaroBI - Dashboard Eleitoral (Teresina + Piauí)

Dashboards web interativos para explorar votação de Jair Bolsonaro no 1º turno de 2022 no Piauí.

## Páginas

| Página | URL | Escopo |
|--------|-----|--------|
| **Teresina** | `index.html` | Locais de votação na capital (mapa, bairros, zonas) |
| **Piauí (Estado)** | `piaui.html` | 224 municípios — votos, comparecimento, abstenção, mapa de calor, estratégia de campanha |

## Dados

- **Teresina:** planilha `Dados dos locais de votação por zona-1turno de 2022.xlsx` → `data.json`
- **Estado:** `data/votacao_pi_bolsonaro_2022.csv` (TSE, por seção) → `data_pi.json`
- **Mapa PI:** `geo/pi-municipios.geojson` (contornos municipais)

## Como gerar os JSON

```bash
# Teresina (geocodificação opcional; usa cache)
python3 parse_data.py

# Piauí inteiro (rápido, ~1s)
python3 parse_pi_state.py
```

CSV estadual: copie o arquivo TSE para `data/votacao_pi_bolsonaro_2022.csv` ou defina:

```bash
export PI_CSV_FILE="/caminho/para/votacao_secao-uf_2022_pi_presidente_jair_messias_bolsonaro.csv"
python3 parse_pi_state.py
```

## Executar localmente

```bash
python3 -m http.server 8765
```

- Teresina: http://127.0.0.1:8765/
- Piauí: http://127.0.0.1:8765/piaui.html

## Dashboard Piauí — o que inclui

- KPIs: votos, aptos, comparecimento, abstenções, percentual, municípios/seções
- Mapa com **contorno por município** (cor = % Bolsonaro) + **heatmap** (votos, % ou abstenção)
- Ranking municipal com ordenação por votos, %, abstenção ou **score de oportunidade**
- Painel **“Onde atacar (Deputado Federal)”** com priorização por mobilização, conversão e volume
- Insights automáticos (top votos, top %, abstenção, panorama estadual)

## Tecnologias

HTML, CSS, JavaScript · Leaflet + heat · ApexCharts · Python/pandas

# BolsonaroBI - Dashboard Eleitoral de Teresina (2022)

Dashboard web interativo para explorar os resultados de votação de Jair Bolsonaro no 1o turno de 2022 em Teresina (PI), com foco em analise geoespacial por zona eleitoral, local de votacao e bairro.

## O que este projeto faz

- Processa dados de uma planilha oficial de locais de votacao.
- Gera um arquivo `data.json` pronto para consumo no front-end.
- Enriquce os dados com:
  - `bairro` inferido por palavras-chave;
  - coordenadas geograficas por geocodificacao;
  - fallback inteligente por zona quando a geocodificacao falha.
- Exibe um dashboard moderno com:
  - mapa interativo (heatmap + marcadores);
  - filtros por zona;
  - busca por nome/endereco;
  - modo de busca "So bairro";
  - KPIs, ranking e insights dinamicos.

## Estrutura principal

- `parse_data.py`: pipeline de processamento e geracao do `data.json`.
- `data.json`: base consolidada usada pela interface.
- `index.html`: estrutura da aplicacao.
- `style.css`: estilos visuais.
- `app.js`: logica do dashboard, filtros, mapa e graficos.

## Como executar localmente

1. (Opcional) Regenerar dados:
   - Ajuste o arquivo de entrada no `parse_data.py` se necessario.
   - Execute:

```bash
python3 parse_data.py
```

2. Subir servidor local:

```bash
python3 -m http.server 8765
```

3. Abrir no navegador:
   - `http://127.0.0.1:8765/`

## Tecnologias

- HTML, CSS e JavaScript puro
- Leaflet + Leaflet.heat
- ApexCharts
- Python (pandas/numpy) para pipeline de dados

## Observacoes

- O projeto usa dados eleitorais agregados por local de votacao.
- Coordenadas com `is_fallback: true` representam aproximacoes para preservar cobertura no mapa.

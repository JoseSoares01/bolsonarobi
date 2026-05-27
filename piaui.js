/* Dashboard estadual — Piauí (Bolsonaro 2022) */

const PI_CENTER = [-6.6, -43.1];
const PI_ZOOM = 7;
const TILES_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILES_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const MAP_ATTRIBUTION = '&copy; OpenStreetMap &copy; CARTO';

let state = {
    data: null,
    geo: null,
    filtered: [],
    byCd: new Map(),
    byName: new Map(),
    map: null,
    tileLayer: null,
    heatLayer: null,
    choroLayer: null,
    markerLayer: null,
    chart: null,
    lastMapFocusQuery: null,
    theme: 'dark',
    showHeat: true,
    showChoro: true,
    heatMetric: 'votes',
    sortMode: 'votes',
    searchQuery: '',
    activeMunicipio: null
};

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initMap();
    loadData();
});

async function loadData() {
    try {
        const [dataRes, geoRes] = await Promise.all([
            fetch('data_pi.json'),
            fetch('geo/pi-municipios.geojson')
        ]);
        if (!dataRes.ok) throw new Error('data_pi.json');
        state.data = await dataRes.json();
        state.geo = geoRes.ok ? await geoRes.json() : null;
        state.filtered = [...state.data.municipalities];
        state.data.municipalities.forEach(m => {
            state.byCd.set(m.cd_municipio, m);
            state.byName.set(normName(m.nm_municipio), m);
        });
        initFilters();
        updateDashboard();
        lucide.createIcons();
    } catch (e) {
        console.error(e);
        document.getElementById('map-overlay-info').textContent =
            'Erro ao carregar dados. Execute: python3 parse_pi_state.py';
    }
}

function normName(s) {
    return String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .trim();
}

function resolveMunicipio(cdGeo, nameGeo) {
    const cd = String(cdGeo || '').padStart(7, '0');
    return state.byCd.get(cd) || state.byName.get(normName(nameGeo)) || null;
}

function ensureMapPanes() {
    if (!state.map) return;
    if (!state.map.getPane('piHeatPane')) {
        const heatPane = state.map.createPane('piHeatPane');
        heatPane.style.pointerEvents = 'none';
        heatPane.style.zIndex = 350;
    }
    if (!state.map.getPane('piGeoPane')) {
        const geoPane = state.map.createPane('piGeoPane');
        geoPane.style.zIndex = 450;
    }
    if (!state.map.getPane('piMarkerPane')) {
        const markerPane = state.map.createPane('piMarkerPane');
        markerPane.style.zIndex = 550;
    }
}

function initMap() {
    state.map = L.map('map', {
        center: PI_CENTER,
        zoom: PI_ZOOM,
        minZoom: 6,
        maxZoom: 14,
        scrollWheelZoom: true,
        doubleClickZoom: true,
        touchZoom: true,
        dragging: true,
        tap: true
    });
    const url = state.theme === 'light' ? TILES_LIGHT : TILES_DARK;
    state.tileLayer = L.tileLayer(url, { attribution: MAP_ATTRIBUTION, subdomains: 'abcd' }).addTo(state.map);

    ensureMapPanes();

    state.markerLayer = L.layerGroup({ pane: 'piMarkerPane' }).addTo(state.map);

    document.getElementById('btn-toggle-heat').addEventListener('click', (e) => {
        state.showHeat = !state.showHeat;
        e.currentTarget.classList.toggle('active', state.showHeat);
        updateMapLayers();
    });
    document.getElementById('btn-toggle-choro').addEventListener('click', (e) => {
        state.showChoro = !state.showChoro;
        e.currentTarget.classList.toggle('active', state.showChoro);
        updateMapLayers();
    });

    window.addEventListener('resize', () => {
        if (state.map) state.map.invalidateSize();
    });
}

function initFilters() {
    const input = document.getElementById('search-municipio');
    const clear = document.getElementById('clear-search');
    input.addEventListener('input', () => {
        state.searchQuery = input.value;
        clear.style.display = state.searchQuery ? 'flex' : 'none';
        applyFilters();
    });
    clear.addEventListener('click', () => {
        input.value = '';
        state.searchQuery = '';
        clear.style.display = 'none';
        applyFilters();
        input.focus();
    });

    const heatBtns = {
        votes: document.getElementById('heat-metric-votes'),
        perc: document.getElementById('heat-metric-perc'),
        abst: document.getElementById('heat-metric-abst')
    };
    Object.entries(heatBtns).forEach(([metric, btn]) => {
        btn.addEventListener('click', () => {
            state.heatMetric = metric;
            Object.values(heatBtns).forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updateMapLayers();
        });
    });

    ['sort-votes', 'sort-percent', 'sort-abst', 'sort-opp'].forEach(id => {
        document.getElementById(id).addEventListener('click', (e) => {
            document.querySelectorAll('#sort-votes,#sort-percent,#sort-abst,#sort-opp').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            state.sortMode = id.replace('sort-', '').replace('opp', 'oportunidade').replace('abst', 'abstencao');
            renderLeaderboard();
        });
    });
}

function applyFilters() {
    const q = state.searchQuery.toLowerCase().trim();
    const prevFocus = state.lastMapFocusQuery;
    state.filtered = state.data.municipalities.filter(m =>
        !q || m.nm_municipio.toLowerCase().includes(q)
    );
    state.activeMunicipio = resolveActiveMunicipio();
    updateDashboard();
    if (q !== prevFocus) {
        state.lastMapFocusQuery = q;
        focusMapToFilterResults();
    }
}

/** Uma cidade selecionada na busca → modo bairros. */
function resolveActiveMunicipio() {
    const q = state.searchQuery.trim().toLowerCase();
    if (!q) return null;
    const exact = state.data.municipalities.find(m => m.nm_municipio.toLowerCase() === q);
    if (exact) return exact;
    if (state.filtered.length === 1) return state.filtered[0];
    return null;
}

function isBairroView() {
    if (!state.activeMunicipio) return false;
    const list = getBairrosAtivos();
    return list.length > 0;
}

function getBairrosAtivos() {
    if (!state.activeMunicipio || !state.data.bairros_por_municipio) return [];
    return state.data.bairros_por_municipio[state.activeMunicipio.cd_municipio] || [];
}

/** Ao buscar, aproxima a região (ex.: Altos + entorno) sem travar o mapa. */
function focusMapToFilterResults() {
    if (!state.map) return;
    const q = state.searchQuery.trim();
    if (!q) {
        state.map.flyTo(PI_CENTER, PI_ZOOM, { duration: 0.85 });
        return;
    }
    if (isBairroView()) {
        const bairros = getBairrosAtivos().filter(b => b.lat != null);
        const m = state.activeMunicipio;
        if (bairros.length > 1) {
            const bounds = L.latLngBounds(bairros.map(b => [b.lat, b.lon]));
            state.map.flyToBounds(bounds, { padding: [40, 40], maxZoom: 12, duration: 0.85 });
        } else if (bairros.length === 1) {
            state.map.flyTo([bairros[0].lat, bairros[0].lon], 12, { duration: 0.85 });
        } else if (m.lat != null) {
            state.map.flyTo([m.lat, m.lon], 10, { duration: 0.85 });
        }
        return;
    }
    const targets = state.filtered.filter(m => m.lat != null && m.lon != null);
    if (!targets.length) return;
    if (targets.length === 1) {
        state.map.flyTo([targets[0].lat, targets[0].lon], 9, { duration: 0.85 });
        return;
    }
    const bounds = L.latLngBounds(targets.map(m => [m.lat, m.lon]));
    state.map.flyToBounds(bounds, { padding: [56, 56], maxZoom: 10, duration: 0.85 });
}

function getHighlightedCdSet() {
    return new Set(state.filtered.map(m => m.cd_municipio));
}

function isMapContextMode() {
    return Boolean(state.searchQuery.trim()) && !isBairroView();
}

function updateDashboard() {
    if (!state.data) return;
    updateKPIs();
    // Painéis primeiro: se mapa/gráfico falharem, listas e insights continuam visíveis
    renderLeaderboard();
    renderInsights();
    renderStrategy();
    try {
        updateMapLayers();
    } catch (err) {
        console.error('Erro ao atualizar mapa:', err);
    }
    try {
        updateChart();
    } catch (err) {
        console.error('Erro ao atualizar gráfico:', err);
    }
}

function updateKPIs() {
    const s = state.data.summary;
    const filt = isBairroView() ? [state.activeMunicipio] : state.filtered;
    let votos = 0, aptos = 0, comp = 0, abst = 0, nom = 0;
    filt.forEach(m => {
        votos += m.votos_bolsonaro;
        aptos += m.aptos;
        comp += m.comparecimento;
        abst += m.abstencoes;
        nom += m.votos_nominais;
    });
    const perc = nom > 0 ? (votos / nom) * 100 : 0;
    const pComp = aptos > 0 ? (comp / aptos) * 100 : 0;
    const pAbst = aptos > 0 ? (abst / aptos) * 100 : 0;

    setText('kpi-votos', votos.toLocaleString('pt-BR'));
    setText('kpi-votos-share', `${((votos / s.votos_bolsonaro) * 100).toFixed(1)}% do total do PI`);
    setText('kpi-aptos', aptos.toLocaleString('pt-BR'));
    setText('kpi-comparecimento', comp.toLocaleString('pt-BR'));
    setText('kpi-perc-comp', `${pComp.toFixed(1)}% dos aptos`);
    setText('kpi-abstencoes', abst.toLocaleString('pt-BR'));
    setText('kpi-perc-abst', `${pAbst.toFixed(1)}% dos aptos`);
    setText('kpi-percentual', `${perc.toFixed(2)}%`.replace('.', ','));
    document.getElementById('kpi-percentual-bar').style.width = `${Math.min(perc, 100)}%`;
    if (isBairroView()) {
        const bairros = getBairrosAtivos();
        setText('kpi-municipios', String(bairros.length));
        setText('kpi-secoes', `${state.activeMunicipio.nm_municipio} · ${bairros.length} bairros`);
    } else {
        setText('kpi-municipios', String(filt.length));
        setText('kpi-secoes', `${filt.reduce((a, m) => a + m.secoes, 0).toLocaleString('pt-BR')} seções`);
    }
    updateViewLabels();
}

function updateViewLabels() {
    const mapTitle = document.getElementById('map-panel-title');
    const rankTitle = document.getElementById('ranking-panel-title');
    const chartTitle = document.getElementById('chart-panel-title');
    const searchLabel = document.querySelector('label[for="search-municipio"]');
    if (isBairroView()) {
        const nome = state.activeMunicipio.nm_municipio;
        if (mapTitle) mapTitle.textContent = `Bairros de ${nome} — mapa de calor`;
        if (rankTitle) rankTitle.textContent = `Ranking de bairros (${nome})`;
        if (chartTitle) chartTitle.textContent = `Top 10 bairros (${nome})`;
        if (searchLabel) searchLabel.textContent = `Cidade selecionada: ${nome}`;
    } else {
        if (mapTitle) mapTitle.textContent = 'Mapa do Piauí — calor e municípios';
        if (rankTitle) rankTitle.textContent = 'Ranking municipal';
        if (chartTitle) chartTitle.textContent = 'Top 10 municípios (votos)';
        if (searchLabel) searchLabel.textContent = 'Buscar município';
    }
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function colorForPerc(perc, statePerc) {
    const ratio = statePerc > 0 ? perc / statePerc : 1;
    if (ratio >= 1.2) return '#10b981';
    if (ratio >= 1.0) return '#06b6d4';
    if (ratio >= 0.85) return '#fbbf24';
    return '#a78bfa';
}

function heatIntensity(m) {
    if (state.heatMetric === 'perc') return m.perc_bolsonaro * 2.5;
    if (state.heatMetric === 'abst') return m.perc_abstencao * 2.5;
    const base = isBairroView() ? 2500 : 12000;
    return Math.min(1, m.votos_bolsonaro / base) * 1.8;
}

function updateMapLayers() {
    if (!state.map || !state.data) return;

    if (state.heatLayer) {
        state.map.removeLayer(state.heatLayer);
        state.heatLayer = null;
    }
    if (state.choroLayer) {
        state.map.removeLayer(state.choroLayer);
        state.choroLayer = null;
    }
    if (state.markerLayer) {
        state.markerLayer.clearLayers();
    }

    const statePerc = isBairroView()
        ? state.activeMunicipio.perc_bolsonaro
        : state.data.summary.percentual;
    const contextMode = isMapContextMode();
    const highlighted = getHighlightedCdSet();
    const bairroView = isBairroView();
    const bairros = getBairrosAtivos();
    const heatSource = bairroView
        ? bairros.filter(b => b.lat != null && b.lon != null)
        : state.filtered.filter(m => m.lat != null && m.lon != null);

    if (state.showHeat && heatSource.length) {
        const points = heatSource.map(item => [item.lat, item.lon, heatIntensity(item)]);
        state.heatLayer = L.heatLayer(points, {
            radius: bairroView ? 18 : contextMode ? 22 : 28,
            blur: bairroView ? 14 : 16,
            maxZoom: 13,
            gradient: { 0.2: 'blue', 0.5: 'cyan', 0.75: 'lime', 1: 'red' }
        });
        state.map.addLayer(state.heatLayer);
    }

    if (state.showChoro && state.geo) {
        const activeCd = state.activeMunicipio?.cd_municipio;
        state.choroLayer = L.geoJSON(state.geo, {
            pane: 'piGeoPane',
            filter: (feat) => {
                const m = resolveMunicipio(feat.properties.id, feat.properties.name);
                if (!m) return false;
                if (bairroView) return true;
                if (!contextMode) {
                    return highlighted.has(m.cd_municipio);
                }
                return true;
            },
            style: (feat) => {
                const m = resolveMunicipio(feat.properties.id, feat.properties.name);
                const cd = m ? m.cd_municipio : '';
                const isActiveCity = bairroView && cd === activeCd;
                const isHit = m && highlighted.has(cd);
                const perc = m ? m.perc_bolsonaro : 0;
                const fill = colorForPerc(perc, statePerc);
                if (bairroView && !isActiveCity) {
                    return {
                        color: 'rgba(148, 163, 184, 0.35)',
                        weight: 0.8,
                        opacity: 0.4,
                        fillColor: '#94a3b8',
                        fillOpacity: 0.05,
                        dashArray: '3 4'
                    };
                }
                if (bairroView && isActiveCity) {
                    return {
                        color: '#06b6d4',
                        weight: 2.5,
                        opacity: 0.95,
                        fillColor: '#06b6d4',
                        fillOpacity: 0.08
                    };
                }
                if (contextMode && !isHit) {
                    return {
                        color: 'rgba(148, 163, 184, 0.55)',
                        weight: 1,
                        opacity: 0.65,
                        fillColor: '#94a3b8',
                        fillOpacity: 0.12,
                        dashArray: '4 3'
                    };
                }
                return {
                    color: fill,
                    weight: isHit ? 2.5 : 1.5,
                    opacity: 0.95,
                    fillColor: fill,
                    fillOpacity: isHit ? 0.45 : 0.3
                };
            },
            onEachFeature: (feat, layer) => {
                const m = resolveMunicipio(feat.properties.id, feat.properties.name);
                if (!m) return;
                const cd = m.cd_municipio;
                if (!bairroView) {
                    layer.bindPopup(buildMunicipioPopup(m), { closeButton: false, offset: [0, -4] });
                }
                layer.on({
                    click: () => {
                        if (!bairroView) focusMunicipio(m, layer);
                    },
                    mouseover: (e) => {
                        if (bairroView) return;
                        const isHit = highlighted.has(cd);
                        state.map.getContainer().style.cursor = 'pointer';
                        e.target.setStyle({
                            weight: 3,
                            fillOpacity: isHit ? 0.6 : 0.28
                        });
                        showOverlay(m);
                    },
                    mouseout: (e) => {
                        if (bairroView) return;
                        state.map.getContainer().style.cursor = '';
                        state.choroLayer.resetStyle(e.target);
                    }
                });
            }
        });
        state.map.addLayer(state.choroLayer);
    }

    if (bairroView) {
        bairros.forEach(b => {
            if (b.lat == null) return;
            const color = colorForPerc(b.perc_bolsonaro, statePerc);
            const marker = L.circleMarker([b.lat, b.lon], {
                pane: 'piMarkerPane',
                radius: 9,
                color: '#fff',
                weight: 2,
                fillColor: color,
                fillOpacity: 0.95
            });
            marker.bindPopup(buildBairroPopup(b), { closeButton: false, offset: [0, -6] });
            marker.on('click', () => focusBairro(b, marker));
            marker.bindTooltip(b.bairro, {
                permanent: false,
                direction: 'top',
                className: 'pi-muni-tooltip'
            });
            marker.addTo(state.markerLayer);
        });
    } else {
        highlighted.forEach(cd => {
            const m = state.byCd.get(cd);
            if (!m || m.lat == null) return;
            const color = colorForPerc(m.perc_bolsonaro, statePerc);
            const marker = L.circleMarker([m.lat, m.lon], {
                pane: 'piMarkerPane',
                radius: contextMode ? 10 : 8,
                color: '#fff',
                weight: 2,
                fillColor: color,
                fillOpacity: 0.95
            });
            marker.bindPopup(buildMunicipioPopup(m), { closeButton: false, offset: [0, -6] });
            marker.on('click', () => focusMunicipio(m, marker));
            marker.addTo(state.markerLayer);
        });
    }

    disableHeatmapPointerBlock();
    if (state.markerLayer) state.markerLayer.bringToFront();
    if (state.choroLayer) state.choroLayer.bringToFront();
}

function buildBairroPopup(b) {
    const p = (b.perc_bolsonaro * 100).toFixed(1);
    const pComp = (b.perc_comparecimento * 100).toFixed(1);
    const pAbst = (b.perc_abstencao * 100).toFixed(1);
    return `
        <div class="popup-header">
            <div class="popup-title">${b.bairro}</div>
            <span class="popup-zone-badge">${state.activeMunicipio.nm_municipio}</span>
        </div>
        <div class="popup-details">
            <div class="popup-row"><span class="label">Votos Bolsonaro:</span><span class="val">${b.votos_bolsonaro.toLocaleString('pt-BR')}</span></div>
            <div class="popup-row"><span class="label">% nominais:</span><span class="val-perc">${p}%</span></div>
            <div class="popup-row"><span class="label">Seções / locais:</span><span class="val">${b.secoes}</span></div>
            <div class="popup-row"><span class="label">Comparecimento:</span><span class="val">${b.comparecimento.toLocaleString('pt-BR')} (${pComp}%)</span></div>
            <div class="popup-row"><span class="label">Abstenções:</span><span class="val">${b.abstencoes.toLocaleString('pt-BR')} (${pAbst}%)</span></div>
        </div>
    `;
}

function focusBairro(b, layer) {
    const el = document.getElementById('map-overlay-info');
    if (el) {
        el.innerHTML = `
            <strong>${b.bairro}</strong> · ${state.activeMunicipio.nm_municipio}<br>
            ${b.votos_bolsonaro.toLocaleString('pt-BR')} votos (${(b.perc_bolsonaro * 100).toFixed(1)}%)<br>
            ${b.secoes} seções mapeadas
        `;
    }
    if (b.lat != null) {
        state.map.flyTo([b.lat, b.lon], 13, { duration: 0.6 });
    }
    if (layer?.openPopup) setTimeout(() => layer.openPopup(), 280);
    document.querySelectorAll('.leaderboard-item').forEach(el => {
        el.classList.toggle('active', el.dataset.bairro === b.bairro);
    });
}

function buildMunicipioPopup(m) {
    const p = (m.perc_bolsonaro * 100).toFixed(1);
    const pComp = (m.perc_comparecimento * 100).toFixed(1);
    const pAbst = (m.perc_abstencao * 100).toFixed(1);
    return `
        <div class="popup-header">
            <div class="popup-title">${m.nm_municipio}</div>
        </div>
        <div class="popup-details">
            <div class="popup-row"><span class="label">Votos Bolsonaro:</span><span class="val">${m.votos_bolsonaro.toLocaleString('pt-BR')}</span></div>
            <div class="popup-row"><span class="label">% nominais:</span><span class="val-perc">${p}%</span></div>
            <div class="popup-row"><span class="label">Comparecimento:</span><span class="val">${m.comparecimento.toLocaleString('pt-BR')} (${pComp}%)</span></div>
            <div class="popup-row"><span class="label">Abstenções:</span><span class="val">${m.abstencoes.toLocaleString('pt-BR')} (${pAbst}%)</span></div>
            <div class="popup-row"><span class="label">Estratégia:</span><span class="val" style="font-size:0.7rem">${m.estrategia_principal}</span></div>
        </div>
    `;
}

function showOverlay(m) {
    const el = document.getElementById('map-overlay-info');
    if (!el) return;
    el.innerHTML = `
        <strong>${m.nm_municipio}</strong><br>
        ${m.votos_bolsonaro.toLocaleString('pt-BR')} votos · ${(m.perc_bolsonaro * 100).toFixed(1)}%<br>
        Comparecimento: ${m.comparecimento.toLocaleString('pt-BR')} · Abstenção: ${(m.perc_abstencao * 100).toFixed(1)}%<br>
        <em>${m.estrategia_principal}</em>
    `;
}

/** Heatmap canvas não deve capturar cliques — permite pan/zoom e polígonos. */
function disableHeatmapPointerBlock() {
    document.querySelectorAll('.leaflet-heatmap-layer, .leaflet-heatmap-layer canvas').forEach(el => {
        el.style.pointerEvents = 'none';
    });
}

function focusMunicipio(m, layer) {
    showOverlay(m);
    if (m.lat != null) {
        state.map.flyTo([m.lat, m.lon], 10, { duration: 0.7 });
    }
    if (layer && layer.openPopup) {
        setTimeout(() => layer.openPopup(), 320);
    }
    document.querySelectorAll('.leaderboard-item').forEach(el => {
        el.classList.toggle('active', el.dataset.cd === m.cd_municipio);
    });
}

function updateChart() {
    const el = document.getElementById('top-municipios-chart');
    if (!el || !state.data) return;
    if (state.chart) {
        state.chart.destroy();
        state.chart = null;
    }

    const source = isBairroView()
        ? [...getBairrosAtivos()]
        : [...state.filtered];
    const top = source.sort((a, b) => b.votos_bolsonaro - a.votos_bolsonaro).slice(0, 10);
    const labelKey = isBairroView() ? 'bairro' : 'nm_municipio';
    if (!top.length) {
        el.innerHTML = '<p class="no-results-text" style="padding:1rem;text-align:center">Sem dados para exibir no gráfico.</p>';
        return;
    }
    const isLight = state.theme === 'light';
    const options = {
        chart: { type: 'bar', height: 200, toolbar: { show: false }, foreColor: isLight ? '#475569' : '#94a3b8' },
        series: [{ name: 'Votos', data: top.map(m => m.votos_bolsonaro) }],
        xaxis: {
            categories: top.map(m => {
                const name = m[labelKey];
                return name.length > 14 ? name.slice(0, 12) + '…' : name;
            }),
            labels: { style: { fontSize: '9px' } }
        },
        colors: ['#06b6d4'],
        plotOptions: { bar: { borderRadius: 4, horizontal: true } },
        dataLabels: { enabled: false },
        tooltip: { theme: isLight ? 'light' : 'dark' }
    };
    state.chart = new ApexCharts(el, options);
    state.chart.render();
}

function renderLeaderboard() {
    const list = document.getElementById('leaderboard-list');
    if (!list) return;
    list.innerHTML = '';

    if (isBairroView()) {
        const bairros = getBairrosAtivos();
        if (!bairros.length) {
            list.innerHTML = '<p class="no-results-text">Sem bairros mapeados para esta cidade.</p>';
            return;
        }
        const sorted = [...bairros];
        const refPerc = state.activeMunicipio.perc_bolsonaro;
        if (state.sortMode === 'percent') sorted.sort((a, b) => b.perc_bolsonaro - a.perc_bolsonaro);
        else if (state.sortMode === 'abstencao') sorted.sort((a, b) => b.perc_abstencao - a.perc_abstencao);
        else sorted.sort((a, b) => b.votos_bolsonaro - a.votos_bolsonaro);

        sorted.forEach(b => {
            const item = document.createElement('div');
            item.className = 'leaderboard-item';
            item.dataset.bairro = b.bairro;
            const p = (b.perc_bolsonaro * 100).toFixed(1);
            const bar = colorForPerc(b.perc_bolsonaro, refPerc);
            item.innerHTML = `
                <div class="leaderboard-top-row">
                    <div style="display:flex;flex-direction:column;gap:0.1rem;max-width:72%">
                        <span class="leaderboard-name">${b.bairro}</span>
                        <span class="leaderboard-meta">${b.secoes} seções · ${b.locais || b.secoes} pontos</span>
                    </div>
                    <div class="leaderboard-val-group">
                        <span class="leaderboard-main-val">${b.votos_bolsonaro.toLocaleString('pt-BR')}</span>
                        <span class="leaderboard-perc-val">${p}%</span>
                    </div>
                </div>
                <div class="leaderboard-bar-wrapper">
                    <div class="progress-bar-container" style="height:3px">
                        <div class="progress-bar" style="width:${Math.min(parseFloat(p), 100)}%;background:${bar}"></div>
                    </div>
                </div>
                <div class="leaderboard-meta" style="margin-top:0.25rem;font-size:0.65rem">
                    Aptos ${b.aptos.toLocaleString('pt-BR')} · Comp. ${(b.perc_comparecimento * 100).toFixed(0)}% · Abst. ${(b.perc_abstencao * 100).toFixed(0)}%
                </div>
            `;
            item.addEventListener('click', () => focusBairro(b));
            list.appendChild(item);
        });
        return;
    }

    if (!state.filtered.length) {
        list.innerHTML = '<p class="no-results-text">Nenhum município encontrado.</p>';
        return;
    }

    const sorted = [...state.filtered];
    if (state.sortMode === 'percent') sorted.sort((a, b) => b.perc_bolsonaro - a.perc_bolsonaro);
    else if (state.sortMode === 'abstencao') sorted.sort((a, b) => b.perc_abstencao - a.perc_abstencao);
    else if (state.sortMode === 'oportunidade') sorted.sort((a, b) => b.score_oportunidade - a.score_oportunidade);
    else sorted.sort((a, b) => b.votos_bolsonaro - a.votos_bolsonaro);

    sorted.slice(0, 80).forEach(m => {
        const item = document.createElement('div');
        item.className = 'leaderboard-item';
        item.dataset.cd = m.cd_municipio;
        const p = (m.perc_bolsonaro * 100).toFixed(1);
        const bar = colorForPerc(m.perc_bolsonaro, state.data.summary.percentual);
        item.innerHTML = `
            <div class="leaderboard-top-row">
                <div style="display:flex;flex-direction:column;gap:0.1rem;max-width:72%">
                    <span class="leaderboard-name">${m.nm_municipio}</span>
                    <span class="leaderboard-meta">${m.estrategia_principal} · score ${m.score_oportunidade}</span>
                </div>
                <div class="leaderboard-val-group">
                    <span class="leaderboard-main-val">${m.votos_bolsonaro.toLocaleString('pt-BR')}</span>
                    <span class="leaderboard-perc-val">${p}%</span>
                </div>
            </div>
            <div class="leaderboard-bar-wrapper">
                <div class="progress-bar-container" style="height:3px">
                    <div class="progress-bar" style="width:${Math.min(parseFloat(p), 100)}%;background:${bar}"></div>
                </div>
            </div>
            <div class="leaderboard-meta" style="margin-top:0.25rem;font-size:0.65rem">
                Aptos ${m.aptos.toLocaleString('pt-BR')} · Comp. ${(m.perc_comparecimento * 100).toFixed(0)}% · Abst. ${(m.perc_abstencao * 100).toFixed(0)}%
            </div>
        `;
        item.addEventListener('click', () => focusMunicipio(m));
        list.appendChild(item);
    });
}

function renderInsights() {
    const box = document.getElementById('insights-container');
    if (!box || !state.data) return;
    box.innerHTML = '';
    const insights = state.data.insights || [];
    if (!insights.length) {
        box.innerHTML = '<p class="no-results-text">Nenhum insight disponível.</p>';
        return;
    }
    insights.forEach(ins => box.appendChild(createInsightCard(ins)));
    lucide.createIcons();
}

function renderStrategy() {
    const box = document.getElementById('strategy-container');
    if (!box || !state.data) return;
    box.innerHTML = '';

    if (isBairroView()) {
        const topB = [...getBairrosAtivos()]
            .sort((a, b) => b.votos_bolsonaro - a.votos_bolsonaro)
            .slice(0, 8);
        topB.forEach((b, i) => {
            const card = document.createElement('div');
            card.className = 'insight-card geo strategy-card';
            card.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem">
                    <span class="insight-title">${i + 1}. ${b.bairro}</span>
                </div>
                <p class="insight-desc">
                    <strong>${state.activeMunicipio.nm_municipio}</strong> — ${b.votos_bolsonaro.toLocaleString('pt-BR')} votos
                    (${(b.perc_bolsonaro * 100).toFixed(1)}%), abstenção ${(b.perc_abstencao * 100).toFixed(1)}%.
                </p>
            `;
            card.addEventListener('click', () => focusBairro(b));
            box.appendChild(card);
        });
        return;
    }

    const top = [...state.filtered]
        .sort((a, b) => b.score_oportunidade - a.score_oportunidade)
        .slice(0, 12);

    if (!top.length) {
        box.innerHTML = '<p class="no-results-text">Nenhum município no filtro atual.</p>';
        return;
    }

    top.forEach((m, i) => {
        const card = document.createElement('div');
        card.className = 'insight-card geo strategy-card';
        card.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem">
                <span class="insight-title">${i + 1}. ${m.nm_municipio}</span>
                <span class="strategy-score">${m.score_oportunidade}</span>
            </div>
            <p class="insight-desc">
                <strong>${m.estrategia_principal}</strong> — ${m.votos_bolsonaro.toLocaleString('pt-BR')} votos
                (${(m.perc_bolsonaro * 100).toFixed(1)}%), abstenção ${(m.perc_abstencao * 100).toFixed(1)}%.
                Comparecimento ${m.comparecimento.toLocaleString('pt-BR')} de ${m.aptos.toLocaleString('pt-BR')} aptos.
            </p>
        `;
        card.addEventListener('click', () => focusMunicipio(m));
        box.appendChild(card);
    });
}

function createInsightCard(insight) {
    const card = document.createElement('div');
    card.className = `insight-card ${insight.type}`;
    let icon = 'sparkles';
    if (insight.type === 'positive') icon = 'chevron-up-circle';
    else if (insight.type === 'negative') icon = 'chevron-down-circle';
    else if (insight.type === 'percent') icon = 'trending-up';
    else if (insight.type === 'geo') icon = 'target';
    card.innerHTML = `
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.15rem">
            <i data-lucide="${icon}" style="width:14px;height:14px"></i>
            <span class="insight-title">${insight.title}</span>
        </div>
        <p class="insight-desc">${String(insight.description || '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>
    `;
    return card;
}

function initTheme() {
    const saved = localStorage.getItem('theme');
    state.theme = saved === 'light' ? 'light' : 'dark';
    document.body.classList.toggle('light-theme', state.theme === 'light');
    document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
    updateThemeIcon();
}

function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', state.theme);
    document.body.classList.toggle('light-theme', state.theme === 'light');
    updateThemeIcon();
    if (state.map && state.tileLayer) {
        state.map.removeLayer(state.tileLayer);
        state.tileLayer = L.tileLayer(state.theme === 'light' ? TILES_LIGHT : TILES_DARK, {
            attribution: MAP_ATTRIBUTION,
            subdomains: 'abcd'
        }).addTo(state.map);
    }
    updateChart();
}

function updateThemeIcon() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.innerHTML = state.theme === 'light'
        ? '<i data-lucide="moon" class="theme-toggle-icon"></i>'
        : '<i data-lucide="sun" class="theme-toggle-icon"></i>';
    lucide.createIcons({ nodeList: btn.querySelectorAll('[data-lucide]') });
}

/* ==========================================================================
   APP.JS - DASHBOARD ELEITORAL CONTROL ENGINE
   ========================================================================== */

// Global App State
let appState = {
    originalData: null,
    filteredLocations: [],
    selectedZone: 'all',
    searchQuery: '',
    /** 'all' = nome do local + endereço; 'bairro' = apenas campo bairro (data.json) */
    searchMode: 'all',
    sortMode: 'votes', // 'votes' or 'percent'
    showHeatmap: true,
    showMarkers: true,
    map: null,
    heatmapLayer: null,
    markerLayer: null,
    markersMap: new Map(), // To find markers quickly by location name
    zoneChart: null,
    theme: 'dark', // 'dark' or 'light'
    tileLayer: null
};

// Map Tile Constants
const MAP_CENTER = [-5.0920, -42.8038]; // Centered on Teresina
const DEFAULT_ZOOM = 12;
const TILES_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILES_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const MAP_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

/** Debounce ao digitar no modo “Só bairro”: mapa vai ao pico de intensidade do heatmap */
let bairroMapFocusTimer = null;
const BAIRRO_MAP_FOCUS_DEBOUNCE_MS = 420;

// Initialize the Dashboard on load
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    console.log("Inicializando o Dashboard...");
    
    // 0. Initialize Theme
    initTheme();
    
    // 1. Initialize Map
    initMap();
    
    // 2. Fetch and Load Data
    try {
        const response = await fetch('data.json');
        if (!response.ok) {
            throw new Error(`Erro HTTP: ${response.status}`);
        }
        appState.originalData = await response.json();
        appState.filteredLocations = [...appState.originalData.locations];
        
        console.log("Dados carregados com sucesso!", appState.originalData);
        
        // 3. Setup UI Components
        initFilters();
        updateDashboard();
        
        // Initialize Lucide icons
        lucide.createIcons();
    } catch (error) {
        console.error("Falha ao carregar dados do dashboard:", error);
        showErrorMessage();
    }
}

// ==========================================================================
// INTERACTIVE MAP INITIALIZATION & CONTROLS
// ==========================================================================
function initMap() {
    // Create Leaflet map instance
    appState.map = L.map('map', {
        center: MAP_CENTER,
        zoom: DEFAULT_ZOOM,
        minZoom: 11,
        maxZoom: 16,
        zoomControl: true
    });

    // Determine correct tile layer based on active theme
    const tilesUrl = appState.theme === 'light' ? TILES_LIGHT : TILES_DARK;

    // Add CartoDB tile layer
    appState.tileLayer = L.tileLayer(tilesUrl, {
        attribution: MAP_ATTRIBUTION,
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(appState.map);

    // Initialize layers
    appState.markerLayer = L.featureGroup().addTo(appState.map);
    
    // Setup Layer toggles in header
    const btnToggleHeat = document.getElementById('btn-toggle-heat');
    const btnToggleMarkers = document.getElementById('btn-toggle-markers');

    btnToggleHeat.addEventListener('click', () => {
        appState.showHeatmap = !appState.showHeatmap;
        btnToggleHeat.classList.toggle('active', appState.showHeatmap);
        updateMapLayers();
    });

    btnToggleMarkers.addEventListener('click', () => {
        appState.showMarkers = !appState.showMarkers;
        btnToggleMarkers.classList.toggle('active', appState.showMarkers);
        updateMapLayers();
    });
}

function updateMapLayers() {
    if (!appState.originalData) return;

    // 1. Clear existing layers
    appState.markerLayer.clearLayers();
    appState.markersMap.clear();
    if (appState.heatmapLayer) {
        appState.map.removeLayer(appState.heatmapLayer);
        appState.heatmapLayer = null;
    }

    // 2. Add Heatmap Layer if active
    if (appState.showHeatmap && appState.filteredLocations.length > 0) {
        // Prepare heat points [lat, lon, intensity]
        // Intensity is normalized based on the vote count or percentage
        const heatPoints = appState.filteredLocations.map(loc => {
            // Give higher support percentage more weight in intensity
            const intensity = loc.percentual * 2.0; 
            return [loc.lat, loc.lon, intensity];
        });

        // Config leaflet heat
        appState.heatmapLayer = L.heatLayer(heatPoints, {
            radius: 25,
            blur: 15,
            maxZoom: 13,
            gradient: {
                0.2: 'blue',
                0.4: 'cyan',
                0.6: 'lime',
                0.8: 'yellow',
                1.0: 'red'
            }
        }).addTo(appState.map);
    }

    // 3. Add Marker Layer if active
    if (appState.showMarkers) {
        appState.filteredLocations.forEach(loc => {
            // Determine marker color / design based on percentage support
            // High support (>35%) gets green/cyan, low support gets blue/violet
            let markerColor = '#a78bfa'; // violet (default)
            if (loc.percentual >= 0.40) markerColor = '#10b981'; // emerald
            else if (loc.percentual >= 0.30) markerColor = '#06b6d4'; // cyan
            else if (loc.percentual >= 0.20) markerColor = '#fbbf24'; // amber
            
            // Custom CSS glowing circle marker
            const customIcon = L.divIcon({
                className: 'custom-map-marker',
                html: `<div class="marker-dot" style="background-color: ${markerColor}; box-shadow: 0 0 10px ${markerColor}bb;"></div>`,
                iconSize: [12, 12],
                iconAnchor: [6, 6]
            });

            const marker = L.marker([loc.lat, loc.lon], { icon: customIcon });
            
            // Popup HTML content with modern skinning
            const percentFormatted = (loc.percentual * 100).toFixed(2);
            const votesNominaisFormatted = loc.votos_nominais.toLocaleString('pt-BR');
            const votesFormatted = loc.qt_votos.toLocaleString('pt-BR');
            
            const popupContent = `
                <div class="popup-header">
                    <div class="popup-title">${loc.local_votacao}</div>
                    <span class="popup-zone-badge">Zona ${loc.nr_zona}</span>
                    ${loc.is_fallback ? '<span class="popup-fallback-badge">Coord. Aproximada</span>' : ''}
                </div>
                <div class="popup-details">
                    <div class="popup-row">
                        <span class="label">Bairro:</span>
                        <span class="val">${(loc.bairro || '—')}</span>
                    </div>
                    <div class="popup-row">
                        <span class="label">Endereço:</span>
                        <span class="val" style="font-size: 0.7rem; color: #94a3b8; max-width: 150px; text-align: right; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;" title="${loc.local_endereco}">${loc.local_endereco}</span>
                    </div>
                    <div class="popup-row">
                        <span class="label">Votos Bolsonaro:</span>
                        <span class="val">${votesFormatted}</span>
                    </div>
                    <div class="popup-row">
                        <span class="label">Votos Válidos do Local:</span>
                        <span class="val">${votesNominaisFormatted}</span>
                    </div>
                    <div class="popup-row" style="margin-top: 0.25rem;">
                        <span class="label" style="font-weight: 700;">Percentual Bolsonaro:</span>
                        <span class="val-perc">${percentFormatted}%</span>
                    </div>
                    <div class="popup-progress-container">
                        <div class="progress-bar-container" style="height: 4px;">
                            <div class="progress-bar" style="width: ${percentFormatted}%; background: linear-gradient(to right, ${markerColor}, #34d399);"></div>
                        </div>
                    </div>
                </div>
            `;

            marker.bindPopup(popupContent, {
                closeButton: false,
                offset: [0, -5]
            });

            // Marker hover & click handlers
            marker.on('click', () => {
                document.getElementById('map-overlay-info').innerHTML = `
                    <strong>${loc.local_votacao}</strong><br>
                    Zona ${loc.nr_zona} | Bolsonaro: ${votesFormatted} votos (${percentFormatted}%)
                `;
                
                // Highlight item in leaderboard
                highlightLeaderboardItem(loc.local_votacao);
            });

            marker.addTo(appState.markerLayer);
            appState.markersMap.set(loc.local_votacao, marker);
        });
    }
}

/**
 * No modo “Só bairro”, centraliza o mapa no local com maior intensidade do heatmap
 * (mesma métrica que updateMapLayers: proporcional a `percentual`; desempate: mais votos).
 */
function focusMapOnMaxHeatIntensityFromBairroSearch() {
    if (!appState.map || appState.searchMode !== 'bairro') return;
    const q = String(appState.searchQuery || '').trim();
    if (!q) return;

    const locs = appState.filteredLocations;
    if (!locs.length) return;

    let best = locs[0];
    for (let i = 1; i < locs.length; i++) {
        const loc = locs[i];
        if (loc.percentual > best.percentual) best = loc;
        else if (loc.percentual === best.percentual && loc.qt_votos > best.qt_votos) best = loc;
    }

    const maxZ = typeof appState.map.getMaxZoom === 'function' ? appState.map.getMaxZoom() : 16;
    const z = Math.min(15, maxZ);
    appState.map.flyTo([best.lat, best.lon], z, { duration: 0.85, easeLinearity: 0.22 });

    const marker = appState.markersMap.get(best.local_votacao);
    const votesFormatted = best.qt_votos.toLocaleString('pt-BR');
    const percentFormatted = (best.percentual * 100).toFixed(2);
    const overlay = document.getElementById('map-overlay-info');
    if (overlay) {
        overlay.innerHTML = `
            <strong>Maior intensidade no filtro</strong><br>
            ${best.local_votacao}<br>
            ${best.bairro ? best.bairro + ' · ' : ''}Zona ${best.nr_zona} — ${votesFormatted} votos (${percentFormatted}%)
        `;
    }

    if (marker) {
        window.setTimeout(() => {
            try {
                marker.openPopup();
            } catch (_) { /* ignore */ }
        }, 480);
    }
    highlightLeaderboardItem(best.local_votacao);
}

function scheduleFocusMaxIntensityIfBairroSearch() {
    clearTimeout(bairroMapFocusTimer);
    bairroMapFocusTimer = null;
    if (appState.searchMode !== 'bairro' || !String(appState.searchQuery || '').trim()) return;
    bairroMapFocusTimer = window.setTimeout(() => {
        bairroMapFocusTimer = null;
        focusMapOnMaxHeatIntensityFromBairroSearch();
    }, BAIRRO_MAP_FOCUS_DEBOUNCE_MS);
}

// Zoom to a specific voting location and open popup
function zoomToLocation(locName) {
    const marker = appState.markersMap.get(locName);
    const loc = appState.filteredLocations.find(l => l.local_votacao === locName);
    
    if (marker && loc) {
        appState.map.setView([loc.lat, loc.lon], 15, { animate: true, duration: 1 });
        setTimeout(() => {
            marker.openPopup();
        }, 300);

        document.getElementById('map-overlay-info').innerHTML = `
            <strong>${loc.local_votacao}</strong><br>
            Zona ${loc.nr_zona} | Bolsonaro: ${loc.qt_votos.toLocaleString('pt-BR')} votos (${(loc.percentual * 100).toFixed(2)}%)
        `;
    }
}

// ==========================================================================
// FILTERS & INTERACTIVE SEARCH
// ==========================================================================
function initFilters() {
    // 1. Zone Button Filter click handler
    const zoneContainer = document.getElementById('zone-filter-container');
    zoneContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('zone-btn')) {
            // Remove active class from all buttons
            document.querySelectorAll('.zone-btn').forEach(btn => btn.classList.remove('active'));
            
            // Add active class to clicked button
            e.target.classList.add('active');
            
            // Set state
            appState.selectedZone = e.target.dataset.zone;
            
            // Apply filtering and update
            applyFilters();
        }
    });

    // 2. Search Input handling
    const searchInput = document.getElementById('search-input');
    const clearSearch = document.getElementById('clear-search');

    searchInput.addEventListener('input', (e) => {
        appState.searchQuery = e.target.value;
        clearSearch.style.display = appState.searchQuery ? 'flex' : 'none';
        applyFilters();
    });

    clearSearch.addEventListener('click', () => {
        searchInput.value = '';
        appState.searchQuery = '';
        clearSearch.style.display = 'none';
        applyFilters();
        searchInput.focus();
    });

    // 2b. Modo de busca: nome/endereço vs só bairro
    const btnSearchAll = document.getElementById('search-mode-all');
    const btnSearchBairro = document.getElementById('search-mode-bairro');
    if (btnSearchAll && btnSearchBairro) {
        const setSearchMode = (mode) => {
            if (mode === 'all') {
                clearTimeout(bairroMapFocusTimer);
                bairroMapFocusTimer = null;
            }
            appState.searchMode = mode;
            btnSearchAll.classList.toggle('active', mode === 'all');
            btnSearchBairro.classList.toggle('active', mode === 'bairro');
            searchInput.placeholder =
                mode === 'bairro'
                    ? 'Ex.: Ininga, Dirceu, Centro...'
                    : 'Digite o nome da escola ou endereço...';
            applyFilters();
        };
        btnSearchAll.addEventListener('click', () => setSearchMode('all'));
        btnSearchBairro.addEventListener('click', () => setSearchMode('bairro'));
    }

    // 3. Sorting controls
    const btnSortVotes = document.getElementById('sort-votes');
    const btnSortPercent = document.getElementById('sort-percent');

    btnSortVotes.addEventListener('click', () => {
        btnSortVotes.classList.add('active');
        btnSortPercent.classList.remove('active');
        appState.sortMode = 'votes';
        renderLeaderboard();
    });

    btnSortPercent.addEventListener('click', () => {
        btnSortPercent.classList.add('active');
        btnSortVotes.classList.remove('active');
        appState.sortMode = 'percent';
        renderLeaderboard();
    });
}

function applyFilters() {
    if (!appState.originalData) return;

    let filtered = [...appState.originalData.locations];

    // Filter by Zone
    if (appState.selectedZone !== 'all') {
        const zoneNum = parseInt(appState.selectedZone);
        filtered = filtered.filter(loc => loc.nr_zona === zoneNum);
    }

    // Filter by Search Query
    if (appState.searchQuery) {
        const query = appState.searchQuery.toLowerCase().trim();
        if (appState.searchMode === 'bairro') {
            filtered = filtered.filter(loc => {
                const b = String(loc.bairro || '').toLowerCase();
                return b.includes(query);
            });
        } else {
            filtered = filtered.filter(loc =>
                loc.local_votacao.toLowerCase().includes(query) ||
                loc.local_endereco.toLowerCase().includes(query)
            );
        }
    }

    appState.filteredLocations = filtered;
    
    // Update dashboard elements
    updateDashboard();

    // Modo bairro: após redesenhar marcadores, agenda voo ao pico de intensidade (debounce)
    scheduleFocusMaxIntensityIfBairroSearch();
}

// ==========================================================================
// DASHBOARD ELEMENTS UPDATE
// ==========================================================================
function updateDashboard() {
    if (!appState.originalData) return;

    // 1. Update KPI Values
    updateKPIs();
    
    // 2. Update Map Layers
    updateMapLayers();
    
    // 3. Update Chart
    updateChart();
    
    // 4. Render Leaderboard List
    renderLeaderboard();

    // 5. Render Insights Panel
    renderInsights();
}

function updateKPIs() {
    let votes = 0;
    let nominal = 0;
    let percent = 0;
    
    if (appState.filteredLocations.length > 0) {
        votes = appState.filteredLocations.reduce((sum, loc) => sum + loc.qt_votos, 0);
        nominal = appState.filteredLocations.reduce((sum, loc) => sum + loc.votos_nominais, 0);
        percent = nominal > 0 ? (votes / nominal) * 100 : 0;
    }

    // Counter animation or straight write
    animateValue('kpi-total-votos', votes, true);
    animateValue('kpi-votos-nominais', nominal, true);
    animateValue('kpi-percentual-global', percent, false, '%');
    
    // Set progress bar
    document.getElementById('kpi-percentual-bar').style.width = `${percent}%`;

    // Coverage details
    const totalLocaisFiltered = appState.filteredLocations.length;
    document.getElementById('kpi-locais-cobertos').innerText = totalLocaisFiltered;

    // Zonas count
    const uniqueZonas = new Set(appState.filteredLocations.map(l => l.nr_zona));
    document.getElementById('kpi-zonas-cobertas').innerText = uniqueZonas.size;

    // Subtext for total votes (percentage of Teresina overall support)
    const overallTotalVotes = appState.originalData.summary.total_votes;
    const shareOfTotal = overallTotalVotes > 0 ? (votes / overallTotalVotes) * 100 : 0;
    document.getElementById('kpi-votos-perc-global').innerText = `${shareOfTotal.toFixed(1)}% do total do candidato`;
}

// Helper to animate KPI values counting up
function animateValue(id, endValue, isInteger, suffix = '') {
    const obj = document.getElementById(id);
    if (!obj) return;
    
    const duration = 800; // ms
    const startTime = performance.now();
    const startValue = 0;

    function step(timestamp) {
        const progress = Math.min((timestamp - startTime) / duration, 1);
        // Easing out quadratic
        const easeProgress = progress * (2 - progress);
        const currentValue = startValue + easeProgress * (endValue - startValue);

        if (isInteger) {
            obj.innerHTML = Math.floor(currentValue).toLocaleString('pt-BR') + suffix;
        } else {
            obj.innerHTML = currentValue.toFixed(2).replace('.', ',') + suffix;
        }

        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            if (isInteger) {
                obj.innerHTML = endValue.toLocaleString('pt-BR') + suffix;
            } else {
                obj.innerHTML = endValue.toFixed(2).replace('.', ',') + suffix;
            }
        }
    }

    window.requestAnimationFrame(step);
}

// ==========================================================================
// APEXCHARTS INTEGRATION
// ==========================================================================
function updateChart() {
    if (!appState.originalData) return;

    const chartContainer = document.getElementById('zone-share-chart');
    if (!chartContainer) return;
    const isLightTheme = appState.theme === 'light';
    const chartTextMuted = isLightTheme ? '#475569' : '#94a3b8';
    const chartTextStrong = isLightTheme ? '#0f172a' : '#f8fafc';
    const chartTextSoft = isLightTheme ? '#64748b' : '#64748b';
    const radialTrackBg = isLightTheme ? 'rgba(15, 23, 42, 0.14)' : 'rgba(255, 255, 255, 0.05)';
    const donutStroke = isLightTheme ? '#e2e8f0' : '#0b1122';
    const tooltipTheme = isLightTheme ? 'light' : 'dark';

    // 1. Destroy old chart if exists
    if (appState.zoneChart) {
        appState.zoneChart.destroy();
        appState.zoneChart = null;
    }

    // Chart configs
    let options = {};
    
    // CASE A: Single Zone Selected - Render a beautiful Radial Bar chart of support in that zone
    if (appState.selectedZone !== 'all') {
        const zoneNum = parseInt(appState.selectedZone);
        const zoneData = appState.originalData.zones.find(z => z.nr_zona === zoneNum);
        
        if (zoneData) {
            const supportPercent = (zoneData.percentual * 100).toFixed(1);
            options = {
                chart: {
                    type: 'radialBar',
                    height: 180,
                    sparkline: { enabled: true }
                },
                series: [parseFloat(supportPercent)],
                colors: ['#06b6d4'],
                plotOptions: {
                    radialBar: {
                        startAngle: -90,
                        endAngle: 90,
                        track: {
                            background: radialTrackBg,
                            strokeWidth: '97%',
                            margin: 5,
                            dropShadow: { enabled: false }
                        },
                        dataLabels: {
                            name: { show: false },
                            value: {
                                offsetY: -2,
                                fontSize: '20px',
                                fontWeight: '700',
                                color: chartTextStrong,
                                formatter: function(val) {
                                    return val + "%";
                                }
                            }
                        }
                    }
                },
                labels: [`Zona ${zoneNum}`],
                subtitle: {
                    text: `Percentual de Votos na Zona ${zoneNum}`,
                    align: 'center',
                    style: {
                        color: chartTextMuted,
                        fontSize: '11px',
                        fontFamily: 'Inter'
                    }
                }
            };
        }
    } 
    // CASE B: 'ALL' Zones selected - Render a high-end Pie Chart showing vote share contribution per zone
    else {
        // Group filtered dataset votes by Zone
        const zoneVotes = {};
        appState.filteredLocations.forEach(loc => {
            zoneVotes[loc.nr_zona] = (zoneVotes[loc.nr_zona] || 0) + loc.qt_votos;
        });

        const series = [];
        const labels = [];
        
        Object.keys(zoneVotes).sort().forEach(zone => {
            labels.push(`Zona ${zone}`);
            series.push(zoneVotes[zone]);
        });

        options = {
            chart: {
                type: 'donut',
                height: 180,
                foreColor: chartTextMuted,
                fontFamily: 'Inter'
            },
            series: series,
            labels: labels,
            colors: ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ec4899'],
            stroke: {
                show: true,
                width: 2,
                colors: [donutStroke]
            },
            plotOptions: {
                pie: {
                    donut: {
                        size: '70%',
                        background: 'transparent',
                        labels: {
                            show: true,
                            name: {
                                show: true,
                                fontSize: '11px',
                                fontWeight: '600',
                                color: chartTextMuted
                            },
                            value: {
                                show: true,
                                fontSize: '14px',
                                fontWeight: '800',
                                color: chartTextStrong,
                                formatter: function (val) {
                                    return parseInt(val).toLocaleString('pt-BR');
                                }
                            },
                            total: {
                                show: true,
                                label: 'Votos Totais',
                                fontSize: '10px',
                                fontWeight: '700',
                                color: chartTextSoft,
                                formatter: function (w) {
                                    return w.globals.seriesTotals.reduce((a, b) => a + b, 0).toLocaleString('pt-BR');
                                }
                            }
                        }
                    }
                }
            },
            legend: {
                show: true,
                position: 'right',
                fontSize: '10px',
                markers: { radius: 10 },
                itemMargin: {
                    vertical: 2
                }
            },
            dataLabels: { enabled: false },
            tooltip: {
                theme: tooltipTheme,
                y: {
                    formatter: function(val) {
                        return val.toLocaleString('pt-BR') + ' votos';
                    }
                }
            }
        };
    }

    if (options.chart) {
        appState.zoneChart = new ApexCharts(chartContainer, options);
        appState.zoneChart.render();
    }
}

// ==========================================================================
// LEADERBOARD RENDERING
// ==========================================================================
function renderLeaderboard() {
    const listElement = document.getElementById('leaderboard-list');
    if (!listElement) return;

    listElement.innerHTML = '';

    if (appState.filteredLocations.length === 0) {
        listElement.innerHTML = `
            <div class="no-results">
                <i data-lucide="info" style="width: 24px; height: 24px; color: var(--text-muted); margin-bottom: 0.5rem;"></i>
                <p style="color: var(--text-muted); font-size: 0.8rem;">Nenhum local de votação corresponde aos filtros atuais.</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    // Sort locations based on selected sortMode
    const sorted = [...appState.filteredLocations];
    if (appState.sortMode === 'votes') {
        sorted.sort((a, b) => b.qt_votos - a.qt_votos);
    } else {
        sorted.sort((a, b) => b.percentual - a.percentual);
    }

    // Render elements (slice to top 100 to maintain exceptional DOM performance)
    const itemsToRender = sorted.slice(0, 100);

    itemsToRender.forEach(loc => {
        const item = document.createElement('div');
        item.classList.add('leaderboard-item');
        item.dataset.name = loc.local_votacao;
        
        const votesFormatted = loc.qt_votos.toLocaleString('pt-BR');
        const percentFormatted = (loc.percentual * 100).toFixed(1);
        
        // Progress bar color based on support percent
        let barColor = 'var(--accent-purple)';
        if (loc.percentual >= 0.40) barColor = 'var(--accent-emerald)';
        else if (loc.percentual >= 0.30) barColor = 'var(--accent-blue)';
        else if (loc.percentual >= 0.20) barColor = 'var(--accent-amber)';

        item.innerHTML = `
            <div class="leaderboard-top-row">
                <div style="display: flex; flex-direction: column; gap: 0.15rem; max-width: 70%;">
                    <span class="leaderboard-name" title="${loc.local_votacao}">${loc.local_votacao}</span>
                    <div class="leaderboard-meta">
                        <span style="font-weight: 700; color: var(--text-muted);">ZONA ${loc.nr_zona}</span>
                        <span>•</span>
                        <span title="${loc.bairro || ''}">${loc.bairro || '—'}</span>
                        <span>•</span>
                        <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px;" title="${loc.local_endereco}">${loc.local_endereco}</span>
                    </div>
                </div>
                <div class="leaderboard-val-group">
                    <span class="leaderboard-main-val">${votesFormatted} <span style="font-size: 0.6rem; color: var(--text-muted); font-weight: 500;">votos</span></span>
                    <span class="leaderboard-perc-val">${percentFormatted}%</span>
                </div>
            </div>
            <div class="leaderboard-bar-wrapper">
                <div class="progress-bar-container" style="height: 3px;">
                    <div class="progress-bar" style="width: ${percentFormatted}%; background: ${barColor};"></div>
                </div>
            </div>
        `;

        item.addEventListener('click', () => {
            // Remove active classes
            document.querySelectorAll('.leaderboard-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            
            // Zoom to map location
            zoomToLocation(loc.local_votacao);
        });

        listElement.appendChild(item);
    });
}

function highlightLeaderboardItem(name) {
    const items = document.querySelectorAll('.leaderboard-item');
    items.forEach(item => {
        if (item.dataset.name === name) {
            item.classList.add('active');
            // Scroll to item inside list container
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            item.classList.remove('active');
        }
    });
}

// ==========================================================================
// RENDER INSIGHTS
// ==========================================================================
function renderInsights() {
    const container = document.getElementById('insights-container');
    if (!container || !appState.originalData) return;

    container.innerHTML = '';

    // If a zone is selected, generate specific zone insights on the fly!
    if (appState.selectedZone !== 'all') {
        const zoneNum = parseInt(appState.selectedZone);
        const zoneLocs = appState.originalData.locations.filter(l => l.nr_zona === zoneNum);
        
        if (zoneLocs.length > 0) {
            // Compute specific stats
            const totalZoneVotes = zoneLocs.reduce((sum, l) => sum + l.qt_votos, 0);
            const totalNominal = zoneLocs.reduce((sum, l) => sum + l.votos_nominais, 0);
            const avgPercent = totalNominal > 0 ? (totalZoneVotes / totalNominal) * 100 : 0;
            
            const highestLoc = [...zoneLocs].sort((a,b) => b.percentual - a.percentual)[0];
            const lowestLoc = [...zoneLocs].sort((a,b) => a.percentual - b.percentual)[0];
            
            const zoneInsights = [
                {
                    title: `Desempenho Geral - Zona ${zoneNum}`,
                    description: `A Zona Eleitoral ${zoneNum} registrou **${avgPercent.toFixed(2)}%** de apoio médio para Bolsonaro, totalizando **${totalZoneVotes.toLocaleString('pt-BR')}** votos em **${zoneLocs.length}** locais de votação.`,
                    type: 'positive'
                },
                {
                    title: "Destaque Máximo da Zona",
                    description: `O maior percentual nesta zona foi registrado no(a) **${highestLoc.local_votacao}**, alcançando **${(highestLoc.percentual * 100).toFixed(2)}%** (${highestLoc.qt_votos.toLocaleString('pt-BR')} votos).`,
                    type: 'percent'
                },
                {
                    title: "Ponto Crítico da Zona",
                    description: `A menor percentagem de votos da zona foi no(a) **${lowestLoc.local_votacao}**, com **${(lowestLoc.percentual * 100).toFixed(2)}%** (${lowestLoc.qt_votos.toLocaleString('pt-BR')} de ${lowestLoc.votos_nominais.toLocaleString('pt-BR')} votos válidos).`,
                    type: 'negative'
                }
            ];

            zoneInsights.forEach(insight => {
                const card = createInsightCard(insight);
                container.appendChild(card);
            });
            return;
        }
    }

    // Default general insights from data.json
    appState.originalData.insights.forEach(insight => {
        const card = createInsightCard(insight);
        container.appendChild(card);
    });
}

function createInsightCard(insight) {
    const card = document.createElement('div');
    card.classList.add('insight-card', insight.type);
    
    // Choose appropriate Lucide icon name based on type
    let iconName = 'sparkles';
    if (insight.type === 'positive') iconName = 'chevron-up-circle';
    else if (insight.type === 'negative') iconName = 'chevron-down-circle';
    else if (insight.type === 'info') iconName = 'award';
    else if (insight.type === 'percent') iconName = 'trending-up';
    else if (insight.type === 'geo') iconName = 'map-pin';

    card.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.15rem;">
            <i data-lucide="${iconName}" style="width: 14px; height: 14px; flex-shrink: 0;"></i>
            <span class="insight-title">${insight.title}</span>
        </div>
        <p class="insight-desc">${insight.description}</p>
    `;
    
    // Initialize loaded icon
    setTimeout(() => {
        lucide.createIcons({
            attrs: {
                class: 'insight-card-icon'
            },
            nameAttr: 'data-lucide',
            nodeList: card.querySelectorAll('[data-lucide]')
        });
    }, 0);

    return card;
}

// ==========================================================================
// ERROR MANAGEMENT
// ==========================================================================
function showErrorMessage() {
    const kpis = ['kpi-total-votos', 'kpi-votos-nominais', 'kpi-percentual-global', 'kpi-locais-cobertos'];
    kpis.forEach(kpi => {
        const el = document.getElementById(kpi);
        if (el) el.innerText = 'Erro';
    });

    const list = document.getElementById('leaderboard-list');
    if (list) {
        list.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: #ef4444;">
                <i data-lucide="alert-triangle" style="width: 36px; height: 36px; margin-bottom: 0.5rem;"></i>
                <h4 style="font-weight: 700; margin-bottom: 0.25rem;">Erro de Carregamento</h4>
                <p style="font-size: 0.75rem; color: var(--text-muted);">Não foi possível carregar os dados eleitorais. Certifique-se de que o script 'parse_data.py' foi executado com sucesso e gerou o arquivo 'data.json' na pasta.</p>
            </div>
        `;
        lucide.createIcons();
    }
}

// ==========================================================================
// THEME TOGGLER FUNCTIONS (LIGHT / DARK MODE)
// ==========================================================================
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    
    // Default to dark theme, but check if light theme was saved
    if (savedTheme === 'light') {
        appState.theme = 'light';
        document.body.classList.add('light-theme');
        updateToggleIcon('light');
    } else {
        appState.theme = 'dark';
        document.body.classList.remove('light-theme');
        updateToggleIcon('dark');
    }
    
    // Add click handler to toggle button
    const btnToggle = document.getElementById('theme-toggle');
    if (btnToggle) {
        btnToggle.addEventListener('click', toggleTheme);
    }
}

function toggleTheme() {
    const newTheme = appState.theme === 'dark' ? 'light' : 'dark';
    appState.theme = newTheme;
    localStorage.setItem('theme', newTheme);
    
    // Toggle body class
    if (newTheme === 'light') {
        document.body.classList.add('light-theme');
    } else {
        document.body.classList.remove('light-theme');
    }
    
    updateToggleIcon(newTheme);
    
    // Dynamically update Leaflet Tile layer
    if (appState.map && appState.tileLayer) {
        appState.map.removeLayer(appState.tileLayer);
        
        const newTilesUrl = newTheme === 'light' ? TILES_LIGHT : TILES_DARK;
        appState.tileLayer = L.tileLayer(newTilesUrl, {
            attribution: MAP_ATTRIBUTION,
            subdomains: 'abcd',
            maxZoom: 20
        }).addTo(appState.map);
    }
    
    // Re-render ApexCharts with new tooltip/legend styles
    updateChart();
    
    console.log(`Tema alterado para: ${newTheme}`);
}

function updateToggleIcon(theme) {
    const btnToggle = document.getElementById('theme-toggle');
    if (!btnToggle) return;
    
    // Switch between sun and moon icon
    if (theme === 'light') {
        btnToggle.innerHTML = `<i data-lucide="moon" class="theme-toggle-icon"></i>`;
        btnToggle.title = "Ativar Modo Escuro";
    } else {
        btnToggle.innerHTML = `<i data-lucide="sun" class="theme-toggle-icon"></i>`;
        btnToggle.title = "Ativar Modo Claro";
    }
    
    // Re-create lucide icon for button
    lucide.createIcons({
        nameAttr: 'data-lucide',
        nodeList: btnToggle.querySelectorAll('[data-lucide]')
    });
}

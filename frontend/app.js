// app.js - Análise Sentinel-2 com Google Earth Engine

document.addEventListener('DOMContentLoaded', () => {
  // Aguardar Chart.js carregar
  if (typeof Chart === 'undefined') {
    console.log('Aguardando Chart.js carregar...');
    const checkChart = setInterval(() => {
      if (typeof Chart !== 'undefined') {
        clearInterval(checkChart);
        console.log('Chart.js carregado com sucesso');
        initializeApp();
      }
    }, 100);
    return;
  }

  // ──────────────── Variáveis Globais ─────────────────
  let map;
  let layerControl;
  let drawnItems;
  let currentGeometry = null;
  let currentImages = [];
  let timeSeriesData = [];
  let selectedImage = null;
  let timeSeriesChart = null;
  let precipitationData = [];
  let precipitationChart = null;
  
  // Sistema de múltiplas ROIs
  let rois = [];
  let selectedROI = null;
  let roiLayers = {};
  
  // Controle de mapas base
  let currentBaseMap = 'satellite';
  let baseMapLayers = {};
  
  // Sistema de malha amostral
  let sampleGridPoints = [];
  let sampleGridLayer = null;
  let pointStatsData = [];
  
  // ──────────────── 1. Inicialização do Mapa ──────────
  function initializeMap() {
    map = L.map('map').setView([-10, -52], 4);

    // Criar mapas base
    baseMapLayers = {
      'osm': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: 'Map data © OpenStreetMap contributors'
      }),
      'cartodb': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
      }),
      'satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri'
      })
    };

    // Adicionar mapa base padrão (satélite)
    baseMapLayers[currentBaseMap].addTo(map);

    // Não adicionar layer control ao mapa - será controlado pela sidebar
  }

  // ──────────────── 2. Controle de Desenho ─────────────
  function initializeDrawing() {
    drawnItems = new L.FeatureGroup();
  map.addLayer(drawnItems);

  const drawControl = new L.Control.Draw({
    edit: { featureGroup: drawnItems },
      draw: { 
        polygon: true, 
        rectangle: true, 
        circle: false, 
        marker: false, 
        polyline: false 
      }
  });
  map.addControl(drawControl);

  map.on(L.Draw.Event.CREATED, event => {
    drawnItems.clearLayers();
    drawnItems.addLayer(event.layer);
      
      // Capturar geometria GeoJSON do Leaflet Draw
      const geoJson = event.layer.toGeoJSON();
      currentGeometry = normalizeGeometry(geoJson.geometry);
      
      console.log('ROI criada:', JSON.stringify(currentGeometry, null, 2));
      updateROIStatus();
    });

  // Event listener para atualizar área durante o desenho
  map.on(L.Draw.Event.DRAWVERTEX, event => {
    updateAreaDuringDrawing();
  });

  map.on(L.Draw.Event.EDITVERTEX, event => {
    if (currentGeometry) {
      // Atualizar geometria após edição
      const geoJson = event.layer.toGeoJSON();
      currentGeometry = normalizeGeometry(geoJson.geometry);
      updateROIStatus();
    }
  });

  // Função para atualizar área durante o desenho
  function updateAreaDuringDrawing() {
    if (drawnItems && drawnItems.getLayers().length > 0) {
      const layer = drawnItems.getLayers()[0];
      if (layer && layer.toGeoJSON) {
        const geoJson = layer.toGeoJSON();
        const tempGeometry = normalizeGeometry(geoJson.geometry);
        if (tempGeometry && tempGeometry.type === 'Polygon') {
          const tempArea = calculateROIArea(tempGeometry);
          console.log(`Área atual durante desenho: ${tempArea.toFixed(2)} hectares`);
          
          // Atualizar indicador visual
          const currentAreaElement = document.getElementById('currentArea');
          if (currentAreaElement) {
            currentAreaElement.textContent = tempArea.toFixed(2);
          }
          
          // Mostrar indicador de área
          const areaIndicator = document.getElementById('areaIndicator');
          if (areaIndicator) {
            areaIndicator.style.display = 'block';
          }
        }
      }
    }
  }
  }

  // ──────────────── 3. Upload de Geometria ─────────────
  function initializeUpload() {
    document.getElementById('uploadROI').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;

    const valid = ['.zip', '.kml', '.kmz', '.geojson', '.json']
      .some(ext => file.name.toLowerCase().endsWith(ext));

      if (!valid) {
        alert('⚠️ Formato de arquivo não suportado.');
        return;
      }

    const formData = new FormData();
    formData.append('file', file);

    try {
        showLoading(true);
      const resp = await fetch('/upload-geometry', {
        method: 'POST',
        body: formData
      });

      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      if (!data.geometry) throw new Error('Geometria não retornada');

        currentGeometry = normalizeGeometry(data.geometry);
      drawnItems.clearLayers();
      const layer = L.geoJSON({ type: 'Feature', geometry: currentGeometry }, {
          style: { color: '#3498db', weight: 2, fillOpacity: 0.2 }
      });

      layer.addTo(drawnItems);
      map.fitBounds(layer.getBounds());
      // ROI adicionada ao mapa - controle será atualizado na sidebar
        updateROIStatus();
        alert('✅ ROI carregada com sucesso');
    } catch (err) {
      console.error(err);
      alert(`❌ Erro ao processar o arquivo: ${err.message}`);
      } finally {
        showLoading(false);
      }
    });
  }

  // ──────────────── 4. Controle de Mapas Base ──────────
  function changeBaseMap(mapType) {
    // Remover mapa base atual
    if (baseMapLayers[currentBaseMap]) {
      map.removeLayer(baseMapLayers[currentBaseMap]);
    }
    
    // Adicionar novo mapa base
    if (baseMapLayers[mapType]) {
      baseMapLayers[mapType].addTo(map);
      currentBaseMap = mapType;
      
      // Atualizar botões ativos
      updateBaseMapButtons();
      
      console.log(`Mapa base alterado para: ${mapType}`);
    }
  }

  function updateBaseMapButtons() {
    // Remover classe ativa de todos os botões
    document.querySelectorAll('[onclick^="changeBaseMap"]').forEach(btn => {
      btn.classList.remove('active');
    });
    
    // Adicionar classe ativa ao botão atual
    const activeButton = document.querySelector(`[onclick="changeBaseMap('${currentBaseMap}')"]`);
    if (activeButton) {
      activeButton.classList.add('active');
    }
  }

  // ──────────────── 5. Sistema de Múltiplas ROIs ────────
  function loadROIsFromStorage() {
    const stored = localStorage.getItem('userROIs');
    if (stored) {
      rois = JSON.parse(stored);
      displayROIList();
    }
  }

  function saveROIsToStorage() {
    localStorage.setItem('userROIs', JSON.stringify(rois));
  }

  function addROI(name, geometry) {
    const roi = {
      id: Date.now().toString(),
      name: name,
      geometry: geometry,
      createdAt: new Date().toISOString()
    };
    
    rois.push(roi);
    saveROIsToStorage();
    displayROIList();
    
    // Adicionar layer no mapa
    const layer = L.geoJSON({ type: 'Feature', geometry: geometry }, {
      style: { color: getRandomColor(), weight: 2, fillOpacity: 0.2 }
    });
    
    roiLayers[roi.id] = layer;
    layer.addTo(map);
    // ROI adicionada ao mapa - controle será atualizado na sidebar
    
    return roi;
  }

  function removeROI(roiId) {
    // Remover do array
    rois = rois.filter(roi => roi.id !== roiId);
    saveROIsToStorage();
    
    // Remover layer do mapa
    if (roiLayers[roiId]) {
      map.removeLayer(roiLayers[roiId]);
      delete roiLayers[roiId];
    }
    
    // Se era a ROI selecionada, limpar seleção
    if (selectedROI && selectedROI.id === roiId) {
      selectedROI = null;
      currentGeometry = null;
      updateROIStatus();
    }
    
    displayROIList();
  }

  function selectROI(roiId) {
    const roi = rois.find(r => r.id === roiId);
    if (roi) {
      selectedROI = roi;
      currentGeometry = roi.geometry;
      updateROIStatus();
      displayROIList();
      
      // Centralizar o mapa na ROI selecionada
      centerMapOnROI(roi.geometry);
    }
  }

  function centerMapOnROI(geometry) {
    if (!geometry || !geometry.coordinates) return;
    
    try {
      // Converter geometria para bounds do Leaflet
      let bounds;
      
      if (geometry.type === 'Polygon') {
        const coordinates = geometry.coordinates[0];
        const latLngs = coordinates.map(coord => [coord[1], coord[0]]); // [lat, lng]
        bounds = L.latLngBounds(latLngs);
      } else if (geometry.type === 'MultiPolygon') {
        const allCoordinates = [];
        geometry.coordinates.forEach(polygon => {
          polygon[0].forEach(coord => {
            allCoordinates.push([coord[1], coord[0]]);
          });
        });
        bounds = L.latLngBounds(allCoordinates);
      }
      
      if (bounds) {
        // Centralizar e ajustar zoom para mostrar toda a ROI
        map.fitBounds(bounds, { 
          padding: [20, 20], // Padding para não colar nas bordas
          maxZoom: 16 // Zoom máximo para não ficar muito próximo
        });
        
        console.log('Mapa centralizado na ROI selecionada');
      }
    } catch (error) {
      console.log('Erro ao centralizar mapa na ROI:', error);
    }
  }

  // Função para atualizar controle de layers na sidebar
  function updateLayersControl() {
    const layersControl = document.getElementById('layersControl');
    const layersCard = document.getElementById('layersCard');
    if (!layersControl || !layersCard) return;

    let html = '<div class="layers-list">';
    
    // Adicionar ROI atual se existir
    if (currentGeometry) {
      const roiName = selectedROI ? selectedROI.name : 'ROI Temporária';
      const roiIcon = selectedROI ? 'text-success' : 'text-warning';
      const roiId = selectedROI ? selectedROI.id : 'temp';
      
      html += `
        <div class="layer-item">
          <div class="form-check">
            <input class="form-check-input" type="checkbox" id="roiLayer" checked>
            <label class="form-check-label" for="roiLayer">
              <i class="fas fa-map-marker-alt ${roiIcon}"></i> ${roiName}
            </label>
          </div>
        </div>
      `;
    }

    // Adicionar apenas a camada de visualização ativa (NDVI, RGB, EVI)
    if (window.currentLayer) {
      const layerName = window.currentLayer.options.layerName || 'Visualização Ativa';
      html += `
        <div class="layer-item">
          <div class="form-check">
            <input class="form-check-input" type="checkbox" id="currentLayer" checked>
            <label class="form-check-label" for="currentLayer">
              <i class="fas fa-eye text-primary"></i> ${layerName}
            </label>
          </div>
        </div>
      `;
    }

    html += '</div>';
    layersControl.innerHTML = html;

    // Mostrar/ocultar card baseado no conteúdo
    const hasContent = html.includes('layer-item');
    layersCard.style.display = hasContent ? 'block' : 'none';

    // Adicionar event listeners para checkboxes
    layersControl.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
      checkbox.addEventListener('change', function() {
        const layerId = this.id;
        const isChecked = this.checked;
        
        if (layerId === 'roiLayer') {
          // Controlar visibilidade da ROI
          if (selectedROI && roiLayers[selectedROI.id]) {
            if (isChecked) {
              map.addLayer(roiLayers[selectedROI.id]);
            } else {
              map.removeLayer(roiLayers[selectedROI.id]);
            }
          } else if (currentGeometry && !selectedROI) {
            // ROI temporária - controlar drawnItems
            if (isChecked) {
              if (drawnItems.getLayers().length > 0) {
                map.addLayer(drawnItems);
              }
            } else {
              map.removeLayer(drawnItems);
            }
          }
        } else if (layerId === 'currentLayer') {
          // Controlar visibilidade da camada atual (NDVI, RGB, EVI)
          if (window.currentLayer) {
            if (isChecked) {
              map.addLayer(window.currentLayer);
            } else {
              map.removeLayer(window.currentLayer);
            }
          }
        }
      });
    });
  }

  function getRandomColor() {
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#34495e'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  // ──────────────── Funções da Malha Amostral ─────────────
  
  // Gerar malha amostral com espaçamento configurável
  function generateSampleGrid() {
    console.log('Função generateSampleGrid chamada');
    
    if (!currentGeometry) {
      alert('⚠️ Desenhe ou carregue uma ROI primeiro.');
      return;
    }

    try {
      // Limpar malha anterior se existir
      clearSampleGrid();
      
      // Obter espaçamento do slider
      const spacing = parseInt(document.getElementById('gridSpacing').value);
      console.log('Espaçamento selecionado:', spacing);
      
      // Gerar pontos dentro da ROI
      sampleGridPoints = createGridPoints(currentGeometry, spacing);
      console.log('Pontos gerados:', sampleGridPoints.length);
      
      if (sampleGridPoints.length === 0) {
        // Tentar com espaçamento menor para debug
        console.log('Tentando com espaçamento menor...');
        sampleGridPoints = createGridPoints(currentGeometry, 50);
        console.log('Pontos gerados com espaçamento 50m:', sampleGridPoints.length);
        
        if (sampleGridPoints.length === 0) {
          alert('⚠️ Nenhum ponto foi gerado dentro da ROI. Verifique se a ROI é válida.');
          return;
        }
      }
      
      // Criar layer de pontos
      createSampleGridLayer();
      
      // Atualizar interface
      updateSampleGridInfo();
      
      console.log(`Malha amostral criada com ${sampleGridPoints.length} pontos (espaçamento: ${spacing}m)`);
      
    } catch (error) {
      console.error('Erro ao gerar malha amostral:', error);
      alert(`❌ Erro ao gerar malha amostral: ${error.message}`);
    }
  }

  // Criar pontos da grade dentro da geometria
  function createGridPoints(geometry, spacingMeters) {
    console.log('createGridPoints chamada com:', { geometry, spacingMeters });
    const points = [];
    let pointId = 1;
    
    if (geometry.type === 'Polygon') {
      const coordinates = geometry.coordinates[0];
      console.log('Coordenadas do polígono:', coordinates.length, 'pontos');
      
      const bounds = getGeometryBounds(coordinates);
      console.log('Limites da geometria:', bounds);
      
      // Converter metros para graus (aproximação)
      const latSpacing = spacingMeters / 111000; // 1 grau ≈ 111km
      const lngSpacing = spacingMeters / (111000 * Math.cos(bounds.centerLat * Math.PI / 180));
      
      console.log('Espaçamento em graus:', { latSpacing, lngSpacing });
      
      // Gerar pontos na grade
      for (let lat = bounds.minLat; lat <= bounds.maxLat; lat += latSpacing) {
        for (let lng = bounds.minLng; lng <= bounds.maxLng; lng += lngSpacing) {
          const point = [lng, lat];
          
          // Verificar se o ponto está dentro da ROI
          if (isPointInPolygon(point, coordinates)) {
            points.push({
              id: pointId++,
              lat: lat,
              lng: lng,
              coordinates: point
            });
          }
        }
      }
      
      console.log('Pontos gerados dentro da ROI:', points.length);
    } else {
      console.log('Tipo de geometria não suportado:', geometry.type);
    }
    
    return points;
  }

  // Obter limites da geometria
  function getGeometryBounds(coordinates) {
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    
    coordinates.forEach(coord => {
      const [lng, lat] = coord;
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    });
    
    return {
      minLat, maxLat, minLng, maxLng,
      centerLat: (minLat + maxLat) / 2,
      centerLng: (minLng + maxLng) / 2
    };
  }

  // Verificar se ponto está dentro do polígono
  function isPointInPolygon(point, polygon) {
    const [x, y] = point;
    let inside = false;
    
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    
    return inside;
  }

  // Função alternativa para verificar se ponto está dentro do polígono
  function isPointInPolygonAlternative(point, polygon) {
    const [x, y] = point;
    let inside = false;
    
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0];
      const yi = polygon[i][1];
      const xj = polygon[j][0];
      const yj = polygon[j][1];
      
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    
    return inside;
  }

  // Criar layer visual dos pontos
  function createSampleGridLayer() {
    if (sampleGridLayer) {
      map.removeLayer(sampleGridLayer);
    }
    
    const markers = [];
    sampleGridPoints.forEach(point => {
      const marker = L.circleMarker([point.lat, point.lng], {
        radius: 3,
        fillColor: '#ff6b6b',
        color: '#d63031',
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8
      }).bindPopup(`
        <strong>Ponto ${point.id}</strong><br>
        Lat: ${point.lat.toFixed(6)}<br>
        Lng: ${point.lng.toFixed(6)}
      `);
      
      markers.push(marker);
    });
    
    sampleGridLayer = L.layerGroup(markers);
    sampleGridLayer.addTo(map);
  }

  // Atualizar informações da malha amostral
  function updateSampleGridInfo() {
    const infoElement = document.getElementById('sampleGridInfo');
    if (sampleGridPoints.length > 0) {
      const spacing = document.getElementById('gridSpacing').value;
      const area = calculateROIArea(currentGeometry);
      const density = (sampleGridPoints.length / area).toFixed(2);
      infoElement.innerHTML = `
        <strong>${sampleGridPoints.length} pontos</strong> criados<br>
        <small>Espaçamento: ${spacing}m | Densidade: ${density} pontos/ha</small>
      `;
    } else {
      infoElement.textContent = 'Nenhuma malha criada';
    }
  }

  // Limpar malha amostral
  function clearSampleGrid() {
    if (sampleGridLayer) {
      map.removeLayer(sampleGridLayer);
      sampleGridLayer = null;
    }
    sampleGridPoints = [];
    pointStatsData = [];
    updateSampleGridInfo();
    
    // Esconder botão apenas se não há dados
    const viewButton = document.getElementById('viewPointData');
    if (viewButton) {
      viewButton.style.display = pointStatsData.length > 0 ? 'block' : 'none';
    }
  }

  // Extrair estatísticas por pontos
  async function extractPointStats() {
    if (sampleGridPoints.length === 0) {
      alert('⚠️ Crie uma malha amostral primeiro.');
      return;
    }

    if (!window.currentLayer) {
      alert('⚠️ Gere uma visualização (NDVI, RGB, EVI) primeiro.');
      return;
    }

    try {
      showLoading(true);
      
      // Preparar dados dos pontos
      const pointsData = sampleGridPoints.map(point => ({
        id: point.id,
        lat: point.lat,
        lng: point.lng
      }));

      // Enviar requisição para extrair estatísticas
      const response = await fetch('/api/extract-point-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          points: pointsData,
          geometry: currentGeometry
        })
      });

      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();

      // Armazenar dados para visualização
      pointStatsData = data.stats;
      console.log('Dados armazenados:', pointStatsData);
      
      // Mostrar botão de visualizar dados
      const viewButton = document.getElementById('viewPointData');
      if (viewButton) {
        viewButton.style.display = 'block';
        console.log('Botão de visualizar dados mostrado');
      } else {
        console.error('Botão viewPointData não encontrado');
      }
      
      // Gerar CSV
      generatePointStatsCSV(data.stats);

    } catch (error) {
      console.error('Erro ao extrair estatísticas:', error);
      alert(`❌ Erro ao extrair estatísticas: ${error.message}`);
    } finally {
      showLoading(false);
    }
  }

  // Gerar CSV com estatísticas dos pontos
  function generatePointStatsCSV(stats) {
    console.log('generatePointStatsCSV chamada com:', stats);
    
    let csvContent = 'ID,Latitude,Longitude,NDVI_Medio,EVI_Medio\n';
    
    stats.forEach(stat => {
      console.log('Processando ponto:', stat);
      csvContent += `${stat.id},${stat.lat},${stat.lng},${stat.ndvi_mean},${stat.evi_mean}\n`;
    });

    // Criar e baixar arquivo
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `estatisticas_pontos_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    console.log(`CSV gerado com ${stats.length} pontos`);
  }

  // Mostrar modal com dados dos pontos
  function showPointDataModal() {
    console.log('showPointDataModal chamada');
    console.log('pointStatsData:', pointStatsData);
    
    if (pointStatsData.length === 0) {
      alert('⚠️ Nenhum dado disponível. Extraia estatísticas primeiro.');
      return;
    }

    // Preencher tabela
    const tableBody = document.getElementById('pointDataTableBody');
    if (!tableBody) {
      console.error('Elemento pointDataTableBody não encontrado');
      return;
    }
    
    tableBody.innerHTML = '';

    pointStatsData.forEach(point => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${point.id}</td>
        <td>${point.lat.toFixed(6)}</td>
        <td>${point.lng.toFixed(6)}</td>
        <td>${point.ndvi_mean.toFixed(4)}</td>
        <td>${point.evi_mean.toFixed(4)}</td>
      `;
      tableBody.appendChild(row);
    });

    // Mostrar modal
    const modal = document.getElementById('pointDataModal');
    if (!modal) {
      console.error('Modal pointDataModal não encontrado');
      return;
    }
    
    modal.style.display = 'block';
    modal.style.zIndex = '9999';
    modal.classList.add('open');
    console.log('Modal exibido com z-index:', modal.style.zIndex);
  }

  // Ocultar modal de dados dos pontos
  function hidePointDataModal() {
    const modal = document.getElementById('pointDataModal');
    modal.style.display = 'none';
    modal.classList.remove('open');
  }
  
  // Tornar função globalmente acessível
  window.hidePointDataModal = hidePointDataModal;

  // Exportar dados dos pontos para CSV
  function exportPointDataCSV() {
    if (pointStatsData.length === 0) {
      alert('⚠️ Nenhum dado disponível para exportar.');
      return;
    }

    generatePointStatsCSV(pointStatsData);
  }

  // Atualizar informações do slider de espaçamento
  function updateSpacingInfo() {
    const spacing = parseInt(document.getElementById('gridSpacing').value);
    const spacingValue = document.getElementById('spacingValue');
    const spacingInfo = document.getElementById('spacingInfo');
    
    // Atualizar valor exibido
    spacingValue.textContent = `${spacing}m`;
    
    // Atualizar informação descritiva
    if (spacing === 100) {
      spacingInfo.textContent = 'Aproximadamente 1 hectare (100m x 100m)';
    } else if (spacing === 200) {
      spacingInfo.textContent = 'Aproximadamente 4 hectares (200m x 200m)';
    } else if (spacing === 300) {
      spacingInfo.textContent = 'Aproximadamente 9 hectares (300m x 300m)';
    } else if (spacing === 400) {
      spacingInfo.textContent = 'Aproximadamente 16 hectares (400m x 400m)';
    } else if (spacing === 500) {
      spacingInfo.textContent = 'Aproximadamente 25 hectares (500m x 500m)';
    } else {
      spacingInfo.textContent = `Espaçamento personalizado (${spacing}m x ${spacing}m)`;
    }
  }

  // Estimar número de pontos para o espaçamento atual
  function estimateGridPoints() {
    if (!currentGeometry) return 0;
    
    const spacing = parseInt(document.getElementById('gridSpacing').value);
    const area = calculateROIArea(currentGeometry);
    
    // Estimativa baseada na área e espaçamento
    const estimatedPoints = Math.floor(area / ((spacing / 100) * (spacing / 100)));
    return Math.max(1, estimatedPoints);
  }

  function displayROIList() {
    const roiList = document.getElementById('roiList');
    roiList.innerHTML = '';
    
    if (rois.length === 0) {
      roiList.innerHTML = '<p class="text-muted small">Nenhuma ROI salva</p>';
      return;
    }
    
    rois.forEach(roi => {
      const item = document.createElement('div');
      item.className = `roi-item ${selectedROI && selectedROI.id === roi.id ? 'selected' : ''}`;
      item.innerHTML = `
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <strong>${roi.name}</strong><br>
            <small class="text-muted">${new Date(roi.createdAt).toLocaleDateString()}</small>
          </div>
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-primary btn-sm" onclick="selectROI('${roi.id}')">
              <i class="fas fa-check"></i>
            </button>
            <button class="btn btn-outline-danger btn-sm" onclick="removeROI('${roi.id}')">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      `;
      roiList.appendChild(item);
    });
  }

  function showAddROIModal() {
    document.getElementById('addROIModal').classList.add('open');
  }

  function hideAddROIModal() {
    document.getElementById('addROIModal').classList.remove('open');
  }

  function saveCurrentROI() {
    if (!currentGeometry) {
      alert('⚠️ Desenhe uma ROI primeiro.');
      return;
    }
    
    const name = document.getElementById('roiName').value.trim();
    if (!name) {
      alert('⚠️ Digite um nome para a ROI.');
      return;
    }
    
    // Verificar se já existe ROI com o mesmo nome
    if (rois.some(roi => roi.name.toLowerCase() === name.toLowerCase())) {
      alert('⚠️ Já existe uma ROI com este nome.');
      return;
    }
    
    const roi = addROI(name, currentGeometry);
    hideAddROIModal();
    document.getElementById('roiName').value = '';
    
    alert(`✅ ROI "${name}" salva com sucesso!`);
  }

  // ──────────────── 5. Funções Auxiliares ──────────────
  function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'block' : 'none';
  }

  function updateROIStatus() {
    const hasROI = currentGeometry !== null;
    document.getElementById('imagesCard').style.display = hasROI ? 'block' : 'none';
    document.getElementById('visualizationCard').style.display = hasROI ? 'block' : 'none';
    
    // Atualizar indicador de área
    const areaIndicator = document.getElementById('areaIndicator');
    const currentAreaElement = document.getElementById('currentArea');
    
    if (hasROI) {
      const area = calculateROIArea(currentGeometry);
      currentAreaElement.textContent = area.toFixed(2);
      areaIndicator.style.display = 'block';
    } else {
      areaIndicator.style.display = 'none';
    }
    
    // Atualizar informações da ROI selecionada
    const roiInfo = document.getElementById('roiInfo');
    if (hasROI && selectedROI) {
      const area = calculateROIArea(currentGeometry);
      roiInfo.innerHTML = `
        <div class="alert alert-info">
          <strong>ROI Selecionada:</strong> ${selectedROI.name}<br>
          <small>Área: ${area.toFixed(2)} hectares | Criada: ${new Date(selectedROI.createdAt).toLocaleDateString()}</small>
        </div>
      `;
      roiInfo.style.display = 'block';
    } else if (hasROI) {
      const area = calculateROIArea(currentGeometry);
      roiInfo.innerHTML = `
        <div class="alert alert-warning">
          <strong>ROI Temporária</strong><br>
          <small>Área: ${area.toFixed(2)} hectares | <button class="btn btn-sm btn-outline-primary" onclick="showAddROIModal()">Salvar ROI</button></small>
        </div>
      `;
      roiInfo.style.display = 'block';
    } else {
      roiInfo.style.display = 'none';
    }
    
    if (hasROI) {
      // Normalizar geometria
      currentGeometry = normalizeGeometry(currentGeometry);
      
      // Calcular área da ROI
      const area = calculateROIArea(currentGeometry);
      console.log(`ROI definida - Área: ${area.toFixed(2)} hectares`);
    }

    // Atualizar controle de layers
    updateLayersControl();
    
    // Mostrar/ocultar card da malha amostral
    const sampleGridCard = document.getElementById('sampleGridCard');
    if (hasROI) {
      sampleGridCard.style.display = 'block';
    } else {
      sampleGridCard.style.display = 'none';
    }
  }

  function normalizeGeometry(geometry) {
    // Garantir que a geometria está no formato GeoJSON correto
    if (!geometry || typeof geometry !== 'object') {
      return null;
    }

    // Se já é uma geometria válida
    if (geometry.type && geometry.coordinates) {
      return {
        type: geometry.type,
        coordinates: geometry.coordinates
      };
    }

    // Se é um Feature
    if (geometry.type === 'Feature' && geometry.geometry) {
      return {
        type: geometry.geometry.type,
        coordinates: geometry.geometry.coordinates
      };
    }

    // Se é um FeatureCollection
    if (geometry.type === 'FeatureCollection' && geometry.features && geometry.features.length > 0) {
      const firstFeature = geometry.features[0];
      if (firstFeature.geometry) {
        return {
          type: firstFeature.geometry.type,
          coordinates: firstFeature.geometry.coordinates
        };
      }
    }

    return null;
  }

  function calculateROIArea(geometry) {
    if (!geometry || geometry.type !== 'Polygon') return 0;
    
    try {
      // Usar a biblioteca de geometria do Leaflet para cálculo mais preciso
      const coordinates = geometry.coordinates[0];
      const latLngs = coordinates.map(coord => [coord[1], coord[0]]); // [lat, lng]
      
      // Calcular área usando fórmula de Shoelace com correção de latitude
      let area = 0;
      const n = latLngs.length;
      
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const lat1 = latLngs[i][0] * Math.PI / 180;
        const lat2 = latLngs[j][0] * Math.PI / 180;
        const lng1 = latLngs[i][1] * Math.PI / 180;
        const lng2 = latLngs[j][1] * Math.PI / 180;
        
        area += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
      }
      
      area = Math.abs(area) * 6371000 * 6371000 / 2; // Raio da Terra em metros
      return area / 10000; // Converter m² para hectares
    } catch (error) {
      console.log('Erro ao calcular área:', error);
      return 0;
    }
  }

  // ──────────────── 5. Carregar Imagens Sentinel-2 ─────
  function initializeImageLoading() {
    document.getElementById('loadImages').addEventListener('click', async () => {
      if (!currentGeometry) {
        alert('⚠️ Desenhe ou carregue uma ROI primeiro.');
        return;
      }

      const startDate = document.getElementById('startDate').value;
      const endDate = document.getElementById('endDate').value;

      if (!startDate || !endDate) {
        alert('⚠️ Defina as datas inicial e final.');
        return;
      }

      try {
        showLoading(true);
        
        // Validar geometria antes de enviar
        if (!currentGeometry) {
          throw new Error('Nenhuma ROI definida. Desenhe uma área no mapa ou faça upload de um arquivo.');
        }
        
        if (!currentGeometry.type || !currentGeometry.coordinates) {
          throw new Error('Geometria inválida. A ROI deve ter tipo e coordenadas válidas.');
        }
        
        if (!['Polygon', 'MultiPolygon'].includes(currentGeometry.type)) {
          throw new Error('Tipo de geometria não suportado. Use polígono ou multipolígono.');
        }
        
        console.log('Enviando requisição com geometria:', JSON.stringify(currentGeometry, null, 2));
        
        const response = await fetch('/api/load-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        geometry: currentGeometry,
            startDate: startDate,
            endDate: endDate
      })
    });

    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();

        currentImages = data.images;
        timeSeriesData = data.timeSeries;

        displayImageList();
        updateStatistics();
        createTimeSeriesChart();
        showChartModal();

      } catch (err) {
        console.error(err);
        alert(`❌ Erro ao carregar imagens: ${err.message}`);
      } finally {
        showLoading(false);
      }
    });
  }

  // ──────────────── 6. Exibir Lista de Imagens ─────────
  function displayImageList() {
    const imageList = document.getElementById('imageList');
    imageList.innerHTML = '';

    if (currentImages.length === 0) {
      imageList.innerHTML = '<p class="text-muted">Nenhuma imagem encontrada no período.</p>';
      return;
    }

    currentImages.forEach((image, index) => {
      const item = document.createElement('div');
      item.className = 'image-item';
      item.innerHTML = `
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <strong>${image.date}</strong><br>
            <small class="text-muted">Nuvens: ${image.cloudPercentage}%</small>
          </div>
          <button class="btn btn-sm btn-outline-primary" onclick="selectImage(${index})">
            Selecionar
          </button>
        </div>
      `;
      imageList.appendChild(item);
    });

    // Atualizar controle de layers na sidebar
    updateLayersControl();
  }

  // ──────────────── 7. Selecionar Imagem ───────────────
  window.selectImage = function(index) {
    selectedImage = currentImages[index];
    
    // Remover seleção anterior
    document.querySelectorAll('.image-item').forEach(item => {
      item.classList.remove('selected');
    });
    
    // Adicionar seleção atual
    document.querySelectorAll('.image-item')[index].classList.add('selected');
    
    // Atualizar estatísticas da imagem selecionada
    updateImageStatistics(selectedImage);
  };

  // ──────────────── 8. Visualizações ───────────────────
  function initializeVisualizations() {
    // NDVI
    document.getElementById('showNDVI').addEventListener('click', async () => {
      await showVisualization('ndvi');
    });

    // RGB
    document.getElementById('showRGB').addEventListener('click', async () => {
      await showVisualization('rgb');
    });

    // EVI
    document.getElementById('showEVI').addEventListener('click', async () => {
      await showVisualization('evi');
    });

    // Download TIFF
    document.getElementById('downloadTIFF').addEventListener('click', async () => {
      await downloadTIFF();
    });

  }

  async function showVisualization(type) {
    if (!currentGeometry) {
      alert('⚠️ Desenhe ou carregue uma ROI primeiro.');
      return;
    }

    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;

    try {
      showLoading(true);
      
      // Validar geometria antes de enviar
      if (!currentGeometry) {
        throw new Error('Nenhuma ROI definida. Desenhe uma área no mapa ou faça upload de um arquivo.');
      }
      
      if (!currentGeometry.type || !currentGeometry.coordinates) {
        throw new Error('Geometria inválida. A ROI deve ter tipo e coordenadas válidas.');
      }
      
      if (!['Polygon', 'MultiPolygon'].includes(currentGeometry.type)) {
        throw new Error('Tipo de geometria não suportado. Use polígono ou multipolígono.');
      }
      
      console.log(`Gerando visualização ${type.toUpperCase()} com geometria:`, JSON.stringify(currentGeometry, null, 2));
      
      const endpoint = `/api/visualize-${type}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geometry: currentGeometry,
          imageId: selectedImage ? selectedImage.id : null,
          imageDate: selectedImage ? selectedImage.date : null,
          startDate: startDate,
          endDate: endDate
        })
      });

      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();

      // Remover layer anterior se existir
      if (window.currentLayer) {
        map.removeLayer(window.currentLayer);
      }

      // Adicionar nova layer
      window.currentLayer = L.tileLayer(data.tileUrl, { opacity: 0.8 }).addTo(map);
      
      const layerName = type.toUpperCase() + (selectedImage ? ` - ${selectedImage.date}` : ' - Composição');
      // Armazenar nome da camada para o controle
      window.currentLayer.options.layerName = layerName;
      
      // Atualizar controle de layers na sidebar
      updateLayersControl();

  } catch (err) {
    console.error(err);
      alert(`❌ Erro ao gerar visualização: ${err.message}`);
    } finally {
      showLoading(false);
    }
  }

  // ──────────────── 8. Download TIFF ────────────────────
  async function downloadTIFF() {
    if (!currentGeometry) {
      alert('⚠️ Desenhe ou carregue uma ROI primeiro.');
      return;
    }

    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;

    if (!startDate || !endDate) {
      alert('⚠️ Selecione as datas inicial e final.');
      return;
    }

    // Mostrar opções de download
    const options = ['RGB', 'NDVI', 'EVI'];
    const choice = prompt(`Escolha o tipo de download:\n1 - RGB\n2 - NDVI\n3 - EVI\n\nDigite o número (1-3):`);
    
    if (!choice || choice < 1 || choice > 3) {
      return;
    }

    const selectedType = options[parseInt(choice) - 1].toLowerCase();

    try {
      showLoading(true);
      
      console.log(`Gerando download TIFF ${selectedType.toUpperCase()} com geometria:`, JSON.stringify(currentGeometry, null, 2));
      
      const response = await fetch('/api/download-tiff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geometry: currentGeometry,
          imageId: selectedImage ? selectedImage.id : null,
          imageDate: selectedImage ? selectedImage.date : null,
          startDate: startDate,
          endDate: endDate,
          type: selectedType
        })
      });

      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();

      // Abrir URL de download em nova aba
      if (data.downloadUrl) {
        window.open(data.downloadUrl, '_blank');
        alert(`✅ ${data.message}\n\nO arquivo ${selectedType.toUpperCase()}.tif será baixado diretamente para seu computador.`);
      } else {
        throw new Error('URL de download não retornada');
      }

    } catch (err) {
      console.error(err);
      alert(`❌ Erro ao gerar download: ${err.message}`);
    } finally {
      showLoading(false);
    }
  }

  // ──────────────── 9. Estatísticas ────────────────────
  function updateStatistics() {
    if (timeSeriesData.length === 0) return;

    const latestData = timeSeriesData[timeSeriesData.length - 1];
    document.getElementById('ndviMean').textContent = latestData.ndvi_mean ? latestData.ndvi_mean.toFixed(3) : '-';
    document.getElementById('eviMean').textContent = latestData.evi_mean ? latestData.evi_mean.toFixed(3) : '-';
    
    document.getElementById('statsCard').style.display = 'block';
  }

  function updateImageStatistics(image) {
    // Aqui você pode implementar estatísticas específicas da imagem selecionada
    console.log('Imagem selecionada:', image);
  }

  // ──────────────── 10. Gráfico de Séries Temporais ────
  function createTimeSeriesChart() {
    if (timeSeriesData.length === 0) return;

    // Verificar se Chart.js está disponível
    if (typeof Chart === 'undefined') {
      console.error('Chart.js não está carregado');
      alert('Erro: Chart.js não está disponível. Recarregue a página.');
      return;
    }

    const ctx = document.getElementById('timeSeriesChart').getContext('2d');
    
    if (timeSeriesChart) {
      timeSeriesChart.destroy();
    }

    const labels = timeSeriesData.map(d => d.date);
    const ndviData = timeSeriesData.map(d => d.ndvi_mean);
    const eviData = timeSeriesData.map(d => d.evi_mean);

    timeSeriesChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'NDVI',
            data: ndviData,
            borderColor: 'rgb(75, 192, 192)',
            backgroundColor: 'rgba(75, 192, 192, 0.2)',
            tension: 0.1
          },
          {
            label: 'EVI',
            data: eviData,
            borderColor: 'rgb(255, 99, 132)',
            backgroundColor: 'rgba(255, 99, 132, 0.2)',
            tension: 0.1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: 'Séries Temporais de Índices de Vegetação',
            font: {
              size: 16
            }
          },
          legend: {
            position: 'top',
            labels: {
              font: {
                size: 12
              }
            }
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text: 'Data',
              font: {
                size: 12
              }
            }
          },
          y: {
            beginAtZero: true,
            max: 1,
            title: {
              display: true,
              text: 'Valor do Índice',
              font: {
                size: 12
              }
            }
          }
        }
      }
    });

    showChartModal();
  }

  // ──────────────── 11. Controles do Modal do Gráfico ────
  function showChartModal() {
    if (timeSeriesData.length > 0) {
      document.getElementById('chartModal').classList.add('open');
    }
  }

  function hideChartModal() {
    document.getElementById('chartModal').classList.remove('open');
  }

  // ──────────────── 12. Gráfico de Precipitação ────────────
  async function generatePrecipitationChart() {
    if (!currentGeometry) {
      alert('⚠️ Desenhe ou carregue uma ROI primeiro.');
      return;
    }

    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;

    if (!startDate || !endDate) {
      alert('⚠️ Defina as datas inicial e final.');
      return;
    }

    try {
      showLoading(true);
      
      console.log('Buscando dados de precipitação CHIRPS...');
      
      const response = await fetch('/api/precipitation-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geometry: currentGeometry,
          startDate: startDate,
          endDate: endDate
        })
      });

      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();

      precipitationData = data.precipitationData;
      
      if (precipitationData.length === 0) {
        alert('⚠️ Nenhum dado de precipitação encontrado para o período selecionado.');
        return;
      }

      createPrecipitationChart();
      showPrecipitationModal();

    } catch (err) {
      console.error(err);
      alert(`❌ Erro ao carregar dados de precipitação: ${err.message}`);
    } finally {
      showLoading(false);
    }
  }

  function createPrecipitationChart() {
    if (precipitationData.length === 0) return;

    // Verificar se Chart.js está disponível
    if (typeof Chart === 'undefined') {
      console.error('Chart.js não está carregado');
      alert('Erro: Chart.js não está disponível. Recarregue a página.');
      return;
    }

    const ctx = document.getElementById('precipitationChart').getContext('2d');
    
    if (precipitationChart) {
      precipitationChart.destroy();
    }

    const labels = precipitationData.map(d => d.date);
    const precipitationMean = precipitationData.map(d => d.precipitation_mean || 0);
    const precipitationMax = precipitationData.map(d => d.precipitation_max || 0);
    const precipitationMin = precipitationData.map(d => d.precipitation_min || 0);

    precipitationChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Precipitação Média (mm)',
            data: precipitationMean,
            borderColor: 'rgb(54, 162, 235)',
            backgroundColor: 'rgba(54, 162, 235, 0.2)',
            tension: 0.1,
            fill: true
          },
          {
            label: 'Precipitação Máxima (mm)',
            data: precipitationMax,
            borderColor: 'rgb(255, 99, 132)',
            backgroundColor: 'rgba(255, 99, 132, 0.1)',
            tension: 0.1,
            borderDash: [5, 5]
          },
          {
            label: 'Precipitação Mínima (mm)',
            data: precipitationMin,
            borderColor: 'rgb(75, 192, 192)',
            backgroundColor: 'rgba(75, 192, 192, 0.1)',
            tension: 0.1,
            borderDash: [5, 5]
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: 'Precipitação Diária - Dados CHIRPS',
            font: {
              size: 16
            }
          },
          legend: {
            position: 'top',
            labels: {
              font: {
                size: 12
              }
            }
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text: 'Data',
              font: {
                size: 12
              }
            }
          },
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Precipitação (mm)',
              font: {
                size: 12
              }
            }
          }
        }
      }
    });
  }

  function showPrecipitationModal() {
    if (precipitationData.length > 0) {
      document.getElementById('precipitationModal').classList.add('open');
    }
  }

  function hidePrecipitationModal() {
    document.getElementById('precipitationModal').classList.remove('open');
  }

  // ──────────────── 14. Modal de Disclaimer ──────────────
  function showDisclaimerModal() {
    document.getElementById('disclaimerOverlay').classList.add('show');
    document.getElementById('disclaimerModal').classList.add('open');
  }

  function hideDisclaimerModal() {
    document.getElementById('disclaimerOverlay').classList.remove('show');
    document.getElementById('disclaimerModal').classList.remove('open');
  }

  function acceptDisclaimer() {
    const dontShowAgain = document.getElementById('dontShowAgain').checked;
    
    if (dontShowAgain) {
      localStorage.setItem('disclaimerAccepted', 'true');
      console.log('Disclaimer aceito - não será mostrado novamente');
    } else {
      console.log('Disclaimer aceito - será mostrado novamente na próxima visita');
    }
    
    hideDisclaimerModal();
  }

  function showFullInfo() {
    hideDisclaimerModal();
    showInfoModal();
  }

  // Função para resetar disclaimer (útil para testes)
  function resetDisclaimer() {
    localStorage.removeItem('disclaimerAccepted');
    console.log('Disclaimer resetado - será mostrado novamente');
  }

  function checkDisclaimerStatus() {
    const disclaimerAccepted = localStorage.getItem('disclaimerAccepted');
    
    console.log('Verificando status do disclaimer:', disclaimerAccepted);
    
    if (!disclaimerAccepted) {
      console.log('Disclaimer não foi aceito - mostrando modal');
      // Aguardar um pouco para garantir que a página carregou
      setTimeout(() => {
        showDisclaimerModal();
      }, 1000);
    } else {
      console.log('Disclaimer já foi aceito - não mostrando modal');
    }
  }

  // ──────────────── 15. Modal de Informações ──────────────
  function showInfoModal() {
    document.getElementById('infoModal').classList.add('open');
  }

  function hideInfoModal() {
    document.getElementById('infoModal').classList.remove('open');
  }

  // ──────────────── 13. Exportação CSV ──────────────────
  function exportToCSV(data, filename) {
    if (!data || data.length === 0) {
      alert('⚠️ Nenhum dado disponível para exportar.');
      return;
    }

    // Converter dados para CSV
    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(','),
      ...data.map(row => 
        headers.map(header => {
          const value = row[header];
          // Escapar valores que contêm vírgulas ou aspas
          if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        }).join(',')
      )
    ].join('\n');

    // Criar e baixar arquivo
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function exportTimeSeriesData() {
    if (timeSeriesData.length === 0) {
      alert('⚠️ Nenhum dado de séries temporais disponível.');
      return;
    }

    const roiName = selectedROI ? selectedROI.name : 'ROI_Temporaria';
    const filename = `series_temporais_${roiName}_${new Date().toISOString().split('T')[0]}.csv`;
    
    exportToCSV(timeSeriesData, filename);
  }

  function exportPrecipitationData() {
    if (precipitationData.length === 0) {
      alert('⚠️ Nenhum dado de precipitação disponível.');
      return;
    }

    const roiName = selectedROI ? selectedROI.name : 'ROI_Temporaria';
    const filename = `precipitacao_${roiName}_${new Date().toISOString().split('T')[0]}.csv`;
    
    exportToCSV(precipitationData, filename);
  }

  function exportAllData() {
    const hasTimeSeries = timeSeriesData.length > 0;
    const hasPrecipitation = precipitationData.length > 0;

    if (!hasTimeSeries && !hasPrecipitation) {
      alert('⚠️ Nenhum dado disponível para exportar. Gere os gráficos primeiro.');
      return;
    }

    const roiName = selectedROI ? selectedROI.name : 'ROI_Temporaria';
    const timestamp = new Date().toISOString().split('T')[0];

    if (hasTimeSeries) {
      const filename = `series_temporais_${roiName}_${timestamp}.csv`;
      exportToCSV(timeSeriesData, filename);
    }

    if (hasPrecipitation) {
      const filename = `precipitacao_${roiName}_${timestamp}.csv`;
      exportToCSV(precipitationData, filename);
    }

    alert('✅ Dados exportados com sucesso!');
  }

  // ──────────────── 12. Controles da Sidebar ───────────
  function initializeSidebarControls() {
    // Toggle sidebar
    document.getElementById('toggleSidebar').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });

    // Fechar sidebar
    document.getElementById('closeSidebar').addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('open');
    });

    // Modal de informações
    document.getElementById('showInfo').addEventListener('click', () => {
      showInfoModal();
    });

    // Toggle gráfico
    document.getElementById('toggleChart').addEventListener('click', () => {
      document.getElementById('chartModal').classList.toggle('open');
    });

    // Fechar gráfico
    document.getElementById('closeChart').addEventListener('click', () => {
      hideChartModal();
    });

    // Fechar gráfico de precipitação
    document.getElementById('closePrecipitationChart').addEventListener('click', () => {
      hidePrecipitationModal();
    });

    // Gráfico de precipitação
    document.getElementById('generatePrecipitationChart').addEventListener('click', async () => {
      await generatePrecipitationChart();
    });

    // Malha amostral
    const generateSampleGridBtn = document.getElementById('generateSampleGrid');
    if (generateSampleGridBtn) {
      generateSampleGridBtn.addEventListener('click', generateSampleGrid);
      console.log('Event listener adicionado para generateSampleGrid');
    } else {
      console.error('Botão generateSampleGrid não encontrado');
    }
    
    document.getElementById('extractPointStats').addEventListener('click', extractPointStats);
    document.getElementById('viewPointData').addEventListener('click', () => {
      console.log('Botão Visualizar Dados clicado');
      showPointDataModal();
    });
    document.getElementById('clearSampleGrid').addEventListener('click', clearSampleGrid);
    
    // Slider de espaçamento
    document.getElementById('gridSpacing').addEventListener('input', updateSpacingInfo);
    
    // Modal de dados dos pontos
    document.getElementById('exportPointDataCSV').addEventListener('click', exportPointDataCSV);

    // Exportação CSV (apenas nos modais dos gráficos)
    document.getElementById('exportTimeSeriesCSV').addEventListener('click', () => {
      exportTimeSeriesData();
    });

    document.getElementById('exportPrecipitationCSV').addEventListener('click', () => {
      exportPrecipitationData();
    });

    // Limpar ROI
    document.getElementById('clearROI').addEventListener('click', () => {
      if (drawnItems) {
        drawnItems.clearLayers();
      }
      currentGeometry = null;
      selectedROI = null;
      currentImages = [];
      timeSeriesData = [];
      precipitationData = [];
      selectedImage = null;
      
      if (window.currentLayer) {
        map.removeLayer(window.currentLayer);
      }
      
      if (timeSeriesChart) {
        timeSeriesChart.destroy();
        timeSeriesChart = null;
      }
      
      if (precipitationChart) {
        precipitationChart.destroy();
        precipitationChart = null;
      }
      
      document.getElementById('imagesCard').style.display = 'none';
      document.getElementById('visualizationCard').style.display = 'none';
      document.getElementById('statsCard').style.display = 'none';
      document.getElementById('imageList').innerHTML = '';
      hideChartModal();
      hidePrecipitationModal();
      updateROIStatus();
    });
  }

  // ──────────────── 13. Inicialização ──────────────────
  function initializeApp() {
    initializeMap();
    initializeDrawing();
    initializeUpload();
    initializeImageLoading();
    initializeVisualizations();
    initializeSidebarControls();
    
    // Carregar ROIs salvas
    loadROIsFromStorage();
    
    // Inicializar slider de espaçamento
    updateSpacingInfo();
    
    // Atualizar botões de mapa base
    updateBaseMapButtons();
    
    // Verificar status do disclaimer
    checkDisclaimerStatus();
  }

  // Funções globais para event listeners
  window.selectROI = selectROI;
  window.removeROI = removeROI;
  window.showAddROIModal = showAddROIModal;
  window.hideAddROIModal = hideAddROIModal;
  window.saveCurrentROI = saveCurrentROI;
  window.exportTimeSeriesData = exportTimeSeriesData;
  window.exportPrecipitationData = exportPrecipitationData;
  window.exportAllData = exportAllData;
  window.showInfoModal = showInfoModal;
  window.hideInfoModal = hideInfoModal;
  window.acceptDisclaimer = acceptDisclaimer;
  window.showFullInfo = showFullInfo;
  window.resetDisclaimer = resetDisclaimer;
  window.changeBaseMap = changeBaseMap;

  // Inicializar aplicação (só executa se Chart.js estiver disponível)
  initializeApp();
});


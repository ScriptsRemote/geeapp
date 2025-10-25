const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateEE, ee } = require('./gee.js');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('frontend'));

// Configuração do multer para upload de arquivos
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Inicializar Google Earth Engine
authenticateEE();

// Função auxiliar para construir URL de tiles
function buildTileUrl(mapId) {
    const idPath = mapId.mapid.startsWith('projects/')
        ? mapId.mapid
        : `maps/${mapId.mapid}`;
    const base = `https://earthengine.googleapis.com/v1alpha/${idPath}/tiles/{z}/{x}/{y}`;
    return mapId.token ? `${base}?token=${mapId.token}` : base;
}

// Máscara de Nuvem Sentinel 2 - Versão Completa
function maskCloudAndShadowsSR(image) {
    try {
        // Máscara completa de nuvens e sombras
        const cloudProb = image.select('MSK_CLDPRB');
        const snowProb = image.select('MSK_SNWPRB');
        const cloud = cloudProb.lt(5); // Probabilidade de nuvem < 5%
        const snow = snowProb.lt(5); // Probabilidade de neve < 5%
        const scl = image.select('SCL'); 
        const shadow = scl.eq(3); // 3 = cloud shadow
        const cirrus = scl.eq(10); // 10 = cirrus
        
        // Máscara combinada: remove nuvens, neve, sombras e cirrus
        const mask = (cloud.and(snow)).and(cirrus.neq(1)).and(shadow.neq(1));
        
        return image.updateMask(mask)
                    .select('B.*')
                    .multiply(0.0001) // Fator de escala DN para reflectância
                    .copyProperties(image, image.propertyNames())
                    .set('date', image.date().format('YYYY-MM-dd'));
                    
    } catch (error) {
        console.log('Erro na máscara de nuvens:', error);
        // Fallback: sem máscara mas com fator de escala
        return image.select('B.*')
                    .multiply(0.0001) // Fator de escala DN para reflectância
                    .copyProperties(image, image.propertyNames())
                    .set('date', image.date().format('YYYY-MM-dd'));
    }
}

// Função para calcular índices de vegetação - Versão Simplificada
function calculateIndices(image, roi) {
    try {
        // Índices de vegetação básicos
        const ndvi = image.normalizedDifference(['B8','B4']).rename('ndvi');
        const evi = image.expression('2.5 * ((N - R) / (N + (6 * R) - (7.5 * B) + 1))', {
            'N': image.select('B8'), 
            'R': image.select('B4'), 
            'B': image.select('B2')
        }).rename('evi');
        
        return image.addBands([ndvi, evi])
                    .copyProperties(image, image.propertyNames());
    } catch (error) {
        console.error('Erro ao calcular índices:', error);
        // Retornar imagem sem índices em caso de erro
        return image.copyProperties(image, image.propertyNames());
    }
}

// Função para reduzir estatísticas por região
function reduceStatistics(image, roi) {
    const serieReduce = image.reduceRegions({
        collection: roi,
        reducer: ee.Reducer.mean().combine({
            reducer2: ee.Reducer.stdDev(),
            sharedInputs: true
        }).combine({
            reducer2: ee.Reducer.max(),
            sharedInputs: true
        }),
        scale: 20
    });

    return serieReduce.map(function(f) { 
        return f.set({date: image.get('date')}); 
    }).copyProperties(image);
}

app.post('/api/load-images', async (req, res) => {
    try {
        const { geometry, startDate, endDate } = req.body;
        
        if (!geometry || !startDate || !endDate) {
            return res.status(400).json({ error: 'Geometria e datas são obrigatórias' });
        }

        const roi = ee.FeatureCollection([ee.Feature(geometry)]);
        
        // Seleção da coleção Sentinel-2
        const s2 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterBounds(roi)
            .filterDate(startDate, endDate)
            .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 50))
            .map(maskCloudAndShadowsSR)
            .map(image => calculateIndices(image, roi));

        // Obter informações das imagens
        const imageList = await new Promise((resolve, reject) => {
            s2.getInfo((info, error) => {
                if (error) reject(error);
                else resolve(info.features.map(img => ({
                    id: img.id,
                    date: img.properties.date,
                    cloudPercentage: img.properties.CLOUDY_PIXEL_PERCENTAGE,
                    systemIndex: img.properties['system:index']
                })));
            });
        });

        // Calcular estatísticas temporais
        const stats = s2.select(['ndvi', 'evi']).map(image => reduceStatistics(image, roi)).flatten();
        
        const timeSeriesData = await new Promise((resolve, reject) => {
            stats.getInfo((info, error) => {
                if (error) reject(error);
                else resolve(info.features.map(f => ({
                    date: f.properties.date,
                    ndvi_mean: f.properties.ndvi_mean,
                    evi_mean: f.properties.evi_mean
                })));
            });
        });

        res.json({
            images: imageList,
            timeSeries: timeSeriesData
        });

    } catch (error) {
        console.error('Erro ao carregar imagens:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.post('/api/visualize-ndvi', async (req, res) => {
    try {
        const { geometry, imageId, startDate, endDate, imageDate } = req.body;
        const roi = ee.FeatureCollection([ee.Feature(geometry)]);
        
        let image;
        if (imageId) {
            const s2 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
                .filterBounds(roi)
                .filterDate(startDate, endDate)
                .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 50))
                .map(maskCloudAndShadowsSR)
                .map(img => calculateIndices(img, roi))
                .filter(ee.Filter.eq('date', imageDate));
            
            image = s2.select('ndvi').first().clip(roi);
        } else {
            const s2 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
                .filterBounds(roi)
                .filterDate(startDate, endDate)
                .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 50))
                .map(maskCloudAndShadowsSR)
                .map(img => calculateIndices(img, roi));
            
            image = s2.select('ndvi').median().clip(roi);
        }

        const ndviParams = {
            min: 0,
            max: 1,
            palette: ['red', 'yellow', 'green']
        };

        const mapId = await new Promise((resolve, reject) => {
            image.getMapId(ndviParams, (mapId, error) => {
                if (error) reject(error);
                else resolve(mapId);
            });
        });

        res.json({
            tileUrl: buildTileUrl(mapId),
            mapId: mapId
        });

    } catch (error) {
        console.error('Erro NDVI:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.post('/api/visualize-rgb', async (req, res) => {
    try {
        const { geometry, imageId, startDate, endDate, imageDate } = req.body;
        
        const roi = ee.FeatureCollection([ee.Feature(geometry)]);
        
        let image;
        if (imageId) {
            const s2 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
                .filterBounds(roi)
                .filterDate(startDate, endDate)
                .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 50))
                .map(maskCloudAndShadowsSR)
                .filter(ee.Filter.eq('date', imageDate));
            
            image = s2.select(['B4', 'B3', 'B2']).first().clip(roi);
        } else {
            const s2 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
                .filterBounds(roi)
                .filterDate(startDate, endDate)
                .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 50))
                .map(maskCloudAndShadowsSR);
            
            image = s2.select(['B4', 'B3', 'B2']).median().clip(roi);
        }

        const rgbParams = {
            bands: ['B4', 'B3', 'B2'],
            min: 0.015,
            max: 0.20
        };

        const mapId = await new Promise((resolve, reject) => {
            image.getMapId(rgbParams, (mapId, error) => {
                if (error) reject(error);
                else resolve(mapId);
            });
        });

        res.json({
            tileUrl: buildTileUrl(mapId),
            mapId: mapId
        });

    } catch (error) {
        console.error('Erro RGB:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.post('/api/visualize-evi', async (req, res) => {
    try {
        const { geometry, imageId, startDate, endDate, imageDate } = req.body;
        
        const roi = ee.FeatureCollection([ee.Feature(geometry)]);
        
        let image;
        if (imageId) {
            const s2 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
                .filterBounds(roi)
                .filterDate(startDate, endDate)
                .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 50))
                .map(maskCloudAndShadowsSR)
                .map(img => calculateIndices(img, roi))
                .filter(ee.Filter.eq('date', imageDate));
            
            image = s2.select('evi').first().clip(roi);
        } else {
            const s2 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
                .filterBounds(roi)
                .filterDate(startDate, endDate)
                .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 50))
                .map(maskCloudAndShadowsSR)
                .map(img => calculateIndices(img, roi));
            
            image = s2.select('evi').median().clip(roi);
        }

        const eviParams = {
            min: 0,
            max: 1,
            palette: ['brown', 'yellow', 'green']
        };

        const mapId = await new Promise((resolve, reject) => {
            image.getMapId(eviParams, (mapId, error) => {
                if (error) reject(error);
                else resolve(mapId);
            });
        });

        res.json({
            tileUrl: buildTileUrl(mapId),
            mapId: mapId
        });

    } catch (error) {
        console.error('Erro EVI:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.post('/upload-geometry', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }

        const filePath = req.file.path;
        const fileExtension = path.extname(req.file.originalname).toLowerCase();
        let geometry;
        
        if (fileExtension === '.geojson' || fileExtension === '.json') {
            geometry = await processGeoJSON(filePath);
        } else {
            return res.status(400).json({ error: 'Apenas arquivos GeoJSON e JSON são suportados.' });
        }

        if (!geometry || !geometry.type || !geometry.coordinates) {
            throw new Error('Geometria inválida no arquivo');
        }

        const validGeometry = {
            type: geometry.type,
            coordinates: geometry.coordinates
        };

        fs.unlinkSync(filePath);
        res.json({ geometry: validGeometry });

    } catch (error) {
        console.error('Erro ao processar arquivo:', error);
        res.status(500).json({ error: 'Erro ao processar arquivo: ' + error.message });
    }
});

// Funções de processamento de arquivos

async function processGeoJSON(filePath) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    if (data.type === 'FeatureCollection') {
        if (data.features && data.features.length > 0) {
            return data.features[0].geometry;
        } else {
            throw new Error('FeatureCollection vazia');
        }
    } else if (data.type === 'Feature') {
        return data.geometry;
    } else if (data.type && ['Polygon', 'MultiPolygon', 'Point', 'LineString'].includes(data.type)) {
        return data;
    } else {
        return data.geometry || data;
    }
}


// API para dados de precipitação CHIRPS
app.post('/api/precipitation-data', async (req, res) => {
    try {
        const { geometry, startDate, endDate } = req.body;
        
        if (!geometry || !startDate || !endDate) {
            return res.status(400).json({ error: 'Geometria e datas são obrigatórias' });
        }

        const roi = ee.FeatureCollection([ee.Feature(geometry)]);
        
        // Coleção CHIRPS Daily
        const chirps = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY")
            .filterBounds(roi)
            .filterDate(startDate, endDate)
            .select('precipitation');

        // Calcular estatísticas de precipitação por dia
        const precipitationStats = chirps.map(function(image) {
            const stats = image.reduceRegion({
                reducer: ee.Reducer.mean().combine({
                    reducer2: ee.Reducer.max(),
                    sharedInputs: true
                }).combine({
                    reducer2: ee.Reducer.min(),
                    sharedInputs: true
                }),
                geometry: roi,
                scale: 5500, // Resolução do CHIRPS
                maxPixels: 1e9
            });

            return ee.Feature(null, {
                date: image.date().format('YYYY-MM-dd'),
                precipitation_mean: stats.get('precipitation_mean'),
                precipitation_max: stats.get('precipitation_max'),
                precipitation_min: stats.get('precipitation_min')
            });
        });

        const precipitationData = await new Promise((resolve, reject) => {
            precipitationStats.getInfo((info, error) => {
                if (error) reject(error);
                else resolve(info.features.map(f => ({
                    date: f.properties.date,
                    precipitation_mean: f.properties.precipitation_mean,
                    precipitation_max: f.properties.precipitation_max,
                    precipitation_min: f.properties.precipitation_min
                })));
            });
        });

        res.json({
            precipitationData: precipitationData
        });

    } catch (error) {
        console.error('Erro ao carregar dados de precipitação:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// API para extrair estatísticas por pontos
app.post('/api/extract-point-stats', async (req, res) => {
    try {
        const { points, geometry } = req.body;
        
        if (!points || !geometry) {
            return res.status(400).json({ error: 'Pontos e geometria são obrigatórios' });
        }

        // Converter geometria para EE
        const roi = ee.Geometry(geometry);
        
        // Carregar imagem Sentinel-2 mais recente
        const sentinel2 = ee.ImageCollection('COPERNICUS/S2_SR')
            .filterBounds(roi)
            .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
            .sort('system:time_start', false)
            .first();
        
        if (!sentinel2) {
            return res.status(404).json({ error: 'Nenhuma imagem Sentinel-2 encontrada' });
        }

        // Calcular NDVI e EVI
        const ndvi = sentinel2.normalizedDifference(['B8', 'B4']).rename('NDVI');
        const evi = sentinel2.expression(
            '2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))',
            {
                'NIR': sentinel2.select('B8'),
                'RED': sentinel2.select('B4'),
                'BLUE': sentinel2.select('B2')
            }
        ).rename('EVI');

        // Combinar bandas
        const image = sentinel2.addBands(ndvi).addBands(evi);

        // Criar FeatureCollection com os pontos da malha
        const pointFeatures = points.map(point => 
            ee.Feature(ee.Geometry.Point([point.lng, point.lat]), {
                id: point.id,
                lat: point.lat,
                lng: point.lng
            })
        );
        
        const pointCollection = ee.FeatureCollection(pointFeatures);
        
        // Extrair valores diretamente nos pontos (apenas valor médio)
        const pointStats = image.select(['NDVI', 'EVI']).reduceRegions({
            collection: pointCollection,
            reducer: ee.Reducer.mean(), // Apenas valor médio
            scale: 10, // Resolução de 10m
            maxPixelsPerRegion: 1000 // Máximo de pixels por região
        });

        const statsData = await new Promise((resolve, reject) => {
            pointStats.getInfo((info, error) => {
                if (error) reject(error);
                else resolve(info.features);
            });
        });

        // Processar resultados (apenas valores médios)
        const stats = statsData.map(feature => {
            const properties = feature.properties;
            return {
                id: properties.id,
                lat: properties.lat,
                lng: properties.lng,
                ndvi_mean: properties.NDVI || 0,
                evi_mean: properties.EVI || 0
            };
        });

        res.json({ stats });
    } catch (error) {
        console.error('Erro ao extrair estatísticas por pontos:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.post('/api/download-tiff', async (req, res) => {
    try {
        const { geometry, imageId, startDate, endDate, imageDate, type } = req.body;
        const roi = ee.FeatureCollection([ee.Feature(geometry)]);
        
        let image;
        if (imageId) {
            const s2 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
                .filterBounds(roi)
                .filterDate(startDate, endDate)
                .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 50))
                .map(maskCloudAndShadowsSR)
                .map(img => calculateIndices(img, roi))
                .filter(ee.Filter.eq('date', imageDate));
            
            if (type === 'rgb') {
                image = s2.select(['B4', 'B3', 'B2']).first();
            } else {
                image = s2.select(type).first();
            }
        } else {
            const s2 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
                .filterBounds(roi)
                .filterDate(startDate, endDate)
                .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 50))
                .map(maskCloudAndShadowsSR)
                .map(img => calculateIndices(img, roi));
            
            if (type === 'rgb') {
                image = s2.select(['B4', 'B3', 'B2']).median();
            } else {
                image = s2.select(type).median();
            }
        }

        // Obter geometria da ROI
        const roiGeometry = await new Promise((resolve, reject) => {
            roi.geometry().evaluate((geometry, error) => {
                if (error) reject(error);
                else resolve(geometry);
            });
        });

        // Configurar parâmetros para download direto
        const downloadParams = {
            name: `${type.toUpperCase()}_${imageDate || 'composite'}`,
            crs: 'EPSG:4326',
            scale: 20,
            region: roiGeometry,
            format: 'GEO_TIFF'
        };

        // Gerar URL de download direto
        const downloadUrl = await new Promise((resolve, reject) => {
            image.getDownloadURL(downloadParams, (url, error) => {
                if (error) reject(error);
                else resolve(url);
            });
        });

        res.json({
            downloadUrl: downloadUrl,
            message: `Download ${type.toUpperCase()} pronto! Clique para baixar.`
        });

    } catch (error) {
        console.error('Erro no download TIFF:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/index.html'));
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Acesse: http://localhost:${PORT}`);
});

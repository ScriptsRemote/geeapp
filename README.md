# 🌍 Sentinel-2 GEE Application

Aplicação web para análise de imagens Sentinel-2 com Google Earth Engine. Permite visualizar índices de vegetação (NDVI, EVI), gerar séries temporais e fazer download de arquivos TIFF.

## 🎯 O que o projeto faz

- **Mapa interativo** com Leaflet para visualização
- **ROI (Região de Interesse)** por desenho ou upload de GeoJSON
- **Visualizações**: NDVI, RGB colorido, EVI
- **Máscara de nuvens** automática do Sentinel-2
- **Séries temporais** com gráficos interativos
- **Download TIFF** direto para o computador
- **Estatísticas** da região analisada

## 🛠️ Instalação

### 1. Inicializar projeto
```bash
npm init -y
```

### 2. Instalar dependências
```bash
npm install express multer @google/earthengine google-auth-library
```

### 3. Configurar Google Earth Engine
- Coloque seu arquivo `private-key.json` na pasta raiz
- O arquivo deve conter as credenciais do Google Earth Engine

### 4. Executar aplicação
```bash
node server.js
```

### 5. Acessar
```
http://localhost:3000
```

## 🛣️ Rotas da API

### **POST** `/api/load-images`
Carrega lista de imagens Sentinel-2 disponíveis
- **Body**: `{ geometry, startDate, endDate }`
- **Retorna**: Lista de imagens e dados de séries temporais

### **POST** `/api/visualize-ndvi`
Gera visualização NDVI
- **Body**: `{ geometry, imageId, imageDate, startDate, endDate }`
- **Retorna**: URL de tiles para visualização

### **POST** `/api/visualize-rgb`
Gera visualização RGB colorida
- **Body**: `{ geometry, imageId, imageDate, startDate, endDate }`
- **Retorna**: URL de tiles para visualização

### **POST** `/api/visualize-evi`
Gera visualização EVI
- **Body**: `{ geometry, imageId, imageDate, startDate, endDate }`
- **Retorna**: URL de tiles para visualização

### **POST** `/api/download-tiff`
Gera download de arquivo TIFF
- **Body**: `{ geometry, imageId, imageDate, startDate, endDate, type }`
- **Retorna**: URL de download direto

### **POST** `/upload-geometry`
Upload de arquivo GeoJSON para ROI
- **Body**: FormData com arquivo
- **Retorna**: Geometria processada

## 📁 Estrutura do Projeto

```
gee/
├── server.js              # Servidor Node.js/Express
├── gee.js                 # Configuração Google Earth Engine
├── package.json           # Dependências do projeto
├── private-key.json       # Chave do GEE (não versionado)
├── frontend/              # Arquivos do frontend
│   ├── index.html         # Interface principal
│   ├── app.js            # Lógica do frontend
│   └── exemplo_roi.geojson # Exemplo de ROI
├── uploads/               # Arquivos temporários
└── .gitignore            # Arquivos ignorados pelo Git
```

## 🎯 Como Usar

1. **Desenhe uma ROI** no mapa ou faça upload de GeoJSON
2. **Selecione as datas** de análise
3. **Carregue as imagens** disponíveis
4. **Visualize** NDVI, RGB ou EVI
5. **Gere gráficos** de séries temporais
6. **Baixe arquivos TIFF** para análise offline

## 📊 Tipos de Download

- **RGB**: Composição colorida (B4, B3, B2)
- **NDVI**: Índice de vegetação normalizado
- **EVI**: Índice de vegetação aprimorado

## 🔒 Segurança

- ✅ Chaves privadas no `.gitignore`
- ✅ Uploads temporários limpos automaticamente
- ✅ Validação de arquivos de entrada
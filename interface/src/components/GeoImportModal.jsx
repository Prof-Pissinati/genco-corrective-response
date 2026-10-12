import React, { useState, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Importação no estilo moderno do React/Vite
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

// Corrige o ícone do Leaflet que costuma quebrar no React
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl,
    iconUrl,
    shadowUrl
});

function parseGeoFile(content, filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const result = {};

    if (ext === 'json') {
        try {
            const data = JSON.parse(content);
            if (Array.isArray(data)) {
                data.forEach(item => {
                    const id = item.id ?? item.nodeId ?? item.node;
                    const lat = item.lat ?? item.latitude;
                    const lng = item.lng ?? item.lon ?? item.longitude;
                    if (id != null && lat != null && lng != null)
                        result[String(id)] = { lat: Number(lat), lng: Number(lng) };
                });
            } else {
                Object.entries(data).forEach(([k, v]) => {
                    if (v.lat != null && (v.lng ?? v.lon) != null)
                        result[k] = { lat: Number(v.lat), lng: Number(v.lng ?? v.lon) };
                });
            }
        } catch (e) {
            console.error("Erro no parse do JSON", e);
        }
    } else {
        const lines = content.split(/\r?\n/).filter(l => l.trim());
        let startLine = 0;
        if (/[a-zA-Z]/.test(lines[0])) startLine = 1;
        const sep = lines[startLine]?.includes(',') ? ',' : /\s+/;

        for (let i = startLine; i < lines.length; i++) {
            const parts = lines[i].trim().split(sep).map(p => p.trim()).filter(Boolean);
            if (parts.length >= 3) {
                const [id, lat, lng] = parts;
                if (!isNaN(Number(id)) && !isNaN(Number(lat)) && !isNaN(Number(lng)))
                    result[id] = { lat: Number(lat), lng: Number(lng) };
            }
        }
    }
    return result;
}

function generateFictiveGeo(svgPositions, centerLat, centerLng) {
    const nodeIds = Object.keys(svgPositions);
    if (!nodeIds.length) return {};

    const xs = nodeIds.map(id => svgPositions[id]?.x).filter(v => v != null);
    const ys = nodeIds.map(id => svgPositions[id]?.y).filter(v => v != null);
    if (!xs.length || !ys.length) return {};

    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const svgW = maxX - minX || 1;
    const svgH = maxY - minY || 1;

    const spanLat = 0.05;
    const spanLng = 0.05;

    const result = {};
    nodeIds.forEach(id => {
        const p = svgPositions[id];
        if (!p) return;
        result[id] = {
            lat: centerLat + ((1 - (p.y - minY) / svgH) - 0.5) * spanLat,
            lng: centerLng + (((p.x - minX) / svgW) - 0.5) * spanLng,
        };
    });
    return result;
}

function LocationPicker({ position, setPosition }) {
    useMapEvents({
        click(e) { setPosition(e.latlng); }
    });
    return position ? <Marker position={position} /> : null;
}

export default function GeoImportModal({ isOpen, onConfirm, onCancel, allNodes, svgPositions, darkMode }) {
    const [activeTab, setActiveTab] = useState('import');
    const [fileResult, setFileResult] = useState(null);
    const [centerPos, setCenterPos] = useState({ lat: -20.428, lng: -51.343 }); // Ilha Solteira default

    if (!isOpen) return null;

    const bg = darkMode ? '#222' : '#fff';
    const fg = darkMode ? '#fff' : '#333';
    const border = darkMode ? '#444' : '#ccc';

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            const parsed = parseGeoFile(evt.target.result, file.name);
            setFileResult(parsed);
        };
        reader.readAsText(file);
    };

    const handleConfirm = () => {
        if (activeTab === 'import') {
            if (fileResult) onConfirm(fileResult);
        } else {
            const fictive = generateFictiveGeo(svgPositions, centerPos.lat, centerPos.lng);
            onConfirm(fictive);
        }
    };

    const coverage = fileResult ? Object.keys(fileResult).filter(id => allNodes.includes(Number(id) || id)).length : 0;

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 10000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <div style={{ background: bg, color: fg, padding: '20px', borderRadius: '12px', width: '600px', maxWidth: '90%', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
                <h3 style={{ margin: '0 0 15px 0', borderBottom: `1px solid ${border}`, paddingBottom: '10px' }}>🌍 Coordenadas Geográficas Ausentes</h3>
                <p style={{ fontSize: '13px', opacity: 0.8, marginBottom: '20px' }}>O sistema atual não possui coordenadas geográficas suficientes para renderizar o mapa. Escolha uma opção:</p>

                <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                    <button onClick={() => setActiveTab('import')} style={{ flex: 1, padding: '8px', background: activeTab === 'import' ? '#00bcd4' : 'transparent', color: activeTab === 'import' ? '#000' : fg, border: `1px solid ${border}`, borderRadius: '6px', cursor: 'pointer' }}>Importar Arquivo</button>
                    <button onClick={() => setActiveTab('generate')} style={{ flex: 1, padding: '8px', background: activeTab === 'generate' ? '#00bcd4' : 'transparent', color: activeTab === 'generate' ? '#000' : fg, border: `1px solid ${border}`, borderRadius: '6px', cursor: 'pointer' }}>Gerar Posições Fictícias</button>
                </div>

                {activeTab === 'import' && (
                    <div style={{ minHeight: '200px' }}>
                        <div style={{ border: `2px dashed ${border}`, padding: '20px', textAlign: 'center', borderRadius: '8px', marginBottom: '15px' }}>
                            <input type="file" accept=".json,.csv,.txt" onChange={handleFileUpload} style={{ color: fg }} />
                            <p style={{ fontSize: '12px', opacity: 0.6, marginTop: '10px' }}>Formatos aceitos: JSON, CSV ou TXT (node, lat, lng)</p>
                        </div>
                        {fileResult && (
                            <div style={{ fontSize: '13px', background: darkMode ? '#333' : '#f5f5f5', padding: '10px', borderRadius: '6px' }}>
                                <p style={{ margin: '0 0 5px 0', color: coverage >= allNodes.length * 0.5 ? '#4caf50' : '#ff9800' }}>
                                    <strong>{coverage}</strong> barras compatíveis encontradas (de {allNodes.length} totais).
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'generate' && (
                    <div style={{ minHeight: '200px' }}>
                        <p style={{ fontSize: '12px', marginBottom: '10px' }}>Clique no mapa para definir o ponto central da rede:</p>
                        <div style={{ height: '200px', width: '100%', borderRadius: '8px', overflow: 'hidden', marginBottom: '10px', border: `1px solid ${border}` }}>
                            <MapContainer center={[centerPos.lat, centerPos.lng]} zoom={12} style={{ height: '100%', width: '100%' }}>
                                <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                                <LocationPicker position={centerPos} setPosition={setCenterPos} />
                            </MapContainer>
                        </div>
                        <div style={{ display: 'flex', gap: '10px', fontSize: '12px' }}>
                            <label>Lat: <input type="number" step="0.0001" value={centerPos.lat} onChange={e => setCenterPos({ ...centerPos, lat: Number(e.target.value) })} style={{ width: '100px', background: darkMode ? '#111' : '#fff', color: fg, border: `1px solid ${border}`, padding: '4px', borderRadius: '4px' }} /></label>
                            <label>Lng: <input type="number" step="0.0001" value={centerPos.lng} onChange={e => setCenterPos({ ...centerPos, lng: Number(e.target.value) })} style={{ width: '100px', background: darkMode ? '#111' : '#fff', color: fg, border: `1px solid ${border}`, padding: '4px', borderRadius: '4px' }} /></label>
                        </div>
                    </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                    <button onClick={onCancel} style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${border}`, color: fg, borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
                    <button onClick={handleConfirm} disabled={activeTab === 'import' && !fileResult} style={{ padding: '8px 16px', background: '#4caf50', border: 'none', color: '#fff', borderRadius: '6px', cursor: (activeTab === 'import' && !fileResult) ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: (activeTab === 'import' && !fileResult) ? 0.5 : 1 }}>
                        Aplicar Coordenadas
                    </button>
                </div>
            </div>
        </div>
    );
}
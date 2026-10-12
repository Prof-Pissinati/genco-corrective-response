// src/utils/geoRouting.js

export async function fetchStreetRoute(points) {
    if (!points || points.length < 2) return null;

    const coordsString = points.map(p => `${p.lng},${p.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordsString}?geometries=geojson&overview=full`;

    try {
        // Removido o AbortController. Agora o sistema espera a API responder o tempo que for necessário.
        const response = await fetch(url);
        
        if (!response.ok) throw new Error("Falha na API OSRM");
        const data = await response.json();
        
        if (data.routes && data.routes.length > 0) {
            return data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]); 
        }
        return null;
    } catch (error) {
        console.warn(`Erro no roteamento OSRM.`, error);
        return null;
    }
}
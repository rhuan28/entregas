// services/routeOptimization.js - Versão corrigida
const axios = require('axios');
require('dotenv').config();

class RouteOptimizationService {
    constructor() {
        this.apiKey = process.env.GOOGLE_MAPS_API_KEY;
        this.directionsURL = 'https://maps.googleapis.com/maps/api/directions/json';
    }

    // Otimiza rota com suporte para ordem manual e prioridade
    async optimizeRoute(deliveries, depot, circularRoute = true, manualOrder = {}) {
        try {
            if (deliveries.length === 0) {
                throw new Error('Nenhuma entrega para otimizar');
            }

            console.log(`Otimizando rota para ${deliveries.length} paradas...`);
            console.log(`Rota circular: ${circularRoute}`);
            console.log(`Ordem manual:`, manualOrder);

            // Verifica se há uma ordem manual completa (todas as entregas com posição)
            const hasCompleteManualOrder = this.hasCompleteManualOrder(deliveries, manualOrder);
            
            // Se tem ordem manual completa, mantém essa ordem
            if (hasCompleteManualOrder) {
                console.log('Usando ordem manual completa fornecida');
                deliveries.sort((a, b) => {
                    const orderA = manualOrder[a.id] || 999;
                    const orderB = manualOrder[b.id] || 999;
                    return orderA - orderB;
                });
                
                return this.calculateRouteWithFixedOrder(deliveries, depot, circularRoute);
            }

            // Ordena por prioridade primeiro (2=Urgente, 1=Alta, 0=Normal)
            let sortedDeliveries = [...deliveries].sort((a, b) => {
                // Se tem ordem manual, usa ela primeiro
                if (manualOrder[a.id] && manualOrder[b.id]) {
                    return manualOrder[a.id] - manualOrder[b.id];
                }
                // Senão, ordena por prioridade (maior prioridade primeiro)
                return (b.priority || 0) - (a.priority || 0);
            });

            // Se há apenas uma entrega
            if (sortedDeliveries.length === 1) {
                return {
                    optimizedOrder: [{
                        shipmentId: `entrega_${sortedDeliveries[0].id}`,
                        deliveryId: sortedDeliveries[0].id,
                        lat: sortedDeliveries[0].lat,
                        lng: sortedDeliveries[0].lng,
                        address: sortedDeliveries[0].address,
                        order: 0,
                        type: sortedDeliveries[0].type || 'delivery'
                    }],
                    totalDistance: 0,
                    totalDuration: 0,
                    polyline: null
                };
            }

            // Usa endereço como string para a API, não coordenadas
            const origin = depot.address || `${depot.lat},${depot.lng}`;
            const destination = circularRoute 
                ? origin 
                : sortedDeliveries[sortedDeliveries.length - 1].address;

            // Separa as paradas na confeitaria e as entregas normais
            const pickupStops = sortedDeliveries.filter(d => d.type === 'pickup');
            const normalDeliveries = sortedDeliveries.filter(d => d.type !== 'pickup');
            
            console.log(`Separando ${pickupStops.length} paradas na confeitaria e ${normalDeliveries.length} entregas normais`);

            // Prepara waypoints usando endereços, mantendo as paradas na confeitaria na posição correta
            let orderedStops = [];
            
            if (Object.keys(manualOrder).length > 0) {
                // Se tem ordem manual parcial, aplica ela
                orderedStops = [...sortedDeliveries].sort((a, b) => {
                    const orderA = manualOrder[a.id] || 999;
                    const orderB = manualOrder[b.id] || 999;
                    return orderA - orderB;
                });
            } else {
                // Se não tem ordem manual, faz a otimização automática
                try {
                    console.log('Otimizando automaticamente com Google Directions API');
                    
                    // Preparação dos waypoints para a API
                    const waypoints = normalDeliveries.map(d => ({
                        location: d.address,
                        stopover: true
                    }));
                    
                    // Chamada à API do Google para otimizar a rota de entregas normais
                    const response = await axios.get(this.directionsURL, {
                        params: {
                            origin: origin,
                            destination: circularRoute ? origin : normalDeliveries[normalDeliveries.length - 1].address,
                            waypoints: `optimize:true|${waypoints.map(w => w.location).join('|')}`,
                            key: this.apiKey,
                            mode: 'driving'
                        }
                    });
                    
                    if (response.data.status === 'OK') {
                        // Ordenar as entregas normais conforme a otimização do Google
                        const waypointOrder = response.data.routes[0].waypoint_order;
                        const optimizedNormalDeliveries = waypointOrder.map(index => normalDeliveries[index]);
                        
                        // Agora precisa intercalar as paradas na confeitaria na ordem correta
                        if (pickupStops.length > 0) {
                            orderedStops = this.integratePickupStops(optimizedNormalDeliveries, pickupStops, manualOrder);
                        } else {
                            orderedStops = optimizedNormalDeliveries;
                        }
                    } else {
                        throw new Error(`Erro na API: ${response.data.status}`);
                    }
                } catch (error) {
                    console.error('Erro na otimização automática:', error.message);
                    // Fallback: usa a ordem original
                    orderedStops = sortedDeliveries;
                }
            }

            // Calcula a rota completa com todas as paradas (incluindo as da confeitaria)
            return this.calculateRouteWithOrderedStops(orderedStops, depot, circularRoute);

        } catch (error) {
            console.error('Erro na otimização:', error.message);
            
            // Fallback: retorna ordem por prioridade
            const fallbackOrder = deliveries
                .sort((a, b) => (b.priority || 0) - (a.priority || 0))
                .map((delivery, index) => ({
                    shipmentId: delivery.type === 'pickup' ? delivery.id : `entrega_${delivery.id}`,
                    deliveryId: delivery.id,
                    lat: delivery.lat,
                    lng: delivery.lng,
                    address: delivery.address,
                    order: index,
                    type: delivery.type || 'delivery',
                    priority: delivery.priority
                }));

            return {
                optimizedOrder: fallbackOrder,
                totalDistance: 0,
                totalDuration: 0,
                polyline: null
            };
        }
    }

    // Intercala as paradas da confeitaria com base em sua ordem manual, se houver
    integratePickupStops(deliveries, pickupStops, manualOrder) {
        const allStops = [...deliveries];
        
        // Adiciona as paradas da confeitaria em ordem
        pickupStops.forEach(stop => {
            const stopOrder = manualOrder[stop.id] || stop.order || 999;
            
            // Encontra a posição correta para inserir
            if (stopOrder < 999) {
                let inserted = false;
                for (let i = 0; i < allStops.length; i++) {
                    const currentOrder = manualOrder[allStops[i].id] || 999;
                    if (stopOrder < currentOrder) {
                        allStops.splice(i, 0, stop);
                        inserted = true;
                        break;
                    }
                }
                if (!inserted) {
                    allStops.push(stop);
                }
            } else {
                // Se não tem ordem específica, coloca no final
                allStops.push(stop);
            }
        });
        
        return allStops;
    }

    // Calcula rota com paradas já ordenadas
    async calculateRouteWithOrderedStops(stops, depot, circularRoute) {
        try {
            // Mapeia cada parada para o formato da API
            const waypoints = stops.map(stop => ({
                location: stop.address,
                stopover: true
            }));
            
            const origin = depot.address;
            const destination = circularRoute ? origin : stops[stops.length - 1].address;
            
            // Chama a API do Google para calcular a rota com a ordem fixa
            const response = await axios.get(this.directionsURL, {
                params: {
                    origin: origin,
                    destination: destination,
                    waypoints: waypoints.map(w => w.location).join('|'),
                    key: this.apiKey,
                    mode: 'driving'
                }
            });
            
            if (response.data.status !== 'OK') {
                throw new Error(`API Error: ${response.data.status}`);
            }
            
            const route = response.data.routes[0];
            
            // Cria a estrutura otimizada com todas as paradas na ordem correta
            const optimizedOrder = stops.map((stop, index) => ({
                shipmentId: stop.type === 'pickup' ? stop.id : `entrega_${stop.id}`,
                deliveryId: stop.id,
                lat: parseFloat(stop.lat),
                lng: parseFloat(stop.lng),
                address: stop.address,
                order: index,
                type: stop.type || 'delivery'
            }));
            
            // Calcula distância e tempo total
            let totalDistance = 0;
            let totalDuration = 0;
            
            route.legs.forEach(leg => {
                totalDistance += leg.distance.value;
                totalDuration += leg.duration.value;
            });
            
            return {
                optimizedOrder: optimizedOrder,
                totalDistance: totalDistance,
                totalDuration: totalDuration,
                polyline: route.overview_polyline.points
            };
        } catch (error) {
            console.error('Erro ao calcular rota com ordem fixa:', error);
            
            // Fallback: retorna a ordem sem calcular distância/tempo
            const optimizedOrder = stops.map((stop, index) => ({
                shipmentId: stop.type === 'pickup' ? stop.id : `entrega_${stop.id}`,
                deliveryId: stop.id,
                lat: parseFloat(stop.lat),
                lng: parseFloat(stop.lng),
                address: stop.address,
                order: index,
                type: stop.type || 'delivery'
            }));
            
            return {
                optimizedOrder: optimizedOrder,
                totalDistance: 0,
                totalDuration: 0,
                polyline: null
            };
        }
    }

    // Verifica se há ordem manual completa
    hasCompleteManualOrder(deliveries, manualOrder) {
        const deliveryCount = deliveries.length;
        const manualOrderCount = Object.keys(manualOrder).length;
        
        // Tem ordem manual completa se todas as entregas tiverem posição
        return manualOrderCount >= deliveryCount;
    }

    // Calcula rota com ordem fixa
    async calculateRouteWithFixedOrder(deliveries, depot, circularRoute) {
        try {
            const waypoints = deliveries.map(d => ({
                location: d.address,
                stopover: true
            }));

            const destination = circularRoute 
                ? depot.address
                : deliveries[deliveries.length - 1].address;

            const response = await axios.get(this.directionsURL, {
                params: {
                    origin: depot.address,
                    destination: destination,
                    waypoints: waypoints.map(w => w.location).join('|'),
                    key: this.apiKey,
                    mode: 'driving',
                    language: 'pt-BR'
                }
            });

            if (response.data.status !== 'OK') {
                throw new Error(`API Error: ${response.data.status}`);
            }

            const route = response.data.routes[0];
            
            // Mantém a ordem original
            const optimizedDeliveries = deliveries.map((delivery, index) => ({
                shipmentId: delivery.type === 'pickup' ? delivery.id : `entrega_${delivery.id}`,
                deliveryId: delivery.id,
                lat: parseFloat(delivery.lat),
                lng: parseFloat(delivery.lng),
                address: delivery.address,
                order: index,
                type: delivery.type || 'delivery'
            }));

            let totalDistance = 0;
            let totalDuration = 0;
            
            route.legs.forEach(leg => {
                totalDistance += leg.distance.value;
                totalDuration += leg.duration.value;
            });

            return {
                optimizedOrder: optimizedDeliveries,
                totalDistance: totalDistance,
                totalDuration: totalDuration,
                polyline: route.overview_polyline.points
            };

        } catch (error) {
            throw error;
        }
    }
}

module.exports = new RouteOptimizationService();
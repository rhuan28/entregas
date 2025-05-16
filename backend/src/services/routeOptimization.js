// services/routeOptimization.js - Versão atualizada
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

            // Prepara waypoints usando endereços, com prioridade alta primeiro
            const waypoints = sortedDeliveries.map(d => ({
                location: d.address, // Usa endereço completo, não coordenadas
                stopover: true
            }));

            // Se há prioridades diferentes, otimiza separadamente
            const urgentDeliveries = sortedDeliveries.filter(d => d.priority === 2);
            const highPriorityDeliveries = sortedDeliveries.filter(d => d.priority === 1);
            const normalDeliveries = sortedDeliveries.filter(d => d.priority === 0 || !d.priority);

            let finalOrder = [];
            
            // Otimiza cada grupo separadamente
            if (urgentDeliveries.length > 0) {
                const urgentOptimized = await this.optimizeGroup(urgentDeliveries, origin, false);
                finalOrder = finalOrder.concat(urgentOptimized);
            }
            
            if (highPriorityDeliveries.length > 0) {
                const lastPoint = finalOrder.length > 0 ? finalOrder[finalOrder.length - 1].address : origin;
                const highOptimized = await this.optimizeGroup(highPriorityDeliveries, lastPoint, false);
                finalOrder = finalOrder.concat(highOptimized);
            }
            
            if (normalDeliveries.length > 0) {
                const lastPoint = finalOrder.length > 0 ? finalOrder[finalOrder.length - 1].address : origin;
                const normalOptimized = await this.optimizeGroup(normalDeliveries, lastPoint, circularRoute ? origin : false);
                finalOrder = finalOrder.concat(normalOptimized);
            }

            // Se não conseguiu otimizar por grupos, otimiza tudo junto
            if (finalOrder.length === 0) {
                const response = await axios.get(this.directionsURL, {
                    params: {
                        origin: origin,
                        destination: destination,
                        waypoints: `optimize:true|${waypoints.map(w => w.location).join('|')}`,
                        key: this.apiKey,
                        mode: 'driving',
                        language: 'pt-BR',
                        avoid: 'tolls'
                    }
                });

                if (response.data.status !== 'OK') {
                    throw new Error(`API Error: ${response.data.status}`);
                }

                const route = response.data.routes[0];
                const waypoint_order = route.waypoint_order;
                
                finalOrder = waypoint_order.map((originalIndex, newIndex) => ({
                    shipmentId: `entrega_${sortedDeliveries[originalIndex].id}`,
                    deliveryId: sortedDeliveries[originalIndex].id,
                    lat: parseFloat(sortedDeliveries[originalIndex].lat),
                    lng: parseFloat(sortedDeliveries[originalIndex].lng),
                    address: sortedDeliveries[originalIndex].address,
                    order: newIndex,
                    type: sortedDeliveries[originalIndex].type || 'delivery',
                    priority: sortedDeliveries[originalIndex].priority
                }));

                let totalDistance = 0;
                let totalDuration = 0;
                
                route.legs.forEach(leg => {
                    totalDistance += leg.distance.value;
                    totalDuration += leg.duration.value;
                });

                return {
                    optimizedOrder: finalOrder,
                    totalDistance: totalDistance,
                    totalDuration: totalDuration,
                    polyline: route.overview_polyline.points
                };
            }

            // Calcula distância e tempo total
            const totalRoute = await this.calculateTotalRoute(finalOrder, origin, circularRoute);
            
            return totalRoute;

        } catch (error) {
            console.error('Erro na otimização:', error.message);
            
            // Fallback: retorna ordem por prioridade
            const fallbackOrder = deliveries
                .sort((a, b) => (b.priority || 0) - (a.priority || 0))
                .map((delivery, index) => ({
                    shipmentId: `entrega_${delivery.id}`,
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

    // Otimiza um grupo de entregas
    async optimizeGroup(deliveries, startPoint, endPoint) {
        if (deliveries.length === 0) return [];
        
        if (deliveries.length === 1) {
            return [{
                shipmentId: `entrega_${deliveries[0].id}`,
                deliveryId: deliveries[0].id,
                lat: deliveries[0].lat,
                lng: deliveries[0].lng,
                address: deliveries[0].address,
                type: deliveries[0].type || 'delivery',
                priority: deliveries[0].priority
            }];
        }

        try {
            const waypoints = deliveries.map(d => ({
                location: d.address,
                stopover: true
            }));

            const params = {
                origin: startPoint,
                destination: endPoint || deliveries[deliveries.length - 1].address,
                waypoints: `optimize:true|${waypoints.map(w => w.location).join('|')}`,
                key: this.apiKey,
                mode: 'driving',
                language: 'pt-BR'
            };

            const response = await axios.get(this.directionsURL, { params });

            if (response.data.status === 'OK') {
                const route = response.data.routes[0];
                const waypoint_order = route.waypoint_order;
                
                return waypoint_order.map(originalIndex => ({
                    shipmentId: `entrega_${deliveries[originalIndex].id}`,
                    deliveryId: deliveries[originalIndex].id,
                    lat: deliveries[originalIndex].lat,
                    lng: deliveries[originalIndex].lng,
                    address: deliveries[originalIndex].address,
                    type: deliveries[originalIndex].type || 'delivery',
                    priority: deliveries[originalIndex].priority
                }));
            }
        } catch (error) {
            console.error('Erro ao otimizar grupo:', error);
        }

        return deliveries.map(d => ({
            shipmentId: `entrega_${d.id}`,
            deliveryId: d.id,
            lat: d.lat,
            lng: d.lng,
            address: d.address,
            type: d.type || 'delivery',
            priority: d.priority
        }));
    }

    // Calcula rota total com todos os pontos
    async calculateTotalRoute(orderedStops, origin, circularRoute) {
        try {
            const waypoints = orderedStops.map(stop => ({
                location: stop.address,
                stopover: true
            }));

            const destination = circularRoute ? origin : orderedStops[orderedStops.length - 1].address;

            const response = await axios.get(this.directionsURL, {
                params: {
                    origin: origin,
                    destination: destination,
                    waypoints: waypoints.map(w => w.location).join('|'),
                    key: this.apiKey,
                    mode: 'driving',
                    language: 'pt-BR'
                }
            });

            if (response.data.status === 'OK') {
                const route = response.data.routes[0];
                let totalDistance = 0;
                let totalDuration = 0;
                
                route.legs.forEach(leg => {
                    totalDistance += leg.distance.value;
                    totalDuration += leg.duration.value;
                });

                return {
                    optimizedOrder: orderedStops.map((stop, index) => ({ ...stop, order: index })),
                    totalDistance: totalDistance,
                    totalDuration: totalDuration,
                    polyline: route.overview_polyline.points
                };
            }
        } catch (error) {
            console.error('Erro ao calcular rota total:', error);
        }

        return {
            optimizedOrder: orderedStops.map((stop, index) => ({ ...stop, order: index })),
            totalDistance: 0,
            totalDuration: 0,
            polyline: null
        };
    }

    // Verifica se há ordem manual completa
    hasCompleteManualOrder(deliveries, manualOrder) {
        const regularDeliveries = deliveries.filter(d => !d.type || d.type !== 'pickup');
        const manualOrderCount = Object.keys(manualOrder).length;
        return manualOrderCount === regularDeliveries.length;
    }

    // Calcula rota com ordem fixa
    async calculateRouteWithFixedOrder(deliveries, depot, circularRoute) {
        try {
            const waypoints = deliveries.map(d => ({
                location: `${d.lat},${d.lng}`,
                stopover: true
            }));

            const destination = circularRoute 
                ? `${depot.lat},${depot.lng}` 
                : `${deliveries[deliveries.length - 1].lat},${deliveries[deliveries.length - 1].lng}`;

            const response = await axios.get(this.directionsURL, {
                params: {
                    origin: `${depot.lat},${depot.lng}`,
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
                shipmentId: delivery.id.toString().startsWith('pickup_') 
                    ? delivery.id 
                    : `entrega_${delivery.id}`,
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
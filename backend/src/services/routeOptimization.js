// services/routeOptimization.js - Versão com otimização inteligente por proximidade
const axios = require('axios');
require('dotenv').config();

class RouteOptimizationService {
    constructor() {
        this.apiKey = process.env.GOOGLE_MAPS_API_KEY;
        this.directionsURL = 'https://maps.googleapis.com/maps/api/directions/json';
        
        // Configurações de otimização inteligente
        this.config = {
            maxDetourRatio: 1.3,      // Máximo 30% de desvio
            maxDetourDistance: 2000,   // Máximo 2km de desvio
            priorityWeight: 0.7,       // Peso da prioridade vs distância
            maxDetoursPerPriority: 2   // Máximo 2 desvios por entrega prioritária
        };
    }

    // Otimiza rota com suporte para ordem manual, prioridade e desvio inteligente
    async optimizeRoute(deliveries, depot, circularRoute = true, manualOrder = {}) {
        try {
            if (deliveries.length === 0) {
                throw new Error('Nenhuma entrega para otimizar');
            }

            console.log(`🚚 Otimizando rota para ${deliveries.length} paradas...`);
            console.log(`🔄 Rota circular: ${circularRoute}`);
            console.log(`📋 Ordem manual:`, manualOrder);

            // Verifica se há uma ordem manual completa
            const hasCompleteManualOrder = this.hasCompleteManualOrder(deliveries, manualOrder);
            
            if (hasCompleteManualOrder) {
                console.log('📌 Usando ordem manual completa fornecida');
                deliveries.sort((a, b) => {
                    const orderA = manualOrder[a.id] || 999;
                    const orderB = manualOrder[b.id] || 999;
                    return orderA - orderB;
                });
                
                return this.calculateRouteWithFixedOrder(deliveries, depot, circularRoute);
            }

            // Separa entregas por tipo
            const pickupStops = deliveries.filter(d => d.type === 'pickup');
            const normalDeliveries = deliveries.filter(d => d.type !== 'pickup');
            
            console.log(`🏪 ${pickupStops.length} paradas na confeitaria, 📦 ${normalDeliveries.length} entregas`);

            if (normalDeliveries.length === 0) {
                return this.handlePickupOnlyRoute(pickupStops, depot, circularRoute, manualOrder);
            }

            if (normalDeliveries.length === 1) {
                return this.handleSingleDeliveryRoute(normalDeliveries, pickupStops, depot, circularRoute, manualOrder);
            }

            // Aplica otimização inteligente
            console.log('🧠 Aplicando otimização inteligente com análise de desvios...');
            const optimizedOrder = await this.intelligentOptimization(normalDeliveries, depot, manualOrder);
            
            // Integra paradas na confeitaria
            const finalOrder = this.integratePickupStops(optimizedOrder, pickupStops, manualOrder);
            
            return this.calculateRouteWithOrderedStops(finalOrder, depot, circularRoute);

        } catch (error) {
            console.error('❌ Erro na otimização:', error.message);
            
            // Fallback: ordem por prioridade
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

    // Nova função de otimização inteligente
    async intelligentOptimization(deliveries, depot, manualOrder) {
        console.log('🧠 Iniciando otimização inteligente...');
        
        // Separa entregas por prioridade
        const urgentDeliveries = deliveries.filter(d => (d.priority || 0) === 2);
        const highPriorityDeliveries = deliveries.filter(d => (d.priority || 0) === 1);
        const normalDeliveries = deliveries.filter(d => (d.priority || 0) === 0);
        
        console.log(`📊 Prioridades: ${urgentDeliveries.length} urgentes, ${highPriorityDeliveries.length} altas, ${normalDeliveries.length} normais`);
        
        let optimizedRoute = [];
        let remainingDeliveries = [...normalDeliveries];
        let currentPosition = depot;
        
        // Processa entregas urgentes primeiro
        for (const urgentDelivery of urgentDeliveries) {
            console.log(`🚨 Processando entrega urgente: ${urgentDelivery.customer_name || urgentDelivery.id}`);
            
            const result = await this.processDeliveryWithDetour(
                urgentDelivery, 
                remainingDeliveries, 
                currentPosition, 
                optimizedRoute.length
            );
            
            optimizedRoute.push(...result.route);
            remainingDeliveries = result.remaining;
            currentPosition = result.lastPosition;
        }
        
        // Processa entregas de alta prioridade
        for (const highPriorityDelivery of highPriorityDeliveries) {
            console.log(`⭐ Processando entrega de alta prioridade: ${highPriorityDelivery.customer_name || highPriorityDelivery.id}`);
            
            const result = await this.processDeliveryWithDetour(
                highPriorityDelivery, 
                remainingDeliveries, 
                currentPosition, 
                optimizedRoute.length
            );
            
            optimizedRoute.push(...result.route);
            remainingDeliveries = result.remaining;
            currentPosition = result.lastPosition;
        }
        
        // Adiciona entregas normais restantes otimizadas
        if (remainingDeliveries.length > 0) {
            console.log(`📦 Otimizando ${remainingDeliveries.length} entregas normais restantes...`);
            const remainingOptimized = await this.optimizeRemainingDeliveries(
                remainingDeliveries, 
                currentPosition, 
                optimizedRoute.length
            );
            optimizedRoute.push(...remainingOptimized);
        }
        
        console.log(`✅ Otimização concluída: ${optimizedRoute.length} paradas na rota final`);
        return optimizedRoute;
    }

    // Processa uma entrega prioritária verificando desvios inteligentes
    async processDeliveryWithDetour(priorityDelivery, normalDeliveries, currentPosition, orderOffset) {
        console.log(`🎯 Analisando rota para: ${priorityDelivery.customer_name || priorityDelivery.id}`);
        
        // Calcula distância direta até a entrega prioritária
        const directDistance = await this.calculateDistance(currentPosition, priorityDelivery);
        console.log(`📏 Distância direta: ${(directDistance/1000).toFixed(1)}km`);
        
        // Verifica se alguma entrega normal está "no caminho"
        const detoursAnalysis = await this.analyzeDetours(
            currentPosition, 
            priorityDelivery, 
            normalDeliveries, 
            directDistance
        );
        
        let routeSegment = [];
        let remaining = [...normalDeliveries];
        
        if (detoursAnalysis.worthwhileDetours.length > 0) {
            console.log(`📍 Encontrados ${detoursAnalysis.worthwhileDetours.length} desvios vantajosos:`);
            
            // Adiciona entregas do desvio primeiro
            detoursAnalysis.worthwhileDetours.forEach((detour, index) => {
                console.log(`   ↳ ${detour.delivery.customer_name || detour.delivery.id}: +${(detour.extraDistance/1000).toFixed(1)}km (${((detour.detourRatio-1)*100).toFixed(0)}% desvio)`);
                
                routeSegment.push({
                    shipmentId: `entrega_${detour.delivery.id}`,
                    deliveryId: detour.delivery.id,
                    lat: parseFloat(detour.delivery.lat),
                    lng: parseFloat(detour.delivery.lng),
                    address: detour.delivery.address,
                    order: orderOffset + index,
                    type: 'delivery',
                    priority: detour.delivery.priority,
                    detourSavings: detour.savings,
                    isDetour: true
                });
                
                // Remove da lista de restantes
                remaining = remaining.filter(d => d.id !== detour.delivery.id);
            });
        }
        
        // Adiciona a entrega prioritária
        routeSegment.push({
            shipmentId: `entrega_${priorityDelivery.id}`,
            deliveryId: priorityDelivery.id,
            lat: parseFloat(priorityDelivery.lat),
            lng: parseFloat(priorityDelivery.lng),
            address: priorityDelivery.address,
            order: orderOffset + routeSegment.length,
            type: 'delivery',
            priority: priorityDelivery.priority
        });
        
        const lastPosition = routeSegment[routeSegment.length - 1];
        
        return {
            route: routeSegment,
            remaining: remaining,
            lastPosition: lastPosition
        };
    }

    // Analisa desvios vantajosos
    async analyzeDetours(origin, destination, candidateDeliveries, directDistance) {
        console.log(`🔍 Analisando ${candidateDeliveries.length} possíveis desvios...`);
        
        const detours = [];
        
        for (const candidate of candidateDeliveries) {
            try {
                // Calcula rota com desvio: origem → candidato → destino
                const detourDistance = await this.calculateDetourDistance(origin, candidate, destination);
                
                // Calcula economia/perda
                const extraDistance = detourDistance - directDistance;
                const detourRatio = detourDistance / directDistance;
                
                // Verifica se o desvio é vantajoso
                const isWorthwhile = this.isDetourWorthwhile(
                    extraDistance, 
                    detourRatio, 
                    candidate.priority || 0
                );
                
                if (isWorthwhile) {
                    const savings = this.calculateDetourValue(extraDistance, candidate.priority || 0);
                    
                    detours.push({
                        delivery: candidate,
                        extraDistance: extraDistance,
                        detourRatio: detourRatio,
                        savings: savings
                    });
                }
            } catch (error) {
                console.error(`⚠️ Erro ao analisar desvio para ${candidate.customer_name || candidate.id}:`, error.message);
            }
        }
        
        // Ordena por valor do desvio (melhor primeiro) e limita
        const worthwhileDetours = detours
            .sort((a, b) => b.savings - a.savings)
            .slice(0, this.config.maxDetoursPerPriority);
        
        return { worthwhileDetours };
    }

    // Verifica se um desvio vale a pena
    isDetourWorthwhile(extraDistance, detourRatio, candidatePriority) {
        // Regras para determinar se vale a pena
        const rules = [
            // Regra 1: Desvio muito pequeno (menos de 500m) sempre vale
            extraDistance < 500,
            
            // Regra 2: Desvio moderado (até 1.5km) com candidato de prioridade alta
            extraDistance < 1500 && candidatePriority >= 1,
            
            // Regra 3: Desvio pequeno (até 1km) com qualquer prioridade
            extraDistance < 1000,
            
            // Regra 4: Até 30% de aumento na distância
            detourRatio <= this.config.maxDetourRatio,
            
            // Regra 5: Desvio máximo absoluto respeitado
            extraDistance <= this.config.maxDetourDistance
        ];
        
        return rules.some(rule => rule);
    }

    // Calcula valor do desvio (quanto "vale a pena")
    calculateDetourValue(extraDistance, candidatePriority) {
        // Pontuação base pela prioridade (maior prioridade = mais vantajoso)
        const priorityScore = candidatePriority * 1000;
        
        // Penalidade pela distância extra (maior distância = menos vantajoso)
        const distancePenalty = extraDistance;
        
        // Score final (maior = melhor)
        return priorityScore - distancePenalty;
    }

    // Calcula distância entre dois pontos usando Google Maps
    async calculateDistance(origin, destination) {
        try {
            const response = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
                params: {
                    origins: `${origin.lat},${origin.lng}`,
                    destinations: `${destination.lat},${destination.lng}`,
                    key: this.apiKey,
                    mode: 'driving',
                    units: 'metric'
                },
                timeout: 5000
            });
            
            if (response.data.status === 'OK' && response.data.rows[0].elements[0].status === 'OK') {
                return response.data.rows[0].elements[0].distance.value; // em metros
            }
            
            // Fallback: distância euclidiana
            return this.calculateEuclideanDistance(origin, destination);
        } catch (error) {
            console.error('⚠️ Erro ao calcular distância via API:', error.message);
            return this.calculateEuclidianDistance(origin, destination);
        }
    }

    // Calcula distância de desvio (origem → desvio → destino)
    async calculateDetourDistance(origin, detour, destination) {
        try {
            const response = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
                params: {
                    origins: `${origin.lat},${origin.lng}|${detour.lat},${detour.lng}`,
                    destinations: `${detour.lat},${detour.lng}|${destination.lat},${destination.lng}`,
                    key: this.apiKey,
                    mode: 'driving',
                    units: 'metric'
                },
                timeout: 5000
            });
            
            if (response.data.status === 'OK') {
                const leg1 = response.data.rows[0].elements[0]; // origem → desvio
                const leg2 = response.data.rows[1].elements[1]; // desvio → destino
                
                if (leg1.status === 'OK' && leg2.status === 'OK') {
                    return leg1.distance.value + leg2.distance.value;
                }
            }
            
            // Fallback
            const dist1 = this.calculateEuclideanDistance(origin, detour);
            const dist2 = this.calculateEuclideanDistance(detour, destination);
            return dist1 + dist2;
        } catch (error) {
            console.error('⚠️ Erro ao calcular distância de desvio:', error.message);
            const dist1 = this.calculateEuclideanDistance(origin, detour);
            const dist2 = this.calculateEuclideanDistance(detour, destination);
            return dist1 + dist2;
        }
    }

    // Distância euclidiana como fallback
    calculateEuclideanDistance(point1, point2) {
        const R = 6371000; // Raio da Terra em metros
        const dLat = (point2.lat - point1.lat) * Math.PI / 180;
        const dLng = (point2.lng - point1.lng) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(point1.lat * Math.PI / 180) * Math.cos(point2.lat * Math.PI / 180) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    // Otimiza entregas restantes
    async optimizeRemainingDeliveries(deliveries, currentPosition, orderOffset) {
        if (deliveries.length === 0) return [];
        
        console.log(`🔄 Otimizando ${deliveries.length} entregas restantes...`);
        
        // Para poucas entregas, usa ordem por proximidade
        if (deliveries.length <= 3) {
            return this.optimizeByProximity(deliveries, currentPosition, orderOffset);
        }
        
        // Para muitas entregas, tenta usar Google Directions API
        try {
            const waypoints = deliveries.map(d => d.address).slice(0, -1); // Remove última para destination
            const response = await axios.get(this.directionsURL, {
                params: {
                    origin: `${currentPosition.lat},${currentPosition.lng}`,
                    destination: deliveries[deliveries.length - 1].address,
                    waypoints: `optimize:true|${waypoints.join('|')}`,
                    key: this.apiKey,
                    mode: 'driving'
                },
                timeout: 10000
            });
            
            if (response.data.status === 'OK') {
                const waypointOrder = response.data.routes[0].waypoint_order || [];
                const optimized = [];
                
                // Adiciona waypoints otimizados
                waypointOrder.forEach((index, order) => {
                    optimized.push({
                        shipmentId: `entrega_${deliveries[index].id}`,
                        deliveryId: deliveries[index].id,
                        lat: parseFloat(deliveries[index].lat),
                        lng: parseFloat(deliveries[index].lng),
                        address: deliveries[index].address,
                        order: orderOffset + order,
                        type: 'delivery',
                        priority: deliveries[index].priority
                    });
                });
                
                // Adiciona o destino final
                const lastDelivery = deliveries[deliveries.length - 1];
                optimized.push({
                    shipmentId: `entrega_${lastDelivery.id}`,
                    deliveryId: lastDelivery.id,
                    lat: parseFloat(lastDelivery.lat),
                    lng: parseFloat(lastDelivery.lng),
                    address: lastDelivery.address,
                    order: orderOffset + optimized.length,
                    type: 'delivery',
                    priority: lastDelivery.priority
                });
                
                console.log(`✅ Google Directions otimizou ${optimized.length} entregas`);
                return optimized;
            }
        } catch (error) {
            console.error('⚠️ Erro na otimização do Google:', error.message);
        }
        
        // Fallback: proximidade
        console.log('📍 Usando otimização por proximidade (fallback)');
        return this.optimizeByProximity(deliveries, currentPosition, orderOffset);
    }

    // Otimização simples por proximidade
    optimizeByProximity(deliveries, currentPosition, orderOffset) {
        const optimized = [];
        let remaining = [...deliveries];
        let current = currentPosition;
        
        while (remaining.length > 0) {
            // Encontra a entrega mais próxima
            let nearest = remaining[0];
            let minDistance = this.calculateEuclideanDistance(current, nearest);
            
            for (const delivery of remaining) {
                const distance = this.calculateEuclideanDistance(current, delivery);
                if (distance < minDistance) {
                    minDistance = distance;
                    nearest = delivery;
                }
            }
            
            // Adiciona à rota otimizada
            optimized.push({
                shipmentId: `entrega_${nearest.id}`,
                deliveryId: nearest.id,
                lat: parseFloat(nearest.lat),
                lng: parseFloat(nearest.lng),
                address: nearest.address,
                order: orderOffset + optimized.length,
                type: 'delivery',
                priority: nearest.priority
            });
            
            // Remove da lista e atualiza posição atual
            remaining = remaining.filter(d => d.id !== nearest.id);
            current = nearest;
        }
        
        return optimized;
    }

    // Funções auxiliares mantidas
    integratePickupStops(deliveries, pickupStops, manualOrder) {
        const allStops = [...deliveries];
        
        pickupStops.forEach(stop => {
            const stopOrder = manualOrder[stop.id] || stop.order || 999;
            
            if (stopOrder < 999) {
                let inserted = false;
                for (let i = 0; i < allStops.length; i++) {
                    const currentOrder = allStops[i].order;
                    if (stopOrder < currentOrder) {
                        allStops.splice(i, 0, {
                            shipmentId: stop.id,
                            deliveryId: stop.id,
                            lat: parseFloat(stop.lat),
                            lng: parseFloat(stop.lng),
                            address: stop.address,
                            order: stopOrder,
                            type: 'pickup'
                        });
                        inserted = true;
                        break;
                    }
                }
                if (!inserted) {
                    allStops.push({
                        shipmentId: stop.id,
                        deliveryId: stop.id,
                        lat: parseFloat(stop.lat),
                        lng: parseFloat(stop.lng),
                        address: stop.address,
                        order: allStops.length,
                        type: 'pickup'
                    });
                }
            } else {
                allStops.push({
                    shipmentId: stop.id,
                    deliveryId: stop.id,
                    lat: parseFloat(stop.lat),
                    lng: parseFloat(stop.lng),
                    address: stop.address,
                    order: allStops.length,
                    type: 'pickup'
                });
            }
        });
        
        return allStops;
    }

    hasCompleteManualOrder(deliveries, manualOrder) {
        const deliveryCount = deliveries.length;
        const manualOrderCount = Object.keys(manualOrder).length;
        return manualOrderCount >= deliveryCount;
    }

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

    async calculateRouteWithOrderedStops(stops, depot, circularRoute) {
        try {
            const waypoints = stops.map(stop => ({
                location: stop.address,
                stopover: true
            }));
            
            const origin = depot.address;
            const destination = circularRoute ? origin : stops[stops.length - 1].address;
            
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
            
            let totalDistance = 0;
            let totalDuration = 0;
            
            route.legs.forEach(leg => {
                totalDistance += leg.distance.value;
                totalDuration += leg.duration.value;
            });
            
            return {
                optimizedOrder: stops,
                totalDistance: totalDistance,
                totalDuration: totalDuration,
                polyline: route.overview_polyline.points
            };
        } catch (error) {
            console.error('Erro ao calcular rota:', error);
            
            return {
                optimizedOrder: stops,
                totalDistance: 0,
                totalDuration: 0,
                polyline: null
            };
        }
    }

    handlePickupOnlyRoute(pickupStops, depot, circularRoute, manualOrder) {
        const optimizedOrder = pickupStops.map((stop, index) => ({
            shipmentId: stop.id,
            deliveryId: stop.id,
            lat: parseFloat(stop.lat),
            lng: parseFloat(stop.lng),
            address: stop.address,
            order: manualOrder[stop.id] || index,
            type: 'pickup'
        }));

        return {
            optimizedOrder: optimizedOrder.sort((a, b) => a.order - b.order),
            totalDistance: 0,
            totalDuration: 0,
            polyline: null
        };
    }

    handleSingleDeliveryRoute(deliveries, pickupStops, depot, circularRoute, manualOrder) {
        const allStops = [...deliveries];
        
        pickupStops.forEach(stop => {
            allStops.push({
                ...stop,
                type: 'pickup'
            });
        });
        
        const optimizedOrder = allStops.map((stop, index) => ({
            shipmentId: stop.type === 'pickup' ? stop.id : `entrega_${stop.id}`,
            deliveryId: stop.id,
            lat: parseFloat(stop.lat),
            lng: parseFloat(stop.lng),
            address: stop.address,
            order: manualOrder[stop.id] || index,
            type: stop.type || 'delivery'
        }));

        return {
            optimizedOrder: optimizedOrder.sort((a, b) => a.order - b.order),
            totalDistance: 0,
            totalDuration: 0,
            polyline: null
        };
    }
}

module.exports = new RouteOptimizationService();
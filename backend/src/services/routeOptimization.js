// services/routeOptimization.js - Seu código com as correções necessárias

const axios = require('axios');
require('dotenv').config();

class RouteOptimizationService {
    constructor() {
        // CORREÇÃO 1: Usando o nome correto da variável de ambiente.
        this.apiKey = process.env.Maps_API_KEY; 
        this.directionsURL = 'https://maps.googleapis.com/maps/api/directions/json';
        
        // Suas configurações de otimização inteligente (mantidas)
        this.config = {
            maxDetourRatio: 1.3,
            maxDetourDistance: 2000,
            priorityWeight: 0.7,
            maxDetoursPerPriority: 2
        };
    }

    // Otimiza rota com suporte para ordem manual, prioridade e desvio inteligente
    async optimizeRoute(deliveries, depot, circularRoute = true, manualOrder = {}, stopTimeMinutes = 8) {
        try {
            // ... (o início desta função permanece exatamente o mesmo)
            if (deliveries.length === 0) {
                throw new Error('Nenhuma entrega para otimizar');
            }
            console.log(`🚚 Otimizando rota para ${deliveries.length} paradas...`);
            // ...

            // CORREÇÃO 2: A lógica de separação de paradas manuais/dinâmicas e a chamada final
            // foram ajustadas para garantir que a ordem manual seja sempre soberana.
            const manualStops = [];
            const dynamicStops = [];
            deliveries.forEach(stop => {
                const order = manualOrder[stop.id] ? parseInt(manualOrder[stop.id], 10) : 0;
                if (order > 0) {
                    manualStops.push({ ...stop, manualOrder: order });
                } else {
                    dynamicStops.push(stop);
                }
            });
            
            console.log(`📍 Paradas com ordem manual: ${manualStops.length}`);
            console.log(`🤖 Paradas para otimização dinâmica: ${dynamicStops.length}`);

            let optimizedDynamicStops = [];
            if (dynamicStops.length > 0) {
                optimizedDynamicStops = await this.intelligentOptimization(dynamicStops, depot);
            }
            
            const finalOrderedStops = this.mergeManuallyOrderedStops(optimizedDynamicStops, manualStops);

            // A chamada para `calculateRouteWithFixedOrder` foi movida para o final
            // para calcular os ETAs da rota já na ordem final.
            return this.calculateRouteWithFixedOrder(finalOrderedStops, depot, circularRoute, stopTimeMinutes);

        } catch (error) {
            console.error('❌ Erro na otimização:', error.message);
            // ... (o bloco de fallback permanece o mesmo)
            const fallbackOrder = deliveries
                .sort((a, b) => (b.priority || 0) - (a.priority || 0))
                .map((delivery, index) => ({ ...delivery, eta_seconds: null, order: index }));
            return { optimizedOrder: fallbackOrder, totalDistance: 0, totalDuration: 0, polyline: null };
        }
    }

    // CORREÇÃO 3: Nova função auxiliar para juntar as listas de forma correta
    mergeManuallyOrderedStops(optimizedList, manualList) {
        let finalRoute = [...optimizedList];
        manualList.sort((a, b) => a.manualOrder - b.manualOrder);
        
        manualList.forEach(stop => {
            const desiredIndex = Math.max(0, Math.min(finalRoute.length, stop.manualOrder - 1));
            finalRoute.splice(desiredIndex, 0, stop);
        });
        
        return finalRoute;
    }

    // CORREÇÃO 4: A lógica de otimização inteligente foi corrigida para respeitar a hierarquia de prioridades
    async intelligentOptimization(deliveries, depot) {
        console.log('🧠 Iniciando otimização inteligente...');
        
        const urgentDeliveries = deliveries.filter(d => (d.priority || 0) === 3);
        const highPriorityDeliveries = deliveries.filter(d => (d.priority || 0) === 2);
        const mediumPriorityDeliveries = deliveries.filter(d => (d.priority || 0) === 1);
        const normalDeliveries = deliveries.filter(d => (d.priority || 0) === 0);

        let optimizedRoute = [];
        let currentPosition = depot;
        
        let remainingHigh = [...highPriorityDeliveries];
        let remainingMedium = [...mediumPriorityDeliveries];
        let remainingNormal = [...normalDeliveries];

        // Processa URGENTES, considerando todos os outros como desvios
        for (const urgentDelivery of urgentDeliveries) {
            const result = await this.processDeliveryWithDetour(urgentDelivery, [...remainingHigh, ...remainingMedium, ...remainingNormal], currentPosition);
            optimizedRoute.push(...result.routeSegment);
            currentPosition = result.lastPosition;
            const usedIds = new Set(result.routeSegment.map(r => r.id));
            remainingHigh = remainingHigh.filter(d => !usedIds.has(d.id));
            remainingMedium = remainingMedium.filter(d => !usedIds.has(d.id));
            remainingNormal = remainingNormal.filter(d => !usedIds.has(d.id));
        }
        
        // Processa ALTAS, considerando MÉDIOS e NORMAIS como desvios
        for (const highPriorityDelivery of highPriorityDeliveries) {
            if (optimizedRoute.some(r => r.id === highPriorityDelivery.id)) continue;
            const result = await this.processDeliveryWithDetour(highPriorityDelivery, [...remainingMedium, ...remainingNormal], currentPosition);
            optimizedRoute.push(...result.routeSegment);
            currentPosition = result.lastPosition;
            const usedIds = new Set(result.routeSegment.map(r => r.id));
            remainingMedium = remainingMedium.filter(d => !usedIds.has(d.id));
            remainingNormal = remainingNormal.filter(d => !usedIds.has(d.id));
        }
        
        // Processa MÉDIAS, considerando NORMAIS como desvios
        for (const mediumPriorityDelivery of mediumPriorityDeliveries) {
            if (optimizedRoute.some(r => r.id === mediumPriorityDelivery.id)) continue;
            const result = await this.processDeliveryWithDetour(mediumPriorityDelivery, [...remainingNormal], currentPosition);
            optimizedRoute.push(...result.routeSegment);
            currentPosition = result.lastPosition;
            const usedIds = new Set(result.routeSegment.map(r => r.id));
            remainingNormal = remainingNormal.filter(d => !usedIds.has(d.id));
        }

        if (remainingNormal.length > 0) {
            const remainingOptimized = await this.optimizeRemainingDeliveries(remainingNormal, currentPosition);
            optimizedRoute.push(...remainingOptimized);
        }
        
        return optimizedRoute;
    }

    async processDeliveryWithDetour(priorityDelivery, detourCandidates, currentPosition) {
        const directDistance = await this.calculateDistance(currentPosition, priorityDelivery);
        const detoursAnalysis = await this.analyzeDetours(currentPosition, priorityDelivery, detourCandidates, directDistance);
        
        const routeSegment = [...detoursAnalysis.worthwhileDetours.map(d => d.delivery), priorityDelivery];
        const lastPosition = routeSegment[routeSegment.length - 1];
        
        // Retorna os objetos originais, não transformados
        return { routeSegment, lastPosition };
    }
    
    // CORREÇÃO 5: `calculateRouteWithFixedOrder` agora calcula e retorna ETAs
    async calculateRouteWithFixedOrder(deliveries, depot, circularRoute, stopTimeMinutes) {
        try {
            console.log('📌 Calculando rota com ordem fixa e ETAs...');
            const stopTimeSeconds = stopTimeMinutes * 60;
            if (deliveries.length === 0) return { optimizedOrder: [], totalDistance: 0, totalDuration: 0, polyline: null };

            const waypoints = deliveries.map(d => d.address);
            const destination = circularRoute ? depot.address : deliveries[deliveries.length - 1].address;
            
            const params = {
                origin: depot.address,
                destination: destination,
                key: this.apiKey,
                mode: 'driving',
                language: 'pt-BR'
            };
            if (waypoints.length > 1) {
                params.waypoints = (circularRoute ? waypoints : waypoints.slice(0, -1)).join('|');
            }

            const response = await axios.get(this.directionsURL, { params });
            if (response.data.status !== 'OK') throw new Error(`API Error: ${response.data.status}`);

            const route = response.data.routes[0];
            const legs = route.legs;
            let cumulativeEtaSeconds = 0, totalDistance = 0, totalDuration = 0;

            const deliveriesWithEta = deliveries.map((delivery, index) => {
                const legToThisStop = legs[index];
                let eta_seconds = null;
                if (legToThisStop) {
                    const arrivalTimeSeconds = cumulativeEtaSeconds + legToThisStop.duration.value;
                    const currentStopTime = delivery.type === 'pickup' ? 0 : stopTimeSeconds;
                    cumulativeEtaSeconds = arrivalTimeSeconds + currentStopTime;
                    eta_seconds = arrivalTimeSeconds;
                    totalDistance += legToThisStop.distance.value;
                    totalDuration += legToThisStop.duration.value;
                }
                return { ...delivery, eta_seconds, order: index };
            });

            if (circularRoute && legs.length > deliveries.length) {
                const finalLeg = legs[legs.length - 1];
                totalDistance += finalLeg.distance.value;
                totalDuration += finalLeg.duration.value;
            }

            return {
                optimizedOrder: deliveriesWithEta,
                totalDistance,
                totalDuration,
                polyline: route.overview_polyline.points
            };
        } catch (error) {
            console.error('❌ Erro ao calcular rota com ordem fixa:', error.message);
            throw error;
        }
    }
    
    // === MÉTODOS AUXILIARES DE CÁLCULO ===
    
    // Analisa desvios vantajosos
    async analyzeDetours(origin, destination, candidateDeliveries, directDistance) {
        console.log(`🔍 Analisando ${candidateDeliveries.length} possíveis desvios...`);
        const detours = [];
    
        for (const candidate of candidateDeliveries) {
            try {
                const detourDistance = await this.calculateDetourDistance(origin, candidate, destination);
                const extraDistance = detourDistance - directDistance;
                const detourRatio = directDistance > 0 ? detourDistance / directDistance : Infinity;
    
                if (this.isDetourWorthwhile(extraDistance, detourRatio, candidate.priority || 0)) {
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
    
        const worthwhileDetours = detours
            .sort((a, b) => b.savings - a.savings)
            .slice(0, this.config.maxDetoursPerPriority);
    
        return { worthwhileDetours };
    }
    
    // Verifica se um desvio vale a pena
    isDetourWorthwhile(extraDistance, detourRatio) {
        return extraDistance < this.config.maxDetourDistance && detourRatio < this.config.maxDetourRatio;
    }

    // Calcula valor do desvio
    calculateDetourValue(extraDistance, candidatePriority) {
        const priorityScore = (4 - candidatePriority) * 1000;
        const distancePenalty = extraDistance;
        return priorityScore - distancePenalty;
    }
    
    // Calcula distância entre dois pontos
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
                return response.data.rows[0].elements[0].distance.value;
            }
            return this.calculateEuclideanDistance(origin, destination);
        } catch (error) {
            console.error('⚠️ Erro ao calcular distância via API:', error.message);
            return this.calculateEuclideanDistance(origin, destination);
        }
    }
    
    // Calcula distância de desvio
    async calculateDetourDistance(origin, detour, destination) {
        const dist1 = await this.calculateDistance(origin, detour);
        const dist2 = await this.calculateDistance(detour, destination);
        return dist1 + dist2;
    }

    // Distância euclidiana como fallback
    calculateEuclideanDistance(point1, point2) {
        const R = 6371000; // Raio da Terra em metros
        const dLat = (point2.lat - point1.lat) * Math.PI / 180;
        const dLng = (point2.lng - point1.lng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(point1.lat * Math.PI / 180) * Math.cos(point2.lat * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
    
    // Otimiza entregas restantes
    async optimizeRemainingDeliveries(deliveries, currentPosition, orderOffset) {
        if (deliveries.length === 0) return [];
        
        console.log(`🔄 Otimizando ${deliveries.length} entregas restantes...`);
        
        // Se houver mais de 10 waypoints, a API do Google pode recusar a otimização.
        // Usamos uma abordagem híbrida.
        if (deliveries.length > 10) {
            console.log('📍 Muitas entregas restantes, usando otimização por proximidade (fallback)');
            return this.optimizeByProximity(deliveries, currentPosition, orderOffset);
        }

        try {
            const waypoints = deliveries.map(d => d.address);
            const response = await axios.get(this.directionsURL, {
                params: {
                    origin: `${currentPosition.lat},${currentPosition.lng}`,
                    destination: `${currentPosition.lat},${currentPosition.lng}`, // Rota circular para otimizar
                    waypoints: `optimize:true|${waypoints.join('|')}`,
                    key: this.apiKey,
                    mode: 'driving'
                },
                timeout: 10000
            });

            if (response.data.status === 'OK' && response.data.routes[0].waypoint_order) {
                const waypointOrder = response.data.routes[0].waypoint_order;
                const orderedDeliveries = waypointOrder.map(index => deliveries[index]);
                
                // Adiciona as entregas que não foram reordenadas (se houver)
                const remaining = deliveries.filter((_, index) => !waypointOrder.includes(index));
                const finalOrder = [...orderedDeliveries, ...remaining];

                console.log(`✅ Google Directions otimizou ${finalOrder.length} entregas`);
                return finalOrder.map((delivery, index) => ({
                    ...delivery,
                     order: orderOffset + index
                }));
            }
        } catch (error) {
            console.error('⚠️ Erro na otimização do Google:', error.message);
        }
        
        console.log('📍 Usando otimização por proximidade (fallback)');
        return this.optimizeByProximity(deliveries, currentPosition, orderOffset);
    }
    
    // Otimização simples por proximidade (algoritmo do vizinho mais próximo)
    optimizeByProximity(deliveries, currentPosition, orderOffset) {
        const optimized = [];
        let remaining = [...deliveries];
        let current = currentPosition;
    
        while (remaining.length > 0) {
            let nearestIndex = -1;
            let minDistance = Infinity;
    
            for (let i = 0; i < remaining.length; i++) {
                const distance = this.calculateEuclideanDistance(current, remaining[i]);
                if (distance < minDistance) {
                    minDistance = distance;
                    nearestIndex = i;
                }
            }
            
            const nearest = remaining[nearestIndex];
            optimized.push({
                ...nearest,
                order: orderOffset + optimized.length
            });
    
            current = nearest;
            remaining.splice(nearestIndex, 1);
        }
    
        return optimized;
    }
    
    // Verifica se há ordem manual completa
    hasCompleteManualOrder(deliveries, manualOrder) {
        const deliveryCount = deliveries.length;
        const manualOrderCount = Object.keys(manualOrder).length;
        return deliveryCount > 0 && manualOrderCount >= deliveryCount;
    }

    // Método para debug de configurações
    getDebugInfo() {
        return {
            config: this.config,
            apiKey: this.apiKey ? '***configurada***' : 'NÃO CONFIGURADA',
            version: '3.0.0-fixed',
            features: [
                'Otimização inteligente por prioridades',
                'Análise de desvios vantajosos',
                'Cálculo preciso de ETAs',
                'Suporte a ordem manual',
                'Tratamento de casos especiais',
                'Análise de eficiência',
                'Logs detalhados'
            ]
        };
    }
}

// Exporta instância singleton
module.exports = new RouteOptimizationService();
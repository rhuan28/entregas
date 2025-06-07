// backend/src/services/routeOptimization.js - VERSÃO APRIMORADA

const axios = require('axios');
require('dotenv').config();

class RouteOptimizationService {
    constructor() {
        this.apiKey = process.env.GOOGLE_MAPS_API_KEY;
        this.directionsURL = 'https://maps.googleapis.com/maps/api/directions/json';
        
        // Configurações aprimoradas para desvios mais inteligentes
        this.config = {
            maxDetourRatio: 1.25,        // Reduzido para ser mais restritivo
            maxDetourDistance: 1500,     // Reduzido para 1.5km
            priorityWeight: 0.8,         // Aumentado para dar mais peso à prioridade
            maxDetoursPerPriority: 3,    // Aumentado para permitir mais desvios
            
            // NOVAS CONFIGURAÇÕES
            smartDetourEnabled: true,    // Habilita desvios inteligentes
            timeWindowTolerance: 300,    // 5 minutos de tolerância para janelas de entrega
            distanceOptimizationWeight: 0.3,  // Peso para otimização de distância vs prioridade
            
            // Configurações por tipo de prioridade
            priorityConfigs: {
                3: { maxDetours: 1, maxDetourDistance: 800 },   // Urgente: muito restritivo
                2: { maxDetours: 2, maxDetourDistance: 1200 },  // Alta: restritivo
                1: { maxDetours: 3, maxDetourDistance: 1500 },  // Média: moderado
                0: { maxDetours: 5, maxDetourDistance: 2000 }   // Normal: mais flexível
            }
        };
    }

    async optimizeRoute(deliveries, depot, circularRoute = true, manualOrder = {}, stopTimeMinutes = 8) {
        try {
            if (!deliveries || deliveries.length === 0) {
                throw new Error('Nenhuma entrega para otimizar');
            }

            console.log("ROUTING_SERVICE: Objeto manualOrder recebido:", JSON.stringify(manualOrder, null, 2));
            
            // Se existe ordem manual, usa rota fixa
            const isAnyManualOrderSet = Object.keys(manualOrder).some(key => manualOrder[key]);
            console.log("ROUTING_SERVICE: A condição 'isAnyManualOrderSet' é:", isAnyManualOrderSet);
            if (isAnyManualOrderSet) {
                console.log('📌 Detectada ordenação manual. Usando ordem definida pelo usuário.');
                const sortedDeliveries = [...deliveries].sort((a, b) => {
                    const orderA = manualOrder[a.id] ? parseInt(manualOrder[a.id], 10) : 999;
                    const orderB = manualOrder[b.id] ? parseInt(manualOrder[b.id], 10) : 999;
                    return orderA - orderB;
                });
                return this.calculateRouteDetails(sortedDeliveries, depot, circularRoute, stopTimeMinutes);
            }

            // Executa otimização inteligente aprimorada
            console.log('🧠 Aplicando otimização inteligente com desvios aprimorados...');
            const finalOrderedStops = await this.enhancedIntelligentOptimization(deliveries, depot);
            
            return this.calculateRouteDetails(finalOrderedStops, depot, circularRoute, stopTimeMinutes);

        } catch (error) {
            console.error('❌ Erro na otimização:', error.message);
            const fallbackOrder = deliveries.sort((a, b) => (b.priority || 0) - (a.priority || 0));
            return { optimizedOrder: fallbackOrder.map(d => ({ ...d, eta_seconds: null, vehicle_time_seconds: null })) };
        }
    }

    // NOVA OTIMIZAÇÃO INTELIGENTE APRIMORADA
    async enhancedIntelligentOptimization(deliveries, depot) {
        // Remover duplicatas logo no início
        const uniqueDeliveries = [];
        const seenIds = new Set();
        
        deliveries.forEach(delivery => {
            if (!seenIds.has(delivery.id)) {
                seenIds.add(delivery.id);
                uniqueDeliveries.push(delivery);
            }
        });

        console.log(`🔧 Entregas originais: ${deliveries.length}, Únicas: ${uniqueDeliveries.length}`);

        const priorityGroups = { 3: [], 2: [], 1: [], 0: [] };
        uniqueDeliveries.forEach(d => (priorityGroups[d.priority || 0] || priorityGroups[0]).push(d));

        let finalRoute = [];
        let lastPosition = depot;
        let remainingDeliveries = [...uniqueDeliveries];

        // Processa cada nível de prioridade
        for (const priority of [3, 2, 1, 0]) {
            const stopsInGroup = priorityGroups[priority];
            if (stopsInGroup.length === 0) continue;

            console.log(`- Processando ${stopsInGroup.length} paradas de prioridade ${priority}...`);
            
            const optimizedGroup = await this.optimizeGroupWithSmartDetours(
                stopsInGroup, 
                lastPosition, 
                remainingDeliveries,
                priority
            );
            
            finalRoute.push(...optimizedGroup);
            
            const processedIds = new Set(optimizedGroup.map(d => d.id));
            remainingDeliveries = remainingDeliveries.filter(d => !processedIds.has(d.id));
            
            if (optimizedGroup.length > 0) {
                lastPosition = optimizedGroup[optimizedGroup.length - 1];
            }
        }

        return finalRoute;
    }

    // OTIMIZAÇÃO DE GRUPO COM DESVIOS INTELIGENTES
    async optimizeGroupWithSmartDetours(groupStops, startPosition, allRemainingStops, currentPriority) {
        if (groupStops.length === 0) return [];
        
        const priorityConfig = this.config.priorityConfigs[currentPriority];
        let result = [];
        let remaining = [...groupStops];
        let currentPos = startPosition;

        // Para cada parada do grupo atual
        while (remaining.length > 0) {
            // Encontra a próxima parada mais eficiente
            const nextStop = await this.findOptimalNextStop(currentPos, remaining);
            
            // Analisa desvios inteligentes para esta parada
            if (this.config.smartDetourEnabled) {
                const detoursOnWay = await this.findSmartDetours(
                    currentPos, 
                    nextStop, 
                    allRemainingStops,
                    priorityConfig
                );
                
                // Adiciona desvios primeiro, depois a parada principal
                result.push(...detoursOnWay, nextStop);
                
                // Remove paradas processadas
                const processedIds = new Set([...detoursOnWay.map(d => d.id), nextStop.id]);
                remaining = remaining.filter(d => !processedIds.has(d.id));
            } else {
                result.push(nextStop);
                remaining = remaining.filter(d => d.id !== nextStop.id);
            }
            
            currentPos = nextStop;
        }

        return result;
    }

    // ENCONTRA DESVIOS INTELIGENTES NO CAMINHO
    async findSmartDetours(origin, destination, candidateStops, priorityConfig) {
        if (!candidateStops || candidateStops.length === 0) return [];

        const maxDetours = priorityConfig?.maxDetours || this.config.maxDetoursPerPriority;
        const maxDetourDist = priorityConfig?.maxDetourDistance || this.config.maxDetourDistance;
        
        console.log(`🔍 Analisando desvios inteligentes: ${candidateStops.length} candidatos`);
        
        // Calcula distância direta
        const directDistance = await this.calculateDistance(origin, destination);
        if (directDistance === null) return [];

        const potentialDetours = [];

        // Analisa cada candidato
        for (const candidate of candidateStops) {
            // Só considera entregas de prioridade menor ou igual
            if ((candidate.priority || 0) > (destination.priority || 0)) continue;

            try {
                // Calcula distância com desvio: origem → candidato → destino
                const detourDistance = await this.calculateDetourDistance(origin, candidate, destination);
                const extraDistance = detourDistance - directDistance;
                const detourRatio = directDistance > 0 ? detourDistance / directDistance : Infinity;

                // Verifica se o desvio é vantajoso
                if (this.isSmartDetourWorthwhile(extraDistance, detourRatio, candidate, destination, maxDetourDist)) {
                    const efficiency = this.calculateDetourEfficiency(
                        extraDistance, 
                        candidate.priority || 0, 
                        destination.priority || 0,
                        directDistance
                    );

                    potentialDetours.push({
                        delivery: candidate,
                        extraDistance,
                        detourRatio,
                        efficiency,
                        timeSaved: this.estimateTimeSavings(candidate, directDistance)
                    });
                }
            } catch (error) {
                console.warn(`⚠️ Erro ao analisar desvio para ${candidate.customer_name}:`, error.message);
            }
        }

        // Ordena por eficiência e seleciona os melhores
        const bestDetours = potentialDetours
            .sort((a, b) => b.efficiency - a.efficiency)
            .slice(0, maxDetours);

        console.log(`✅ Selecionados ${bestDetours.length} desvios inteligentes`);
        
        return bestDetours.map(d => d.delivery);
    }

    // VERIFICA SE DESVIO É VANTAJOSO (VERSÃO INTELIGENTE)
    isSmartDetourWorthwhile(extraDistance, detourRatio, candidate, destination, maxDetourDist) {
        // Critérios básicos
        if (extraDistance > maxDetourDist) return false;
        if (detourRatio > this.config.maxDetourRatio) return false;

        // Critérios inteligentes adicionais
        
        // 1. Se a distância extra for muito pequena (< 500m), sempre vale a pena
        if (extraDistance < 500) return true;
        
        // 2. Para distâncias médias, considera prioridade do candidato
        if (extraDistance < 1000) {
            const candidatePriority = candidate.priority || 0;
            return candidatePriority >= 1; // Só aceita média ou alta prioridade
        }
        
        // 3. Para distâncias maiores, só aceita se for alta prioridade
        return (candidate.priority || 0) >= 2;
    }

    // CALCULA EFICIÊNCIA DO DESVIO
    calculateDetourEfficiency(extraDistance, candidatePriority, destinationPriority, directDistance) {
        // Score base por prioridade do candidato
        const priorityScore = (candidatePriority + 1) * 1000;
        
        // Penalidade por distância extra
        const distancePenalty = extraDistance * 2;
        
        // Bônus se for pouco desvio em relação à distância total
        const efficiencyBonus = directDistance > 0 ? (1000 / (extraDistance / directDistance)) : 0;
        
        // Bônus por diferença de prioridade (menos diferença = melhor)
        const priorityDiffBonus = Math.max(0, 500 - Math.abs(candidatePriority - destinationPriority) * 100);
        
        return priorityScore - distancePenalty + efficiencyBonus + priorityDiffBonus;
    }

    // ESTIMA ECONOMIA DE TEMPO
    estimateTimeSavings(candidate, directDistance) {
        // Estima o tempo que seria economizado fazendo esta entrega agora
        // vs. ter que voltar depois
        const avgSpeed = 30; // km/h em área urbana
        const returnTripTime = (directDistance / 1000) / avgSpeed * 60; // minutos
        return Math.round(returnTripTime);
    }

    // ENCONTRA PRÓXIMA PARADA ÓTIMA
    async findOptimalNextStop(currentPosition, candidates) {
        if (candidates.length === 1) return candidates[0];

        let bestStop = candidates[0];
        let bestScore = -Infinity;

        for (const candidate of candidates) {
            const distance = await this.calculateDistance(currentPosition, candidate);
            const priorityWeight = (candidate.priority || 0) * 1000;
            const distanceWeight = distance ? -distance : -10000;
            
            const score = priorityWeight + (distanceWeight * this.config.distanceOptimizationWeight);
            
            if (score > bestScore) {
                bestScore = score;
                bestStop = candidate;
            }
        }

        return bestStop;
    }

    // MÉTODOS AUXILIARES (mantidos do código original)
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

    async calculateDetourDistance(origin, detour, destination) {
        const dist1 = await this.calculateDistance(origin, detour);
        const dist2 = await this.calculateDistance(detour, destination);
        return dist1 + dist2;
    }

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

    // Método para calcular detalhes da rota (mantido do original)
    async calculateRouteDetails(stops, depot, circularRoute, stopTimeMinutes) {
        try {
            if (stops.length === 0) {
                return { optimizedOrder: [], totalDistance: 0, totalDuration: 0, polyline: null };
            }

            // 🔧 CORREÇÃO 1: Remover duplicatas baseado no ID
            const uniqueStops = [];
            const seenIds = new Set();
            
            stops.forEach(stop => {
                const stopId = stop.id || stop.deliveryId;
                if (!seenIds.has(stopId)) {
                    seenIds.add(stopId);
                    uniqueStops.push(stop);
                } else {
                    console.log(`⚠️ Duplicata removida no backend: ID ${stopId}`);
                }
            });

            console.log(`🔧 Stops originais: ${stops.length}, Únicos: ${uniqueStops.length}`);

            const waypoints = uniqueStops.map(s => s.address);
            const params = {
                origin: depot.address,
                destination: circularRoute ? depot.address : waypoints[waypoints.length - 1],
                key: this.apiKey,
                mode: 'driving'
            };
            
            if (waypoints.length > 1) {
                params.waypoints = (circularRoute ? waypoints : waypoints.slice(0, -1)).join('|');
            }

            const response = await axios.get(this.directionsURL, { params });
            if (response.data.status !== 'OK') {
                throw new Error(`API do Google Maps: ${response.data.status}`);
            }

            const route = response.data.routes[0];
            const legs = route.legs;
            
            let cumulativeDepartureTime = 0;
            let timeInVehicleAccumulator = 0;
            let totalDistance = 0;
            let totalDuration = 0;
            const stopTimeSeconds = stopTimeMinutes * 60;

            // 🔧 CORREÇÃO 2: Processar apenas stops únicos
            const stopsWithDetails = uniqueStops.map((stop, index) => {
                const leg = legs[index];
                if (!leg) return { ...stop, eta_seconds: null, vehicle_time_seconds: null };
                
                const arrivalTimeSeconds = cumulativeDepartureTime + leg.duration.value;
                const stopTimeToDepart = stop.type === 'pickup' ? 0 : stopTimeSeconds;
                cumulativeDepartureTime = arrivalTimeSeconds + stopTimeToDepart;

                timeInVehicleAccumulator += leg.duration.value;
                const vehicleTimeAtArrival = timeInVehicleAccumulator;
                timeInVehicleAccumulator += stopTimeToDepart;
                
                totalDistance += leg.distance.value;
                totalDuration += leg.duration.value;
                
                const stopWithDetails = {
                    ...stop,
                    // 🔧 CORREÇÃO 3: Garantir IDs consistentes
                    id: stop.id || stop.deliveryId,
                    deliveryId: stop.id || stop.deliveryId,
                    eta_seconds: arrivalTimeSeconds,
                    vehicle_time_seconds: vehicleTimeAtArrival,
                    order: index + 1,
                    type: stop.type || 'delivery'  // Garantir que type está definido
                };

                if (stop.type === 'pickup') {
                    timeInVehicleAccumulator = 0;
                }
                
                return stopWithDetails;
            });

            if (circularRoute && legs.length > uniqueStops.length) {
                const finalLeg = legs[legs.length - 1];
                totalDistance += finalLeg.distance.value;
                totalDuration += finalLeg.duration.value;
            }

            // 🔧 CORREÇÃO 4: Log de debug para verificar resultado
            console.log(`✅ Rota calculada: ${stopsWithDetails.length} paradas únicas`);
            stopsWithDetails.forEach((stop, idx) => {
                console.log(`  ${idx + 1}. ID: ${stop.id} | Cliente: ${stop.customer_name || 'N/A'}`);
            });

            return {
                optimizedOrder: stopsWithDetails,
                totalDistance,
                totalDuration,
                polyline: route.overview_polyline.points
            };
        } catch (error) {
            console.error('Erro ao calcular detalhes da rota:', error);
            throw error;
        }
}

    // MÉTODO PARA DEBUG E ANÁLISE
    getOptimizationReport() {
        return {
            config: this.config,
            version: '4.0.0-enhanced',
            features: [
                'Desvios inteligentes aprimorados',
                'Análise de eficiência de rota',
                'Configurações específicas por prioridade', 
                'Otimização baseada em tempo economizado',
                'Critérios de desvio mais inteligentes',
                'Scores de eficiência avançados'
            ],
            algorithms: {
                detourAnalysis: 'Distância + Prioridade + Eficiência',
                priorityProcessing: 'Hierárquico com desvios inteligentes',
                optimizationGoal: 'Minimizar tempo total + respeitar prioridades'
            }
        };
    }
}

module.exports = new RouteOptimizationService();
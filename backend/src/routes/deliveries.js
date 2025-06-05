// routes/deliveries.js - Versão corrigida com prioridades conforme tabela fornecida
const express = require('express');
const router = express.Router();
const googleMaps = require('../services/googleMaps');
const routeOptimization = require('../services/routeOptimization');

// Obtém a instância do banco de dados a partir do app
function getDb(req) {
    return req.app.get('db');
}

// Endereço da confeitaria (depot)
const CONFEITARIA_ADDRESS = {
    address: 'R. Barata Ribeiro, 466 - Vila Itapura, Campinas - SP, 13023-030',
    lat: -22.894334936369436,
    lng: -47.0640515913573
};

// Configuração dos produtos com suas prioridades - CORRIGIDA CONFORME TABELA
const PRODUCT_CONFIG = {
    'bentocake': { name: 'Bentocake', priority: 0, size: 'P' },      // Normal
    '6fatias': { name: '6 fatias', priority: 1, size: 'P' },        // Média
    '10fatias': { name: '10 fatias', priority: 2, size: 'M' },      // Alta
    '18fatias': { name: '18 fatias', priority: 2, size: 'M' },      // Alta
    '24fatias': { name: '24 fatias', priority: 2, size: 'G' },      // Alta
    '30fatias': { name: '30 fatias', priority: 2, size: 'G' },      // Alta
    '40fatias': { name: '40 fatias', priority: 2, size: 'GG' },     // Alta
    'personalizado': { name: 'Personalizado', priority: 0, size: 'M' } // Normal
};

// Constantes para facilitar manutenção
const PRIORITY_LEVELS = {
    NORMAL: 0,
    MEDIUM: 1,
    HIGH: 2,
    URGENT: 3
};

const PRIORITY_LABELS = {
    [PRIORITY_LEVELS.NORMAL]: 'Normal',
    [PRIORITY_LEVELS.MEDIUM]: 'Média',
    [PRIORITY_LEVELS.HIGH]: 'Alta',
    [PRIORITY_LEVELS.URGENT]: 'Urgente'
};

// Função para validar prioridade
function validatePriority(priority) {
    const validPriorities = [0, 1, 2, 3];
    const numPriority = parseInt(priority);
    
    if (!validPriorities.includes(numPriority)) {
        throw new Error('Prioridade deve ser 0 (Normal), 1 (Média), 2 (Alta) ou 3 (Urgente)');
    }
    
    return numPriority;
}

// Função para obter label de prioridade
function getPriorityLabel(priority) {
    return PRIORITY_LABELS[priority] || 'Normal';
}

// Lista entregas por data
router.get('/', async (req, res) => {
    try {
        const { date } = req.query;
        const db = getDb(req);
        
        let query = 'SELECT * FROM deliveries';
        let params = [];
        
        if (date) {
            query += ' WHERE order_date = $1';
            params.push(date);
        } else {
            query += ' WHERE order_date = CURRENT_DATE';
        }
        
        // Ordena por prioridade (3=Urgente, 2=Alta, 1=Média, 0=Normal)
        query += ' ORDER BY priority DESC, created_at ASC';
        
        console.log(`Executando query para buscar entregas: ${query} com data ${date || 'HOJE'}`);
        
        const result = await db.query(query, params);
        console.log(`Encontradas ${result.rows.length} entregas`);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Erro ao buscar entregas:', error);
        res.status(500).json({ error: error.message });
    }
});

// Lista rotas por data ou todas (excluindo arquivadas por padrão)
router.get('/routes', async (req, res) => {
    try {
        const { includeArchived = 'false' } = req.query;
        const db = getDb(req);

        // 1. Buscar configurações de preço e tempo de parada

        const settingsResult = await db.query(
            "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('daily_rate', 'km_rate', 'stop_time')" // Adiciona 'stop_time'

        );
        const appSettings = {};
        settingsResult.rows.forEach(row => {
            appSettings[row.setting_key] = parseFloat(row.setting_value) || 0;
        });
        const dailyRate = appSettings.daily_rate || 100;
        const kmRate = appSettings.km_rate || 2.5;
        const stopTimePerDelivery = appSettings.stop_time || 8; // Tempo de parada em minutos, padrão 8


        // 2. Buscar rotas

        let whereClause = includeArchived === 'true' ? '' : 'WHERE (r.archived = false OR r.archived IS NULL)';
        const query = `
            SELECT 
                r.id,
                r.route_date,
                r.status,
                r.total_distance,
                r.total_duration, -- Duração em segundos do Google
                r.optimized_order,
                r.route_config,
                r.archived,
                r.archived_at,
                COUNT(DISTINCT d.id) as delivery_count, -- Total de paradas que são entregas
                COUNT(DISTINCT CASE WHEN d.status = 'delivered' THEN d.id END) as delivered_count
            FROM routes r 
            LEFT JOIN deliveries d ON r.route_date = d.order_date 
            ${whereClause}

            GROUP BY r.id, r.route_date, r.status, r.total_distance, r.total_duration, 
                     r.optimized_order, r.route_config, r.archived, r.archived_at
            ORDER BY r.route_date DESC
            LIMIT 30
        `;
        
        const result = await db.query(query);

        // 3. Calcular valor e TEMPO COM PARADAS, e parsear JSON para cada rota

        const routesWithData = result.rows.map(route => {
            // Cálculo do valor (usando arredondamento prévio da distância)

            const distanceInKmRaw = route.total_distance ? (route.total_distance / 1000) : 0;
            const distanceKmRounded = parseFloat(distanceInKmRaw.toFixed(1));
            const valor_total_rota_calculated = dailyRate + (distanceKmRounded * kmRate);

            // Cálculo do tempo total com paradas

            const routeDurationMinutes = route.total_duration ? Math.round(route.total_duration / 60) : 0;
            // route.delivery_count já conta as entregas (não paradas de pickup)

            const numberOfActualDeliveries = parseInt(route.delivery_count) || 0; 
            const total_duration_with_stops = routeDurationMinutes + (numberOfActualDeliveries * stopTimePerDelivery);

            return {
                ...route,
                optimized_order: route.optimized_order ? 
                    (typeof route.optimized_order === 'string' ? 
                        JSON.parse(route.optimized_order) : route.optimized_order) : null,
                route_config: route.route_config ? 
                    (typeof route.route_config === 'string' ? 
                        JSON.parse(route.route_config) : route.route_config) : null,
                valor_total_rota: parseFloat(valor_total_rota_calculated.toFixed(2)),
                total_duration_with_stops: total_duration_with_stops // Novo campo

            };
        });
        
        res.json(routesWithData);
    } catch (error) {
        console.error('Erro ao buscar rotas com valor e tempo de parada:', error);
        res.status(500).json({ error: error.message });
    }
});

// Busca rota específica por data
router.get('/routes/:date', async (req, res) => {
    try {
        const { date } = req.params;
        const db = getDb(req);
        
        console.log(`Buscando rota para data: ${date}`);
        
        const query = `
            SELECT 
                r.id,
                r.route_date,
                r.status,
                r.total_distance,
                r.total_duration,
                r.optimized_order,
                r.route_config,
                r.archived,
                r.archived_at,
                COUNT(DISTINCT d.id) as delivery_count,
                COUNT(DISTINCT CASE WHEN d.status = 'delivered' THEN d.id END) as delivered_count
            FROM routes r 
            LEFT JOIN deliveries d ON r.route_date = d.order_date 
            WHERE r.route_date = $1
            GROUP BY r.id, r.route_date, r.status, r.total_distance, r.total_duration, 
                     r.optimized_order, r.route_config, r.archived, r.archived_at
        `;
        
        const result = await db.query(query, [date]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                error: 'Rota não encontrada para esta data',
                date: date 
            });
        }
        
        const route = result.rows[0];
        
        // Parse JSON fields safely
        const routeWithParsedData = {
            ...route,
            optimized_order: route.optimized_order ? 
                (typeof route.optimized_order === 'string' ? 
                    JSON.parse(route.optimized_order) : route.optimized_order) : null,
            route_config: route.route_config ? 
                (typeof route.route_config === 'string' ? 
                    JSON.parse(route.route_config) : route.route_config) : null
        };
        
        console.log(`Rota encontrada para ${date}:`, {
            id: route.id,
            status: route.status,
            deliveries: route.delivery_count,
            hasOptimizedOrder: !!routeWithParsedData.optimized_order,
            hasRouteConfig: !!routeWithParsedData.route_config
        });
        
        res.json(routeWithParsedData);
    } catch (error) {
        console.error('Erro ao buscar rota específica:', error);
        res.status(500).json({ error: error.message });
    }
});

// Limpa todas as entregas de uma data
router.delete('/clear/:date', async (req, res) => {
    try {
        const { date } = req.params;
        const db = getDb(req);
        
        console.log(`Recebendo solicitação para excluir rota da data ${date}`);
        
        // Usar transação para garantir consistência
        const result = await db.transaction(async (client) => {
            // Primeiro deleta notificações relacionadas
            const notificationResult = await client.query(
                'DELETE FROM notifications WHERE delivery_id IN (SELECT id FROM deliveries WHERE order_date = $1)',
                [date]
            );
            
            // Deleta os registros de rastreamento relacionados
            const trackingResult = await client.query(
                'DELETE FROM tracking WHERE delivery_id IN (SELECT id FROM deliveries WHERE order_date = $1)',
                [date]
            );
            
            // Deleta as entregas
            const deliveryResult = await client.query(
                'DELETE FROM deliveries WHERE order_date = $1',
                [date]
            );
            
            // Remove a rota
            const routeResult = await client.query(
                'DELETE FROM routes WHERE route_date = $1',
                [date]
            );
            
            return {
                deliveriesRemoved: deliveryResult.rowCount,
                routesRemoved: routeResult.rowCount,
                notificationsRemoved: notificationResult.rowCount,
                trackingRemoved: trackingResult.rowCount
            };
        });
        
        console.log(`Exclusão concluída. Entregas removidas: ${result.deliveriesRemoved}, Rotas removidas: ${result.routesRemoved}`);
        
        res.json({ 
            message: 'Rota e entregas removidas com sucesso',
            ...result
        });
    } catch (error) {
        console.error('Erro ao limpar entregas:', error);
        res.status(500).json({ error: error.message });
    }
});

// Adiciona nova entrega com campos atualizados
router.post('/', async (req, res) => {
    try {
        const { 
            order_number,
            customer_name, 
            customer_phone, 
            address, 
            product_description, // Pode vir como undefined do frontend
            product_type,
            product_name: productNameFromRequest, // Nome que PODE vir do frontend
            size = 'M', // Default se não vier ou não for determinado pelo product_type
            priority = 0,
            delivery_window_start = null,
            delivery_window_end = null,
            order_date 
        } = req.body;
        
        if (!customer_name || !address) {
            return res.status(400).json({ error: 'Campos obrigatórios faltando', required: ['customer_name', 'address'] });
        }
        
        let validatedPriority;
        try {
            validatedPriority = validatePriority(priority);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
        
        const effectiveDate = order_date || new Date().toISOString().split('T')[0];
        
        let coords;
        try {
            coords = await googleMaps.geocodeAddress(address);
        } catch (geocodeError) {
            return res.status(400).json({ error: 'Não foi possível encontrar o endereço fornecido', details: geocodeError.message });
        }
        
        let finalProductName = productNameFromRequest;
        let finalProductDescription = product_description;
        let effectiveSize = size;
        // validatedPriority já contém a prioridade correta (do form ou 0)

        if (product_type && PRODUCT_CONFIG[product_type]) {
            const config = PRODUCT_CONFIG[product_type];
            // Define o nome do produto com base no PRODUCT_CONFIG se não foi enviado pelo frontend
            if (!finalProductName) {
                finalProductName = config.name;
            }
            // Define a descrição como o nome do produto se nenhuma descrição foi enviada
            if (!finalProductDescription) {
                finalProductDescription = finalProductName; // Ex: "6 fatias"
            }
            // Define o tamanho com base no PRODUCT_CONFIG se não foi enviado ou é o default 'M'
            if (!req.body.size || req.body.size === 'M') { // Verifica se 'size' foi explicitamente enviado
                effectiveSize = config.size;
            }
            // Se a prioridade veio como 0 (default/Normal) do formulário, usa a do produto.
            // Se o usuário especificou uma prioridade > 0, ela é mantida por `validatedPriority`.
            if (parseInt(priority) === 0) { 
                validatedPriority = config.priority;
            }
        } else {
            // Se não há product_type válido, mas product_name foi enviado, usa-o para descrição se vazia
            if (!finalProductDescription && finalProductName) {
                finalProductDescription = finalProductName;
            }
        }

        // Se após tudo, a descrição ainda for nula/undefined, e não queremos um fallback genérico,
        // ela será salva como null (o banco de dados permite).
        // Se 'finalProductName' é a única info, ele já foi usado como 'finalProductDescription'.
        if (!finalProductDescription && !finalProductName) {
            finalProductDescription = null; // Ou 'Produto genérico' se preferir não ter null
        }


        const db = getDb(req);
        const result = await db.query(
            `INSERT INTO deliveries (
                order_date, order_number, customer_name, customer_phone, address, 
                lat, lng, product_description, product_type, product_name, size, priority, 
                delivery_window_start, delivery_window_end
            ) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING *`, // Retorna todos os campos para consistência
            [
                effectiveDate,
                order_number || null,
                customer_name, 
                customer_phone || '', // Salva string vazia se não fornecido
                coords.formatted_address, 
                coords.lat, 
                coords.lng, 
                finalProductDescription,   // Usa a descrição finalizada
                product_type || null,
                finalProductName,          // Usa o nome do produto finalizado
                effectiveSize, 
                validatedPriority,         // Usa a prioridade validada/ajustada
                delivery_window_start || null, 
                delivery_window_end || null
            ]
        );
        
        const newDelivery = result.rows[0];
        newDelivery.priority_label = getPriorityLabel(newDelivery.priority);
        
        res.status(201).json(newDelivery); // Envia a entrega completa criada

    } catch (error) {
        console.error('Erro ao adicionar entrega:', error);
        res.status(500).json({ error: error.message });
    }
});

// Atualiza uma entrega
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            order_number,
            customer_name, 
            customer_phone, 
            address, 
            product_description: new_product_description, // Descrição vinda do formulário de edição

            product_type: new_product_type,
            product_name: new_product_name_from_request, // Nome que PODE vir do frontend na edição

            priority: new_priority, // Prioridade vinda do formulário de edição

            size: new_size // Tamanho vindo do formulário de edição

        } = req.body;
        
        const db = getDb(req);
        
        const deliveryResult = await db.query('SELECT * FROM deliveries WHERE id = $1', [id]);
        if (deliveryResult.rows.length === 0) {
            return res.status(404).json({ error: 'Entrega não encontrada' });
        }
        const existingDelivery = deliveryResult.rows[0];
        
        let validatedPriority = existingDelivery.priority;
        if (new_priority !== undefined) {
            try {
                validatedPriority = validatePriority(new_priority);
            } catch (error) {
                return res.status(400).json({ error: error.message });
            }
        }
        
        let lat = existingDelivery.lat;
        let lng = existingDelivery.lng;
        let formatted_address = existingDelivery.address;
        
        if (address && address !== existingDelivery.address) {
            try {
                const coords = await googleMaps.geocodeAddress(address);
                lat = coords.lat;
                lng = coords.lng;
                formatted_address = coords.formatted_address;
            } catch (error) {
                return res.status(400).json({ error: 'Não foi possível geocodificar o novo endereço' });
            }
        }

        let finalProductName = new_product_name_from_request || existingDelivery.product_name;
        let finalProductDescription = (new_product_description !== undefined) ? new_product_description : existingDelivery.product_description;
        let finalSize = new_size || existingDelivery.size;

        // Se o tipo de produto mudou, ou se o nome/descrição não foram enviados e o tipo existe

        if (new_product_type && PRODUCT_CONFIG[new_product_type]) {
            const config = PRODUCT_CONFIG[new_product_type];
            // Se o product_type mudou, ou se o nome não foi enviado pelo request, atualiza o nome.

            if (new_product_type !== existingDelivery.product_type || !new_product_name_from_request) {
                finalProductName = config.name;
            }
            // Se a descrição não foi alterada pelo usuário (veio undefined) OU se o usuário apagou (veio ''),

            // E o tipo de produto mudou, OU se a descrição está vazia e o tipo é o mesmo ou novo:

            // Basicamente, se a descrição está vazia ou não foi explicitamente definida na edição, recalcula.

            if (new_product_description === '' || (new_product_description === undefined && new_product_type !== existingDelivery.product_type)) {
                finalProductDescription = finalProductName; // Usa o nome do produto como descrição

            }
             // Se o tamanho não foi alterado pelo usuário (veio undefined) E o tipo mudou

            if (new_size === undefined && new_product_type !== existingDelivery.product_type) {
                finalSize = config.size;
            }
            // Se a prioridade não foi alterada pelo usuário E o tipo mudou

            if (new_priority === undefined && new_product_type !== existingDelivery.product_type) {
                validatedPriority = config.priority;
            }
        } else if (new_product_type) { // Tipo de produto não configurado, mas foi enviado

             if (!finalProductName) finalProductName = new_product_type; // Usa o tipo como nome se nome estiver vazio

             if (finalProductDescription === '') finalProductDescription = finalProductName; // Se descrição apagada, usa nome

        }
        
        // Se o usuário explicitamente apagou a descrição, ela deve ser salva como vazia ou null

        if (new_product_description === '') {
            finalProductDescription = null; // Ou '' dependendo da preferência do banco

        }


        const updateQuery = `UPDATE deliveries SET 
            order_number = $1, customer_name = $2, customer_phone = $3, address = $4, 
            lat = $5, lng = $6, product_description = $7, product_type = $8, 
            product_name = $9, priority = $10, size = $11, updated_at = CURRENT_TIMESTAMP
            WHERE id = $12
            RETURNING *`;
        
        const queryParams = [
            order_number !== undefined ? order_number : existingDelivery.order_number,
            customer_name || existingDelivery.customer_name,
            customer_phone !== undefined ? (customer_phone || '') : existingDelivery.customer_phone,
            formatted_address,
            lat,
            lng,
            finalProductDescription,
            new_product_type || existingDelivery.product_type,
            finalProductName,
            validatedPriority,
            finalSize,
            id
        ];
        
        const result = await db.query(updateQuery, queryParams);
        const updatedDelivery = result.rows[0];
        updatedDelivery.priority_label = getPriorityLabel(updatedDelivery.priority);
        
        res.json(updatedDelivery);
    } catch (error) {
        console.error('Erro ao atualizar entrega:', error);
        res.status(500).json({ error: error.message });
    }
});

// Função auxiliar para verificar se uma coluna existe
async function checkColumnExists(tableName, columnName) {
    try {
        const db = getDb({ app: { get: () => require('./database') } });
        const result = await db.query(`
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = $1 AND column_name = $2
        `, [tableName, columnName]);
        
        return result.rows.length > 0;
    } catch (error) {
        console.error('Erro ao verificar coluna:', error);
        return false;
    }
}

// Otimiza rota com ordem manual e paradas - VERSÃO ATUALIZADA
router.post('/optimize', async (req, res) => {
    try {
        const { date, manualOrder, pickupStops } = req.body;
        const routeDate = date || new Date().toISOString().split('T')[0];
        
        console.log('Recebendo solicitação de otimização:', {
            date: routeDate,
            manualOrder: manualOrder,
            pickupStops: pickupStops
        });
        
        const db = getDb(req);
        
        // Busca configurações
        const settingsResult = await db.query(
            'SELECT * FROM settings WHERE setting_key IN ($1, $2, $3)',
            ['circular_route', 'origin_address', 'stop_time']
        );
        
        const settings = {};
        settingsResult.rows.forEach(row => {
            settings[row.setting_key] = row.setting_value;
        });

        // Adiciona a leitura do tempo de parada
        const stopTimeMinutes = parseInt(settings.stop_time, 10) || 8;
        
        // Busca todas as entregas do dia ordenadas por nova escala de prioridade
        const deliveries = await db.query(
            'SELECT * FROM deliveries WHERE order_date = $1 AND status IN ($2, $3) ORDER BY priority DESC, id ASC',
            [routeDate, 'pending', 'optimized']
        );
        
        if (deliveries.rows.length === 0) {
            return res.json({ message: 'Nenhuma entrega disponível para otimização' });
        }
        
        // Log das prioridades encontradas
        const priorityStats = deliveries.rows.reduce((acc, delivery) => {
            const priority = delivery.priority || 0;
            acc[priority] = (acc[priority] || 0) + 1;
            return acc;
        }, {});
        
        console.log('Distribuição de prioridades:', Object.entries(priorityStats).map(([p, count]) => 
            `${count} ${getPriorityLabel(parseInt(p))}`
        ).join(', '));
        
        // Define se a rota é circular
        const circularRoute = settings.circular_route === 'true';
        
        // Define endereço de origem
        const originAddress = settings.origin_address || CONFEITARIA_ADDRESS.address;
        let depot = {
            ...CONFEITARIA_ADDRESS,
            address: originAddress
        };
        
        if (originAddress !== CONFEITARIA_ADDRESS.address) {
            try {
                const coords = await googleMaps.geocodeAddress(originAddress);
                depot = {
                    address: originAddress,
                    lat: coords.lat,
                    lng: coords.lng
                };
            } catch (error) {
                console.error('Erro ao geocodificar endereço de origem:', error);
            }
        }
        
        // Adiciona paradas na confeitaria se solicitado
        let allStops = [...deliveries.rows];
        
        if (pickupStops && pickupStops.length > 0) {
            console.log('Adicionando paradas na confeitaria:', pickupStops);
            
            pickupStops.forEach(stop => {
                allStops.push({
                    id: stop.id,
                    lat: depot.lat,
                    lng: depot.lng,
                    address: depot.address,
                    type: 'pickup',
                    priority: 0,
                    order: stop.order || 999
                });
            });
        }
        
        // Volta todas as entregas otimizadas para pendente temporariamente
        await db.query(
            'UPDATE deliveries SET status = $1 WHERE order_date = $2 AND status = $3',
            ['pending', routeDate, 'optimized']
        );
        
        // Otimiza a rota usando a nova escala de prioridades e passando o tempo de parada
        const optimizedRoute = await routeOptimization.optimizeRoute(allStops, depot, circularRoute, manualOrder, stopTimeMinutes);
                
        // Prepara dados da rota para salvar
        const routeData = {
            route_date: routeDate,
            total_distance: optimizedRoute.totalDistance,
            total_duration: optimizedRoute.totalDuration,
            optimized_order: JSON.stringify(optimizedRoute.optimizedOrder),
            route_config: JSON.stringify({
                circularRoute: circularRoute,
                originAddress: originAddress,
                manualOrder: manualOrder,
                pickupStops: pickupStops,
                priorityStats: priorityStats,
                optimizedAt: new Date().toISOString(),
                totalDeliveries: deliveries.rows.length,
                totalStops: allStops.length
            }),
            status: 'planned'
        };
        
        let routeId;
        
        // Atualiza ou cria rota
        if (existingRoutes.rows.length > 0) {
            // Atualiza rota existente
            await db.query(
                'UPDATE routes SET total_distance = $1, total_duration = $2, optimized_order = $3, route_config = $4, status = $5 WHERE id = $6',
                [
                    routeData.total_distance, 
                    routeData.total_duration, 
                    routeData.optimized_order, 
                    routeData.route_config,
                    routeData.status,
                    existingRoutes.rows[0].id
                ]
            );
            routeId = existingRoutes.rows[0].id;
            console.log(`Rota existente atualizada (ID: ${routeId}) com configurações completas`);
        } else {
            // Cria nova rota
            const routeResult = await db.query(
                'INSERT INTO routes (route_date, total_distance, total_duration, optimized_order, route_config, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
                [
                    routeData.route_date,
                    routeData.total_distance, 
                    routeData.total_duration, 
                    routeData.optimized_order,
                    routeData.route_config,
                    routeData.status
                ]
            );
            routeId = routeResult.rows[0].id;
            console.log(`Nova rota criada (ID: ${routeId}) com configurações completas`);
        }
        
        // Atualiza status de todas as entregas incluídas para "optimized"
        await db.query(
            'UPDATE deliveries SET status = $1 WHERE order_date = $2 AND status = $3',
            ['optimized', routeDate, 'pending']
        );
        
        console.log(`✅ Rota otimizada salva permanentemente com ${deliveries.rows.length} entregas e ${allStops.length} paradas total`);
        
        res.json({
            routeId: routeId,
            saved: true,
            ...optimizedRoute,
            circularRoute: circularRoute,
            originAddress: originAddress,
            totalDeliveries: deliveries.rows.length,
            totalStops: allStops.length,
            priorityStats: priorityStats
        });
    } catch (error) {
        console.error('Erro na otimização:', error);
        res.status(500).json({ error: error.message });
    }
});

// Inicia rota
router.post('/routes/:id/start', async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDb(req);
        
        await db.query(
            'UPDATE routes SET status = $1 WHERE id = $2',
            ['active', id]
        );
        
        await db.query(
            'UPDATE deliveries SET status = $1 FROM routes WHERE routes.route_date = deliveries.order_date AND routes.id = $2',
            ['in_transit', id]
        );
        
        // Notifica clientes via socket
        const io = req.app.get('socketio');
        io.to(`route-${id}`).emit('route-started', { routeId: id });
        
        res.json({ message: 'Rota iniciada' });
    } catch (error) {
        console.error('Erro ao iniciar rota:', error);
        res.status(500).json({ error: error.message });
    }
});

// Marca entrega como concluída
router.post('/:id/complete', async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDb(req);
        
        await db.query(
            'UPDATE deliveries SET status = $1 WHERE id = $2',
            ['delivered', id]
        );
        
        // Adiciona notificação
        await db.query(
            'INSERT INTO notifications (delivery_id, type, message) VALUES ($1, $2, $3)',
            [id, 'delivered', 'Entrega concluída!']
        );
        
        // Notifica via socket
        const io = req.app.get('socketio');
        io.emit('delivery-completed', { deliveryId: id });
        
        res.json({ message: 'Entrega concluída' });
    } catch (error) {
        console.error('Erro ao completar entrega:', error);
        res.status(500).json({ error: error.message });
    }
});

// NOVO ENDPOINT: Marcar rota como concluída manualmente
router.put('/routes/:id/complete', async (req, res) => {
    const { id } = req.params;
    const db = getDb(req);

    try {
        const routeResult = await db.query(
            'SELECT route_date, status FROM routes WHERE id = $1',
            [id]
        );

        if (routeResult.rows.length === 0) {
            return res.status(404).json({ error: 'Rota não encontrada.' });
        }

        const route = routeResult.rows[0];
        if (route.status === 'completed') {
            return res.status(400).json({ error: 'Rota já está concluída.' });
        }
        if (route.status === 'cancelled') {
            return res.status(400).json({ error: 'Não é possível concluir uma rota cancelada.' });
        }

        await db.transaction(async (client) => {
            // Atualiza o status da rota para 'completed'

            await client.query(
                'UPDATE routes SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                ['completed', id]
            );

            // Atualiza o status das entregas associadas para 'delivered'

            // Apenas aquelas que estão pendentes, otimizadas ou em trânsito

            const deliveryUpdateResult = await client.query(
                `UPDATE deliveries 
                 SET status = 'delivered', updated_at = CURRENT_TIMESTAMP 
                 WHERE order_date = $1 AND status IN ('pending', 'optimized', 'in_transit')`,
                [route.route_date]
            );
            console.log(`Entregas atualizadas para 'delivered' para rota ${id} (data ${route.route_date}): ${deliveryUpdateResult.rowCount}`);
        });

        const io = req.app.get('socketio');
        if (io) {
            io.emit('route-updated', { routeId: id, status: 'completed' });
        }

        res.json({ message: `Rota ${id} marcada como concluída com sucesso.` });

    } catch (error) {
        console.error(`Erro ao concluir rota ${id}:`, error);
        res.status(500).json({ error: 'Erro interno ao tentar concluir a rota.' });
    }
});

// Deleta uma entrega
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDb(req);
        
        // Verifica se a entrega existe
        const delivery = await db.query(
            'SELECT status FROM deliveries WHERE id = $1',
            [id]
        );
        
        if (delivery.rows.length === 0) {
            return res.status(404).json({ error: 'Entrega não encontrada' });
        }
        
        // Usar transação para deletar em ordem correta
        await db.transaction(async (client) => {
            // Deleta primeiro as notificações relacionadas
            await client.query(
                'DELETE FROM notifications WHERE delivery_id = $1',
                [id]
            );
            
            // Deleta os registros de rastreamento relacionados
            await client.query(
                'DELETE FROM tracking WHERE delivery_id = $1',
                [id]
            );
            
            // Agora deleta a entrega
            await client.query(
                'DELETE FROM deliveries WHERE id = $1',
                [id]
            );
        });
        
        res.json({ message: 'Entrega excluída com sucesso' });
    } catch (error) {
        console.error('Erro ao deletar entrega:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para obter estatísticas de prioridades
router.get('/priority-stats/:date?', async (req, res) => {
    try {
        const { date } = req.params;
        const db = getDb(req);
        
        let query = `
            SELECT 
                priority,
                COUNT(*) as count,
                CASE 
                    WHEN priority = 0 THEN 'Normal'
                    WHEN priority = 1 THEN 'Média'
                    WHEN priority = 2 THEN 'Alta'
                    WHEN priority = 3 THEN 'Urgente'
                    ELSE 'Desconhecida'
                END as label
            FROM deliveries
        `;
        
        let params = [];
        
        if (date) {
            query += ' WHERE order_date = $1';
            params.push(date);
        } else {
            query += ' WHERE order_date = CURRENT_DATE';
        }
        
        query += ' GROUP BY priority ORDER BY priority DESC';
        
        const result = await db.query(query, params);
        
        res.json({
            date: date || new Date().toISOString().split('T')[0],
            statistics: result.rows,
            total: result.rows.reduce((sum, row) => sum + parseInt(row.count), 0)
        });
    } catch (error) {
        console.error('Erro ao buscar estatísticas de prioridade:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
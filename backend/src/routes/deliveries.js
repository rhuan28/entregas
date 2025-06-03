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
        
        let whereClause = includeArchived === 'true' ? '' : 'WHERE r.archived = false OR r.archived IS NULL';
        
        const query = `
            SELECT 
                r.id,
                r.route_date,
                r.status,
                r.total_distance,
                r.total_duration,
                r.archived,
                r.archived_at,
                COUNT(DISTINCT d.id) as delivery_count,
                COUNT(DISTINCT CASE WHEN d.status = 'delivered' THEN d.id END) as delivered_count
            FROM routes r 
            LEFT JOIN deliveries d ON r.route_date = d.order_date 
            ${whereClause}
            GROUP BY r.id, r.route_date, r.status, r.total_distance, r.total_duration, r.archived, r.archived_at
            ORDER BY r.route_date DESC
            LIMIT 30
        `;
        
        const result = await db.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error('Erro ao buscar rotas:', error);
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
            product_description,
            product_type,
            product_name,
            size = 'M',
            priority = 0,
            delivery_window_start = null,
            delivery_window_end = null,
            order_date 
        } = req.body;
        
        // Verifica se os campos obrigatórios estão presentes
        if (!customer_name || !address) {
            return res.status(400).json({ 
                error: 'Campos obrigatórios faltando', 
                required: ['customer_name', 'address'] 
            });
        }
        
        // Valida prioridade
        let validatedPriority;
        try {
            validatedPriority = validatePriority(priority);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
        
        // Data padrão é hoje se não for fornecida
        const effectiveDate = order_date || new Date().toISOString().split('T')[0];
        
        console.log('Tentando geocodificar endereço:', address);
        
        // Geocodifica o endereço
        let coords;
        try {
            coords = await googleMaps.geocodeAddress(address);
            console.log('Coordenadas obtidas:', coords);
        } catch (geocodeError) {
            console.error('Erro ao geocodificar:', geocodeError);
            return res.status(400).json({ 
                error: 'Não foi possível encontrar o endereço fornecido',
                details: geocodeError.message
            });
        }
        
        // Determina configurações baseadas no tipo de produto
        let effectiveSize = size;
        let effectivePriority = validatedPriority;
        let effectiveDescription = product_description;
        
        if (product_type && PRODUCT_CONFIG[product_type]) {
            const config = PRODUCT_CONFIG[product_type];
            
            // Atualiza tamanho se não foi especificado
            if (!size || size === 'M') {
                effectiveSize = config.size;
            }
            
            // Atualiza prioridade se está no valor padrão (0) - só aplica prioridade do produto se não foi definida manualmente
            if (priority === 0) {
                effectivePriority = config.priority;
            }
            
            // Se não foi fornecida descrição, usa a padrão do produto
            if (!effectiveDescription) {
                effectiveDescription = `${config.name} - Produto da confeitaria`;
            }
            
            console.log(`Produto ${product_type}: prioridade ${effectivePriority} (${getPriorityLabel(effectivePriority)})`);
        }
        
        // Se ainda não tem descrição, usa uma padrão
        if (!effectiveDescription) {
            effectiveDescription = product_name || 'Produto da confeitaria';
        }
        
        console.log(`Inserindo entrega no banco de dados com prioridade ${effectivePriority} (${getPriorityLabel(effectivePriority)})...`);
        
        const db = getDb(req);
        const result = await db.query(
            `INSERT INTO deliveries (
                order_date, order_number, customer_name, customer_phone, address, 
                lat, lng, product_description, product_type, product_name, size, priority, 
                delivery_window_start, delivery_window_end
            ) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING id`,
            [
                effectiveDate,
                order_number || null,
                customer_name, 
                customer_phone || '',
                coords.formatted_address, 
                coords.lat, 
                coords.lng, 
                effectiveDescription,
                product_type || null,
                product_name || null,
                effectiveSize || 'M', 
                effectivePriority, 
                delivery_window_start || null, 
                delivery_window_end || null
            ]
        );
        
        console.log('Entrega adicionada com sucesso, ID:', result.rows[0].id);
        
        res.status(201).json({ 
            id: result.rows[0].id, 
            order_date: effectiveDate,
            ...req.body, 
            ...coords,
            size: effectiveSize,
            priority: effectivePriority,
            priority_label: getPriorityLabel(effectivePriority),
            product_description: effectiveDescription,
            message: 'Entrega adicionada com sucesso' 
        });
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
            product_description,
            product_type,
            product_name,
            priority 
        } = req.body;
        
        const db = getDb(req);
        
        // Verifica se a entrega existe
        const delivery = await db.query(
            'SELECT * FROM deliveries WHERE id = $1',
            [id]
        );
        
        if (delivery.rows.length === 0) {
            return res.status(404).json({ error: 'Entrega não encontrada' });
        }
        
        const existingDelivery = delivery.rows[0];
        
        // Valida prioridade se fornecida
        let validatedPriority = existingDelivery.priority;
        if (priority !== undefined) {
            try {
                validatedPriority = validatePriority(priority);
            } catch (error) {
                return res.status(400).json({ error: error.message });
            }
        }
        
        // Se o endereço foi alterado, precisamos geocodificar novamente
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
                console.error('Erro ao geocodificar endereço:', error);
                return res.status(400).json({ error: 'Não foi possível geocodificar o endereço fornecido' });
            }
        }
        
        // Determina configurações baseadas no tipo de produto
        let effectivePriority = validatedPriority;
        let effectiveDescription = product_description || existingDelivery.product_description;
        
        if (product_type && PRODUCT_CONFIG[product_type]) {
            const config = PRODUCT_CONFIG[product_type];
            
            // Se a prioridade não foi definida explicitamente, usa a do produto
            if (priority === undefined) {
                effectivePriority = config.priority;
            }
            
            // Se não foi fornecida descrição, atualiza com base no produto
            if (!product_description) {
                effectiveDescription = `${config.name} - Produto da confeitaria`;
            }
            
            console.log(`Atualizando produto ${product_type}: prioridade ${effectivePriority} (${getPriorityLabel(effectivePriority)})`);
        }
        
        // Atualiza a entrega
        const result = await db.query(
            `UPDATE deliveries SET 
                order_number = $1,
                customer_name = $2, 
                customer_phone = $3, 
                address = $4, 
                lat = $5, 
                lng = $6, 
                product_description = $7,
                product_type = $8,
                product_name = $9,
                priority = $10,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $11
            RETURNING *`,
            [
                order_number || existingDelivery.order_number,
                customer_name || existingDelivery.customer_name,
                customer_phone || existingDelivery.customer_phone,
                formatted_address,
                lat,
                lng,
                effectiveDescription,
                product_type || existingDelivery.product_type,
                product_name || existingDelivery.product_name,
                effectivePriority,
                id
            ]
        );
        
        // Adiciona label de prioridade na resposta
        const updatedDelivery = result.rows[0];
        updatedDelivery.priority_label = getPriorityLabel(updatedDelivery.priority);
        
        res.json(updatedDelivery);
    } catch (error) {
        console.error('Erro ao atualizar entrega:', error);
        res.status(500).json({ error: error.message });
    }
});

// Otimiza rota com ordem manual e paradas
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
        
        // Verifica se já existe uma rota para esta data
        const existingRoutes = await db.query(
            'SELECT id FROM routes WHERE route_date = $1',
            [routeDate]
        );
        
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
        
        // Otimiza a rota usando a nova escala de prioridades
        const optimizedRoute = await routeOptimization.optimizeRoute(allStops, depot, circularRoute, manualOrder);
        
        let routeId;
        
        // Atualiza ou cria rota
        if (existingRoutes.rows.length > 0) {
            // Atualiza rota existente
            await db.query(
                'UPDATE routes SET total_distance = $1, total_duration = $2, optimized_order = $3, status = $4 WHERE id = $5',
                [optimizedRoute.totalDistance, optimizedRoute.totalDuration, JSON.stringify(optimizedRoute.optimizedOrder), 'planned', existingRoutes.rows[0].id]
            );
            routeId = existingRoutes.rows[0].id;
        } else {
            // Cria nova rota
            const routeResult = await db.query(
                'INSERT INTO routes (route_date, total_distance, total_duration, optimized_order) VALUES ($1, $2, $3, $4) RETURNING id',
                [routeDate, optimizedRoute.totalDistance, optimizedRoute.totalDuration, JSON.stringify(optimizedRoute.optimizedOrder)]
            );
            routeId = routeResult.rows[0].id;
        }
        
        // Atualiza status de todas as entregas incluídas para "optimized"
        await db.query(
            'UPDATE deliveries SET status = $1 WHERE order_date = $2 AND status = $3',
            ['optimized', routeDate, 'pending']
        );
        
        console.log(`Rota otimizada criada com ${deliveries.rows.length} entregas e ${allStops.length} paradas total`);
        
        res.json({
            routeId: routeId,
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
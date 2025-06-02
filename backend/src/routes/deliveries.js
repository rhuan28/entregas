// routes/deliveries.js - Versão atualizada para PostgreSQL
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
        
        query += ' ORDER BY priority DESC';
        
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

// Adiciona nova entrega
router.post('/', async (req, res) => {
    try {
        const { 
            customer_name, 
            customer_phone, 
            address, 
            product_description, 
            size = 'M',
            priority = 0,
            delivery_window_start = null,
            delivery_window_end = null,
            order_date 
        } = req.body;
        
        // Verifica se os campos obrigatórios estão presentes
        if (!customer_name || !address || !product_description) {
            return res.status(400).json({ 
                error: 'Campos obrigatórios faltando', 
                required: ['customer_name', 'address', 'product_description'] 
            });
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
        
        console.log('Inserindo entrega no banco de dados...');
        
        const db = getDb(req);
        const result = await db.query(
            `INSERT INTO deliveries (
                order_date, customer_name, customer_phone, address, 
                lat, lng, product_description, size, priority, 
                delivery_window_start, delivery_window_end
            ) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING id`,
            [
                effectiveDate,
                customer_name, 
                customer_phone || '',
                coords.formatted_address, 
                coords.lat, 
                coords.lng, 
                product_description, 
                size || 'M', 
                priority || 0, 
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
            message: 'Entrega adicionada com sucesso' 
        });
    } catch (error) {
        console.error('Erro ao adicionar entrega:', error);
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
        
        // Busca todas as entregas do dia
        const deliveries = await db.query(
            'SELECT * FROM deliveries WHERE order_date = $1 AND status IN ($2, $3) ORDER BY priority DESC, id ASC',
            [routeDate, 'pending', 'optimized']
        );
        
        if (deliveries.rows.length === 0) {
            return res.json({ message: 'Nenhuma entrega disponível para otimização' });
        }
        
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
        
        // Otimiza a rota
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
        
        res.json({
            routeId: routeId,
            ...optimizedRoute,
            circularRoute: circularRoute,
            originAddress: originAddress,
            totalDeliveries: deliveries.rows.length,
            totalStops: allStops.length
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

// Atualiza uma entrega
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            customer_name, 
            customer_phone, 
            address, 
            product_description, 
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
        
        // Atualiza a entrega
        const result = await db.query(
            `UPDATE deliveries SET 
                customer_name = $1, 
                customer_phone = $2, 
                address = $3, 
                lat = $4, 
                lng = $5, 
                product_description = $6, 
                priority = $7,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $8
            RETURNING *`,
            [
                customer_name || existingDelivery.customer_name,
                customer_phone || existingDelivery.customer_phone,
                formatted_address,
                lat,
                lng,
                product_description || existingDelivery.product_description,
                priority !== undefined ? priority : existingDelivery.priority,
                id
            ]
        );
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao atualizar entrega:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
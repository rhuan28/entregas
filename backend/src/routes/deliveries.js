// routes/deliveries.js - Versão atualizada
const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const googleMaps = require('../services/googleMaps');
const routeOptimization = require('../services/routeOptimization');

// Pool de conexões MySQL
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'confeitaria_entregas',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

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
        let query = 'SELECT * FROM deliveries';
        let params = [];
        
        if (date) {
            query += ' WHERE order_date = ?';
            params.push(date);
        } else {
            query += ' WHERE order_date = CURDATE()';
        }
        
        query += ' ORDER BY priority DESC';
        
        const [rows] = await pool.execute(query, params);
        res.json(rows);
    } catch (error) {
        console.error('Erro ao buscar entregas:', error);
        res.status(500).json({ error: error.message });
    }
});

// Lista rotas por data ou todas - ENDPOINT CORRIGIDO
router.get('/routes', async (req, res) => {
    try {
        const query = `
            SELECT 
                r.id,
                r.route_date,
                r.status,
                r.total_distance,
                r.total_duration,
                COUNT(DISTINCT d.id) as delivery_count,
                COUNT(DISTINCT CASE WHEN d.status = 'delivered' THEN d.id END) as delivered_count
            FROM routes r 
            LEFT JOIN deliveries d ON r.route_date = d.order_date 
            GROUP BY r.id 
            ORDER BY r.route_date DESC
            LIMIT 30
        `;
        
        const [rows] = await pool.execute(query);
        res.json(rows);
    } catch (error) {
        console.error('Erro ao buscar rotas:', error);
        res.status(500).json({ error: error.message });
    }
});

// Limpa todas as entregas de uma data
router.delete('/clear/:date', async (req, res) => {
    try {
        const { date } = req.params;
        
        // Primeiro deleta notificações e rastreamento
        await pool.execute(
            'DELETE n FROM notifications n JOIN deliveries d ON n.delivery_id = d.id WHERE d.order_date = ?',
            [date]
        );
        
        await pool.execute(
            'DELETE t FROM tracking t JOIN deliveries d ON t.delivery_id = d.id WHERE d.order_date = ?',
            [date]
        );
        
        // Deleta as entregas
        await pool.execute(
            'DELETE FROM deliveries WHERE order_date = ?',
            [date]
        );
        
        // Cancela rotas do dia
        await pool.execute(
            'UPDATE routes SET status = "cancelled" WHERE route_date = ?',
            [date]
        );
        
        res.json({ message: 'Todas as entregas foram removidas' });
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
            size, 
            priority, 
            delivery_window_start, 
            delivery_window_end,
            order_date 
        } = req.body;
        
        // Geocodifica o endereço
        const coords = await googleMaps.geocodeAddress(address);
        
        const [result] = await pool.execute(
            `INSERT INTO deliveries (
                order_date, customer_name, customer_phone, address, 
                lat, lng, product_description, size, priority, 
                delivery_window_start, delivery_window_end
            ) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                order_date || new Date().toISOString().split('T')[0],
                customer_name, 
                customer_phone, 
                coords.formatted_address, 
                coords.lat, 
                coords.lng, 
                product_description, 
                size, 
                priority, 
                delivery_window_start, 
                delivery_window_end
            ]
        );
        
        res.json({ id: result.insertId, ...req.body, ...coords });
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
        
        // Busca configurações
        const [settingsRows] = await pool.execute(
            'SELECT * FROM settings WHERE setting_key IN ("circular_route", "origin_address", "stop_time")'
        );
        
        const settings = {};
        settingsRows.forEach(row => {
            settings[row.setting_key] = row.setting_value;
        });
        
        // Cancela rotas anteriores não finalizadas
        await pool.execute(
            'UPDATE routes SET status = "cancelled" WHERE route_date = ? AND status IN ("planned", "active")',
            [routeDate]
        );
        
        // Busca todas as entregas do dia
        const [deliveries] = await pool.execute(
            'SELECT * FROM deliveries WHERE order_date = ? AND status IN ("pending", "optimized") ORDER BY priority DESC, id ASC',
            [routeDate]
        );
        
        if (deliveries.length === 0) {
            return res.json({ message: 'Nenhuma entrega disponível para otimização' });
        }
        
        // Aplica ordem manual se existir, mas mantém prioridade como critério principal
        if (manualOrder && Object.keys(manualOrder).length > 0) {
            deliveries.sort((a, b) => {
                // Primeiro ordena por prioridade (maior primeiro)
                if (a.priority !== b.priority) {
                    return b.priority - a.priority;
                }
                // Depois por ordem manual se existir
                const orderA = manualOrder[a.id] || 999;
                const orderB = manualOrder[b.id] || 999;
                return orderA - orderB;
            });
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
        let allStops = [...deliveries];
        if (pickupStops && pickupStops.length > 0) {
            pickupStops.forEach(stop => {
                allStops.push({
                    id: `pickup_${Date.now()}_${Math.random()}`,
                    lat: depot.lat,
                    lng: depot.lng,
                    address: depot.address,
                    type: 'pickup',
                    priority: 0,
                    order: stop.order
                });
            });
            
            // Reordena incluindo as paradas
            allStops.sort((a, b) => {
                // Prioridade primeiro
                const prioA = a.priority || 0;
                const prioB = b.priority || 0;
                if (prioA !== prioB) {
                    return prioB - prioA;
                }
                
                // Depois ordem manual
                const orderA = a.type === 'pickup' ? a.order : (manualOrder[a.id] || 999);
                const orderB = b.type === 'pickup' ? b.order : (manualOrder[b.id] || 999);
                return orderA - orderB;
            });
        }
        
        // Volta todas as entregas otimizadas para pendente temporariamente
        await pool.execute(
            'UPDATE deliveries SET status = "pending" WHERE order_date = ? AND status = "optimized"',
            [routeDate]
        );
        
        // Otimiza a rota
        const optimizedRoute = await routeOptimization.optimizeRoute(allStops, depot, circularRoute, manualOrder);
        
        // Salva nova rota otimizada
        const [routeResult] = await pool.execute(
            'INSERT INTO routes (route_date, total_distance, total_duration, optimized_order) VALUES (?, ?, ?, ?)',
            [routeDate, optimizedRoute.totalDistance, optimizedRoute.totalDuration, JSON.stringify(optimizedRoute.optimizedOrder)]
        );
        
        // Atualiza status de todas as entregas incluídas para "optimized"
        await pool.execute(
            'UPDATE deliveries SET status = "optimized" WHERE order_date = ? AND status = "pending"',
            [routeDate]
        );
        
        res.json({
            routeId: routeResult.insertId,
            ...optimizedRoute,
            circularRoute: circularRoute,
            originAddress: originAddress,
            totalDeliveries: deliveries.length,
            totalStops: allStops.length
        });
    } catch (error) {
        console.error('Erro na otimização:', error);
        res.status(500).json({ error: error.message });
    }
});

// Demais rotas permanecem iguais...
// Inicia rota
router.post('/routes/:id/start', async (req, res) => {
    try {
        const { id } = req.params;
        
        await pool.execute(
            'UPDATE routes SET status = "active" WHERE id = ?',
            [id]
        );
        
        await pool.execute(
            'UPDATE deliveries d JOIN routes r ON r.route_date = d.order_date SET d.status = "in_transit" WHERE r.id = ?',
            [id]
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
        
        await pool.execute(
            'UPDATE deliveries SET status = "delivered" WHERE id = ?',
            [id]
        );
        
        // Adiciona notificação
        await pool.execute(
            'INSERT INTO notifications (delivery_id, type, message) VALUES (?, "delivered", "Entrega concluída!")',
            [id]
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

// Adição da rota PUT para atualizar uma entrega
// Adicionar ao arquivo deliveries.js (routes/deliveries.js)

// Atualiza uma entrega existente
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            customer_name, 
            customer_phone, 
            address, 
            product_description, 
            size, 
            priority 
        } = req.body;
        
        // Verifica se o endereço mudou, se sim, precisamos geocodificar novamente
        let geocoded = {};
        let addressChanged = false;
        
        // Busca o endereço atual para comparação
        const [currentDelivery] = await pool.execute(
            'SELECT address FROM deliveries WHERE id = ?',
            [id]
        );
        
        if (currentDelivery.length === 0) {
            return res.status(404).json({ error: 'Entrega não encontrada' });
        }
        
        // Verifica se o endereço foi alterado
        if (currentDelivery[0].address !== address) {
            // Geocodifica o novo endereço
            try {
                geocoded = await googleMaps.geocodeAddress(address);
                addressChanged = true;
            } catch (error) {
                return res.status(400).json({ error: 'Erro ao geocodificar endereço: ' + error.message });
            }
        }
        
        // Constrói a query dinâmica com base em se o endereço mudou ou não
        let query, params;
        
        if (addressChanged) {
            query = `
                UPDATE deliveries 
                SET customer_name = ?, 
                    customer_phone = ?, 
                    address = ?, 
                    lat = ?, 
                    lng = ?, 
                    product_description = ?, 
                    size = ?, 
                    priority = ?, 
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `;
            params = [
                customer_name,
                customer_phone,
                geocoded.formatted_address,
                geocoded.lat,
                geocoded.lng,
                product_description,
                size,
                priority,
                id
            ];
        } else {
            query = `
                UPDATE deliveries 
                SET customer_name = ?, 
                    customer_phone = ?, 
                    product_description = ?, 
                    size = ?, 
                    priority = ?, 
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `;
            params = [
                customer_name,
                customer_phone,
                product_description,
                size,
                priority,
                id
            ];
        }
        
        // Executa a atualização
        await pool.execute(query, params);
        
        // Pesquisa a entrega atualizada para retornar
        const [updated] = await pool.execute(
            'SELECT * FROM deliveries WHERE id = ?',
            [id]
        );
        
        res.json({ 
            message: 'Entrega atualizada com sucesso', 
            delivery: updated[0] 
        });
        
    } catch (error) {
        console.error('Erro ao atualizar entrega:', error);
        res.status(500).json({ error: error.message });
    }
});

// Deleta uma entrega
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Verifica se a entrega existe
        const [delivery] = await pool.execute(
            'SELECT status FROM deliveries WHERE id = ?',
            [id]
        );
        
        if (delivery.length === 0) {
            return res.status(404).json({ error: 'Entrega não encontrada' });
        }
        
        // Deleta primeiro as notificações relacionadas
        await pool.execute(
            'DELETE FROM notifications WHERE delivery_id = ?',
            [id]
        );
        
        // Deleta os registros de rastreamento relacionados
        await pool.execute(
            'DELETE FROM tracking WHERE delivery_id = ?',
            [id]
        );
        
        // Agora deleta a entrega
        await pool.execute(
            'DELETE FROM deliveries WHERE id = ?',
            [id]
        );
        
        res.json({ message: 'Entrega excluída com sucesso' });
    } catch (error) {
        console.error('Erro ao deletar entrega:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
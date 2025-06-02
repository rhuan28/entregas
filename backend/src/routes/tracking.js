// routes/tracking.js - Atualizado para PostgreSQL
const express = require('express');
const router = express.Router();

// Obtém a instância do banco de dados a partir do app
function getDb(req) {
    return req.app.get('db');
}

// Obtém informações de rastreamento de uma entrega
router.get('/delivery/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDb(req);
        
        // Busca informações da entrega
        const deliveryResult = await db.query(
            'SELECT * FROM deliveries WHERE id = $1',
            [id]
        );
        
        if (deliveryResult.rows.length === 0) {
            return res.status(404).json({ error: 'Entrega não encontrada' });
        }
        
        const delivery = deliveryResult.rows[0];
        
        // Busca rota ativa
        const routeResult = await db.query(
            'SELECT * FROM routes WHERE route_date = $1 AND status = $2',
            [delivery.order_date, 'active']
        );
        
        // Busca última localização
        const lastLocationResult = await db.query(
            'SELECT * FROM tracking WHERE delivery_id = $1 ORDER BY timestamp DESC LIMIT 1',
            [id]
        );
        
        res.json({
            delivery: delivery,
            route: routeResult.rows[0] || null,
            lastLocation: lastLocationResult.rows[0] || null
        });
    } catch (error) {
        console.error('Erro ao buscar rastreamento:', error);
        res.status(500).json({ error: error.message });
    }
});

// Salva nova posição
router.post('/location', async (req, res) => {
    try {
        const { routeId, deliveryId, lat, lng } = req.body;
        const db = getDb(req);
        
        await db.query(
            'INSERT INTO tracking (route_id, delivery_id, lat, lng) VALUES ($1, $2, $3, $4)',
            [routeId, deliveryId, lat, lng]
        );
        
        // Verifica se está próximo do destino (100 metros)
        const deliveryResult = await db.query(
            'SELECT lat, lng FROM deliveries WHERE id = $1',
            [deliveryId]
        );
        
        if (deliveryResult.rows.length > 0) {
            const delivery = deliveryResult.rows[0];
            const distance = calculateDistance(lat, lng, delivery.lat, delivery.lng);
            
            if (distance < 0.1) { // 100 metros
                // Adiciona notificação de aproximação
                await db.query(
                    'INSERT INTO notifications (delivery_id, type, message) VALUES ($1, $2, $3)',
                    [deliveryId, 'approaching', 'Entregador chegando!']
                );
                
                // Notifica via socket
                const io = req.app.get('socketio');
                io.emit('delivery-approaching', { deliveryId });
            }
        }
        
        res.json({ message: 'Localização atualizada' });
    } catch (error) {
        console.error('Erro ao salvar localização:', error);
        res.status(500).json({ error: error.message });
    }
});

// Obtém rota ativa
router.get('/route/active', async (req, res) => {
    try {
        const db = getDb(req);
        
        const routeResult = await db.query(
            'SELECT * FROM routes WHERE route_date = CURRENT_DATE AND status = $1 LIMIT 1',
            ['active']
        );
        
        if (routeResult.rows.length === 0) {
            return res.json({ active: false });
        }
        
        const route = routeResult.rows[0];
        
        // Busca entregas da rota
        const deliveriesResult = await db.query(
            'SELECT * FROM deliveries WHERE order_date = CURRENT_DATE AND status IN ($1, $2) ORDER BY id',
            ['in_transit', 'delivered']
        );
        
        res.json({
            active: true,
            route: route,
            deliveries: deliveriesResult.rows
        });
    } catch (error) {
        console.error('Erro ao buscar rota ativa:', error);
        res.status(500).json({ error: error.message });
    }
});

// Calcula distância entre dois pontos (em km)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Raio da Terra em km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function toRad(deg) {
    return deg * (Math.PI/180);
}

module.exports = router;
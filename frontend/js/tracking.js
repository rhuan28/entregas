// routes/tracking.js
const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
};

// Obtém informações de rastreamento de uma entrega
router.get('/delivery/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const conn = await mysql.createConnection(dbConfig);
        
        // Busca informações da entrega
        const [delivery] = await conn.execute(
            'SELECT * FROM deliveries WHERE id = ?',
            [id]
        );
        
        if (delivery.length === 0) {
            return res.status(404).json({ error: 'Entrega não encontrada' });
        }
        
        // Busca rota ativa
        const [route] = await conn.execute(
            'SELECT * FROM routes WHERE route_date = ? AND status = "active"',
            [delivery[0].order_date]
        );
        
        // Busca última localização
        const [lastLocation] = await conn.execute(
            'SELECT * FROM tracking WHERE delivery_id = ? ORDER BY timestamp DESC LIMIT 1',
            [id]
        );
        
        await conn.end();
        
        res.json({
            delivery: delivery[0],
            route: route[0] || null,
            lastLocation: lastLocation[0] || null
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Salva nova posição
router.post('/location', async (req, res) => {
    try {
        const { routeId, deliveryId, lat, lng } = req.body;
        const conn = await mysql.createConnection(dbConfig);
        
        await conn.execute(
            'INSERT INTO tracking (route_id, delivery_id, lat, lng) VALUES (?, ?, ?, ?)',
            [routeId, deliveryId, lat, lng]
        );
        
        // Verifica se está próximo do destino (100 metros)
        const [delivery] = await conn.execute(
            'SELECT lat, lng FROM deliveries WHERE id = ?',
            [deliveryId]
        );
        
        if (delivery.length > 0) {
            const distance = calculateDistance(lat, lng, delivery[0].lat, delivery[0].lng);
            
            if (distance < 0.1) { // 100 metros
                // Adiciona notificação de aproximação
                await conn.execute(
                    'INSERT INTO notifications (delivery_id, type, message) VALUES (?, "approaching", "Entregador chegando!")',
                    [deliveryId]
                );
                
                // Notifica via socket
                const io = req.app.get('socketio');
                io.emit('delivery-approaching', { deliveryId });
            }
        }
        
        await conn.end();
        res.json({ message: 'Localização atualizada' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obtém rota ativa
router.get('/route/active', async (req, res) => {
    try {
        const conn = await mysql.createConnection(dbConfig);
        
        const [route] = await conn.execute(
            'SELECT * FROM routes WHERE route_date = CURDATE() AND status = "active" LIMIT 1'
        );
        
        if (route.length === 0) {
            return res.json({ active: false });
        }
        
        // Busca entregas da rota
        const [deliveries] = await conn.execute(
            'SELECT * FROM deliveries WHERE order_date = CURDATE() AND status IN ("in_transit", "delivered") ORDER BY id'
        );
        
        await conn.end();
        
        res.json({
            active: true,
            route: route[0],
            deliveries: deliveries
        });
    } catch (error) {
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
// routes/archive.js - Versão atualizada para PostgreSQL
const express = require('express');
const router = express.Router();

// Obtém a instância do banco de dados a partir do app
function getDb(req) {
    return req.app.get('db');
}

/**
 * Lista rotas arquivadas com paginação
 * GET /api/archive/routes
 */
router.get('/routes', async (req, res) => {
    try {
        const { page = 1, limit = 20, search } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const offset = (pageNum - 1) * limitNum;
        
        console.log(`Buscando rotas arquivadas - Página: ${pageNum}, Limit: ${limitNum}, Offset: ${offset}`);
        
        const db = getDb(req);
        
        // Query base para rotas arquivadas
        let baseQuery = `
            SELECT 
                r.id,
                r.route_date,
                r.status,
                r.total_distance,
                r.total_duration,
                r.archived_at
            FROM routes r 
            WHERE r.archived = true
        `;
        
        let params = [];
        let paramIndex = 1;
        
        // Filtro de busca por data ou mês
        if (search && search.trim()) {
            const searchTerm = search.trim();
            // Se tem 7 caracteres, é busca por mês (YYYY-MM)
            if (searchTerm.length === 7 && searchTerm.includes('-')) {
                baseQuery += ` AND TO_CHAR(r.route_date, 'YYYY-MM') = $${paramIndex}`;
                params.push(searchTerm);
                paramIndex++;
            } 
            // Se tem 10 caracteres, é busca por data específica (YYYY-MM-DD)
            else if (searchTerm.length === 10 && searchTerm.includes('-')) {
                baseQuery += ` AND r.route_date = $${paramIndex}`;
                params.push(searchTerm);
                paramIndex++;
            } 
            // Busca geral por parte da data
            else {
                baseQuery += ` AND r.route_date::text LIKE $${paramIndex}`;
                params.push(`%${searchTerm}%`);
                paramIndex++;
            }
        }
        
        baseQuery += ' ORDER BY r.archived_at DESC';
        
        console.log('Query base:', baseQuery);
        console.log('Parâmetros base:', params);
        
        // Executa query para contar total
        const countQuery = baseQuery.replace('SELECT r.id, r.route_date, r.status, r.total_distance, r.total_duration, r.archived_at', 'SELECT COUNT(*)');
        const countResult = await db.query(countQuery, params);
        const total = parseInt(countResult.rows[0].count);
        
        // Aplica paginação
        const paginatedQuery = baseQuery + ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limitNum, offset);
        
        const routesResult = await db.query(paginatedQuery, params);
        
        // Para cada rota, busca as entregas separadamente
        const routesWithDeliveries = [];
        for (const route of routesResult.rows) {
            try {
                const deliveriesResult = await db.query(
                    'SELECT COUNT(*) as delivery_count, SUM(CASE WHEN status = $1 THEN 1 ELSE 0 END) as delivered_count FROM deliveries WHERE order_date = $2',
                    ['delivered', route.route_date]
                );
                
                routesWithDeliveries.push({
                    ...route,
                    delivery_count: parseInt(deliveriesResult.rows[0].delivery_count) || 0,
                    delivered_count: parseInt(deliveriesResult.rows[0].delivered_count) || 0
                });
            } catch (deliveryError) {
                console.error('Erro ao buscar entregas para rota:', route.id, deliveryError);
                routesWithDeliveries.push({
                    ...route,
                    delivery_count: 0,
                    delivered_count: 0
                });
            }
        }
        
        console.log(`Retornando ${routesWithDeliveries.length} rotas de ${total} total`);
        
        res.json({
            routes: routesWithDeliveries,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        console.error('Erro ao buscar rotas arquivadas:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Arquiva uma rota específica (manual - sem restrição de data)
 * POST /api/archive/routes/:id
 */
router.post('/routes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDb(req);
        
        // Verifica se a rota existe e não está arquivada
        const routeResult = await db.query(
            'SELECT id, status, archived FROM routes WHERE id = $1',
            [id]
        );
        
        if (routeResult.rows.length === 0) {
            return res.status(404).json({ error: 'Rota não encontrada' });
        }
        
        const route = routeResult.rows[0];
        
        if (route.archived) {
            return res.status(400).json({ error: 'Rota já está arquivada' });
        }
        
        // Arquiva a rota
        await db.query(
            'UPDATE routes SET archived = true, archived_at = CURRENT_TIMESTAMP WHERE id = $1',
            [id]
        );
        
        res.json({ 
            message: 'Rota arquivada com sucesso',
            routeId: id,
            archivedAt: new Date()
        });
    } catch (error) {
        console.error('Erro ao arquivar rota:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Desarquiva uma rota
 * DELETE /api/archive/routes/:id
 */
router.delete('/routes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDb(req);
        
        // Verifica se a rota existe e está arquivada
        const routeResult = await db.query(
            'SELECT id, archived FROM routes WHERE id = $1',
            [id]
        );
        
        if (routeResult.rows.length === 0) {
            return res.status(404).json({ error: 'Rota não encontrada' });
        }
        
        const route = routeResult.rows[0];
        
        if (!route.archived) {
            return res.status(400).json({ error: 'Rota não está arquivada' });
        }
        
        // Desarquiva a rota
        await db.query(
            'UPDATE routes SET archived = false, archived_at = NULL WHERE id = $1',
            [id]
        );
        
        res.json({ 
            message: 'Rota desarquivada com sucesso',
            routeId: id
        });
    } catch (error) {
        console.error('Erro ao desarquivar rota:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Executa arquivamento automático de rotas antigas
 * POST /api/archive/auto-archive
 */
router.post('/auto-archive', async (req, res) => {
    try {
        const db = getDb(req);
        
        // Arquiva rotas com mais de 3 dias automaticamente
        const result = await db.query(`
            UPDATE routes 
            SET archived = true, archived_at = CURRENT_TIMESTAMP
            WHERE route_date < CURRENT_DATE - INTERVAL '3 days'
            AND archived = false
            AND status IN ('completed', 'cancelled')
        `);
        
        res.json({
            message: 'Arquivamento automático executado',
            archivedCount: result.rowCount
        });
    } catch (error) {
        console.error('Erro no arquivamento automático:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Estatísticas do arquivo com dados reais
 * GET /api/archive/stats
 */
router.get('/stats', async (req, res) => {
    try {
        const db = getDb(req);
        
        // Total de rotas arquivadas
        const totalResult = await db.query(
            'SELECT COUNT(*) as total FROM routes WHERE archived = true'
        );
        
        // Busca configurações de preço
        const settingsResult = await db.query(
            'SELECT setting_key, setting_value FROM settings WHERE setting_key IN ($1, $2)',
            ['daily_rate', 'km_rate']
        );
        
        const settings = {};
        settingsResult.rows.forEach(row => {
            settings[row.setting_key] = parseFloat(row.setting_value) || 0;
        });
        
        const dailyRate = settings.daily_rate || 100;
        const kmRate = settings.km_rate || 2.5;
        
        // Estatísticas do mês atual
        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
        
        // Rotas arquivadas do mês atual com suas entregas e distâncias
        const monthRoutesResult = await db.query(`
            SELECT 
                r.id,
                r.route_date,
                r.total_distance,
                COUNT(d.id) as delivery_count
            FROM routes r
            LEFT JOIN deliveries d ON r.route_date = d.order_date
            WHERE r.archived = true 
            AND TO_CHAR(r.archived_at, 'YYYY-MM') = $1
            GROUP BY r.id, r.route_date, r.total_distance
        `, [currentMonth]);
        
        // Calcula totais do mês
        let monthDeliveries = 0;
        let monthValue = 0;
        
        monthRoutesResult.rows.forEach(route => {
            const deliveries = parseInt(route.delivery_count) || 0;
            const distance = route.total_distance || 0;
            const distanceKm = distance / 1000;
            
            monthDeliveries += deliveries;
            monthValue += dailyRate + (distanceKm * kmRate);
        });
        
        // Rotas arquivadas por mês (últimos 6 meses)
        const monthlyResult = await db.query(`
            SELECT 
                TO_CHAR(archived_at, 'YYYY-MM') as month,
                COUNT(*) as count
            FROM routes 
            WHERE archived = true 
            AND archived_at >= CURRENT_DATE - INTERVAL '6 months'
            GROUP BY TO_CHAR(archived_at, 'YYYY-MM')
            ORDER BY month DESC
        `);
        
        // Total de entregas de rotas arquivadas
        const deliveriesResult = await db.query(`
            SELECT 
                COUNT(d.id) as total_deliveries
            FROM routes r
            LEFT JOIN deliveries d ON r.route_date = d.order_date
            WHERE r.archived = true
        `);
        
        res.json({
            totalArchived: parseInt(totalResult.rows[0].total),
            monthDeliveries: monthDeliveries,
            monthValue: monthValue,
            monthlyStats: monthlyResult.rows,
            totalDeliveries: parseInt(deliveriesResult.rows[0].total_deliveries) || 0,
            settings: {
                dailyRate,
                kmRate
            }
        });
    } catch (error) {
        console.error('Erro ao buscar estatísticas:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
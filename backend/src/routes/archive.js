// backend/src/routes/archive.js - Rotas para arquivamento
const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');

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
        
        // Primeira tentativa: query mais simples sem LIMIT para testar
        let baseQuery = `
            SELECT 
                r.id,
                r.route_date,
                r.status,
                r.total_distance,
                r.total_duration,
                r.archived_at
            FROM routes r 
            WHERE r.archived = TRUE
        `;
        
        let params = [];
        
        // Filtro de busca por data
        if (search && search.trim()) {
            baseQuery += ' AND r.route_date LIKE ?';
            params.push(`%${search.trim()}%`);
        }
        
        baseQuery += ' ORDER BY r.archived_at DESC';
        
        console.log('Query base:', baseQuery);
        console.log('Parâmetros base:', params);
        
        // Primeiro testa sem LIMIT
        const [allRoutes] = await pool.execute(baseQuery, params);
        console.log(`Total de rotas encontradas: ${allRoutes.length}`);
        
        // Aplicar paginação manualmente no JavaScript
        const paginatedRoutes = allRoutes.slice(offset, offset + limitNum);
        
        // Para cada rota, buscar as entregas separadamente
        const routesWithDeliveries = [];
        for (const route of paginatedRoutes) {
            try {
                const [deliveries] = await pool.execute(
                    'SELECT COUNT(*) as delivery_count, SUM(CASE WHEN status = "delivered" THEN 1 ELSE 0 END) as delivered_count FROM deliveries WHERE order_date = ?',
                    [route.route_date]
                );
                
                routesWithDeliveries.push({
                    ...route,
                    delivery_count: deliveries[0].delivery_count || 0,
                    delivered_count: deliveries[0].delivered_count || 0
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
        
        const total = allRoutes.length;
        
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
        
        // Verifica se a rota existe e não está arquivada
        const [route] = await pool.execute(
            'SELECT id, status, archived FROM routes WHERE id = ?',
            [id]
        );
        
        if (route.length === 0) {
            return res.status(404).json({ error: 'Rota não encontrada' });
        }
        
        if (route[0].archived) {
            return res.status(400).json({ error: 'Rota já está arquivada' });
        }
        
        // Arquiva a rota (sem restrição de data para arquivamento manual)
        await pool.execute(
            'UPDATE routes SET archived = TRUE, archived_at = NOW() WHERE id = ?',
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
        
        // Verifica se a rota existe e está arquivada
        const [route] = await pool.execute(
            'SELECT id, archived FROM routes WHERE id = ?',
            [id]
        );
        
        if (route.length === 0) {
            return res.status(404).json({ error: 'Rota não encontrada' });
        }
        
        if (!route[0].archived) {
            return res.status(400).json({ error: 'Rota não está arquivada' });
        }
        
        // Desarquiva a rota
        await pool.execute(
            'UPDATE routes SET archived = FALSE, archived_at = NULL WHERE id = ?',
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
        // Arquiva rotas com mais de 3 dias automaticamente
        const [result] = await pool.execute(`
            UPDATE routes 
            SET archived = TRUE, archived_at = NOW()
            WHERE route_date < DATE_SUB(CURDATE(), INTERVAL 3 DAY)
            AND archived = FALSE
            AND status IN ('completed', 'cancelled')
        `);
        
        res.json({
            message: 'Arquivamento automático executado',
            archivedCount: result.affectedRows
        });
    } catch (error) {
        console.error('Erro no arquivamento automático:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Estatísticas do arquivo
 * GET /api/archive/stats
 */
router.get('/stats', async (req, res) => {
    try {
        // Total de rotas arquivadas
        const [totalResult] = await pool.execute(
            'SELECT COUNT(*) as total FROM routes WHERE archived = TRUE'
        );
        
        // Rotas arquivadas por mês (últimos 6 meses)
        const [monthlyResult] = await pool.execute(`
            SELECT 
                DATE_FORMAT(archived_at, '%Y-%m') as month,
                COUNT(*) as count
            FROM routes 
            WHERE archived = TRUE 
            AND archived_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
            GROUP BY DATE_FORMAT(archived_at, '%Y-%m')
            ORDER BY month DESC
        `);
        
        // Espaço economizado (estimativa baseada no número de entregas)
        const [spaceResult] = await pool.execute(`
            SELECT 
                COUNT(d.id) as total_deliveries,
                COUNT(DISTINCT r.id) as total_routes
            FROM routes r
            LEFT JOIN deliveries d ON r.route_date = d.order_date
            WHERE r.archived = TRUE
        `);
        
        res.json({
            totalArchived: totalResult[0].total,
            monthlyStats: monthlyResult,
            estimatedDeliveries: spaceResult[0].total_deliveries,
            estimatedRoutes: spaceResult[0].total_routes
        });
    } catch (error) {
        console.error('Erro ao buscar estatísticas:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
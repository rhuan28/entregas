// routes/alloy.js - Versão atualizada para criar rotas automaticamente
const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const alloyService = require('../services/alloyService');
const googleMaps = require('../services/googleMaps');

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
 * Importa pedidos do Alloy para uma data específica
 * Faz apenas uma requisição à API e maximiza seu uso
 * Importa pedidos para a data CORRETA de agendamento, não a data da rota
 * Cria automaticamente uma entrada na tabela de rotas para cada data que recebe pedidos
 * POST /api/alloy/import
 */
router.post('/import', async (req, res) => {
    try {
        const { date, forceRefresh } = req.body;
        const routeDate = date || new Date().toISOString().split('T')[0];
        
        console.log(`Consultando pedidos do Alloy com data de agendamento: ${routeDate}`);
        
        // Busca pedidos do Alloy para a data especificada - uma única requisição
        const alloyOrders = await alloyService.getOrders(routeDate, forceRefresh === true);
        
        if (!alloyOrders || alloyOrders.length === 0) {
            return res.json({
                success: true,
                message: 'Nenhum pedido encontrado no Alloy para esta data',
                imported: 0,
                alreadyImported: 0,
                date: routeDate
            });
        }
        
        console.log(`Encontrados ${alloyOrders.length} pedidos no Alloy`);
        
        // Filtra apenas pedidos de delivery
        const deliveryOrders = alloyOrders.filter(order => 
            order.delivery === 1
        );
        
        console.log(`${deliveryOrders.length} pedidos são para entrega`);
        
        // Extraímos datas de agendamento dos pedidos para controle
        const datesFound = new Set();
        deliveryOrders.forEach(order => {
            if (order.agendamento === 1 && order.data_agendamento) {
                try {
                    const dateOnly = order.data_agendamento.split(' ')[0];
                    datesFound.add(dateOnly);
                } catch (e) {
                    // Ignora erros de parsing
                }
            }
        });
        console.log(`Datas de agendamento encontradas: ${Array.from(datesFound).join(', ')}`);
        
        // Para controle de quantos pedidos foram importados para cada data
        const importsByDate = {};
        const importedIds = new Set();
        let totalImported = 0;
        let failures = 0;
        
        // Inicia uma transação para garantir consistência
        const connection = await pool.getConnection();
        await connection.beginTransaction();
        
        try {
            // Processa cada pedido, importando-o para sua data de agendamento correta
            for (const order of deliveryOrders) {
                try {
                    // Primeiro verifica se o pedido já está importado em QUALQUER data
                    const [existingOrder] = await connection.execute(
                        'SELECT id, order_date FROM deliveries WHERE external_order_id = ?',
                        [`alloy_${order.ref}`]
                    );
                    
                    if (existingOrder.length > 0) {
                        console.log(`Pedido alloy_${order.ref} já importado para a data ${existingOrder[0].order_date}`);
                        continue; // Pula este pedido
                    }
                    
                    // Transforma o pedido do Alloy para o formato do sistema
                    // (ordem_date é calculada a partir de data_agendamento)
                    const delivery = alloyService.transformOrderToDelivery(order);
                    
                    // Geocodifica o endereço
                    const coords = await googleMaps.geocodeAddress(delivery.address);
                    
                    // Logs para debug
                    console.log(`Inserindo pedido: ${delivery.external_order_id}`);
                    console.log(`Endereço: ${delivery.address}`);
                    console.log(`Data de agendamento: ${delivery.order_date}`);
                    console.log(`Janela de entrega: ${delivery.delivery_window_start} - ${delivery.delivery_window_end}`);
                    
                    // Insere na base de dados
                    await connection.execute(
                        `INSERT INTO deliveries (
                            external_order_id, order_date, customer_name, customer_phone, 
                            address, lat, lng, product_description, size, 
                            priority, delivery_window_start, delivery_window_end,
                            external_order_data
                        ) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            delivery.external_order_id,
                            delivery.order_date, // Agora usando a data de agendamento!
                            delivery.customer_name,
                            delivery.customer_phone,
                            coords.formatted_address,
                            coords.lat,
                            coords.lng,
                            delivery.product_description,
                            delivery.size,
                            delivery.priority,
                            delivery.delivery_window_start,
                            delivery.delivery_window_end,
                            JSON.stringify(order) // Armazena os dados brutos do pedido para referência futura
                        ]
                    );
                    
                    // Cria entrada na tabela de rotas para esta data, se necessário
                    await createRouteEntryIfNeeded(connection, delivery.order_date);
                    
                    // Registra a importação
                    importedIds.add(order.ref);
                    totalImported++;
                    
                    // Contabiliza por data
                    if (!importsByDate[delivery.order_date]) {
                        importsByDate[delivery.order_date] = 0;
                    }
                    importsByDate[delivery.order_date]++;
                    
                } catch (error) {
                    failures++;
                    console.error(`Erro ao processar pedido ${order.ref}:`, error);
                }
            }
            
            await connection.commit();
            
            // Formata mensagem com detalhes por data
            let dateDetails = '';
            if (Object.keys(importsByDate).length > 0) {
                dateDetails = Object.entries(importsByDate)
                    .map(([date, count]) => `${count} para ${date}`)
                    .join(', ');
            }
            
            res.json({
                success: true,
                message: `Importação concluída: ${totalImported} pedidos importados${dateDetails ? ` (${dateDetails})` : ''}, ${failures} falhas`,
                imported: totalImported,
                failures: failures,
                datesSummary: importsByDate,
                totalAlloy: alloyOrders.length,
                searchDate: routeDate
            });
            
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
        
    } catch (error) {
        console.error('Erro ao importar pedidos do Alloy:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: error.stack
        });
    }
});

/**
 * Verifica status de sincronização com Alloy
 * Modifica para verificar status em todas as datas, não apenas na data da rota
 * GET /api/alloy/sync-status
 */
router.get('/sync-status', async (req, res) => {
    try {
        const { date } = req.query;
        const routeDate = date || new Date().toISOString().split('T')[0];
        
        // Busca pedidos já importados do Alloy do banco de dados local
        const [existingOrders] = await pool.execute(
            'SELECT external_order_id, order_date FROM deliveries WHERE external_order_id LIKE "alloy_%" ORDER BY order_date'
        );
        
        const existingIds = existingOrders.map(order => order.external_order_id);
        
        // Decide se mostra apenas status local ou tenta consultar a API
        let alloyOrders = [];
        let error = null;
        
        try {
            // Tenta acessar o cache - não força refresh
            alloyOrders = await alloyService.getOrders(routeDate, false);
        } catch (e) {
            console.warn('Erro ao verificar pedidos no Alloy, verificando apenas localmente:', e.message);
            error = e.message;
        }
        
        // Filtra apenas pedidos que são para entrega
        const deliveryOrders = alloyOrders.filter(order => 
            order.delivery === 1
        );
        
        // Calcula pedidos que ainda não foram importados (em qualquer data)
        const notImportedCount = deliveryOrders.filter(order => 
            !existingIds.includes(`alloy_${order.ref}`)
        ).length;
        
        // Agrupa os pedidos importados por data
        const importedByDate = {};
        existingOrders.forEach(order => {
            if (!importedByDate[order.order_date]) {
                importedByDate[order.order_date] = 0;
            }
            importedByDate[order.order_date]++;
        });
        
        res.json({
            success: true,
            searchDate: routeDate,
            totalAlloy: deliveryOrders.length,
            imported: existingIds.length,
            importedByDate: importedByDate,
            notImported: notImportedCount,
            syncStatus: notImportedCount === 0 ? 'synced' : 'pending',
            apiError: error,
            usingCache: error !== null || deliveryOrders.length === 0
        });
        
    } catch (error) {
        console.error('Erro ao verificar status de sincronização:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: error.stack
        });
    }
});

/**
 * Limpa o cache do serviço Alloy
 * POST /api/alloy/clear-cache
 */
router.post('/clear-cache', (req, res) => {
    try {
        alloyService.clearCache();
        res.json({
            success: true,
            message: 'Cache do serviço Alloy limpo com sucesso'
        });
    } catch (error) {
        console.error('Erro ao limpar cache:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * Exibe informações adicionais sobre um pedido específico do Alloy
 * GET /api/alloy/order/:ref
 */
router.get('/order/:ref', async (req, res) => {
    try {
        const { ref } = req.params;
        
        // Busca pedido no banco de dados
        const [delivery] = await pool.execute(
            'SELECT * FROM deliveries WHERE external_order_id = ?',
            [`alloy_${ref}`]
        );
        
        if (delivery.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Pedido não encontrado'
            });
        }
        
        // Recupera os dados brutos do pedido
        const orderData = JSON.parse(delivery[0].external_order_data || '{}');
        
        res.json({
            success: true,
            delivery: delivery[0],
            alloyData: orderData
        });
        
    } catch (error) {
        console.error('Erro ao buscar detalhes do pedido:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * Cria uma entrada na tabela de rotas para uma data específica, se necessário
 * @param {Object} connection - Conexão MySQL
 * @param {string} date - Data no formato YYYY-MM-DD
 */
async function createRouteEntryIfNeeded(connection, date) {
    try {
        // Verifica se já existe uma rota para esta data
        const [existingRoute] = await connection.execute(
            'SELECT id FROM routes WHERE route_date = ?',
            [date]
        );
        
        // Se não existe, cria uma nova entrada
        if (existingRoute.length === 0) {
            await connection.execute(
                'INSERT INTO routes (route_date, status) VALUES (?, "planned")',
                [date]
            );
            console.log(`Criada nova entrada de rota para a data ${date}`);
        }
    } catch (error) {
        console.error('Erro ao criar entrada de rota:', error);
        throw error;
    }
}

module.exports = router;
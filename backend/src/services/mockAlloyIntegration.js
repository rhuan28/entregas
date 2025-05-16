// services/mockAlloyIntegration.js
const googleMaps = require('./googleMaps');

class MockAlloyIntegration {
    // Simula busca de pedidos
    async fetchDeliveryOrders() {
        console.log('Simulando pedidos de entrega do Alloy...');
        
        // Pedidos simulados para teste
        return [
            {
                id: "123456",
                customer: {
                    name: "João da Silva",
                    phone: "(19) 99999-8888"
                },
                delivery_address: {
                    full_address: "Av. Norte Sul, 500, Campinas - SP"
                },
                items: [
                    { quantity: 2, name: "Bolo de Chocolate" },
                    { quantity: 1, name: "Torta de Morango" }
                ],
                status: "confirmed",
                delivery_method: "delivery"
            },
            {
                id: "123457",
                customer: {
                    name: "Maria Oliveira",
                    phone: "(19) 88888-7777"
                },
                delivery_address: {
                    full_address: "Rua Izabel Negrão Bertoti, 101, Campinas - SP"
                },
                items: [
                    { quantity: 1, name: "Cheesecake" }
                ],
                status: "confirmed",
                delivery_method: "delivery"
            }
        ];
    }

    // Converte pedido para formato de entrega
    async convertOrderToDelivery(order, currentDate) {
        try {
            // Extrair informações do cliente
            const customerName = order.customer?.name || 'Cliente';
            const customerPhone = order.customer?.phone || '';
            const deliveryAddress = order.delivery_address?.full_address || '';
            
            // Geocodificar endereço
            const coords = await googleMaps.geocodeAddress(deliveryAddress);
            
            // Preparar descrição do produto
            let productDescription = '';
            if (order.items && Array.isArray(order.items)) {
                productDescription = order.items.map(item => 
                    `${item.quantity}x ${item.name}`
                ).join(', ');
            } else {
                productDescription = `Pedido #${order.id}`;
            }
            
            // Criar objeto de entrega
            return {
                customer_name: customerName,
                customer_phone: customerPhone,
                address: coords.formatted_address,
                lat: coords.lat,
                lng: coords.lng,
                product_description: productDescription,
                size: 'M',
                priority: 0,
                order_date: currentDate,
                external_order_id: order.id,
                external_order_data: JSON.stringify(order)
            };
        } catch (error) {
            console.error(`Erro ao converter pedido ${order.id}:`, error);
            throw error;
        }
    }

    // Importa pedidos simulados para o banco
    async importOrdersToDatabase(pool, currentDate) {
        try {
            // Buscar pedidos simulados
            const orders = await this.fetchDeliveryOrders();
            
            console.log(`Encontrados ${orders.length} pedidos simulados`);
            
            // Verificar quais pedidos já estão importados
            const external_ids = orders.map(order => order.id);
            
            // Preparar placeholders para query
            const placeholders = external_ids.map(() => '?').join(',');
            
            const [existingOrders] = await pool.execute(
                `SELECT external_order_id FROM deliveries WHERE external_order_id IN (${placeholders}) AND order_date = ?`,
                [...external_ids, currentDate]
            );
            
            const existingIds = existingOrders.map(row => row.external_order_id);
            const newOrders = orders.filter(order => !existingIds.includes(order.id));
            
            console.log(`${existingIds.length} pedidos já existentes, ${newOrders.length} novos`);
            
            if (newOrders.length === 0) {
                return {
                    success: true,
                    total: orders.length,
                    imported: 0,
                    existingCount: existingIds.length,
                    message: 'Todos os pedidos já foram importados anteriormente'
                };
            }
            
            // Importar novos pedidos
            let importedCount = 0;
            for (const order of newOrders) {
                try {
                    const deliveryData = await this.convertOrderToDelivery(order, currentDate);
                    
                    await pool.execute(
                        `INSERT INTO deliveries (
                            order_date, customer_name, customer_phone, address, 
                            lat, lng, product_description, size, priority,
                            external_order_id, external_order_data, status
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
                        [
                            deliveryData.order_date,
                            deliveryData.customer_name,
                            deliveryData.customer_phone,
                            deliveryData.address,
                            deliveryData.lat,
                            deliveryData.lng,
                            deliveryData.product_description,
                            deliveryData.size,
                            deliveryData.priority,
                            deliveryData.external_order_id,
                            deliveryData.external_order_data
                        ]
                    );
                    
                    console.log(`Pedido #${order.id} importado com sucesso`);
                    importedCount++;
                } catch (error) {
                    console.error(`Erro ao importar pedido ${order.id}:`, error);
                }
            }
            
            return {
                success: true,
                total: orders.length,
                imported: importedCount,
                existingCount: existingIds.length,
                message: `Importados ${importedCount} pedidos de ${orders.length} encontrados`
            };
        } catch (error) {
            console.error('Erro ao importar pedidos:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = new MockAlloyIntegration();
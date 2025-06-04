// ========================================
// INTEGRAÇÃO COM A OTIMIZAÇÃO DE ROTAS
// ========================================

// 1. MODIFICAÇÃO: No event listener do botão otimizar (linha ~950 do routes.js)
document.addEventListener('DOMContentLoaded', function() {
    const optimizeRouteBtn = document.getElementById('optimize-route');
    if (optimizeRouteBtn) {
        optimizeRouteBtn.addEventListener('click', async () => {
            optimizeRouteBtn.disabled = true;
            optimizeRouteBtn.innerHTML = '<span class="loading"></span> Otimizando...';
            
            try {
                const requestData = {
                    date: getRouteDate(),
                    manualOrder: manualOrder,
                    pickupStops: pickupStops.map(stop => ({
                        id: stop.id,
                        address: stop.address,
                        lat: stop.lat,
                        lng: stop.lng,
                        type: 'pickup',
                        order: manualOrder[stop.id] || 999
                    }))
                };
                
                const response = await fetch(`${API_URL}/deliveries/optimize`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestData)
                });
            
                const result = await response.json();
                
                if (response.ok && result.routeId) {
                    currentRoute = result;
                    
                    // Atualiza manualOrder
                    if (result.optimizedOrder && Array.isArray(result.optimizedOrder)) {
                        const newOptimizedManualOrder = {};
                        result.optimizedOrder.forEach((item, index) => {
                            const itemId = item.deliveryId || item.id || item.shipmentId;
                            if (itemId) {
                                newOptimizedManualOrder[itemId] = index + 1;
                            }
                        });
                        manualOrder = newOptimizedManualOrder;
                    }
                    
                    if (result.routeConfig) {
                        pickupStops = result.routeConfig.pickupStops || pickupStops;
                    }
                    
                    showToast(`Rota otimizada! ${result.totalStops || result.optimizedOrder.length} paradas.`, 'success');
                    showOptimizedRoute(currentRoute);
                    
                    if (document.getElementById('start-route')) {
                        document.getElementById('start-route').disabled = false;
                    }
                    updateRouteStats();
                    renderDeliveriesList();

                    // 🎯 NOVA FUNCIONALIDADE: Calcula e exibe tempos de entrega
                    console.log('⏰ Calculando tempos de entrega...');
                    setTimeout(async () => {
                        try {
                            await calculateAndDisplayDeliveryTimes();
                        } catch (error) {
                            console.error('Erro ao calcular tempos:', error);
                        }
                    }, 1000); // Aguarda 1 segundo para garantir que o mapa esteja pronto

                } else {
                     throw new Error(result.error || result.message || "Erro desconhecido na otimização");
                }
            } catch (error) {
                console.error('Erro ao otimizar rota:', error);
                showToast('Erro ao otimizar rota: ' + error.message, 'error');
            } finally {
                optimizeRouteBtn.disabled = false;
                optimizeRouteBtn.innerHTML = '🗺️ OTIMIZAR ROTA';
            }
        });
    }
});

// 2. MODIFICAÇÃO: Função renderDeliveryItemContent atualizada para mostrar tempos
function renderDeliveryItemContentWithTimes(item, index) {
    if (item.type === 'pickup') {
        const manualOrder = window.manualOrder || {};
        
        return `
            <div class="delivery-header">
                <h3>🏪 ${item.customer_name || 'Parada na Confeitaria'}</h3>
                <span class="priority priority-0" style="background-color: #28a745; color: white; padding: 3px 7px; border-radius: 4px; font-size: 0.9em;">
                    🏪 Parada
                </span>
            </div>
            <div class="pickup-time-info" style="
                background: linear-gradient(135deg, #ffeaa7 0%, #fab1a0 100%);
                color: #2d3436;
                padding: 8px 12px;
                border-radius: 6px;
                margin: 8px 0;
                font-size: 13px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 8px;
            ">
                <span style="font-size: 16px;">🏪</span>
                <div>Parada na confeitaria - <strong>Reset do tempo de entrega</strong></div>
            </div>
            <p><strong>📍 Endereço:</strong> ${item.address || 'Confeitaria Demiplié'}</p>
            <p><strong>📦 Ação:</strong> ${item.product_description || 'Recarregar produtos / Pausa'}</p>
            <div class="delivery-actions">
                <div class="manual-order" style="display:flex; align-items:center; gap:5px;">
                    <label for="order-input-${item.id}" style="font-size:0.9em;">Ordem:</label>
                    <input type="number" id="order-input-${item.id}"
                           class="order-input" 
                           value="${manualOrder[item.id] || ''}" 
                           min="1"
                           onchange="if(window.updateManualOrder) window.updateManualOrder('${item.id}', this.value)"
                           style="width:50px; padding:3px; text-align:center;">
                </div>
                <button onclick="if(window.showDeliveryOnMap) window.showDeliveryOnMap(${parseFloat(item.lat || -22.894334936369436)}, ${parseFloat(item.lng || -47.0640515913573)})" class="btn btn-secondary btn-sm">🗺️ Mapa</button>
                <button onclick="deleteDelivery('${item.id}', 'pickup', 'pickup')" class="btn btn-danger btn-sm">🗑️ Remover</button>
            </div>
            <span class="status" style="display:inline-block; margin-top:10px; padding: 3px 7px; border-radius:4px; font-size:0.9em; background-color: #e8f5e9; color: #2e7d32; border: 1px solid #c8e6c9;">
                Parada na Confeitaria
            </span>
        `;
    } else {
        // Para entregas normais
        const orderNumberDisplay = item.order_number ? `<p><strong>📋 Pedido #:</strong> ${item.order_number}</p>` : '';
        const productDisplay = item.product_name ? `<span class="priority-indicator priority-${getPriorityClass(item.priority)}">${item.product_name}</span>` : '';
        const priorityEmoji = getPriorityEmoji(item.priority);
        const manualOrder = window.manualOrder || {};

        return `
            <div class="delivery-header">
                <h3>${item.customer_name} ${productDisplay}</h3>
                <span class="priority priority-${getPriorityClass(item.priority)}" style="background-color: ${getPriorityColor(item.priority)}; color: white; padding: 3px 7px; border-radius: 4px; font-size: 0.9em;">
                    ${priorityEmoji} ${getPriorityLabel(item.priority)}
                </span>
            </div>
            <!-- Espaço onde será inserido o tempo estimado após otimização -->
            ${orderNumberDisplay}
            <p><strong>📍 Endereço:</strong> ${item.address}</p>
            <p><strong>📦 Produto:</strong> ${item.product_description}</p>
            ${item.customer_phone ? `<p><strong>📞 Telefone:</strong> ${item.customer_phone}</p>` : ''}
            <div class="delivery-actions">
                <div class="manual-order" style="display:flex; align-items:center; gap:5px;">
                    <label for="order-input-${item.id}" style="font-size:0.9em;">Ordem:</label>
                    <input type="number" id="order-input-${item.id}"
                           class="order-input" 
                           value="${manualOrder[item.id] || ''}" 
                           min="1"
                           onchange="if(window.updateManualOrder) window.updateManualOrder('${item.id}', this.value)"
                           style="width:50px; padding:3px; text-align:center;">
                </div>
                <button onclick="if(window.editDelivery) window.editDelivery('${item.id}')" class="btn btn-secondary btn-sm">✏️ Editar</button>
                <button onclick="if(window.showDeliveryOnMap) window.showDeliveryOnMap(${parseFloat(item.lat)}, ${parseFloat(item.lng)})" class="btn btn-secondary btn-sm">🗺️ Mapa</button>
                <button onclick="if(window.generateTrackingLink) window.generateTrackingLink('${item.id}')" class="btn btn-info btn-sm">🔗 Link</button>
                ${item.status === 'in_transit' ? `<button onclick="if(window.completeDelivery) window.completeDelivery('${item.id}')" class="btn btn-success btn-sm">✅ Entregar</button>` : ''}
                <button onclick="deleteDelivery('${item.id}', '${item.status || 'pending'}', 'delivery')" class="btn btn-danger btn-sm">🗑️ Excluir</button>
            </div>
            <span class="status status-${item.status || 'pending'}" style="display:inline-block; margin-top:10px; padding: 3px 7px; border-radius:4px; font-size:0.9em;">${getStatusLabel(item.status || 'pending', 'delivery')}</span>
        `;
    }
}

// 3. BOTÃO PARA RECALCULAR TEMPOS (adicional)
function addRecalculateTimesButton() {
    const deliveriesSection = document.querySelector('.deliveries-section-actions');
    if (deliveriesSection && !document.getElementById('recalculate-times-btn')) {
        const button = document.createElement('button');
        button.id = 'recalculate-times-btn';
        button.className = 'btn btn-info';
        button.innerHTML = '⏰ CALCULAR TEMPOS';
        button.onclick = calculateAndDisplayDeliveryTimes;
        button.style.display = 'none'; // Inicialmente oculto
        
        deliveriesSection.appendChild(button);
    }
}

// 4. MOSTRA/ESCONDE BOTÃO DE CALCULAR TEMPOS BASEADO NA ROTA
function toggleTimesButton() {
    const button = document.getElementById('recalculate-times-btn');
    if (button) {
        if (currentRoute && currentRoute.optimizedOrder && currentRoute.optimizedOrder.length > 0) {
            button.style.display = 'inline-block';
        } else {
            button.style.display = 'none';
        }
    }
}

// Substitui a função global
window.renderDeliveryItemContent = renderDeliveryItemContentWithTimes;

// Adiciona observadores para mostrar/esconder botão
const originalShowOptimizedRoute = window.showOptimizedRoute;
if (originalShowOptimizedRoute) {
    window.showOptimizedRoute = function() {
        originalShowOptimizedRoute.apply(this, arguments);
        toggleTimesButton();
    };
}

// Inicialização
document.addEventListener('DOMContentLoaded', function() {
    addRecalculateTimesButton();
    toggleTimesButton();
});

console.log('⏰ Sistema de cálculo de tempos de entrega carregado!');
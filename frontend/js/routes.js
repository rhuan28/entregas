// js/routes.js - Versão completa atualizada com novos campos e prioridades
const API_URL = window.API_URL || 'http://localhost:3000/api';
const socket = io(window.API_CONFIG?.SOCKET_URL || 'http://localhost:3000');

let map;
let directionsService;
let directionsRenderer;
let markers = [];
let currentRoute = null;
let driverMarker = null;
let deliveryData = [];
let pickupStops = [];
let manualOrder = {};

// 🎯 CONFIGURAÇÃO ATUALIZADA DOS PRODUTOS COM NOVAS PRIORIDADES
const PRODUCT_CONFIG = {
    'bentocake': { 
        name: 'Bentocake', 
        priority: 0, // Normal 🟢
        size: 'P', 
        description: 'Bentocake individual',
        color: '#28a745'
    },
    '6fatias': { 
        name: '6 fatias', 
        priority: 1, // Média 🟡
        size: 'P', 
        description: 'Bolo de 6 fatias',
        color: '#ffc107'
    },
    '10fatias': { 
        name: '10 fatias', 
        priority: 2, // Alta 🟠
        size: 'M', 
        description: 'Bolo de 10 fatias',
        color: '#fd7e14'
    },
    '18fatias': { 
        name: '18 fatias', 
        priority: 2, // Alta 🟠
        size: 'M', 
        description: 'Bolo de 18 fatias',
        color: '#fd7e14'
    },
    '24fatias': { 
        name: '24 fatias', 
        priority: 2, // Alta 🟠
        size: 'G', 
        description: 'Bolo de 24 fatias',
        color: '#fd7e14'
    },
    '30fatias': { 
        name: '30 fatias', 
        priority: 2, // Alta 🟠
        size: 'G', 
        description: 'Bolo de 30 fatias',
        color: '#fd7e14'
    },
    '40fatias': { 
        name: '40 fatias', 
        priority: 2, // Alta 🟠
        size: 'GG', 
        description: 'Bolo de 40 fatias',
        color: '#fd7e14'
    },
    'personalizado': { 
        name: 'Personalizado', 
        priority: 0, // Normal 🟢
        size: 'M', 
        description: 'Produto personalizado',
        color: '#28a745'
    }
};

let settings = {
    circular_route: 'true',
    origin_address: 'R. Barata Ribeiro, 466 - Vila Itapura, Campinas - SP, 13023-030',
    stop_time: '8',
    daily_rate: '100',
    km_rate: '2.50'
};

// Sistema de Toast
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
        <span>${message}</span>
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 300);
    }, 3000);
}

// 🏷️ FUNÇÃO ATUALIZADA PARA OBTER LABELS DE PRIORIDADE
function getPriorityLabel(priority) {
    const labels = { 
        0: 'Normal', 
        1: 'Média', 
        2: 'Alta', 
        3: 'Urgente' 
    };
    return labels[priority] || 'Normal';
}

// 🎨 FUNÇÃO ATUALIZADA PARA CORES DE PRIORIDADE
function getPriorityColor(priority) {
    switch(parseInt(priority)) {
        case 3: return '#dc3545'; // Vermelho para urgente 🔴
        case 2: return '#fd7e14'; // Laranja para alta 🟠
        case 1: return '#ffc107'; // Amarelo para média 🟡
        default: return '#28a745'; // Verde para normal 🟢
    }
}

// 🎯 FUNÇÃO AUXILIAR PARA EMOJIS DE PRIORIDADE
function getPriorityEmoji(priority) {
    switch(parseInt(priority)) {
        case 3: return '🔴'; // Urgente
        case 2: return '🟠'; // Alta
        case 1: return '🟡'; // Média
        default: return '🟢'; // Normal
    }
}

// 🏷️ FUNÇÃO AUXILIAR PARA CLASSES CSS DE PRIORIDADE
function getPriorityClass(priority) {
    switch(parseInt(priority)) {
        case 3: return 'urgente';
        case 2: return 'alta';
        case 1: return 'media';
        default: return 'normal';
    }
}

// Função para atualizar informações do produto no formulário principal
function updateProductInfo() {
    const productSelect = document.getElementById('product-select');
    const selectedOption = productSelect.options[productSelect.selectedIndex];
    const prioritySelect = document.getElementById('priority-select');
    const productDescription = document.getElementById('product-description');
    
    if (selectedOption.value) {
        const config = PRODUCT_CONFIG[selectedOption.value];
        
        if (config) {
            // Atualiza prioridade
            prioritySelect.value = config.priority;
            
            // Se a descrição estiver vazia, preenche com o padrão
            if (productDescription && !productDescription.value.trim()) {
                productDescription.value = config.description;
            }
        }
    }
}

// Função para atualizar informações do produto no formulário de edição
function updateEditProductInfo() {
    const productSelect = document.getElementById('edit-product-select');
    const selectedOption = productSelect.options[productSelect.selectedIndex];
    const prioritySelect = document.getElementById('edit-priority-select');
    
    if (selectedOption.value) {
        const config = PRODUCT_CONFIG[selectedOption.value];
        
        if (config) {
            prioritySelect.value = config.priority;
        }
    }
}

// Função para obter o nome do produto baseado no tipo
function getProductDisplayName(productType) {
    return PRODUCT_CONFIG[productType]?.name || productType || 'Produto não especificado';
}

// Obtém data da URL
function getRouteDate() {
    const urlParams = new URLSearchParams(window.location.search);
    const date = urlParams.get('date') || new Date().toISOString().split('T')[0];
    return date;
}

// Inicializa o mapa
function initMap() {
    try {
        const confeitariaLocation = { lat: -22.894334936369436, lng: -47.0640515913573 };
        
        map = new google.maps.Map(document.getElementById('map'), {
            center: confeitariaLocation,
            zoom: 13,
            styles: [
                {
                    featureType: "poi",
                    elementType: "labels",
                    stylers: [{ visibility: "off" }]
                }
            ]
        });
        
        directionsService = new google.maps.DirectionsService();
        directionsRenderer = new google.maps.DirectionsRenderer({
            polylineOptions: {
                strokeColor: '#E5B5B3',
                strokeWeight: 4
            },
            markerOptions: {
                visible: false
            }
        });
        directionsRenderer.setMap(map);
        
        // Adiciona marcador da confeitaria
        new google.maps.Marker({
            position: confeitariaLocation,
            map: map,
            title: 'Confeitaria',
            icon: {
                url: 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png',
                scaledSize: new google.maps.Size(40, 40)
            },
            zIndex: 1000
        });
    } catch (error) {
        console.error('Erro ao inicializar mapa:', error);
    }
}

// Carrega entregas do dia específico
async function loadDeliveries() {
    try {
        const routeDate = getRouteDate();
        console.log(`Carregando entregas para a data ${routeDate}...`);
        
        const url = `${API_URL}/deliveries?date=${routeDate}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Erro ${response.status} ao carregar entregas`);
        }
        
        const deliveries = await response.json();
        console.log(`Dados recebidos: ${deliveries.length} entregas`);
        
        deliveryData = deliveries;
        
        const listElement = document.getElementById('deliveries-list');
        listElement.innerHTML = '';
        
        // Combina entregas e paradas em uma única lista
        const allItems = [];
        
        // Adiciona entregas
        deliveries.forEach(delivery => {
            allItems.push({
                ...delivery,
                type: 'delivery'
            });
        });
        
        // Verifica rota existente
        checkExistingRoute(routeDate);

        // Adiciona paradas na confeitaria
        pickupStops.forEach((stop, index) => {
            allItems.push({
                ...stop,
                type: 'pickup',
                id: stop.id || `pickup_${index}`,
                customer_name: 'Confeitaria',
                product_description: 'Recarregar produtos',
                priority: stop.priority || 0
            });
        });
        
        // Ordena pelo manual order se existir
        allItems.sort((a, b) => {
            const orderA = manualOrder[a.id] || 999;
            const orderB = manualOrder[b.id] || 999;
            return orderA - orderB;
        });
        
        // Renderiza todos os itens
        allItems.forEach((item, index) => {
            const itemElement = document.createElement('div');
            itemElement.className = 'delivery-item draggable';
            itemElement.draggable = true;
            itemElement.dataset.itemId = item.id;
            itemElement.dataset.itemType = item.type;
            
            // Renderiza conteúdo do item
            itemElement.innerHTML = renderDeliveryItem(item, index);
            
            // Adiciona eventos de drag and drop
            itemElement.addEventListener('dragstart', handleDragStart);
            itemElement.addEventListener('dragend', handleDragEnd);
            itemElement.addEventListener('dragover', handleDragOver);
            itemElement.addEventListener('drop', handleDrop);
            itemElement.addEventListener('dragleave', handleDragLeave);
            
            listElement.appendChild(itemElement);
        });
        
        // Atualiza estatísticas
        updateRouteStats();
        
        // Adiciona marcadores no mapa
        updateMapMarkers(allItems);
        
    } catch (error) {
        console.error('Erro ao carregar entregas:', error);
        showToast('Erro ao carregar entregas: ' + error.message, 'error');
        
        const listElement = document.getElementById('deliveries-list');
        listElement.innerHTML = `
            <div class="error-message" style="padding: 20px; text-align: center; background-color: #ffebee; border-radius: 8px; margin-bottom: 20px;">
                <h4 style="color: #d32f2f;">Erro ao carregar entregas</h4>
                <p>Não foi possível carregar as entregas do servidor.</p>
                <button onclick="loadDeliveries()" class="btn btn-secondary" style="margin-top: 10px;">
                    Tentar novamente
                </button>
            </div>
        `;
    }
}

// 📦 FUNÇÃO ATUALIZADA PARA RENDERIZAR ITENS DE ENTREGA
function renderDeliveryItem(item, index) {
    if (item.type === 'pickup') {
        return `
            <div class="delivery-header">
                <h3>🏪 Parada na Confeitaria</h3>
                <span class="priority priority-0">Parada</span>
            </div>
            <p><strong>📍</strong> ${item.address || settings.origin_address}</p>
            <p><strong>📦</strong> Recarregar produtos</p>
            <div class="delivery-actions">
                <div class="manual-order">
                    <label>Ordem:</label>
                    <input type="number" 
                           class="order-input" 
                           value="${manualOrder[item.id] || ''}" 
                           min="1"
                           onchange="updateManualOrder('${item.id}', this.value)">
                </div>
                <button onclick="removePickupStop('${item.id}')" class="btn btn-danger btn-sm">
                    Remover
                </button>
            </div>
        `;
    } else {
        const orderNumberDisplay = item.order_number ? 
            `<p><strong>📋</strong> Pedido #${item.order_number}</p>` : '';
        
        // 🏷️ Indicador visual de produto com prioridade atualizado
        const productDisplay = item.product_name ? 
            `<span class="priority-indicator priority-${getPriorityClass(item.priority)}">${item.product_name}</span>` : '';
        
        // 🎯 Emoji baseado na prioridade
        const priorityEmoji = getPriorityEmoji(item.priority);
        
        return `
            <div class="delivery-header">
                <h3>${item.customer_name} ${productDisplay}</h3>
                <span class="priority priority-${item.priority}" style="background-color: ${getPriorityColor(item.priority)}; color: white;">
                    ${priorityEmoji} ${getPriorityLabel(item.priority)}
                </span>
            </div>
            ${orderNumberDisplay}
            <p><strong>📍</strong> ${item.address}</p>
            <p><strong>📦</strong> ${item.product_description}</p>
            ${item.customer_phone ? `<p><strong>📞</strong> ${item.customer_phone}</p>` : ''}
            <div class="delivery-actions">
                <div class="manual-order">
                    <label>Ordem:</label>
                    <input type="number" 
                           class="order-input" 
                           value="${manualOrder[item.id] || ''}" 
                           min="1"
                           onchange="updateManualOrder(${item.id}, this.value)">
                </div>
                <button onclick="editDelivery(${item.id})" class="btn btn-secondary btn-sm">
                    ✏️ Editar
                </button>
                <button onclick="showDeliveryOnMap(${item.lat}, ${item.lng})" class="btn btn-secondary btn-sm">
                    Ver no Mapa
                </button>
                <button onclick="generateTrackingLink(${item.id})" class="btn btn-info btn-sm">
                    Link
                </button>
                ${item.status === 'in_transit' ? 
                    `<button onclick="completeDelivery(${item.id})" class="btn btn-success btn-sm">
                        Entregar
                    </button>` : ''}
                <button onclick="deleteDelivery(${item.id}, '${item.status}')" class="btn btn-danger btn-sm">
                    Excluir
                </button>
            </div>
            <span class="status status-${item.status}">${getStatusLabel(item.status)}</span>
        `;
    }
}

// Atualiza marcadores no mapa
function updateMapMarkers(allItems) {
    clearMarkers();
    
    allItems.forEach((item, index) => {
        const marker = new google.maps.Marker({
            position: { lat: parseFloat(item.lat), lng: parseFloat(item.lng) },
            map: map,
            title: item.type === 'pickup' ? 'Parada na Confeitaria' : item.customer_name,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 8,
                fillColor: item.type === 'pickup' ? '#FFB6C1' : getPriorityColor(item.priority),
                fillOpacity: 0.8,
                strokeColor: 'white',
                strokeWeight: 2
            },
            label: {
                text: (index + 1).toString(),
                color: 'white',
                fontSize: '12px',
                fontWeight: 'bold'
            },
            zIndex: 100 + index
        });
        
        const infoWindow = new google.maps.InfoWindow({
            content: `
                <div style="padding: 10px;">
                    <h4>${item.type === 'pickup' ? '🏪 Parada na Confeitaria' : item.customer_name}</h4>
                    ${item.order_number ? `<p><strong>Pedido:</strong> #${item.order_number}</p>` : ''}
                    ${item.product_name ? `<p><strong>Produto:</strong> ${item.product_name}</p>` : ''}
                    <p>${item.address || settings.origin_address}</p>
                    <p><strong>${item.product_description}</strong></p>
                    ${item.type !== 'pickup' ? `<p>Prioridade: ${getPriorityLabel(item.priority)}</p>` : ''}
                </div>
            `
        });
        
        marker.addListener('click', () => {
            infoWindow.open(map, marker);
        });
        
        markers.push(marker);
    });
}

// Função para editar uma entrega existente
function editDelivery(id) {
    const delivery = deliveryData.find(d => d.id === id);
    if (!delivery) return;
    
    // Preenche o formulário
    document.getElementById('edit-delivery-id').value = delivery.id;
    document.getElementById('edit-order-number').value = delivery.order_number || '';
    document.getElementById('edit-customer-name').value = delivery.customer_name;
    document.getElementById('edit-customer-phone').value = delivery.customer_phone;
    document.getElementById('edit-address').value = delivery.address;
    document.getElementById('edit-product-description').value = delivery.product_description;
    document.getElementById('edit-priority-select').value = delivery.priority;
    
    // Define o produto se existir
    if (delivery.product_type) {
        document.getElementById('edit-product-select').value = delivery.product_type;
    }
    
    // Mostra o formulário de edição
    document.getElementById('edit-delivery-container').style.display = 'block';
    document.getElementById('edit-delivery-container').scrollIntoView({ behavior: 'smooth' });
}

// Função para cancelar a edição
function cancelEdit() {
    document.getElementById('edit-delivery-container').style.display = 'none';
}

// Atualiza ordem manual
function updateManualOrder(itemId, order) {
    if (order === '' || order < 1) {
        delete manualOrder[itemId];
    } else {
        manualOrder[itemId] = parseInt(order);
    }
}

// Adiciona parada na confeitaria
function addPickupStop() {
    const pickupId = `pickup_${Date.now()}`;
    pickupStops.push({
        id: pickupId,
        type: 'pickup',
        lat: -22.894334936369436,
        lng: -47.0640515913573,
        address: settings.origin_address
    });
    loadDeliveries();
}

// Remove parada na confeitaria
function removePickupStop(stopId) {
    pickupStops = pickupStops.filter(stop => stop.id !== stopId);
    delete manualOrder[stopId];
    loadDeliveries();
}

// Verifica se há uma rota otimizada existente
async function checkExistingRoute(date) {
    try {
        const response = await fetch(`${API_URL}/deliveries/routes`);
        if (!response.ok) return;
        
        const routes = await response.json();
        const existingRoute = routes.find(r => r.route_date === date);
        
        if (existingRoute && existingRoute.total_distance && existingRoute.total_duration) {
            currentRoute = {
                routeId: existingRoute.id,
                totalDistance: existingRoute.total_distance,
                totalDuration: existingRoute.total_duration,
            };
            
            if (existingRoute.optimized_order) {
                try {
                    currentRoute.optimizedOrder = JSON.parse(existingRoute.optimized_order);
                    showOptimizedRoute(currentRoute);
                    document.getElementById('start-route').disabled = false;
                    showToast('Rota otimizada carregada', 'success');
                } catch (e) {
                    console.error('Erro ao processar ordem otimizada:', e);
                }
            } else {
                updateRouteStats();
            }
        }
    } catch (error) {
        console.error('Erro ao verificar rotas existentes:', error);
    }
}

// Funções auxiliares
function getSizeLabel(size) {
    const labels = { 'P': 'Pequeno', 'M': 'Médio', 'G': 'Grande', 'GG': 'Extra Grande' };
    return labels[size] || size;
}

function getStatusLabel(status) {
    const labels = {
        'pending': 'Pendente',
        'optimized': 'Otimizada',
        'in_transit': 'Em Trânsito',
        'delivered': 'Entregue',
        'cancelled': 'Cancelada'
    };
    return labels[status] || status;
}

function clearMarkers() {
    markers.forEach(marker => marker.setMap(null));
    markers = [];
}

// Atualiza estatísticas da rota
function updateRouteStats() {
    document.getElementById('total-deliveries').textContent = deliveryData.length;
    
    if (currentRoute) {
        const distanceKm = (currentRoute.totalDistance / 1000).toFixed(1);
        const totalMinutes = Math.round(currentRoute.totalDuration / 60);
        const stopTime = parseInt(settings.stop_time) || 8;
        const totalStops = deliveryData.length + pickupStops.length;
        const totalTimeWithStops = totalMinutes + (totalStops * stopTime);
        
        // Calcula o preço total
        const dailyRate = parseFloat(settings.daily_rate || 100);
        const kmRate = parseFloat(settings.km_rate || 2.5);
        const totalPrice = dailyRate + (distanceKm * kmRate);
        
        document.getElementById('total-distance').textContent = `${distanceKm} km`;
        document.getElementById('total-time').textContent = `${totalTimeWithStops} min`;
        document.getElementById('total-price').textContent = `R$ ${totalPrice.toFixed(2)}`;
        document.getElementById('share-route').disabled = false;
    } else {
        document.getElementById('total-distance').textContent = '0 km';
        document.getElementById('total-time').textContent = '0 min';
        document.getElementById('total-price').textContent = 'R$ 0,00';
        document.getElementById('share-route').disabled = true;
    }
}

// Mostra rota otimizada no mapa
function showOptimizedRoute(route) {
    clearMarkers();
    
    const orderedDeliveries = [];
    const allStops = [];
    const confeitariaLocation = { 
        lat: -22.894334936369436, 
        lng: -47.0640515913573,
        address: settings.origin_address
    };
    
    route.optimizedOrder.forEach((item, index) => {
        if (item.type === 'pickup' || (item.shipmentId && item.shipmentId.toString().startsWith('pickup_'))) {
            const stop = {
                id: item.id || item.deliveryId || item.shipmentId,
                lat: confeitariaLocation.lat,
                lng: confeitariaLocation.lng,
                address: confeitariaLocation.address,
                type: 'pickup',
                customer_name: 'Confeitaria',
                product_description: 'Recarregar produtos'
            };
            
            orderedDeliveries.push({
                location: stop.address,
                stopover: true
            });
            allStops.push({ ...stop, index: index });
        } else {
            let stop = deliveryData.find(d => {
                if (d.id === item.deliveryId) return true;
                if (item.shipmentId && item.shipmentId.startsWith('entrega_')) {
                    const idFromShipment = parseInt(item.shipmentId.replace('entrega_', ''));
                    if (d.id === idFromShipment) return true;
                }
                return false;
            });
            
            if (stop) {
                orderedDeliveries.push({
                    location: stop.address,
                    stopover: true
                });
                allStops.push({ ...stop, index: index });
            }
        }
    });
    
    if (orderedDeliveries.length === 0) {
        console.error('Nenhuma parada encontrada para a rota');
        return;
    }
    
    // Adiciona marcadores personalizados
    allStops.forEach((stop, index) => {
        const position = { lat: parseFloat(stop.lat), lng: parseFloat(stop.lng) };
        
        const marker = new google.maps.Marker({
            position: position,
            map: map,
            title: stop.type === 'pickup' ? 'Parada na Confeitaria' : stop.customer_name,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 10,
                fillColor: stop.type === 'pickup' ? '#FFB6C1' : getPriorityColor(stop.priority),
                fillOpacity: 0.9,
                strokeColor: 'white',
                strokeWeight: 3
            },
            label: {
                text: (index + 1).toString(),
                color: 'white',
                fontSize: '14px',
                fontWeight: 'bold'
            },
            zIndex: 200 + index
        });
        
        const infoContent = stop.type === 'pickup' 
            ? `<div style="padding: 10px;">
                <h4>🏪 Parada na Confeitaria</h4>
                <p>Recarregar produtos</p>
                <p>${stop.address}</p>
               </div>`
            : `<div style="padding: 10px;">
                <h4>${stop.customer_name}</h4>
                ${stop.order_number ? `<p><strong>Pedido:</strong> #${stop.order_number}</p>` : ''}
                ${stop.product_name ? `<p><strong>Produto:</strong> ${stop.product_name}</p>` : ''}
                <p>${stop.address}</p>
                <p><strong>${stop.product_description}</strong></p>
                <p>Prioridade: ${getPriorityLabel(stop.priority)}</p>
               </div>`;
        
        const infoWindow = new google.maps.InfoWindow({
            content: infoContent
        });
        
        marker.addListener('click', () => {
            infoWindow.open(map, marker);
        });
        
        markers.push(marker);
    });
    
    const origin = settings.origin_address;
    const destination = settings.circular_route === 'true' 
        ? origin 
        : allStops[allStops.length - 1].address;
    
    const request = {
        origin: origin,
        destination: destination,
        waypoints: orderedDeliveries,
        optimizeWaypoints: false,
        travelMode: 'DRIVING',
        language: 'pt-BR'
    };
    
    directionsService.route(request, (result, status) => {
        if (status === 'OK') {
            directionsRenderer.setDirections(result);
            currentRoute.completeStops = allStops;
            const bounds = result.routes[0].bounds;
            map.fitBounds(bounds);
        } else {
            console.error('Erro ao traçar rota:', status);
            showToast('Erro ao exibir rota no mapa', 'error');
        }
    });
}

// Event Listeners para formulários
document.getElementById('delivery-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const delivery = Object.fromEntries(formData);
    delivery.order_date = getRouteDate();
    
    // Adiciona informações do produto
    const productSelect = document.getElementById('product-select');
    if (productSelect.value) {
        delivery.product_type = productSelect.value;
        delivery.product_name = getProductDisplayName(productSelect.value);
    }
    
    try {
        const response = await fetch(`${API_URL}/deliveries`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(delivery)
        });
        
        if (response.ok) {
            showToast('Entrega adicionada com sucesso!', 'success');
            e.target.reset();
            loadDeliveries();
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Erro ao adicionar entrega');
        }
    } catch (error) {
        console.error('Erro ao adicionar entrega:', error);
        showToast('Erro ao adicionar entrega: ' + error.message, 'error');
    }
});

document.getElementById('edit-delivery-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const id = document.getElementById('edit-delivery-id').value;
    const updatedDelivery = {
        order_number: document.getElementById('edit-order-number').value,
        customer_name: document.getElementById('edit-customer-name').value,
        customer_phone: document.getElementById('edit-customer-phone').value,
        address: document.getElementById('edit-address').value,
        product_description: document.getElementById('edit-product-description').value,
        priority: document.getElementById('edit-priority-select').value
    };

    // Adiciona informações do produto
    const productSelect = document.getElementById('edit-product-select');
    if (productSelect.value) {
        updatedDelivery.product_type = productSelect.value;
        updatedDelivery.product_name = getProductDisplayName(productSelect.value);
    }
    
    try {
        const response = await fetch(`${API_URL}/deliveries/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedDelivery)
        });
        
        if (response.ok) {
            showToast('Entrega atualizada com sucesso!', 'success');
            cancelEdit();
            loadDeliveries();
        } else {
            const data = await response.json();
            throw new Error(data.error || 'Erro ao atualizar entrega');
        }
    } catch (error) {
        console.error('Erro ao atualizar entrega:', error);
        showToast('Erro ao atualizar entrega: ' + error.message, 'error');
    }
});

// Otimização de rota
document.getElementById('optimize-route').addEventListener('click', async () => {
    const optimizeBtn = document.getElementById('optimize-route');
    optimizeBtn.disabled = true;
    optimizeBtn.innerHTML = '<span class="loading"></span> Otimizando...';

    try {
        const requestData = {
            date: getRouteDate(),
            manualOrder: manualOrder,
            pickupStops: pickupStops.map(stop => ({
                id: stop.id,
                order: manualOrder[stop.id] || 999
            }))
        };
        
        const response = await fetch(`${API_URL}/deliveries/optimize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });
       
        const result = await response.json();
        
        if (result.routeId) {
            currentRoute = result;
            showToast(`Rota otimizada! ${result.totalStops || result.totalDeliveries} paradas, ${(result.totalDistance/1000).toFixed(1)}km`, 'success');
            showOptimizedRoute(result);
            document.getElementById('start-route').disabled = false;
            updateRouteStats();
        
            // Atualiza a ordem manual com a rota otimizada
            result.optimizedOrder.forEach((item, index) => {
                const itemId = item.deliveryId || item.id;
                if (itemId) {
                    manualOrder[itemId] = index + 1;
                }
            });
            
            loadDeliveries();
        }
    } catch (error) {
        console.error('Erro ao otimizar rota:', error);
        showToast('Erro ao otimizar rota', 'error');
    } finally {
        optimizeBtn.disabled = false;
        optimizeBtn.innerHTML = '🗺️ Otimizar Rota';
    }
});

// Funções utilitárias
function showDeliveryOnMap(lat, lng) {
    map.setCenter({ lat: parseFloat(lat), lng: parseFloat(lng) });
    map.setZoom(17);
}

async function deleteDelivery(deliveryId, status) {
    if (!confirm('Tem certeza que deseja excluir esta entrega?')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/deliveries/${deliveryId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showToast('Entrega excluída com sucesso!', 'success');
            loadDeliveries();
        }
    } catch (error) {
        console.error('Erro ao excluir entrega:', error);
        showToast('Erro ao excluir entrega', 'error');
    }
}

function generateTrackingLink(deliveryId) {
    const trackingUrl = `${window.location.origin}/tracking.html?id=${deliveryId}`;
    
    navigator.clipboard.writeText(trackingUrl).then(() => {
        showToast('Link copiado para a área de transferência!', 'success');
    }).catch(() => {
        prompt('Link de rastreamento:', trackingUrl);
    });
}

async function completeDelivery(deliveryId) {
    try {
        const response = await fetch(`${API_URL}/deliveries/${deliveryId}/complete`, {
            method: 'POST'
        });
        
        if (response.ok) {
            showToast('Entrega concluída!', 'success');
            loadDeliveries();
        }
    } catch (error) {
        console.error('Erro ao completar entrega:', error);
        showToast('Erro ao completar entrega', 'error');
    }
}

// Limpa todas as entregas do dia
async function clearAllDeliveries() {
    if (!confirm('Tem certeza que deseja limpar todas as entregas deste dia?')) {
        return;
    }
    
    try {
        const routeDate = getRouteDate();
        const response = await fetch(`${API_URL}/deliveries/clear/${routeDate}`, {
            method: 'DELETE'
        });
                
        if (response.ok) {
            showToast('Todas as entregas foram removidas', 'success');
            loadDeliveries();
            directionsRenderer.setDirections({routes: []});
            currentRoute = null;
            pickupStops = [];
            manualOrder = {};
        }
    } catch (error) {
        console.error('Erro ao limpar entregas:', error);
        showToast('Erro ao limpar entregas', 'error');
    }
}

// Compartilha rota no Google Maps
function shareRoute() {
    if (!currentRoute || !currentRoute.optimizedOrder) {
        showToast('Primeiro otimize a rota para compartilhar', 'info');
        return;
    }
    
    let url = 'https://www.google.com/maps/dir/';
    url += `${encodeURIComponent(settings.origin_address)}/`;
    
    if (currentRoute.completeStops) {
        currentRoute.completeStops.forEach((stop, index) => {
            const isFirstStop = index === 0;
            const isLastStop = index === currentRoute.completeStops.length - 1;
            
            if (isFirstStop && stop.type === 'pickup') {
                return;
            }
            
            if (settings.circular_route === 'true' && isLastStop && stop.type === 'pickup') {
                return;
            }
            
            url += `${encodeURIComponent(stop.address)}/`;
        });
    }
    
    if (settings.circular_route === 'true') {
        url += `${encodeURIComponent(settings.origin_address)}`;
    }
    
    window.open(url, '_blank');
    showToast('Link compartilhado!', 'success');
}

// Drag and Drop
let draggedElement = null;

function handleDragStart(e) {
    draggedElement = this;
    this.classList.add('dragging');
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
}

function handleDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }
    this.classList.add('drag-over');
    return false;
}

function handleDragLeave(e) {
    this.classList.remove('drag-over');
}

function handleDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }
    
    this.classList.remove('drag-over');
    
    if (draggedElement !== this) {
        const allItems = [...document.querySelectorAll('.delivery-item')];
        const draggedIndex = allItems.indexOf(draggedElement);
        const targetIndex = allItems.indexOf(this);
        
        if (draggedIndex < targetIndex) {
            this.parentNode.insertBefore(draggedElement, this.nextSibling);
        } else {
            this.parentNode.insertBefore(draggedElement, this);
        }
        
        updateManualOrderFromDOM();
    }
    
    return false;
}

function updateManualOrderFromDOM() {
    const items = document.querySelectorAll('.delivery-item');
    items.forEach((item, index) => {
        const itemId = item.dataset.itemId;
        manualOrder[itemId] = index + 1;
        const input = item.querySelector('.order-input');
        if (input) {
            input.value = index + 1;
        }
    });
}

// Configurações
async function loadSettings() {
    try {
        const response = await fetch(`${API_URL}/settings`);
        const data = await response.json();
        
        settings = { ...settings, ...data };
        
        document.getElementById('circular-route').checked = settings.circular_route === 'true';
        document.getElementById('origin-address').value = settings.origin_address;
        document.getElementById('stop-time').value = settings.stop_time || '8';
        document.getElementById('daily-rate').value = settings.daily_rate || '100';
        document.getElementById('km-rate').value = settings.km_rate || '2.50';
    } catch (error) {
        console.error('Erro ao carregar configurações:', error);
    }
}

function openSettings() {
    document.getElementById('settings-modal').style.display = 'block';
}

function closeSettings() {
    document.getElementById('settings-modal').style.display = 'none';
}

async function saveSettings() {
    const circularRoute = document.getElementById('circular-route').checked;
    const originAddress = document.getElementById('origin-address').value;
    const stopTime = document.getElementById('stop-time').value;
    const dailyRate = document.getElementById('daily-rate').value;
    const kmRate = document.getElementById('km-rate').value;
    
    const newSettings = {
        circular_route: circularRoute ? 'true' : 'false',
        origin_address: originAddress,
        stop_time: stopTime,
        daily_rate: dailyRate,
        km_rate: kmRate
    };
    
    try {
        const response = await fetch(`${API_URL}/settings/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newSettings)
        });
        
        if (response.ok) {
            settings = { ...settings, ...newSettings };
            showToast('Configurações salvas com sucesso!', 'success');
            closeSettings();
            updateRouteStats();
        }
    } catch (error) {
        console.error('Erro ao salvar configurações:', error);
        showToast('Erro ao salvar configurações', 'error');
    }
}

// Inicialização
window.onload = async () => {
    console.log('Carregando página...');
    
    const routeDate = getRouteDate();
    const dateObj = new Date(routeDate + 'T00:00:00');
    const formattedDate = dateObj.toLocaleDateString('pt-BR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    document.getElementById('route-date').textContent = formattedDate;
    
    initMap();
    loadDeliveries();
    loadSettings();
    
    // Configura autocomplete para endereço
    if (google && google.maps && google.maps.places) {
        const autocomplete = new google.maps.places.Autocomplete(
            document.getElementById('address-input'),
            { 
                types: ['address'],
                componentRestrictions: { country: 'br' }
            }
        );
        
        autocomplete.addListener('place_changed', function() {
            const place = autocomplete.getPlace();
            if (place.geometry) {
                document.getElementById('address-input').value = place.formatted_address;
            }
        });
    }
};

// Socket.io listeners
socket.on('connect', () => {
    console.log('Conectado ao servidor via Socket.IO');
});

socket.on('location-update', (data) => {
    if (driverMarker) {
        driverMarker.setPosition({ lat: data.lat, lng: data.lng });
    }
});

socket.on('delivery-completed', (data) => {
    loadDeliveries();
});

// Fecha modal ao clicar fora
window.onclick = function(event) {
    const modal = document.getElementById('settings-modal');
    if (event.target == modal) {
        closeSettings();
    }
};
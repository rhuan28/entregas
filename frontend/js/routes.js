// Arquivo: routes.js - Versão corrigida e completa
// Corrige o problema com showOptimizedRoute e adiciona melhor tratamento de erros

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
let manualOrder = {}

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

// Diagnóstico: Função para testar comunicação com o backend
async function testBackendConnection() {
    try {
        console.log('Testando conexão com o backend...');
        
        // Primeiro tenta o endpoint de saúde
        try {
            const healthResponse = await fetch(`${API_URL}/health`);
            if (healthResponse.ok) {
                console.log('✅ Backend respondeu ao endpoint de saúde');
                const healthData = await healthResponse.json();
                console.log('Resposta:', healthData);
                return true;
            } else {
                console.log('❌ Backend respondeu com status', healthResponse.status);
                return false;
            }
        } catch (healthError) {
            console.log('❌ Erro ao acessar endpoint de saúde:', healthError);
        }
        
        // Tenta uma requisição diretas às entregas
        try {
            const date = getRouteDate();
            console.log(`Tentando buscar entregas para a data ${date}...`);
            const testResponse = await fetch(`${API_URL}/deliveries?date=${date}`);
            
            if (testResponse.ok) {
                console.log('✅ Backend respondeu corretamente!');
                const data = await testResponse.json();
                console.log(`Dados recebidos: ${Array.isArray(data) ? data.length + ' entregas' : 'Resposta não é uma array'}`);
                return true;
            } else {
                console.log('❌ Backend respondeu com status:', testResponse.status);
                const text = await testResponse.text();
                console.log('Conteúdo da resposta:', text.substring(0, 100) + '...');
                return false;
            }
        } catch (error) {
            console.error('❌ Erro completo ao testar backend:', error);
            return false;
        }
    } catch (e) {
        console.error('❌ Erro fatal ao testar backend:', e);
        return false;
    }
}

// Inicia rota
document.getElementById('start-route').addEventListener('click', async () => {
    if (!currentRoute) return;
    
    try {
        const response = await fetch(`${API_URL}/deliveries/routes/${currentRoute.routeId}/start`, {
            method: 'POST'
        });
        
        if (response.ok) {
            showToast('Rota iniciada! Rastreamento ativado.', 'success');
            document.getElementById('track-driver').disabled = false;
        }
    } catch (error) {
        console.error('Erro ao iniciar rota:', error);
        showToast('Erro ao iniciar rota', 'error');
    }
});

// Inicialização
window.onload = async () => {
    console.log('Carregando página...');
    
    // Testa a conexão com o backend primeiro
    const backendConnected = await testBackendConnection();
    if (!backendConnected) {
        showToast('Não foi possível conectar ao servidor backend. Verifique o console para mais detalhes.', 'error');
    }
    
    // Define a data da rota
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
    } else {
        console.warn('Google Maps Places API não disponível');
    }
};

// Socket.io listeners
socket.on('connect', () => {
    console.log('Conectado ao servidor via Socket.IO');
});

socket.on('connect_error', (error) => {
    console.error('Erro ao conectar via Socket.IO:', error);
});

socket.on('location-update', (data) => {
    if (driverMarker) {
        driverMarker.setPosition({ lat: data.lat, lng: data.lng });
    }
});

socket.on('delivery-completed', (data) => {
    loadDeliveries();
});

socket.on('delivery-approaching', (data) => {
    showToast('Entregador se aproximando!', 'info');
});

// Fecha modal ao clicar fora dele
window.onclick = function(event) {
    const modal = document.getElementById('settings-modal');
    if (event.target == modal) {
        closeSettings();
    }
};

let settings = {
    circular_route: 'true',
    origin_address: 'R. Barata Ribeiro, 466 - Vila Itapura, Campinas - SP, 13023-030',
    stop_time: '8',
    daily_rate: '100',   // Valor padrão da diária
    km_rate: '2.50'      // Valor padrão por km
};

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
                visible: false // Oculta marcadores padrão do DirectionsRenderer
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
            zIndex: 1000 // Garante que fique acima de outros marcadores
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
        console.log(`Fazendo requisição para: ${url}`);
        
        const response = await fetch(url);
        console.log(`Resposta recebida, status: ${response.status}`);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Erro ${response.status} ao carregar entregas:`, errorText.substring(0, 200));
            throw new Error(`Erro ${response.status}: ${errorText.substring(0, 100)}...`);
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
            
            if (item.type === 'pickup') {
                itemElement.classList.add('pickup-stop');
                itemElement.innerHTML = `
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
                itemElement.innerHTML = `
                    <div class="delivery-header">
                        <h3>${item.customer_name}</h3>
                        <span class="priority priority-${item.priority}">${getPriorityLabel(item.priority)}</span>
                    </div>
                    <p><strong>📍</strong> ${item.address}</p>
                    <p><strong>📦</strong> ${item.product_description} - ${getSizeLabel(item.size)}</p>
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
    } catch (error) {
        console.error('Erro ao carregar entregas:', error);
        showToast('Erro ao carregar entregas: ' + error.message, 'error');
        
        // Mostra mensagem no lugar da lista
        const listElement = document.getElementById('deliveries-list');
        listElement.innerHTML = `
            <div class="error-message" style="padding: 20px; text-align: center; background-color: #ffebee; border-radius: 8px; margin-bottom: 20px;">
                <h4 style="color: #d32f2f;">Erro ao carregar entregas</h4>
                <p>Não foi possível carregar as entregas do servidor. Verifique se:</p>
                <ul style="text-align: left; margin-top: 10px;">
                    <li>O servidor backend está rodando na porta 3000</li>
                    <li>O banco de dados MySQL está conectado corretamente</li>
                    <li>Não há erros no console do servidor</li>
                </ul>
                <button onclick="loadDeliveries()" class="btn btn-secondary" style="margin-top: 10px;">
                    Tentar novamente
                </button>
            </div>
        `;
    }
}

// Função para visualizar a rota otimizada
function showOptimizedRoute(route) {
    clearMarkers(); // Limpa marcadores anteriores
    
    const orderedDeliveries = [];
    const allStops = [];
    const confeitariaLocation = { 
        lat: -22.894334936369436, 
        lng: -47.0640515913573,
        address: settings.origin_address
    };
    
    console.log('Ordem otimizada recebida:', route.optimizedOrder);
    
    route.optimizedOrder.forEach((item, index) => {
        // Verifica se é uma parada na confeitaria (tipo pickup)
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
            allStops.push({
                ...stop,
                index: index
            });
        } else {
            // É uma entrega normal
            let stop = deliveryData.find(d => {
                // Tenta diferentes formas de encontrar o ID correto
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
                allStops.push({
                    ...stop,
                    index: index
                });
            }
        }
    });
    
   if (orderedDeliveries.length === 0) {
        console.error('Nenhuma parada encontrada para a rota');
        return;
    }
    
    // Adiciona marcadores personalizados para cada parada
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
            // Armazena os dados completos para o compartilhamento
            currentRoute.completeStops = allStops;
            
            // Centraliza o mapa na rota
            const bounds = result.routes[0].bounds;
            map.fitBounds(bounds);
        } else {
            console.error('Erro ao traçar rota:', status);
            showToast('Erro ao exibir rota no mapa', 'error');
        }
    });
}

// Função para editar uma entrega existente
function editDelivery(id) {
    // Busca os dados da entrega
    const delivery = deliveryData.find(d => d.id === id);
    if (!delivery) return;
    
    // Preenche o formulário
    document.getElementById('edit-delivery-id').value = delivery.id;
    document.getElementById('edit-customer-name').value = delivery.customer_name;
    document.getElementById('edit-customer-phone').value = delivery.customer_phone;
    document.getElementById('edit-address').value = delivery.address;
    document.getElementById('edit-product-description').value = delivery.product_description;
    document.getElementById('edit-priority').value = delivery.priority;
    
    // Mostra o formulário de edição
    document.getElementById('edit-delivery-container').style.display = 'block';
    
    // Rola para o formulário
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

// Limpa todas as entregas do dia
async function clearAllDeliveries() {
    if (!confirm('Tem certeza que deseja limpar todas as entregas deste dia?')) {
        return;
    }
    
    try {
        const routeDate = getRouteDate();
        const response = await fetch(`${API_URL}/deliveries/clear/${routeDate}`, { // CORRETO: usar routeDate
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
    
    // Cria URL do Google Maps com waypoints
    let url = 'https://www.google.com/maps/dir/';
    
    // Adiciona origem
    url += `${encodeURIComponent(settings.origin_address)}/`;
    
    // Adiciona paradas ordenadas
    if (currentRoute.completeStops) {
        // Ignora a primeira parada se for igual à origem e a última se for circular
        currentRoute.completeStops.forEach((stop, index) => {
            const isFirstStop = index === 0;
            const isLastStop = index === currentRoute.completeStops.length - 1;
            
            // Não adicione a origem novamente como primeira parada
            if (isFirstStop && stop.type === 'pickup') {
                return;
            }
            
            // Se a rota é circular, não adicione a origem como última parada
            if (settings.circular_route === 'true' && isLastStop && stop.type === 'pickup') {
                return;
            }
            
            url += `${encodeURIComponent(stop.address)}/`;
        });
    } else {
        // Fallback para usar optimizedOrder
        currentRoute.optimizedOrder.forEach(item => {
            // Verifica se é uma parada na confeitaria
            if (item.type === 'pickup' || item.shipmentId?.startsWith('pickup_')) {
                url += `${encodeURIComponent(settings.origin_address)}/`;
            } else {
                // É uma entrega normal
                const delivery = deliveryData.find(d => 
                    d.id === item.deliveryId || 
                    d.id === parseInt(item.shipmentId?.replace('entrega_', ''))
                );
                if (delivery && delivery.address) {
                    url += `${encodeURIComponent(delivery.address)}/`;
                }
            }
        });
    }
    
    // Adiciona destino (volta à origem se rota circular)
    if (settings.circular_route === 'true') {
        url += `${encodeURIComponent(settings.origin_address)}`;
    }
    
    // Abre em nova aba
    window.open(url, '_blank');
    showToast('Link compartilhado!', 'success');
}

// Adiciona nova entrega
document.getElementById('delivery-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const delivery = Object.fromEntries(formData);
    delivery.order_date = getRouteDate();
    
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
        }
    } catch (error) {
        console.error('Erro ao adicionar entrega:', error);
        showToast('Erro ao adicionar entrega', 'error');
    }
});

// Adiciona evento de submit ao formulário de edição
document.getElementById('edit-delivery-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const id = document.getElementById('edit-delivery-id').value;
    const updatedDelivery = {
        customer_name: document.getElementById('edit-customer-name').value,
        customer_phone: document.getElementById('edit-customer-phone').value,
        address: document.getElementById('edit-address').value,
        product_description: document.getElementById('edit-product-description').value,
        priority: document.getElementById('edit-priority').value
    };
    
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

// Verifica se há uma rota otimizada existente para a data atual
async function checkExistingRoute(date) {
    try {
        // Busca rotas existentes
        const response = await fetch(`${API_URL}/deliveries/routes`);
        if (!response.ok) return;
        
        const routes = await response.json();
        const existingRoute = routes.find(r => r.route_date === date);
        
        if (existingRoute) {
            console.log('Rota existente encontrada:', existingRoute);
            
            // Verifica se há informações de rota otimizada
            if (existingRoute.total_distance && existingRoute.total_duration) {
                // Recria objeto de rota
                currentRoute = {
                    routeId: existingRoute.id,
                    totalDistance: existingRoute.total_distance,
                    totalDuration: existingRoute.total_duration,
                };
                
                // Verifica se há ordem otimizada salva no banco
                if (existingRoute.optimized_order) {
                    try {
                        // Parse da string JSON para objeto
                        currentRoute.optimizedOrder = JSON.parse(existingRoute.optimized_order);
                        
                        // Mostra a rota no mapa
                        showOptimizedRoute(currentRoute);
                        
                        // Habilita botão de iniciar
                        document.getElementById('start-route').disabled = false;
                        
                        console.log('Rota otimizada carregada do banco de dados.');
                        showToast('Rota otimizada carregada', 'success');
                    } catch (e) {
                        console.error('Erro ao processar ordem otimizada:', e);
                    }
                } else {
                    // Se não houver ordem otimizada, atualize apenas as estatísticas
                    updateRouteStats();
                }
            }
        }
    } catch (error) {
        console.error('Erro ao verificar rotas existentes:', error);
    }
}

// Modifica a função de otimização de rota para enviar corretamente as paradas
document.getElementById('optimize-route').addEventListener('click', async () => {
    const optimizeBtn = document.getElementById('optimize-route');
    optimizeBtn.disabled = true;
    optimizeBtn.innerHTML = '<span class="loading"></span> Otimizando...';

    try {
        // Prepara dados com ordem manual e as paradas na confeitaria
        const requestData = {
            date: getRouteDate(),
            manualOrder: manualOrder,
            pickupStops: pickupStops.map(stop => ({
                id: stop.id,
                order: manualOrder[stop.id] || 999
            }))
        };
        
        console.log('Enviando dados para otimização:', requestData);
       
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

// Funções auxiliares
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
    
    // Copia para o clipboard
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

// Função para obter cor baseada na prioridade
function getPriorityColor(priority) {
    switch(parseInt(priority)) {
        case 2: return '#dc3545'; // Vermelho para urgente
        case 1: return '#ffc107'; // Amarelo para alta
        default: return '#28a745'; // Verde para normal
    }
}

function getPriorityLabel(priority) {
    const labels = { 0: 'Normal', 1: 'Alta', 2: 'Urgente' };
    return labels[priority] || 'Normal';
}

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
        // Troca as posições
        const allItems = [...document.querySelectorAll('.delivery-item')];
        const draggedIndex = allItems.indexOf(draggedElement);
        const targetIndex = allItems.indexOf(this);
        
        if (draggedIndex < targetIndex) {
            this.parentNode.insertBefore(draggedElement, this.nextSibling);
        } else {
            this.parentNode.insertBefore(draggedElement, this);
        }
        
        // Atualiza ordem manual baseada na nova posição
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
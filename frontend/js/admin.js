// js/admin.js
const API_URL = window.API_URL || 'http://localhost:3000/api';
const socket = io(window.API_CONFIG?.SOCKET_URL || 'http://localhost:3000');

let map;
let directionsService;
let directionsRenderer;
let markers = [];
let currentRoute = null;
let driverMarker = null;
let settings = {
    circular_route: 'true',
    origin_address: 'R. Barata Ribeiro, 466 - Vila Itapura, Campinas - SP, 13023-030'
};

// Inicializa o mapa
function initMap() {
    // Coordenadas da confeitaria em Vila Itapura
    const confeitariaLocation = { lat: -22.894334936369436, lng: -47.0640515913573 };
    
    map = new google.maps.Map(document.getElementById('map'), {
        center: confeitariaLocation,
        zoom: 13
    });
    
    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer();
    directionsRenderer.setMap(map);
    
    // Adiciona marcador da confeitaria
    new google.maps.Marker({
        position: confeitariaLocation,
        map: map,
        title: 'Confeitaria',
        icon: 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png'
    });
}

// Carrega entregas do dia
async function loadDeliveries() {
    try {
        const response = await fetch(`${API_URL}/deliveries`);
        const deliveries = await response.json();
        
        // Armazena dados das entregas
        deliveryData = deliveries;
        
        const listElement = document.getElementById('deliveries-list');
        listElement.innerHTML = '';
        
        deliveries.forEach(delivery => {
            const deliveryElement = document.createElement('div');
            deliveryElement.className = 'delivery-item';
            deliveryElement.innerHTML = `
                <div class="delivery-header">
                    <h3>${delivery.customer_name}</h3>
                    <span class="priority priority-${delivery.priority}">${getPriorityLabel(delivery.priority)}</span>
                </div>
                <p>${delivery.address}</p>
                <p>${delivery.product_description} - ${getSizeLabel(delivery.size)}</p>
                <div class="delivery-actions">
                    <button onclick="showDeliveryOnMap(${delivery.lat}, ${delivery.lng})">Ver no Mapa</button>
                    <button onclick="generateTrackingLink(${delivery.id})">Link Rastreamento</button>
                    ${delivery.status === 'in_transit' ? `<button onclick="completeDelivery(${delivery.id})">Marcar Entregue</button>` : ''}
                    <button onclick="deleteDelivery(${delivery.id}, '${delivery.status}')" class="btn-danger">Excluir</button>
                </div>
                <span class="status status-${delivery.status}">${getStatusLabel(delivery.status)}</span>
            `;
            listElement.appendChild(deliveryElement);
        });
        
        // Adiciona marcadores no mapa
        clearMarkers();
        deliveries.forEach(delivery => {
            const marker = new google.maps.Marker({
                position: { lat: parseFloat(delivery.lat), lng: parseFloat(delivery.lng) },
                map: map,
                title: delivery.customer_name,
                icon: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png'
            });
            markers.push(marker);
        });
    } catch (error) {
        console.error('Erro ao carregar entregas:', error);
    }
}

// Adiciona nova entrega
document.getElementById('delivery-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const delivery = Object.fromEntries(formData);
    
    try {
        const response = await fetch(`${API_URL}/deliveries`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(delivery)
        });
        
        if (response.ok) {
            alert('Entrega adicionada com sucesso!');
            e.target.reset();
            loadDeliveries();
        }
    } catch (error) {
        console.error('Erro ao adicionar entrega:', error);
    }
});

// Otimiza rota
document.getElementById('optimize-route').addEventListener('click', async () => {
    console.log('Botão otimizar clicado');
    
    // Limpa rota anterior
    directionsRenderer.setDirections({routes: []});
    currentRoute = null;
    document.getElementById('start-route').disabled = true;
    
    // Desabilita o botão temporariamente para evitar cliques múltiplos
    const optimizeBtn = document.getElementById('optimize-route');
    optimizeBtn.disabled = true;
    optimizeBtn.textContent = 'Otimizando...';
    
    try {
        const response = await fetch(`${API_URL}/deliveries/optimize`, {
            method: 'POST'
        });
        
        console.log('Resposta:', response);
        
        const result = await response.json();
        console.log('Resultado:', result);
        
        if (result.routeId) {
            currentRoute = result;
            alert(`Rota otimizada com sucesso!\n${result.totalDeliveries} entregas incluídas.`);
            showOptimizedRoute(result);
            document.getElementById('start-route').disabled = false;
            
            // Recarrega a lista para mostrar os status atualizados
            loadDeliveries();
        } else if (result.message) {
            alert(result.message);
        }
    } catch (error) {
        console.error('Erro ao otimizar rota:', error);
        alert('Erro ao otimizar rota. Verifique o console.');
    } finally {
        // Reabilita o botão
        optimizeBtn.disabled = false;
        optimizeBtn.textContent = 'Otimizar Rota';
    }
});

// Mostra rota otimizada no mapa
function showOptimizedRoute(route) {
    console.log('Mostrando rota otimizada:', route);
    
    // Encontra as entregas na ordem otimizada
    const orderedDeliveries = [];
    route.optimizedOrder.forEach(item => {
        const delivery = deliveryData.find(d => d.id === item.deliveryId || d.id === parseInt(item.shipmentId.replace('entrega_', '')));
        if (delivery) {
            orderedDeliveries.push({
                location: { lat: parseFloat(delivery.lat), lng: parseFloat(delivery.lng) },
                stopover: true
            });
        }
    });
    
    if (orderedDeliveries.length === 0) {
        console.error('Nenhuma entrega encontrada para a rota');
        return;
    }
    
    // Define origem como a confeitaria (Vila Itapura)
    const origin = { lat: -22.894334936369436, lng: -47.0640515913573 };
    
    // Define destino baseado na configuração de rota circular
    const destination = settings.circular_route === 'true' 
        ? origin // Volta para a confeitaria
        : orderedDeliveries[orderedDeliveries.length - 1].location; // Última entrega
    
    const request = {
        origin: origin,
        destination: destination,
        waypoints: orderedDeliveries,
        optimizeWaypoints: false, // Já está otimizado pelo backend
        travelMode: 'DRIVING'
    };
    
    console.log('Request para DirectionsService:', request);
    
    directionsService.route(request, (result, status) => {
        if (status === 'OK') {
            directionsRenderer.setDirections(result);
        } else {
            console.error('Erro ao desenhar rota:', status);
        }
    });
}

// Variável global para armazenar dados das entregas
let deliveryData = [];

// Inicia rota
document.getElementById('start-route').addEventListener('click', async () => {
    if (!currentRoute) return;
    
    try {
        const response = await fetch(`${API_URL}/deliveries/routes/${currentRoute.routeId}/start`, {
            method: 'POST'
        });
        
        if (response.ok) {
            alert('Rota iniciada! Rastreamento ativado.');
            document.getElementById('track-driver').disabled = false;
            startTracking();
        }
    } catch (error) {
        console.error('Erro ao iniciar rota:', error);
    }
});

// Inicia rastreamento
function startTracking() {
    // Simula posição do entregador (em produção, viria do app do entregador)
    navigator.geolocation.watchPosition((position) => {
        const location = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
        };
        
        updateDriverLocation(location);
        socket.emit('update-location', {
            routeId: currentRoute.routeId,
            lat: location.lat,
            lng: location.lng,
            timestamp: new Date()
        });
    });
}

// Atualiza localização do entregador
function updateDriverLocation(location) {
    if (driverMarker) {
        driverMarker.setPosition(location);
    } else {
        driverMarker = new google.maps.Marker({
            position: location,
            map: map,
            title: 'Entregador',
            icon: {
                url: 'http://maps.google.com/mapfiles/ms/icons/green-dot.png',
                scaledSize: new google.maps.Size(40, 40)
            }
        });
    }
}

// Completa entrega
async function completeDelivery(deliveryId) {
    try {
        const response = await fetch(`${API_URL}/deliveries/${deliveryId}/complete`, {
            method: 'POST'
        });
        
        if (response.ok) {
            alert('Entrega concluída!');
            loadDeliveries();
        }
    } catch (error) {
        console.error('Erro ao completar entrega:', error);
    }
}

// Exclui entrega
async function deleteDelivery(deliveryId, status) {
    let confirmMessage = 'Tem certeza que deseja excluir esta entrega?';
    
    if (status === 'delivered') {
        confirmMessage = 'Esta entrega já foi realizada. Tem certeza que deseja excluir do histórico?';
    }
    
    if (!confirm(confirmMessage)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/deliveries/${deliveryId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (response.ok) {
            alert('Entrega excluída com sucesso!');
            loadDeliveries();
        } else {
            alert(result.error || 'Erro ao excluir entrega');
        }
    } catch (error) {
        console.error('Erro ao excluir entrega:', error);
        alert('Erro ao excluir entrega');
    }
}

// Gera link de rastreamento
function generateTrackingLink(deliveryId) {
    const trackingUrl = `${window.location.origin}/tracking.html?id=${deliveryId}`;
    prompt('Link de rastreamento:', trackingUrl);
}

// Mostra entrega no mapa
function showDeliveryOnMap(lat, lng) {
    map.setCenter({ lat: parseFloat(lat), lng: parseFloat(lng) });
    map.setZoom(17);
}

// Funções auxiliares
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

// Inicializa quando a página carrega
window.onload = () => {
    initMap();
    loadDeliveries();
    loadSettings();
    
    // Configura autocomplete para endereço
    const autocomplete = new google.maps.places.Autocomplete(
        document.getElementById('address-input'),
        { 
            types: ['address'],
            componentRestrictions: { country: 'br' }
        }
    );
};

// Socket.io listeners
socket.on('location-update', (data) => {
    updateDriverLocation({ lat: data.lat, lng: data.lng });
});

socket.on('delivery-completed', (data) => {
    loadDeliveries();
});

socket.on('delivery-approaching', (data) => {
    alert(`Entregador se aproximando da entrega ${data.deliveryId}!`);
});

// Funções de configurações
async function loadSettings() {
    try {
        const response = await fetch(`${API_URL}/settings`);
        const data = await response.json();
        
        settings = { ...settings, ...data };
        
        // Atualiza interface
        document.getElementById('circular-route').checked = settings.circular_route === 'true';
        document.getElementById('origin-address').value = settings.origin_address || 'R. Barata Ribeiro, 466 - Vila Itapura, Campinas - SP, 13023-030';
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
    
    const newSettings = {
        circular_route: circularRoute ? 'true' : 'false',
        origin_address: originAddress
    };
    
    try {
        const response = await fetch(`${API_URL}/settings/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newSettings)
        });
        
        if (response.ok) {
            settings = { ...settings, ...newSettings };
            alert('Configurações salvas com sucesso!');
            closeSettings();
        }
    } catch (error) {
        console.error('Erro ao salvar configurações:', error);
        alert('Erro ao salvar configurações');
    }
}

// Fecha modal ao clicar fora dele
window.onclick = function(event) {
    const modal = document.getElementById('settings-modal');
    if (event.target == modal) {
        closeSettings();
    }
}
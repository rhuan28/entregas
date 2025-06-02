// frontend/js/tracking.js - Cliente de rastreamento
const API_URL = window.API_URL || 'http://localhost:3000/api';
const socket = io(window.API_CONFIG?.SOCKET_URL || 'http://localhost:3000');

let map;
let deliveryMarker;
let driverMarker;
let directionsService;
let directionsRenderer;

// Inicializa página de rastreamento
document.addEventListener('DOMContentLoaded', function() {
    // Obtém ID da entrega da URL
    const urlParams = new URLSearchParams(window.location.search);
    const deliveryId = urlParams.get('id');
    
    if (deliveryId) {
        loadDeliveryInfo(deliveryId);
        initMap();
        startTracking(deliveryId);
    } else {
        showError('ID da entrega não fornecido');
    }
});

// Carrega informações da entrega
async function loadDeliveryInfo(deliveryId) {
    try {
        const response = await fetch(`${API_URL}/tracking/delivery/${deliveryId}`);
        
        if (!response.ok) {
            throw new Error('Entrega não encontrada');
        }
        
        const data = await response.json();
        displayDeliveryInfo(data.delivery);
        updateStatus(data.delivery.status);
        
        if (data.delivery.lat && data.delivery.lng) {
            updateMapWithDelivery(data.delivery);
        }
        
        if (data.lastLocation) {
            updateDriverLocation(data.lastLocation);
        }
        
    } catch (error) {
        console.error('Erro ao carregar informações da entrega:', error);
        showError('Não foi possível carregar as informações da entrega');
    }
}

// Exibe informações da entrega
function displayDeliveryInfo(delivery) {
    const deliveryInfo = document.getElementById('delivery-info');
    
    deliveryInfo.innerHTML = `
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3>${delivery.customer_name}</h3>
            <p><strong>📍 Endereço:</strong> ${delivery.address}</p>
            <p><strong>📦 Produto:</strong> ${delivery.product_description}</p>
            ${delivery.customer_phone ? `<p><strong>📞 Telefone:</strong> ${delivery.customer_phone}</p>` : ''}
            <p><strong>📅 Data:</strong> ${new Date(delivery.order_date + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
        </div>
    `;
}

// Atualiza status na timeline
function updateStatus(status) {
    // Remove classes ativas anteriores
    document.querySelectorAll('.timeline-item').forEach(item => {
        item.classList.remove('active', 'completed');
    });
    
    // Status que já foram completados
    const statusOrder = ['pending', 'optimized', 'in_transit', 'delivered'];
    const currentIndex = statusOrder.indexOf(status);
    
    statusOrder.forEach((statusName, index) => {
        const element = document.getElementById(`status-${statusName}`);
        if (element) {
            if (index < currentIndex) {
                element.classList.add('completed');
            } else if (index === currentIndex) {
                element.classList.add('active');
            }
        }
    });
    
    // Atualiza ETA baseado no status
    updateETA(status);
}

// Atualiza tempo estimado
function updateETA(status) {
    const etaElement = document.getElementById('eta');
    
    switch (status) {
        case 'pending':
            etaElement.textContent = 'Aguardando preparação';
            break;
        case 'optimized':
            etaElement.textContent = 'Preparando para entrega';
            break;
        case 'in_transit':
            etaElement.textContent = 'Em trânsito - chegada em aprox. 15-30 min';
            break;
        case 'delivered':
            etaElement.textContent = 'Entregue! ✅';
            break;
        default:
            etaElement.textContent = 'Calculando...';
    }
}

// Inicializa mapa
function initMap() {
    // Coordenadas padrão (Campinas)
    const defaultLocation = { lat: -22.8949, lng: -47.0653 };
    
    map = new google.maps.Map(document.getElementById('tracking-map'), {
        center: defaultLocation,
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
        }
    });
    directionsRenderer.setMap(map);
}

// Atualiza mapa com localização da entrega
function updateMapWithDelivery(delivery) {
    const deliveryLocation = {
        lat: parseFloat(delivery.lat),
        lng: parseFloat(delivery.lng)
    };
    
    // Centraliza mapa na entrega
    map.setCenter(deliveryLocation);
    map.setZoom(15);
    
    // Adiciona marcador da entrega
    if (deliveryMarker) {
        deliveryMarker.setMap(null);
    }
    
    deliveryMarker = new google.maps.Marker({
        position: deliveryLocation,
        map: map,
        title: 'Local de Entrega',
        icon: {
            url: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png',
            scaledSize: new google.maps.Size(40, 40)
        }
    });
    
    // InfoWindow para o marcador
    const infoWindow = new google.maps.InfoWindow({
        content: `
            <div style="padding: 10px;">
                <h4>${delivery.customer_name}</h4>
                <p>${delivery.address}</p>
                <p>${delivery.product_description}</p>
            </div>
        `
    });
    
    deliveryMarker.addListener('click', () => {
        infoWindow.open(map, deliveryMarker);
    });
}

// Atualiza localização do entregador
function updateDriverLocation(location) {
    const driverLocation = {
        lat: parseFloat(location.lat),
        lng: parseFloat(location.lng)
    };
    
    // Atualiza marcador do entregador
    if (driverMarker) {
        driverMarker.setPosition(driverLocation);
    } else {
        driverMarker = new google.maps.Marker({
            position: driverLocation,
            map: map,
            title: 'Entregador',
            icon: {
                url: 'http://maps.google.com/mapfiles/ms/icons/green-dot.png',
                scaledSize: new google.maps.Size(40, 40)
            }
        });
    }
    
    // Calcular e mostrar rota se temos ambas as localizações
    if (deliveryMarker && driverMarker) {
        showRoute(driverLocation, deliveryMarker.getPosition());
    }
    
    // Atualizar timestamp
    const timestamp = new Date(location.timestamp).toLocaleTimeString('pt-BR');
    document.getElementById('eta').textContent = `Última atualização: ${timestamp}`;
}

// Mostra rota entre entregador e destino
function showRoute(origin, destination) {
    const request = {
        origin: origin,
        destination: destination,
        travelMode: google.maps.TravelMode.DRIVING
    };
    
    directionsService.route(request, (result, status) => {
        if (status === 'OK') {
            directionsRenderer.setDirections(result);
            
            // Atualizar ETA com tempo real
            const route = result.routes[0];
            const leg = route.legs[0];
            document.getElementById('eta').textContent = `Chegada em: ${leg.duration.text}`;
        }
    });
}

// Inicia rastreamento em tempo real
function startTracking(deliveryId) {
    // Conecta ao socket para atualizações em tempo real
    socket.on('connect', () => {
        console.log('Conectado ao rastreamento em tempo real');
        socket.emit('join-route', `delivery-${deliveryId}`);
    });
    
    // Escuta atualizações de localização
    socket.on('location-update', (data) => {
        if (data.deliveryId == deliveryId) {
            updateDriverLocation({
                lat: data.lat,
                lng: data.lng,
                timestamp: data.timestamp
            });
        }
    });
    
    // Escuta quando entrega é concluída
    socket.on('delivery-completed', (data) => {
        if (data.deliveryId == deliveryId) {
            updateStatus('delivered');
            showSuccessMessage('Sua entrega foi concluída! 🎉');
        }
    });
    
    // Escuta quando entregador está se aproximando
    socket.on('delivery-approaching', (data) => {
        if (data.deliveryId == deliveryId) {
            showNotification('Entregador chegando! 🚚');
        }
    });
    
    // Atualizar informações periodicamente
    setInterval(() => {
        loadDeliveryInfo(deliveryId);
    }, 30000); // A cada 30 segundos
}

// Mostra mensagem de sucesso
function showSuccessMessage(message) {
    const successDiv = document.createElement('div');
    successDiv.innerHTML = `
        <div style="background: #4CAF50; color: white; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; font-size: 18px; font-weight: bold;">
            ${message}
        </div>
    `;
    
    document.querySelector('.tracking-container').insertBefore(
        successDiv, 
        document.querySelector('.tracking-status')
    );
}

// Mostra notificação
function showNotification(message) {
    // Criar elemento de notificação
    const notification = document.createElement('div');
    notification.innerHTML = `
        <div style="position: fixed; top: 20px; right: 20px; background: #E5B5B3; color: white; padding: 15px 20px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.2); z-index: 1000; font-weight: bold;">
            ${message}
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Remover após 5 segundos
    setTimeout(() => {
        document.body.removeChild(notification);
    }, 5000);
    
    // Tentar mostrar notificação do navegador também
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Atualização da Entrega', {
            body: message,
            icon: '/assets/logo-demiplie.png'
        });
    }
}

// Mostra erro
function showError(message) {
    const deliveryInfo = document.getElementById('delivery-info');
    deliveryInfo.innerHTML = `
        <div style="background: #f44336; color: white; padding: 20px; border-radius: 8px; text-align: center;">
            <h3>Erro</h3>
            <p>${message}</p>
        </div>
    `;
}

// Solicitar permissão para notificações quando a página carregar
if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
}
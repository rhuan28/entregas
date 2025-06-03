// frontend/js/routes.js - Versão corrigida e atualizada

const API_URL = window.API_URL || 'http://localhost:3000/api';
const socket = typeof io !== 'undefined' ? io(window.API_CONFIG?.SOCKET_URL || 'http://localhost:3000') : null;

let map;
let directionsService;
let directionsRenderer;
let markers = [];
let currentRoute = null;
let driverMarker = null;
let deliveryData = [];
let pickupStops = [];
let manualOrder = {};

const PRODUCT_CONFIG = {
    'bentocake': { name: 'Bentocake', priority: 0, size: 'P', description: 'Bentocake individual', color: '#28a745' },
    '6fatias': { name: '6 fatias', priority: 1, size: 'P', description: 'Bolo de 6 fatias', color: '#ffc107' },
    '10fatias': { name: '10 fatias', priority: 2, size: 'M', description: 'Bolo de 10 fatias', color: '#fd7e14' },
    '18fatias': { name: '18 fatias', priority: 2, size: 'M', description: 'Bolo de 18 fatias', color: '#fd7e14' },
    '24fatias': { name: '24 fatias', priority: 2, size: 'G', description: 'Bolo de 24 fatias', color: '#fd7e14' },
    '30fatias': { name: '30 fatias', priority: 2, size: 'G', description: 'Bolo de 30 fatias', color: '#fd7e14' },
    '40fatias': { name: '40 fatias', priority: 2, size: 'GG', description: 'Bolo de 40 fatias', color: '#fd7e14' },
    'personalizado': { name: 'Personalizado', priority: 0, size: 'M', description: 'Produto personalizado', color: '#28a745' }
};

const PRIORITY_LABELS = {
    0: 'Normal',
    1: 'Média',
    2: 'Alta',
    3: 'Urgente'
};

let settings = {
    circular_route: 'true',
    origin_address: 'R. Barata Ribeiro, 466 - Vila Itapura, Campinas - SP, 13023-030',
    stop_time: '8',
    daily_rate: '100',
    km_rate: '2.50'
};

let confeitariaLocation = {
    lat: -22.894334936369436,
    lng: -47.0640515913573,
    address: settings.origin_address
};

// --- Funções de Interface e Utilitários ---

function showToast(message, type = 'info') {
    const toastContainer = document.body;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';

    toast.innerHTML = `
        <span style="font-size: 1.2em; margin-right: 8px;">${icon}</span>
        <span>${message}</span>
        <button onclick="this.parentElement.remove()" style="background:none;border:none;color:inherit;font-size:1.2em;margin-left:auto;padding:0 5px;cursor:pointer;">×</button>
    `;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    }, 10);

    setTimeout(() => {
        if (toast.parentElement) {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            setTimeout(() => {
                if (toast.parentElement) {
                    toastContainer.removeChild(toast);
                }
            }, 300);
        }
    }, 4000);
}

function getPriorityLabel(priority) {
    const p = parseInt(priority);
    return PRIORITY_LABELS[p] || 'Normal';
}

function getPriorityColor(priority) {
    switch(parseInt(priority)) {
        case 3: return '#dc3545';
        case 2: return '#fd7e14';
        case 1: return '#ffc107';
        default: return '#28a745';
    }
}

function getPriorityEmoji(priority) {
    switch(parseInt(priority)) {
        case 3: return '🔴';
        case 2: return '🟠';
        case 1: return '🟡';
        default: return '🟢';
    }
}

function getPriorityClass(priority) {
    switch(parseInt(priority)) {
        case 3: return 'urgente';
        case 2: return 'alta';
        case 1: return 'media';
        default: return 'normal';
    }
}

function updateProductInfo() {
    const productSelect = document.getElementById('product-select');
    const prioritySelect = document.getElementById('priority-select');

    if (productSelect && productSelect.value && PRODUCT_CONFIG[productSelect.value]) {
        const config = PRODUCT_CONFIG[productSelect.value];
        if (prioritySelect) {
            prioritySelect.value = config.priority;
        }
    }
}

function updateEditProductInfo() {
    const productSelect = document.getElementById('edit-product-select');
    const prioritySelect = document.getElementById('edit-priority-select');

    if (productSelect && productSelect.value && PRODUCT_CONFIG[productSelect.value]) {
        const config = PRODUCT_CONFIG[productSelect.value];
        if (prioritySelect) {
            prioritySelect.value = config.priority;
        }
    }
}

function getProductDisplayName(productType) {
    return PRODUCT_CONFIG[productType]?.name || productType || 'Produto não especificado';
}

function getRouteDate() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('date') || new Date().toISOString().split('T')[0];
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

// --- Funções do Mapa ---

function initMap() {
    if (typeof google === 'undefined' || typeof google.maps === 'undefined') {
        console.error("Google Maps API não carregada. Não é possível inicializar o mapa.");
        showToast("Erro ao carregar API do Mapa. Verifique a conexão ou a chave da API.", "error");
        if (!document.getElementById('google-maps-api-script-retry')) {
             const apiKeyEl = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
             if (apiKeyEl){
                 const apiKey = apiKeyEl.src.split('key=')[1].split('&')[0];
                 const script = document.createElement('script');
                 script.id = 'google-maps-api-script-retry';
                 script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=onGoogleMapsApiLoaded`;
                 script.async = true;
                 script.defer = true;
                 document.head.appendChild(script);
             } else {
                console.error("Não foi possível encontrar a chave da API do Google Maps no HTML.");
             }
        }
        return;
    }

    const initialCenter = { lat: parseFloat(confeitariaLocation.lat), lng: parseFloat(confeitariaLocation.lng) };

    try {
        map = new google.maps.Map(document.getElementById('map'), {
            center: initialCenter,
            zoom: 13,
            styles: [{ featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] }]
        });

        directionsService = new google.maps.DirectionsService();
        directionsRenderer = new google.maps.DirectionsRenderer({
            polylineOptions: { strokeColor: '#E5B5B3', strokeWeight: 4 },
            markerOptions: { visible: false }
        });
        directionsRenderer.setMap(map);

        new google.maps.Marker({
            position: initialCenter,
            map: map,
            title: 'Confeitaria Demiplié',
            icon: {
                url: 'assets/logo-demiplie.png',
                scaledSize: new google.maps.Size(35, 35),
                anchor: new google.maps.Point(17, 35)
            },
            zIndex: 1000
        });
        console.log("Mapa inicializado com centro em:", initialCenter);
    } catch (error) {
        console.error('Erro ao inicializar mapa:', error);
        showToast("Erro ao inicializar o mapa.", "error");
        const mapDiv = document.getElementById('map');
        if(mapDiv) mapDiv.innerHTML = "<p style='text-align:center;padding:20px;color:red;'>Não foi possível carregar o mapa.</p>";
    }
}

window.onGoogleMapsApiLoaded = function() {
    console.log("Google Maps API carregada via callback.");
    initMap();
    if (typeof loadPageData === "function") { // Se tiver uma função principal de carregamento
        loadPageData();
    } else { // Fallback para carregar settings e deliveries se não houver uma principal
        if (typeof loadSettings === "function") loadSettings();
        if (typeof loadDeliveries === "function") loadDeliveries();
    }
};

function clearMarkers() {
    markers.forEach(marker => marker.setMap(null));
    markers = [];
}

function updateMapMarkers(itemsToMark) {
    clearMarkers();
    if (!itemsToMark || typeof google === 'undefined' || !google.maps) return;

    itemsToMark.forEach((item, idx) => {
        if (!item || typeof item.lat === 'undefined' || typeof item.lng === 'undefined') {
            console.warn("Item inválido ou sem coordenadas para marcar:", item);
            return;
        }

        const markerLabel = typeof item.indexInRoute !== 'undefined' ? (item.indexInRoute + 1).toString() : (idx + 1).toString();
        const markerIconConfig = {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: item.type === 'pickup' ? '#FFB6C1' : getPriorityColor(item.priority || 0),
            fillOpacity: 0.9,
            strokeColor: 'white',
            strokeWeight: 2
        };

        const marker = new google.maps.Marker({
            position: { lat: parseFloat(item.lat), lng: parseFloat(item.lng) },
            map: map,
            title: item.type === 'pickup' ? (item.customer_name || 'Confeitaria') : (item.customer_name || 'Entrega'),
            icon: markerIconConfig,
            label: {
                text: markerLabel,
                color: 'white',
                fontSize: '12px',
                fontWeight: 'bold'
            },
            zIndex: 100 + (typeof item.indexInRoute !== 'undefined' ? item.indexInRoute : idx)
        });

        const infoContent = `
            <div style="padding: 10px; font-family: Arial, sans-serif; font-size: 14px; max-width: 250px;">
                <h4 style="margin: 0 0 5px 0; color: #333;">${marker.getTitle()}</h4>
                ${item.order_number ? `<p style="margin: 3px 0;"><strong>Pedido:</strong> #${item.order_number}</p>` : ''}
                ${item.product_name && item.type !== 'pickup' ? `<p style="margin: 3px 0;"><strong>Produto:</strong> ${item.product_name}</p>` : ''}
                <p style="margin: 3px 0;"><strong>Endereço:</strong> ${item.address || 'N/A'}</p>
                ${item.type !== 'pickup' ? `<p style="margin: 3px 0;"><strong>Prioridade:</strong> ${getPriorityLabel(item.priority || 0)}</p>` : ''}
                ${item.product_description && item.type !== 'pickup' ? `<p style="margin: 3px 0;"><strong>Detalhes:</strong> ${item.product_description}</p>` : ''}
            </div>
        `;
        
        const infoWindow = new google.maps.InfoWindow({ content: infoContent });
        marker.addListener('click', () => { infoWindow.open(map, marker); });
        markers.push(marker);
    });
}

function showOptimizedRoute(route) {
    if (typeof google === 'undefined' || !google.maps || !map || !directionsService || !directionsRenderer) {
        console.error("Mapa ou serviços de direção não estão prontos para mostrar rota otimizada.");
        showToast("Mapa não está pronto para exibir a rota.", "error");
        return;
    }

    clearMarkers();

    const orderedWaypoints = [];
    const allStopsForDisplay = [];

    // Usa confeitariaLocation global que é atualizada por loadSettings
    // const currentConfeitariaLocation = { ...confeitariaLocation };

    if (!route || !route.optimizedOrder || route.optimizedOrder.length === 0) {
        console.warn("showOptimizedRoute chamada sem optimizedOrder válido ou com optimizedOrder vazio.");
        if (directionsRenderer) directionsRenderer.setDirections({ routes: [] });
        updateMapMarkers(deliveryData || []);
        return;
    }
    
    route.optimizedOrder.forEach((item, index) => {
        let stopDetails;
        if (item.type === 'pickup') {
            stopDetails = {
                id: item.id || item.deliveryId || item.shipmentId,
                lat: parseFloat(item.lat) || confeitariaLocation.lat,
                lng: parseFloat(item.lng) || confeitariaLocation.lng,
                address: item.address || confeitariaLocation.address,
                type: 'pickup',
                customer_name: 'Confeitaria Demiplié',
                product_description: 'Parada na confeitaria',
                priority: item.priority || 0,
                order: item.order
            };
        } else {
            const fullDeliveryDetails = (deliveryData || []).find(d => d.id === item.deliveryId);
            stopDetails = {
                ...item,
                customer_name: fullDeliveryDetails?.customer_name || item.customer_name || 'Cliente Desconhecido',
                product_description: fullDeliveryDetails?.product_description || item.product_description || 'Produto não especificado',
            };
        }
        
        if (stopDetails.address) {
            orderedWaypoints.push({
                location: stopDetails.address,
                stopover: true
            });
        } else {
            console.warn("Parada sem endereço não será adicionada aos waypoints:", stopDetails);
        }
        allStopsForDisplay.push({ ...stopDetails, indexInRoute: index });
    });

    if (orderedWaypoints.length === 0) {
        console.warn('Nenhuma parada válida com endereço para desenhar a rota otimizada.');
        if (directionsRenderer) directionsRenderer.setDirections({ routes: [] });
        updateMapMarkers(allStopsForDisplay.length > 0 ? allStopsForDisplay : (deliveryData || []));
        return;
    }

    updateMapMarkers(allStopsForDisplay);

    const origin = settings.origin_address;
    let waypointsForAPIRequest = [];
    let destinationForAPIRequest;

    if (orderedWaypoints.length === 1) { // Apenas um destino (além da origem)
        destinationForAPIRequest = orderedWaypoints[0].location;
    } else { // Múltiplas paradas
        // Todos os endereços em orderedWaypoints, exceto o último, são waypoints
        waypointsForAPIRequest = orderedWaypoints.slice(0, -1).map(wp => ({ location: wp.location, stopover: true }));
        destinationForAPIRequest = orderedWaypoints[orderedWaypoints.length - 1].location;
    }

    // Se a rota é circular, o destino final é a origem, e todas as paradas em orderedWaypoints são waypoints
    if (settings.circular_route === 'true') {
        if (orderedWaypoints.length > 0) {
            waypointsForAPIRequest = orderedWaypoints.map(wp => ({ location: wp.location, stopover: true }));
        }
        destinationForAPIRequest = origin; // Destino é a confeitaria
    }
    
    const request = {
        origin: origin,
        destination: destinationForAPIRequest,
        waypoints: waypointsForAPIRequest,
        optimizeWaypoints: false,
        travelMode: google.maps.TravelMode.DRIVING,
        language: 'pt-BR'
    };
    
    console.log("Enviando requisição para DirectionsService:", JSON.stringify(request, null, 2));

    directionsService.route(request, (result, status) => {
        if (status === google.maps.DirectionsStatus.OK) {
            directionsRenderer.setDirections(result);
            if (result.routes && result.routes[0] && result.routes[0].bounds) {
                map.fitBounds(result.routes[0].bounds);
            }
        } else {
            console.error('Erro ao traçar rota otimizada no DirectionsService:', status, result);
            showToast(`Erro ao exibir rota otimizada no mapa: ${status}`, 'error');
        }
    });
    updateRouteStats();
}

// --- Carregamento de Dados ---

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
        deliveryData = deliveries;
        console.log(`Dados de entregas recebidos: ${deliveryData.length} entregas`);

        await checkExistingRoute(routeDate);

        renderDeliveriesList();
        updateRouteStats();

        if (!currentRoute || !currentRoute.optimizedOrder || currentRoute.optimizedOrder.length === 0) {
            updateMapMarkers(deliveryData);
        }
        
    } catch (error) {
        console.error('Erro ao carregar entregas:', error);
        showToast('Erro ao carregar entregas: ' + error.message, 'error');
        const listElement = document.getElementById('deliveries-list');
        if (listElement) {
            listElement.innerHTML = `<div class="error-message" style="padding: 20px; text-align: center; background-color: #ffebee; border-radius: 8px; margin-bottom: 20px;"><h4 style="color: #d32f2f;">Erro ao carregar entregas</h4><p>Não foi possível carregar as entregas do servidor.</p><button onclick="loadDeliveries()" class="btn btn-secondary" style="margin-top: 10px;">Tentar novamente</button></div>`;
        }
    }
}

function renderDeliveriesList() {
    const listElement = document.getElementById('deliveries-list');
    if (!listElement) return;
    listElement.innerHTML = '';

    let allDisplayItems = [...deliveryData.map(d => ({ ...d, type: 'delivery' }))];

    pickupStops.forEach((stop, index) => {
        allDisplayItems.push({
            ...stop,
            id: stop.id || `pickup_${Date.now()}_${index}`,
            customer_name: 'Confeitaria Demiplié',
            product_description: 'Parada na confeitaria',
            priority: stop.priority || 0,
            type: 'pickup'
        });
    });

    allDisplayItems.sort((a, b) => {
        const orderA = manualOrder[a.id] || 999;
        const orderB = manualOrder[b.id] || 999;
        if (orderA !== orderB) return orderA - orderB;
        if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
        return (a.id < b.id) ? -1 : 1;
    });

    if (allDisplayItems.length === 0) {
        listElement.innerHTML = '<p style="text-align:center; padding: 20px; color: #777;">Nenhuma entrega para exibir.</p>';
    } else {
        allDisplayItems.forEach((item, index) => {
            const itemElement = document.createElement('div');
            itemElement.className = 'delivery-item draggable';
            itemElement.draggable = true;
            itemElement.dataset.itemId = item.id;
            itemElement.dataset.itemType = item.type;
            
            itemElement.innerHTML = renderDeliveryItemContent(item, index);
            
            itemElement.addEventListener('dragstart', handleDragStart);
            itemElement.addEventListener('dragend', handleDragEnd);
            itemElement.addEventListener('dragover', handleDragOver);
            itemElement.addEventListener('drop', handleDrop);
            itemElement.addEventListener('dragleave', handleDragLeave);
            
            listElement.appendChild(itemElement);
        });
    }
}

function renderDeliveryItemContent(item, index) {
    if (typeof window.renderDeliveryItem === 'function') {
        return window.renderDeliveryItem(item, index);
    }

    const orderNumberDisplay = item.order_number ? `<p><strong>📋 Pedido #:</strong> ${item.order_number}</p>` : '';
    const productDisplay = item.product_name ? `<span class="priority-indicator priority-${getPriorityClass(item.priority)}">${item.product_name}</span>` : '';
    const priorityEmoji = getPriorityEmoji(item.priority);

    let content = `
        <div class="delivery-header">
            <h3>${item.customer_name} ${productDisplay}</h3>
            <span class="priority priority-${getPriorityClass(item.priority)}" style="background-color: ${getPriorityColor(item.priority)}; color: white; padding: 3px 7px; border-radius: 4px; font-size: 0.9em;">
                ${priorityEmoji} ${getPriorityLabel(item.priority)}
            </span>
        </div>
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
                       onchange="updateManualOrder('${item.id}', this.value)"
                       style="width:50px; padding:3px; text-align:center;">
            </div>
            <button onclick="editDelivery('${item.id}')" class="btn btn-secondary btn-sm">✏️ Editar</button>
            <button onclick="showDeliveryOnMap(${parseFloat(item.lat)}, ${parseFloat(item.lng)})" class="btn btn-secondary btn-sm">🗺️ Mapa</button>
            <button onclick="generateTrackingLink('${item.id}')" class="btn btn-info btn-sm">🔗 Link</button>
    `;
    if (item.status === 'in_transit') {
        content += `<button onclick="completeDelivery('${item.id}')" class="btn btn-success btn-sm">✅ Entregar</button>`;
    }
    content += `<button onclick="deleteDelivery('${item.id}', '${item.status}')" class="btn btn-danger btn-sm">🗑️ Excluir</button>
        </div>
        <span class="status status-${item.status}" style="display:inline-block; margin-top:10px; padding: 3px 7px; border-radius:4px; font-size:0.9em;">${getStatusLabel(item.status)}</span>
    `;
    return content;
}

async function checkExistingRoute(date) {
    try {
        const response = await fetch(`${API_URL}/deliveries/routes/${date}`);

        if (!response.ok) {
            if (response.status === 404) {
                console.log(`Nenhuma rota otimizada salva encontrada para ${date}.`);
                currentRoute = null;
                manualOrder = {};
                pickupStops = [];
                if (typeof directionsRenderer !== 'undefined' && directionsRenderer) {
                    directionsRenderer.setDirections({ routes: [] });
                }
            } else {
                console.error(`Erro ${response.status} ao buscar rota existente para ${date}.`);
                showToast(`Erro ao buscar dados da rota: ${response.status}`, 'error');
            }
            return; 
        }

        const existingRoute = await response.json();

        if (existingRoute && existingRoute.id) {
            currentRoute = {
                routeId: existingRoute.id,
                totalDistance: existingRoute.total_distance,
                totalDuration: existingRoute.total_duration,
                optimizedOrder: existingRoute.optimized_order,
                routeConfig: existingRoute.route_config,
                status: existingRoute.status
            };

            if (currentRoute.routeConfig) {
                manualOrder = currentRoute.routeConfig.manualOrder || {};
                pickupStops = currentRoute.routeConfig.pickupStops || [];
                if (currentRoute.routeConfig.circularRoute !== undefined) {
                    settings.circular_route = currentRoute.routeConfig.circularRoute.toString();
                }
                if (currentRoute.routeConfig.originAddress) {
                    settings.origin_address = currentRoute.routeConfig.originAddress;
                    confeitariaLocation.address = settings.origin_address;
                    // Idealmente, geocodificar aqui para atualizar lat/lng da confeitariaLocation se mudou
                }
            } else {
                 manualOrder = {};
                 pickupStops = [];
            }

            if (currentRoute.optimizedOrder && currentRoute.optimizedOrder.length > 0) {
                showOptimizedRoute(currentRoute);
                if (document.getElementById('start-route')) {
                    document.getElementById('start-route').disabled = currentRoute.status !== 'planned';
                }
                showToast('Rota otimizada carregada do servidor!', 'success');
            } else {
                console.log(`Rota para ${date} encontrada, mas sem otimização.`);
                if (typeof directionsRenderer !== 'undefined' && directionsRenderer) {
                    directionsRenderer.setDirections({ routes: [] });
                }
            }
        } else {
             console.log(`Nenhuma rota encontrada no banco para ${date}.`);
             currentRoute = null;
             manualOrder = {};
             pickupStops = [];
             if (typeof directionsRenderer !== 'undefined' && directionsRenderer) {
                directionsRenderer.setDirections({ routes: [] });
             }
        }
    } catch (error) {
        console.error('Erro crítico ao verificar/carregar rota existente:', error);
        showToast('Falha ao carregar dados da rota.', 'error');
        currentRoute = null;
        manualOrder = {};
        pickupStops = [];
        if (typeof directionsRenderer !== 'undefined' && directionsRenderer) {
            directionsRenderer.setDirections({ routes: [] });
        }
    }
}

function updateRouteStats() {
    const totalDeliveriesEl = document.getElementById('total-deliveries');
    const totalDistanceEl = document.getElementById('total-distance');
    const totalTimeEl = document.getElementById('total-time');
    const totalPriceEl = document.getElementById('total-price');
    const shareRouteBtn = document.getElementById('share-route');

    const actualDeliveryItems = deliveryData.filter(d => d.type !== 'pickup'); // Somente entregas reais
    if (totalDeliveriesEl) totalDeliveriesEl.textContent = actualDeliveryItems.length;

    if (currentRoute && currentRoute.optimizedOrder && currentRoute.optimizedOrder.length > 0) {
        const distanceKm = (currentRoute.totalDistance / 1000).toFixed(1);
        const totalMinutes = Math.round(currentRoute.totalDuration / 60);
        
        const stopTimePerDelivery = parseInt(settings.stop_time) || 8;
        const actualDeliveriesInOptimizedRoute = currentRoute.optimizedOrder.filter(item => item.type !== 'pickup').length;
        const totalTimeWithStops = totalMinutes + (actualDeliveriesInOptimizedRoute * stopTimePerDelivery);
        
        if (totalDistanceEl) totalDistanceEl.textContent = `${distanceKm} km`;
        if (totalTimeEl) totalTimeEl.textContent = `${totalTimeWithStops} min`;
        
        const dailyRate = parseFloat(settings.daily_rate || 100);
        const kmRate = parseFloat(settings.km_rate || 2.50);
        const totalPrice = dailyRate + (parseFloat(distanceKm) * kmRate);
        if (totalPriceEl) totalPriceEl.textContent = `R$ ${totalPrice.toFixed(2)}`;
        
        if (shareRouteBtn) shareRouteBtn.disabled = false;
    } else {
        if (totalDistanceEl) totalDistanceEl.textContent = '0 km';
        if (totalTimeEl) totalTimeEl.textContent = '0 min';
        if (totalPriceEl) totalPriceEl.textContent = 'R$ 0,00';
        if (shareRouteBtn) shareRouteBtn.disabled = true;
    }
    if (typeof window.ensurePriorityFeatures === 'function') window.ensurePriorityFeatures();
}

// --- Ações de Entrega ---

document.addEventListener('DOMContentLoaded', function() {
    const deliveryForm = document.getElementById('delivery-form');
    if (deliveryForm) {
        deliveryForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const delivery = Object.fromEntries(formData.entries());
            delivery.order_date = getRouteDate();
            
            const productSelect = document.getElementById('product-select');
            if (productSelect && productSelect.value && PRODUCT_CONFIG[productSelect.value]) {
                delivery.product_type = productSelect.value;
                delivery.product_name = getProductDisplayName(productSelect.value);
            }

            try {
                const response = await fetch(`${API_URL}/deliveries`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(delivery)
                });
                const result = await response.json();
                if (response.ok) {
                    showToast('Entrega adicionada com sucesso!', 'success');
                    e.target.reset();
                    await loadDeliveries();
                } else {
                    throw new Error(result.error || 'Erro ao adicionar entrega');
                }
            } catch (error) {
                console.error('Erro ao adicionar entrega:', error);
                showToast('Erro ao adicionar entrega: ' + error.message, 'error');
            }
        });
    }
});

function showDeliveryOnMap(lat, lng) {
    if (map && typeof google !== 'undefined' && google.maps) {
        map.setCenter({ lat: parseFloat(lat), lng: parseFloat(lng) });
        map.setZoom(17);
    } else {
        showToast("Mapa não está pronto.", "error");
    }
}

async function deleteDelivery(deliveryId, status) {
    if (!confirm('Tem certeza que deseja excluir esta entrega? Esta ação não pode ser desfeita.')) return;
    try {
        const response = await fetch(`${API_URL}/deliveries/${deliveryId}`, { method: 'DELETE' });
        if (response.ok) {
            showToast('Entrega excluída com sucesso!', 'success');
            await loadDeliveries();
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Erro ao excluir entrega');
        }
    } catch (error) {
        console.error('Erro ao excluir entrega:', error);
        showToast('Erro ao excluir entrega: ' + error.message, 'error');
    }
}

function generateTrackingLink(deliveryId) {
    const trackingUrl = `${window.location.origin}/tracking.html?id=${deliveryId}`;
    navigator.clipboard.writeText(trackingUrl).then(() => {
        showToast('Link de rastreamento copiado!', 'success');
    }).catch(() => {
        prompt('Link de Rastreamento (copie manualmente):', trackingUrl);
    });
}

async function completeDelivery(deliveryId) {
    if (!confirm('Marcar esta entrega como concluída?')) return;
    try {
        const response = await fetch(`${API_URL}/deliveries/${deliveryId}/complete`, { method: 'POST' });
        if (response.ok) {
            showToast('Entrega marcada como concluída!', 'success');
            await loadDeliveries();
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Erro ao concluir entrega');
        }
    } catch (error) {
        console.error('Erro ao completar entrega:', error);
        showToast('Erro ao completar entrega: ' + error.message, 'error');
    }
}

async function clearAllDeliveries() {
    if (!confirm('TEM CERTEZA que deseja limpar TODAS as entregas e a rota para este dia? Esta ação é irreversível!')) return;
    try {
        const routeDate = getRouteDate();
        const response = await fetch(`${API_URL}/deliveries/clear/${routeDate}`, { method: 'DELETE' });
        if (response.ok) {
            showToast('Todas as entregas e a rota do dia foram removidas.', 'success');
            deliveryData = [];
            pickupStops = [];
            manualOrder = {};
            currentRoute = null;
            if (directionsRenderer) directionsRenderer.setDirections({routes: []});
            renderDeliveriesList();
            updateMapMarkers([]);
            updateRouteStats();
        } else {
            const error = await response.json();
            throw new Error(error.error || "Erro ao limpar entregas");
        }
    } catch (error) {
        console.error('Erro ao limpar entregas:', error);
        showToast('Erro ao limpar entregas: ' + error.message, 'error');
    }
}

function shareRoute() {
    if (!currentRoute || !currentRoute.optimizedOrder || currentRoute.optimizedOrder.length === 0) {
        showToast('Otimize a rota primeiro para poder compartilhar.', 'info');
        return;
    }

    let googleMapsUrl = 'https://www.google.com/maps/dir/?api=1';
    googleMapsUrl += `&origin=${encodeURIComponent(settings.origin_address)}`;

    const waypointsAddresses = currentRoute.optimizedOrder.map(item => item.address);
    
    if (settings.circular_route === 'true') {
        if (waypointsAddresses.length > 0) {
            googleMapsUrl += `&waypoints=${encodeURIComponent(waypointsAddresses.join('|'))}`;
        }
        googleMapsUrl += `&destination=${encodeURIComponent(settings.origin_address)}`;
    } else {
        if (waypointsAddresses.length > 1) {
            googleMapsUrl += `&waypoints=${encodeURIComponent(waypointsAddresses.slice(0, -1).join('|'))}`;
        }
        if (waypointsAddresses.length > 0) {
            googleMapsUrl += `&destination=${encodeURIComponent(waypointsAddresses[waypointsAddresses.length - 1])}`;
        } else { // Sem paradas, destino é a origem (pouco provável para rota não circular)
            googleMapsUrl += `&destination=${encodeURIComponent(settings.origin_address)}`;
        }
    }
    googleMapsUrl += '&travelmode=driving';
    window.open(googleMapsUrl, '_blank');
    showToast('Rota aberta no Google Maps!', 'success');
}

// --- Otimização de Rota ---
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
                    if (result.routeConfig) {
                        manualOrder = result.routeConfig.manualOrder || manualOrder;
                        pickupStops = result.routeConfig.pickupStops || pickupStops;
                    }
                    showToast(`Rota otimizada! ${result.totalStops || result.optimizedOrder.length} paradas.`, 'success');
                    showOptimizedRoute(currentRoute);
                    if (document.getElementById('start-route')) {
                        document.getElementById('start-route').disabled = false;
                    }
                    updateRouteStats();
                    renderDeliveriesList();
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

// --- Drag and Drop ---
let draggedElement = null;
function handleDragStart(e) {
    draggedElement = this;
    this.style.opacity = '0.5'; // Visual feedback
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML); // Ou this.dataset.itemId
}
function handleDragEnd(e) {
    this.style.opacity = '1';
    document.querySelectorAll('.delivery-item.drag-over').forEach(el => el.classList.remove('drag-over'));
    draggedElement = null;
}
function handleDragOver(e) {
    e.preventDefault();
    if (this !== draggedElement) {
        this.classList.add('drag-over');
    }
    e.dataTransfer.dropEffect = 'move';
}
function handleDragLeave(e) {
    this.classList.remove('drag-over');
}
function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    this.classList.remove('drag-over');
    if (draggedElement && draggedElement !== this) {
        const list = document.getElementById('deliveries-list');
        const targetIndex = Array.from(list.children).indexOf(this);
        const draggedIndex = Array.from(list.children).indexOf(draggedElement);

        if (draggedIndex < targetIndex) {
            list.insertBefore(draggedElement, this.nextSibling);
        } else {
            list.insertBefore(draggedElement, this);
        }
        updateManualOrderFromDOM();
    }
}

function updateManualOrderFromDOM() {
    const newManualOrder = {};
    const items = document.querySelectorAll('#deliveries-list .delivery-item');
    items.forEach((itemElement, index) => {
        const itemId = itemElement.dataset.itemId;
        if (itemId) {
            newManualOrder[itemId] = index + 1;
            const input = itemElement.querySelector(`#order-input-${itemId}`); // Seleciona pelo ID único
            if (input) {
                input.value = index + 1;
            }
        }
    });
    manualOrder = newManualOrder;
    console.log("Ordem manual atualizada pelo DOM:", manualOrder);
    // Após reordenar no DOM e atualizar `manualOrder`,
    // você pode querer permitir que o usuário clique em "Otimizar Rota" novamente,
    // que usará o novo `manualOrder`.
    // Se a intenção é que a ordem do DOM seja a rota final *sem* reotimização do Google,
    // então uma função para calcular a rota com a ordem fixa do DOM seria necessária.
    // Por ora, a otimização sempre passará pelo backend.
}


// --- Configurações ---
async function loadSettings() {
    try {
        const response = await fetch(`${API_URL}/settings`);
        if (!response.ok) throw new Error("Falha ao carregar configurações.");
        const serverSettings = await response.json();
        settings = { ...settings, ...serverSettings };
        
        const circularRouteEl = document.getElementById('circular-route');
        const originAddressEl = document.getElementById('origin-address');
        const stopTimeEl = document.getElementById('stop-time');
        const dailyRateEl = document.getElementById('daily-rate');
        const kmRateEl = document.getElementById('km-rate');

        if (circularRouteEl) circularRouteEl.checked = settings.circular_route === 'true';
        if (originAddressEl) originAddressEl.value = settings.origin_address;
        if (stopTimeEl) stopTimeEl.value = settings.stop_time || '8';
        if (dailyRateEl) dailyRateEl.value = settings.daily_rate || '100';
        if (kmRateEl) kmRateEl.value = settings.km_rate || '2.50';

        confeitariaLocation.address = settings.origin_address;
        // Adicionar geocodificação para atualizar lat/lng de confeitariaLocation se origin_address mudou
        if (settings.origin_address !== confeitariaLocation.address && typeof google !== 'undefined' && google.maps) {
            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({ 'address': settings.origin_address }, function(results, status) {
                if (status == 'OK' && results[0]) {
                    confeitariaLocation.lat = results[0].geometry.location.lat();
                    confeitariaLocation.lng = results[0].geometry.location.lng();
                    console.log("Localização da confeitaria atualizada por geocodificação:", confeitariaLocation);
                     if (map) map.setCenter(results[0].geometry.location); // Centraliza mapa na nova origem
                } else {
                    console.warn('Falha ao geocodificar novo endereço da confeitaria:', status);
                }
            });
        }
        console.log("Configurações carregadas:", settings);
    } catch (error) {
        console.error('Erro ao carregar configurações:', error);
        showToast("Erro ao carregar configurações.", "error");
    }
}

function openSettings() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.style.display = 'block';
}

function closeSettings() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.style.display = 'none';
}

async function saveSettings() {
    const circularRoute = document.getElementById('circular-route')?.checked;
    const originAddress = document.getElementById('origin-address')?.value;
    const stopTime = document.getElementById('stop-time')?.value;
    const dailyRate = document.getElementById('daily-rate')?.value;
    const kmRate = document.getElementById('km-rate')?.value;
    
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
            confeitariaLocation.address = settings.origin_address; // Atualiza endereço da confeitaria
            // Re-geocodificar para atualizar lat/lng
             if (typeof google !== 'undefined' && google.maps) {
                const geocoder = new google.maps.Geocoder();
                geocoder.geocode({ 'address': settings.origin_address }, function(results, status) {
                    if (status == 'OK' && results[0]) {
                        confeitariaLocation.lat = results[0].geometry.location.lat();
                        confeitariaLocation.lng = results[0].geometry.location.lng();
                        if (map) {
                             map.setCenter(results[0].geometry.location);
                             // Atualizar marcador da confeitaria
                             // (requer ter uma referência ao marcador para atualizá-lo ou recriá-lo)
                        }
                        if (currentRoute && currentRoute.optimizedOrder && currentRoute.optimizedOrder.length > 0) {
                            showOptimizedRoute(currentRoute); // Re-desenha a rota com a nova origem
                        }
                    }
                });
            }
            showToast('Configurações salvas com sucesso!', 'success');
            closeSettings();
            updateRouteStats();
        } else {
            const error = await response.json();
            throw new Error(error.error || "Erro ao salvar configurações");
        }
    } catch (error) {
        console.error('Erro ao salvar configurações:', error);
        showToast('Erro ao salvar configurações: ' + error.message, 'error');
    }
}

// --- Paradas de Pickup ---
function addPickupStop() {
    const newPickupId = `pickup_${Date.now()}`;
    pickupStops.push({
        id: newPickupId,
        type: 'pickup',
        lat: confeitariaLocation.lat,
        lng: confeitariaLocation.lng,
        address: confeitariaLocation.address,
        order: 999 // Default order, to be adjusted or used by optimizer
    });
    manualOrder[newPickupId] = (Object.keys(manualOrder).length > 0 ? Math.max(...Object.values(manualOrder)) : 0) + 1;
    renderDeliveriesList();
    updateMapMarkers([...deliveryData.map(d=>({...d, type:'delivery'})), ...pickupStops]);
    showToast("Parada na confeitaria adicionada.", "info");
}

function removePickupStop(stopId) {
    pickupStops = pickupStops.filter(stop => stop.id !== stopId);
    delete manualOrder[stopId];
    renderDeliveriesList();
    updateMapMarkers([...deliveryData.map(d=>({...d, type:'delivery'})), ...pickupStops]);
    showToast("Parada na confeitaria removida.", "info");
}

/**
 * CORREÇÃO: Função updateManualOrder para selecionar o input pelo ID único.
 */
function updateManualOrder(itemId, orderValue) {
    const order = parseInt(orderValue);
    const inputElement = document.getElementById(`order-input-${itemId}`); // Seleciona pelo ID

    if (isNaN(order) || order < 1) {
        delete manualOrder[itemId];
        if (inputElement) {
            inputElement.value = ''; // Limpa o campo no DOM
        }
    } else {
        manualOrder[itemId] = order;
        // Opcional: Se quiser forçar o valor do input para o número parseado
        // if (inputElement) {
        // inputElement.value = order;
        // }
    }
    console.log("Ordem manual para", itemId, "atualizada para", manualOrder[itemId]);
    // A re-renderização da lista para refletir a ordem visual pode ser feita
    // chamando renderDeliveriesList() aqui, mas pode ser custoso.
    // A ordenação principal acontece em renderDeliveriesList e ao otimizar.
}

// --- Inicialização ---
async function loadPageData() {
    console.log('Página de rotas carregando...');
    const routeDate = getRouteDate();
    const routeDateElement = document.getElementById('route-date');
    if (routeDateElement) {
        try {
            const dateObj = new Date(routeDate + 'T00:00:00Z');
            const formattedDate = dateObj.toLocaleDateString('pt-BR', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Sao_Paulo'
            });
            routeDateElement.textContent = formattedDate;
        } catch (e) {
            routeDateElement.textContent = routeDate;
            console.error("Erro ao formatar data:", e);
        }
    }
    
    await loadSettings(); 
    
    // Garante que o mapa seja inicializado SE a API do Google estiver pronta.
    // Se a API carregar depois, onGoogleMapsApiLoaded() chamará initMap e depois esta função.
    if (typeof google !== 'undefined' && typeof google.maps !== 'undefined' && !map) {
        initMap();
    }
    
    await loadDeliveries();
    
    if (typeof window.ensurePriorityFeatures === "function") window.ensurePriorityFeatures();
    else if (typeof addPriorityLegend === "function") addPriorityLegend(); // Fallback
    
    updateRouteStats();
}


window.onload = async () => {
    // Adiciona listeners para os botões de configuração do modal
    const settingsBtn = document.getElementById('settings-btn');
    const saveSettingsBtn = document.querySelector('#settings-modal .btn-primary'); // Mais específico
    const cancelSettingsBtn = document.querySelector('#settings-modal .btn-secondary'); // Mais específico
    const closeSettingsIcon = document.querySelector('#settings-modal .close');

    if (settingsBtn) settingsBtn.onclick = openSettings;
    if (saveSettingsBtn) saveSettingsBtn.onclick = saveSettings;
    if (cancelSettingsBtn) cancelSettingsBtn.onclick = closeSettings;
    if (closeSettingsIcon) closeSettingsIcon.onclick = closeSettings;

    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal) {
        window.onclick = function(event) {
            if (event.target == settingsModal) {
                closeSettings();
            }
        };
    }

    // Chama a função principal de carregamento
    // Se a API do Google Maps ainda não carregou, onGoogleMapsApiLoaded chamará loadPageData.
    // Se já carregou, chamamos diretamente.
    if (typeof google !== 'undefined' && typeof google.maps !== 'undefined') {
        await loadPageData();
    } else {
        console.log("Aguardando API do Google Maps carregar para executar loadPageData...");
        // onGoogleMapsApiLoaded (definido globalmente ou no callback da API) se encarregará de chamar loadPageData.
    }


    if (socket) {
        socket.on('connect', () => console.log('Socket.IO conectado (routes.js)'));
        socket.on('location-update', (data) => {
            if (currentRoute && data.routeId === currentRoute.routeId) {
                if (!driverMarker && map) {
                    driverMarker = new google.maps.Marker({ map: map, title: 'Entregador', icon: {/* ... */} });
                }
                if (driverMarker) driverMarker.setPosition(new google.maps.LatLng(data.lat, data.lng));
            }
        });
        socket.on('delivery-completed', (data) => {
            const delivery = deliveryData.find(d => d.id === data.deliveryId);
            if (delivery) {
                delivery.status = 'delivered';
                renderDeliveriesList();
                updateRouteStats();
            }
        });
    } else {
        console.warn("Socket.IO não inicializado.");
    }
};

// Exportar funções que precisam ser acessíveis globalmente pelo HTML (ex: onclick)
window.editDelivery = window.editDelivery || function(id) {
    const delivery = deliveryData.find(d => d.id == id);
    if (!delivery) { showToast('Entrega não encontrada.', 'error'); return; }
    const fields = {
        'edit-delivery-id': delivery.id,
        'edit-order-number': delivery.order_number || '',
        'edit-customer-name': delivery.customer_name,
        'edit-customer-phone': delivery.customer_phone || '',
        'edit-address': delivery.address,
        'edit-product-select': delivery.product_type || '',
        'edit-product-description': delivery.product_description || '',
        'edit-priority-select': delivery.priority || '0'
    };
    for (const elId in fields) {
        const el = document.getElementById(elId);
        if (el) el.value = fields[elId];
    }
    if (typeof updateEditProductInfo === 'function') updateEditProductInfo();
    const container = document.getElementById('edit-delivery-container');
    if (container) {
        container.style.display = 'block';
        container.scrollIntoView({ behavior: 'smooth' });
    }
};
window.cancelEdit = window.cancelEdit || function() {
    const container = document.getElementById('edit-delivery-container');
    if (container) container.style.display = 'none';
    const form = document.getElementById('edit-delivery-form');
    if (form) form.reset();
};
window.addPickupStop = addPickupStop;
window.removePickupStop = removePickupStop;
window.updateManualOrder = updateManualOrder;
window.clearAllDeliveries = clearAllDeliveries;
window.shareRoute = shareRoute;
window.openSettings = openSettings;
window.showDeliveryOnMap = showDeliveryOnMap;
window.deleteDelivery = deleteDelivery;
window.generateTrackingLink = generateTrackingLink;
window.completeDelivery = completeDelivery;
// Funções do HTML como updateProductInfo e updateEditProductInfo já são globais
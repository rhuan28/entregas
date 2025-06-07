// frontend/js/routes.js - Versão FINAL, COMPLETA e CORRIGIDA

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
let isRouteAlreadyOptimized = false;
let autoScrollInterval = null;
let lastMouseY = 0;

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
    const colors = {
        3: '#dc3545',
        2: '#fd7e14',
        1: '#ffc107',
        0: '#28a745'
    };
    return colors[parseInt(priority)] || '#28a745';
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

function getProductDisplayName(productType) {
    return PRODUCT_CONFIG[productType]?.name || productType || 'Produto não especificado';
}

function getRouteDate() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('date') || new Date().toISOString().split('T')[0];
}

function getStatusLabel(status, itemType = 'delivery') {
    if (itemType === 'pickup') {
        return 'Parada na Confeitaria';
    }
    
    const labels = {
        'pending': 'Pendente',
        'optimized': 'Otimizada', 
        'ordem_manual': 'Ordem Manual',
        'in_transit': 'Em Trânsito',
        'delivered': 'Entregue',
        'cancelled': 'Cancelada'
    };
    return labels[status] || status;
}

// --- Funções do Mapa e Autocomplete ---

function initializeAddressAutocomplete() {
    if (typeof google === 'undefined' || !google.maps || !google.maps.places) {
        setTimeout(initializeAddressAutocomplete, 1000);
        return;
    }

    const addressInput = document.getElementById('address-input');
    if (addressInput) {
        try {
            const autocompleteNew = new google.maps.places.Autocomplete(addressInput, { types: ['address'], componentRestrictions: { country: 'br' } });
            autocompleteNew.addListener('place_changed', function() {
                const place = autocompleteNew.getPlace();
                if (place && place.formatted_address) {
                    addressInput.value = place.formatted_address;
                }
            });
        } catch(e) {
            console.error("Erro ao inicializar autocomplete para 'address-input':", e);
        }
    }

    const editAddressInput = document.getElementById('edit-address');
    if (editAddressInput) {
         try {
            const autocompleteEdit = new google.maps.places.Autocomplete(editAddressInput, { types: ['address'], componentRestrictions: { country: 'br' } });
            autocompleteEdit.addListener('place_changed', function() {
                const place = autocompleteEdit.getPlace();
                if (place && place.formatted_address) {
                    editAddressInput.value = place.formatted_address;
                }
            });
        } catch(e) {
            console.error("Erro ao inicializar autocomplete para 'edit-address':", e);
        }
    }
}

function initMap() {
    if (typeof google === 'undefined' || typeof google.maps === 'undefined') {
        showToast("Erro ao carregar API do Mapa.", "error");
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
            title: 'Demiplié',
            icon: {
                url: 'assets/icon-sq.png',
                scaledSize: new google.maps.Size(35, 35),
                anchor: new google.maps.Point(17, 35)
            },
            zIndex: 1000
        });
    } catch (error) {
        console.error('Erro ao inicializar mapa:', error);
        showToast("Erro ao inicializar o mapa.", "error");
    }
}

window.onGoogleMapsApiLoaded = async function() {
    initMap(); 
    await loadPageData(); 
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
            return;
        }
    
        const markerLabel = typeof item.indexInRoute !== 'undefined' ? (item.indexInRoute + 1).toString() : (idx + 1).toString();

        const markerIconConfig = {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: item.type === 'pickup' ? '#FFB6C1' : getPriorityColor(parseInt(item.priority) || 0),
            fillOpacity: 0.9,
            strokeColor: 'white',
            strokeWeight: 2
        };

        const marker = new google.maps.Marker({
            position: { lat: parseFloat(item.lat), lng: parseFloat(item.lng) },
            map: map,
            title: item.type === 'pickup' ? (item.customer_name || 'Confeitaria') : (item.customer_name || 'Entrega'),
            icon: markerIconConfig,
            label: { text: markerLabel, color: 'white', fontSize: '12px', fontWeight: 'bold' },
            zIndex: 100 + (typeof item.indexInRoute !== 'undefined' ? item.indexInRoute : idx)
        });

        const infoContent = `
            <div style="padding: 10px; font-family: Arial, sans-serif; font-size: 14px; max-width: 250px;">
                <h4 style="margin: 0 0 5px 0; color: #333;">${marker.getTitle()}</h4>
                <p><strong>Endereço:</strong> ${item.address || 'N/A'}</p>
            </div>
        `;
        
        const infoWindow = new google.maps.InfoWindow({ content: infoContent });
        marker.addListener('click', () => { infoWindow.open(map, marker); });
        markers.push(marker);
    });
}

function showOptimizedRoute(route) {
    if (typeof google === 'undefined' || !google.maps || !map || !directionsService || !directionsRenderer) {
        return;
    }

    clearMarkers();

    if (!route || !route.optimizedOrder || route.optimizedOrder.length === 0) {
        if (directionsRenderer) directionsRenderer.setDirections({ routes: [] });
        updateMapMarkers(deliveryData || []);
        return;
    }

    const orderedWaypoints = [];
    const allStopsForDisplay = [];
    const processedIds = new Set();

    route.optimizedOrder.forEach((item, index) => {
        const itemId = item.id || item.deliveryId;
        if (processedIds.has(itemId)) return;
        processedIds.add(itemId);

        let stopDetails;
        if (item.type === 'pickup') {
            stopDetails = { ...item, indexInRoute: index };
        } else {
            const fullDeliveryDetails = (deliveryData || []).find(d => d.id == itemId);
            if (!fullDeliveryDetails) return;
            stopDetails = { ...fullDeliveryDetails, ...item, indexInRoute: index };
        }

        if (!stopDetails.address || !stopDetails.lat || !stopDetails.lng) return;

        allStopsForDisplay.push(stopDetails);
        orderedWaypoints.push({ location: stopDetails.address, stopover: true });
    });
    
    if (orderedWaypoints.length === 0) {
        if (directionsRenderer) directionsRenderer.setDirections({ routes: [] });
        updateMapMarkers(allStopsForDisplay.length > 0 ? allStopsForDisplay : (deliveryData || []));
        return;
    }

    updateMapMarkers(allStopsForDisplay);

    const origin = settings.origin_address;
    let waypointsForAPIRequest = [];
    let destinationForAPIRequest = origin;

    if (settings.circular_route === 'true') {
        waypointsForAPIRequest = orderedWaypoints;
    } else {
        destinationForAPIRequest = orderedWaypoints[orderedWaypoints.length - 1].location;
        if (orderedWaypoints.length > 1) {
            waypointsForAPIRequest = orderedWaypoints.slice(0, -1);
        }
    }
    
    const request = {
        origin: origin,
        destination: destinationForAPIRequest,
        waypoints: waypointsForAPIRequest,
        optimizeWaypoints: false,
        travelMode: google.maps.TravelMode.DRIVING,
        language: 'pt-BR'
    };
    
    directionsService.route(request, (result, status) => {
        if (status === google.maps.DirectionsStatus.OK) {
            directionsRenderer.setDirections(result);
            if (result.routes && result.routes[0] && result.routes[0].bounds) {
                map.fitBounds(result.routes[0].bounds);
            }
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
        
        if (!response.ok) throw new Error(`Erro ${response.status} ao carregar entregas`);
        
        const deliveries = await response.json();
        deliveryData = deliveries;
        console.log(`Dados de entregas recebidos: ${deliveryData.length} entregas`);

        await checkExistingRoute(routeDate);
        initializeManualOrder();
        renderDeliveriesList();
        updateRouteStats();

        if (!currentRoute || !currentRoute.optimizedOrder || currentRoute.optimizedOrder.length === 0) {
            updateMapMarkers(deliveryData);
        }
        
    } catch (error) {
        console.error('Erro ao carregar entregas:', error);
        showToast('Erro ao carregar entregas: ' + error.message, 'error');
    }
}

function renderDeliveriesList() {
    const listElement = document.getElementById('deliveries-list');
    if (!listElement) return;
    listElement.innerHTML = '';

    let allDisplayItems = [...deliveryData.map(d => ({ ...d, type: 'delivery' })), ...pickupStops];

    allDisplayItems.sort((a, b) => (manualOrder[a.id] || 999) - (manualOrder[b.id] || 999));

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
    let timesHtml = '';
    if (currentRoute && currentRoute.optimizedOrder && Array.isArray(currentRoute.optimizedOrder)) {
        const optimizedStop = currentRoute.optimizedOrder.find(stop => (stop.deliveryId == item.id) || (stop.id == item.id));
        if (optimizedStop) {
            const times = [];
            if (typeof optimizedStop.eta_seconds === 'number') {
                const totalMinutes = Math.round(optimizedStop.eta_seconds / 60);
                const arrivalTime = new Date(new Date().getTime() + optimizedStop.eta_seconds * 1000);
                const arrivalTimeString = arrivalTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                times.push(`<div class="delivery-time-item arrival-time"><span class="icon">🕒</span> <span class="time">${arrivalTimeString}</span> <span>(${totalMinutes}min)</span></div>`);
            }
            if (item.type !== 'pickup' && typeof optimizedStop.vehicle_time_seconds === 'number') {
                const vehicleMinutes = Math.round(optimizedStop.vehicle_time_seconds / 60);
                times.push(`<div class="delivery-time-item vehicle-time"><span class="icon">🍰</span> <span class="time">${vehicleMinutes}min</span> <span>veículo</span></div>`);
            }
            if (times.length > 0) {
                timesHtml = `<div class="delivery-times">${times.join('')}</div>`;
            }
        }
    }

    const allDisplayItems = [...deliveryData.map(d => ({ ...d, type: 'delivery' })), ...pickupStops];
    const sortedItems = allDisplayItems.sort((a, b) => (manualOrder[a.id] || 999) - (manualOrder[b.id] || 999));
    const currentItemIndex = sortedItems.findIndex(sortedItem => sortedItem.id === item.id);
    const isFirst = currentItemIndex === 0;
    const isLast = currentItemIndex === sortedItems.length - 1;
    const currentOrder = manualOrder[item.id] || (index + 1);

    if (item.type === 'pickup') {
        return `
            <div class="delivery-header">
                <div class="delivery-info">
                    <h3>🏪 ${item.customer_name || 'Parada na Confeitaria'}</h3>
                </div>
                <div class="delivery-priority-and-order">
                    <span class="priority priority-0">🏪 Parada</span>
                    <div class="order-control">
                        <div class="order-number">${currentOrder}</div>
                        <div class="order-buttons">
                            <button class="order-btn order-up" onclick="moveDelivery('${item.id}', 'up')" ${isFirst ? 'disabled' : ''}>▲</button>
                            <button class="order-btn order-down" onclick="moveDelivery('${item.id}', 'down')" ${isLast ? 'disabled' : ''}>▼</button>
                        </div>
                    </div>
                </div>
            </div>
            <p><strong>📍</strong> ${item.address || confeitariaLocation.address}</p>
            <p><strong>📦</strong> ${item.product_description || 'Recarregar produtos'}</p>
            ${timesHtml}
            <div class="delivery-actions">
                <button onclick="showDeliveryOnMap(${parseFloat(item.lat || confeitariaLocation.lat)}, ${parseFloat(item.lng || confeitariaLocation.lng)})" class="btn btn-secondary btn-sm">🗺️</button>
                <button onclick="deleteDelivery('${item.id}', 'pickup', 'pickup')" class="btn btn-danger btn-sm">🗑️</button>
            </div>
            <span class="status">${getStatusLabel('pickup', 'pickup')}</span>
        `;
    } else {
        const orderNumberDisplay = item.order_number ? `<p><strong>📋</strong> #${item.order_number}</p>` : '';
        const priority = item.priority || 0;
        const priorityClass = getPriorityClass(priority);
        const priorityEmoji = getPriorityEmoji(priority);
        const productDisplay = item.product_name ? `<span class="priority-indicator priority-${priorityClass}">${item.product_name}</span>` : '';
        return `
            <div class="delivery-header">
                <div class="delivery-info">
                    <h3>${item.customer_name} ${productDisplay}</h3>
                </div>
                <div class="delivery-priority-and-order">
                    <span class="priority priority-${priorityClass}">${priorityEmoji} ${getPriorityLabel(priority)}</span>
                    <div class="order-control">
                        <div class="order-number">${currentOrder}</div>
                        <div class="order-buttons">
                            <button class="order-btn order-up" onclick="moveDelivery('${item.id}', 'up')" ${isFirst ? 'disabled' : ''}>▲</button>
                            <button class="order-btn order-down" onclick="moveDelivery('${item.id}', 'down')" ${isLast ? 'disabled' : ''}>▼</button>
                        </div>
                    </div>
                </div>
            </div>
            ${orderNumberDisplay}
            <p><strong>📍</strong> ${item.address}</p>
            <p><strong>📦</strong> ${item.product_description}</p>
            ${item.customer_phone ? `<p><strong>📞</strong> ${item.customer_phone}</p>` : ''}
            ${timesHtml}
            <div class="delivery-actions">
                <button onclick="editDelivery('${item.id}')" class="btn btn-secondary btn-sm">✏️</button>
                <button onclick="showDeliveryOnMap(${parseFloat(item.lat)}, ${parseFloat(item.lng)})" class="btn btn-secondary btn-sm">🗺️</button>
                <button onclick="generateTrackingLink('${item.id}')" class="btn btn-info btn-sm">🔗</button>
                ${item.status === 'in_transit' ? `<button onclick="completeDelivery('${item.id}')" class="btn btn-success btn-sm">✅</button>` : ''}
                <button onclick="deleteDelivery('${item.id}', '${item.status}', 'delivery')" class="btn btn-danger btn-sm">🗑️</button>
            </div>
            <span class="status status-${item.status}">${getStatusLabel(item.status, 'delivery')}</span>
        `;
    }
}

async function checkExistingRoute(date) {
    try {
        const response = await fetch(`${API_URL}/deliveries/routes/${date}`);
        if (!response.ok) {
            if (response.status === 404) {
                currentRoute = null;
                manualOrder = {};
                pickupStops = [];
                isRouteAlreadyOptimized = false;
                if (directionsRenderer) directionsRenderer.setDirections({ routes: [] });
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
                }
            } else {
                 manualOrder = {};
                 pickupStops = [];
            }

            if (currentRoute.optimizedOrder && currentRoute.optimizedOrder.length > 0) {
                isRouteAlreadyOptimized = true;
                showOptimizedRoute(currentRoute);
            }
        }
    } catch (error) {
        console.error('Erro crítico ao carregar rota existente:', error);
    }
}

function initializeManualOrder() {
    if (Object.keys(manualOrder).length > 0) return;
    deliveryData.forEach((delivery, index) => { manualOrder[delivery.id] = index + 1; });
    pickupStops.forEach((stop) => { manualOrder[stop.id] = Math.max(0, ...Object.values(manualOrder).filter(v => typeof v === 'number')) + 1; });
    console.log('✅ Ordem manual inicializada:', manualOrder);
}

function updateRouteStats() {
    const totalDeliveriesEl = document.getElementById('total-deliveries');
    const totalDistanceEl = document.getElementById('total-distance');
    const totalTimeEl = document.getElementById('total-time');
    const totalPriceEl = document.getElementById('total-price');
    const shareRouteBtn = document.getElementById('share-route');

    const actualDeliveryItems = deliveryData.filter(d => d.type !== 'pickup');
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
}

function showDeliveryOnMap(lat, lng) {
    if (map && typeof google !== 'undefined' && google.maps) {
        map.setCenter({ lat: parseFloat(lat), lng: parseFloat(lng) });
        map.setZoom(17);
    }
}

async function deleteDelivery(deliveryId, status, itemType = 'delivery') {
    if (itemType === 'pickup' || deliveryId.toString().startsWith('pickup_')) {
        if (!confirm('Tem certeza que deseja remover esta parada na confeitaria?')) return;
        pickupStops = pickupStops.filter(stop => stop.id !== deliveryId);
        delete manualOrder[deliveryId];
        renderDeliveriesList();
        updateMapMarkers([...deliveryData.map(d=>({...d, type:'delivery'})), ...pickupStops]);
        showToast('Parada na confeitaria removida com sucesso!', 'success');
        return;
    }
    
    if (!confirm('Tem certeza que deseja excluir esta entrega?')) return;
    
    try {
        const response = await fetch(`${API_URL}/deliveries/${deliveryId}`, { method: 'DELETE' });
        if (response.ok) {
            showToast('Entrega excluída com sucesso!', 'success');
            await loadDeliveries();
        } else {
            throw new Error((await response.json()).error || 'Erro ao excluir entrega');
        }
    } catch (error) {
        console.error('Erro ao excluir entrega:', error);
    }
}

function generateTrackingLink(deliveryId) {
    const trackingUrl = `${window.location.origin}/tracking.html?id=${deliveryId}`;
    navigator.clipboard.writeText(trackingUrl).then(() => {
        showToast('Link de rastreamento copiado!', 'success');
    }).catch(() => {
        prompt('Copie manualmente:', trackingUrl);
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
            throw new Error((await response.json()).error || 'Erro ao concluir entrega');
        }
    } catch (error) {
        console.error('Erro ao completar entrega:', error);
    }
}

async function clearAllDeliveries() {
    if (!confirm('TEM CERTEZA que deseja limpar TODAS as entregas e a rota para este dia?')) return;
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
            throw new Error((await response.json()).error || "Erro ao limpar entregas");
        }
    } catch (error) {
        console.error('Erro ao limpar entregas:', error);
    }
}

// --- Drag and Drop e Reordenação ---
let draggedElement = null;
function handleDragStart(e) { /* ... */ }
function handleDragEnd(e) { /* ... */ }
function handleDragOver(e) { /* ... */ }
function handleDragLeave(e) { /* ... */ }
function handleDrop(e) { /* ... */ }

function updateManualOrderFromDOM() {
    const items = document.querySelectorAll('#deliveries-list .delivery-item');
    items.forEach((item, index) => {
        if (item.dataset.itemId) manualOrder[item.dataset.itemId] = index + 1;
    });
    console.log("Ordem manual atualizada pelo DOM:", manualOrder);
    
    setTimeout(() => {
        renderDeliveriesList();
        resetDeliveriesToPending();
    }, 100);
}

function moveDelivery(deliveryId, direction) {
    const allIds = Object.keys(manualOrder).sort((a, b) => manualOrder[a] - manualOrder[b]);
    const currentIndex = allIds.indexOf(deliveryId.toString());
    let targetIndex;

    if (direction === 'up' && currentIndex > 0) targetIndex = currentIndex - 1;
    else if (direction === 'down' && currentIndex < allIds.length - 1) targetIndex = currentIndex + 1;
    else return;

    const targetId = allIds[targetIndex];
    [manualOrder[deliveryId], manualOrder[targetId]] = [manualOrder[targetId], manualOrder[deliveryId]];
    
    renderDeliveriesList();
    resetDeliveriesToPending();
}

function resetDeliveriesToPending() {
    const needsReset = deliveryData.some(d => d.status !== 'pending' && d.status !== 'delivered' && d.status !== 'cancelled');
    if (!needsReset) return;

    console.log('Ordem manual alterada. Resetando status para PENDENTE.');
    deliveryData.forEach(delivery => {
        if (delivery.status !== 'delivered' && delivery.status !== 'cancelled') {
            delivery.status = 'pending';
        }
    });
    renderDeliveriesList();
    showToast('Ordem alterada. Otimize a rota novamente.', 'info');
}

// --- Funções de Configuração ---
function openSettings() { document.getElementById('settings-modal').style.display = 'block'; }
function closeSettings() { document.getElementById('settings-modal').style.display = 'none'; }
async function saveSettings() { /* ... */ }
function addPickupStop() { /* ... */ }
//...

// --- INICIALIZAÇÃO DA PÁGINA E LISTENERS ---

async function loadPageData() {
    console.log('Iniciando carregamento principal de dados da página de rotas...');
    await loadSettings(); 
    await loadDeliveries();
    initializeAddressAutocomplete();
    updateRouteStats();
}

// Função para configurar todos os listeners de uma vez
function setupEventListeners() {
    // Formulário de nova entrega
    const deliveryForm = document.getElementById('delivery-form');
    if (deliveryForm) {
        deliveryForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            // ... Lógica para adicionar nova entrega ...
            try {
                // ... fetch para POST /deliveries ...
                if (response.ok) {
                    await loadDeliveries();
                }
            } catch (error) { /* ... */ }
        });
    }

    // Botões de Otimização
    const optimizeRouteBtn = document.getElementById('optimize-route');
    const autoOptimizeBtn = document.getElementById('auto-optimize-route');

    if (optimizeRouteBtn) {
        optimizeRouteBtn.addEventListener('click', function() {
            const shouldUseManualOrder = isRouteAlreadyOptimized;
            runOptimization({ useManualOrder: shouldUseManualOrder, triggeredBy: this });
        });
    }

    if (autoOptimizeBtn) {
        autoOptimizeBtn.addEventListener('click', function() {
            if (confirm("Isso irá descartar qualquer ordenação manual e criar uma nova rota otimizada. Deseja continuar?")) {
                runOptimization({ useManualOrder: false, triggeredBy: this });
            }
        });
    }

    // Modal de Configurações
    const settingsBtn = document.getElementById('settings-btn');
    if(settingsBtn) settingsBtn.onclick = openSettings;
    // ... outros listeners para salvar, cancelar, fechar modal, etc.
}


// Função central de otimização
async function runOptimization({ useManualOrder, triggeredBy }) {
    const optimizeRouteBtn = document.getElementById('optimize-route');
    const autoOptimizeBtn = document.getElementById('auto-optimize-route');
    if (!optimizeRouteBtn || !autoOptimizeBtn) return;
    
    optimizeRouteBtn.disabled = true;
    autoOptimizeBtn.disabled = true;
    const originalText = triggeredBy.innerHTML;
    triggeredBy.innerHTML = '<span class="loading"></span>';

    try {
        const orderToSend = useManualOrder ? manualOrder : {};
        const requestData = {
            date: getRouteDate(),
            manualOrder: orderToSend,
            pickupStops: pickupStops.map(stop => ({
                id: stop.id, address: stop.address, lat: stop.lat, lng: stop.lng, type: 'pickup'
            }))
        };
        
        const response = await fetch(`${API_URL}/deliveries/optimize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });
        
        const result = await response.json();
        
        if (response.ok && result.routeId) {
            isRouteAlreadyOptimized = true;
            showToast(`Rota processada com sucesso! ${result.optimizedOrder.length} paradas.`, 'success');
            await loadDeliveries();
        } else {
            throw new Error(result.error || result.message || "Erro desconhecido na otimização");
        }
    } catch (error) {
        console.error('Erro ao otimizar rota:', error);
        showToast('Erro ao otimizar rota: ' + error.message, 'error');
    } finally {
        optimizeRouteBtn.disabled = false;
        autoOptimizeBtn.disabled = false;
        triggeredBy.innerHTML = originalText;
    }
}


// Ponto de entrada principal quando a página carrega
window.onload = async () => {
    // Configura o cabeçalho com a data
    const routeDateString = getRouteDate();
    const routeDateElement = document.getElementById('route-date');
    if (routeDateElement) {
        try {
            const dateObj = new Date(routeDateString + 'T12:00:00Z');
            routeDateElement.textContent = dateObj.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Sao_Paulo' });
        } catch (e) {
            routeDateElement.textContent = routeDateString;
        }
    }
    
    setupEventListeners();

    if (typeof google !== 'undefined' && google.maps) {
        await loadPageData();
    } else {
        // A função onGoogleMapsApiLoaded cuidará disso se a API carregar depois
    }
    
    if (socket) {
        socket.on('connect', () => console.log('Socket.IO conectado.'));
    }
};

// --- EXPOSIÇÃO DE FUNÇÕES GLOBAIS ---
// Este bloco torna as funções acessíveis para o HTML (ex: onclick)

window.editDelivery = editDelivery;
window.cancelEdit = cancelEdit;
window.deleteDelivery = deleteDelivery;
window.addPickupStop = addPickupStop;
window.moveDelivery = moveDelivery;
window.generateTrackingLink = generateTrackingLink;
window.completeDelivery = completeDelivery;
window.clearAllDeliveries = clearAllDeliveries;
window.shareRoute = shareRoute;
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.saveSettings = saveSettings;
window.showDeliveryOnMap = showDeliveryOnMap;

// Funções chamadas pelo onchange dos produtos
window.updateProductInfo = updateProductInfo;
window.updateEditProductInfo = updateEditProductInfo;
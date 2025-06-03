// frontend/js/config.js - Configuração corrigida
// Detecta se está em produção ou desenvolvimento
const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';

// URLs da API com fallback mais robusto
const API_CONFIG = {
    // URL do backend
    BACKEND_URL: isProduction 
        ? 'https://entregas-backend-fly.fly.dev' 
        : (window.location.protocol + '//' + window.location.hostname + ':3000'),
        
    // Socket.io URL (mesma do backend) com configurações específicas
    SOCKET_URL: isProduction 
        ? 'https://entregas-backend-fly.fly.dev' 
        : (window.location.protocol + '//' + window.location.hostname + ':3000'),
        
    // Configurações específicas do Socket.IO
    SOCKET_CONFIG: {
        transports: ['websocket', 'polling'],
        upgrade: true,
        rememberUpgrade: true,
        timeout: 20000,
        forceNew: false,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5,
        maxReconnectionAttempts: 5,
        // Configurações específicas para produção
        ...(isProduction && {
            secure: true,
            rejectUnauthorized: false
        })
    }
};

// Exporta a configuração para uso nos outros arquivos
window.API_CONFIG = API_CONFIG;

// Para compatibilidade com código existente
window.API_URL = API_CONFIG.BACKEND_URL + '/api';

// Função para inicializar Socket.IO com configurações corretas
window.initializeSocket = function() {
    if (typeof io !== 'undefined') {
        console.log('🔌 Inicializando Socket.IO...');
        console.log('🔗 Socket URL:', API_CONFIG.SOCKET_URL);
        
        const socket = io(API_CONFIG.SOCKET_URL, API_CONFIG.SOCKET_CONFIG);
        
        socket.on('connect', () => {
            console.log('✅ Socket.IO conectado com sucesso!');
            console.log('🆔 Socket ID:', socket.id);
            console.log('🚀 Transporte:', socket.io.engine.transport.name);
        });
        
        socket.on('connect_error', (error) => {
            console.error('❌ Erro de conexão Socket.IO:', error.message);
            console.log('🔄 Tentando reconectar...');
        });
        
        socket.on('disconnect', (reason) => {
            console.log('❌ Socket.IO desconectado:', reason);
            if (reason === 'io server disconnect') {
                // Reconecta manualmente se o servidor desconectou
                socket.connect();
            }
        });
        
        socket.on('reconnect', (attemptNumber) => {
            console.log('✅ Socket.IO reconectado após', attemptNumber, 'tentativas');
        });
        
        socket.on('reconnect_error', (error) => {
            console.error('❌ Erro na reconexão:', error.message);
        });
        
        socket.io.on('upgrade', () => {
            console.log('⬆️ Upgrade para WebSocket realizado');
        });
        
        return socket;
    } else {
        console.error('❌ Socket.IO não carregado');
        return null;
    }
};

// Função para testar conectividade
window.testConnection = async function() {
    try {
        console.log('🧪 Testando conexão com o backend...');
        
        // Testa endpoint de saúde
        const healthResponse = await fetch(window.API_URL + '/health', {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });
        
        if (healthResponse.ok) {
            const healthData = await healthResponse.json();
            console.log('✅ Backend respondeu:', healthData);
            return true;
        } else {
            console.error('❌ Backend retornou status:', healthResponse.status);
            return false;
        }
        
    } catch (error) {
        console.error('❌ Erro ao testar conexão:', error);
        return false;
    }
};

// Auto-teste na inicialização
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🌍 Ambiente:', isProduction ? 'Produção' : 'Desenvolvimento');
    console.log('🔗 API URL:', window.API_URL);
    console.log('🔌 Socket URL:', API_CONFIG.SOCKET_URL);
    
    // Testa conexão automaticamente
    const connected = await window.testConnection();
    if (!connected) {
        console.warn('⚠️ Problemas de conectividade detectados');
    }
});

// Exporta para uso global
window.isProduction = isProduction;
// frontend/js/config.js
// Configuração de URLs para desenvolvimento e produção

// Detecta se está em produção ou desenvolvimento
const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';

// URLs da API
const API_CONFIG = {
    // URL do backend no Fly.io
    BACKEND_URL: isProduction 
        ? 'https://entregas-backend-fly.fly.dev' 
        : 'http://localhost:3000',
        
    // Socket.io URL (mesma do backend)
    SOCKET_URL: isProduction 
        ? 'https://entregas-backend-fly.fly.dev' 
        : 'http://localhost:3000'
};

// Exporta a configuração para uso nos outros arquivos
window.API_CONFIG = API_CONFIG;

// Para compatibilidade com código existente
window.API_URL = API_CONFIG.BACKEND_URL + '/api';

console.log('🌍 Ambiente:', isProduction ? 'Produção' : 'Desenvolvimento');
console.log('🔗 API URL:', window.API_URL);
console.log('🔌 Socket URL:', API_CONFIG.SOCKET_URL);
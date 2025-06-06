// src/index.js - Versão FINAL e CORRIGIDA

const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const db = require('./database');
require('dotenv').config();

// Importa as rotas
const deliveriesRouter = require('./routes/deliveries');
const trackingRouter = require('./routes/tracking');
const settingsRouter = require('./routes/settings');
const archiveRouter = require('./routes/archive');

const app = express();
const server = http.createServer(app);

// --- INÍCIO DA CONFIGURAÇÃO DE CORS ---

// Lista de domínios que podem acessar seu backend
const allowedOrigins = [
    'https://entregas.demiplie.com.br',
    'https://entregas-drab.vercel.app',
    process.env.FRONTEND_URL,
    'http://localhost:3001',
    'http://localhost:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:3000'
].filter(Boolean);

// Opções de configuração para o CORS
const corsOptions = {
    origin: function (origin, callback) {
        // Permite requisições da mesma origem, da lista de permitidos ou sem origem (como Postman)
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Sua origem não é permitida pela política de CORS.'));
        }
    },
    credentials: true
};

// --- FIM DA CONFIGURAÇÃO DE CORS ---


// Middlewares Essenciais
app.use(cors(corsOptions)); // Aplica a configuração de CORS AQUI. Isso é tudo que você precisa.
app.use(express.json({ limit: '10mb' })); // Para interpretar o corpo de requisições JSON


// Configuração do Socket.io
const io = socketIo(server, {
    cors: corsOptions, // Reutiliza as mesmas opções de CORS
});
app.set('socketio', io);


// Inicialização da aplicação
async function initializeApp() {
    try {
        console.log('🔄 Inicializando aplicação...');
        await db.testConnection();
        await db.initializeDatabase();
        console.log('✅ Banco de dados inicializado com sucesso!');
        app.set('db', db);
    } catch (error) {
        console.error('❌ Erro ao inicializar aplicação:', error);
        process.exit(1);
    }
}


// Rotas da API
app.get('/api/health', async (req, res) => {
    res.json({ status: 'ok', message: 'Servidor está no ar!' });
});

app.use('/api/deliveries', deliveriesRouter);
app.use('/api/tracking', trackingRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/archive', archiveRouter);


// Tratamento de erros global
app.use((err, req, res, next) => {
    console.error('❌ Erro não tratado:', err);
    res.status(500).json({
        error: 'Erro interno do servidor',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});


// Inicializa e Inicia o Servidor
initializeApp().then(() => {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Servidor rodando na porta ${PORT}`);
        console.log('🎉 Sistema pronto para uso!');
    });
}).catch((error) => {
    console.error('❌ Falha fatal ao inicializar servidor:', error);
    process.exit(1);
});
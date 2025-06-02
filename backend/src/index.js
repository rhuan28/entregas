// src/index.js - Backend principal atualizado para PostgreSQL
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const db = require('./database'); // Nova configuração PostgreSQL
require('dotenv').config();

const deliveriesRouter = require('./routes/deliveries');
const trackingRouter = require('./routes/tracking');
const settingsRouter = require('./routes/settings');
const archiveRouter = require('./routes/archive');

const app = express();
const server = http.createServer(app);

// Configuração CORS para produção
const corsOptions = {
    origin: [
        'https://entregas-drab.vercel.app', // Substitua pela sua URL do Vercel
        process.env.FRONTEND_URL,
        'http://localhost:3001', // Para desenvolvimento local
        'http://localhost:3000'  // Para desenvolvimento local
    ].filter(Boolean), // Remove valores undefined/null
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 200
};

// Configuração Socket.io
const io = socketIo(server, {
    cors: {
        origin: corsOptions.origin,
        methods: ['GET', 'POST'],
        credentials: true
    }
});

// Inicialização da aplicação
async function initializeApp() {
    try {
        console.log('🔄 Inicializando aplicação...');
        
        // Testa conexão com PostgreSQL
        await db.testConnection();
        
        // Inicializa/migra banco de dados
        await db.initializeDatabase();
        
        console.log('✅ Banco de dados inicializado com sucesso!');
        
        // Torna a conexão do banco disponível para as rotas
        app.set('db', db);
        
    } catch (error) {
        console.error('❌ Erro ao inicializar aplicação:', error);
        console.error('Verifique se o DATABASE_URL está configurado corretamente');
        process.exit(1);
    }
}

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Log de todas as requisições
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Headers CORS adicionais
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (corsOptions.origin.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// Endpoint para verificar se o servidor está funcionando
app.get('/api/health', async (req, res) => {
    try {
        // Testa conexão com banco
        await db.testConnection();
        
        res.json({ 
            status: 'ok', 
            message: 'Servidor backend funcionando!',
            database: 'connected',
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development'
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'error', 
            message: 'Erro na conexão com banco de dados',
            error: error.message
        });
    }
});

// Rota separada para listar rotas (atualizada para PostgreSQL)
app.get('/api/routes', async (req, res) => {
    try {
        console.log('Listando rotas...');
        const query = `
            SELECT 
                r.id,
                r.route_date,
                r.status,
                r.total_distance,
                r.total_duration,
                r.archived,
                r.archived_at,
                COUNT(DISTINCT d.id) as delivery_count,
                COUNT(DISTINCT CASE WHEN d.status = 'delivered' THEN d.id END) as delivered_count
            FROM routes r 
            LEFT JOIN deliveries d ON r.route_date = d.order_date 
            WHERE r.archived = false OR r.archived IS NULL
            GROUP BY r.id, r.route_date, r.status, r.total_distance, r.total_duration, r.archived, r.archived_at
            ORDER BY r.route_date DESC
            LIMIT 30
        `;
        
        const result = await db.query(query);
        console.log(`Retornando ${result.rows.length} rotas`);
        res.json(result.rows);
    } catch (error) {
        console.error('Erro ao buscar rotas:', error);
        res.status(500).json({ error: error.message });
    }
});

// Rotas principais
app.use('/api/deliveries', deliveriesRouter);
app.use('/api/tracking', trackingRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/archive', archiveRouter);

// Endpoint para tratar URLs incorretas
app.use('*', (req, res) => {
    console.log(`Rota não encontrada: ${req.originalUrl}`);
    res.status(404).json({ error: 'Rota não encontrada' });
});

// Socket.io para rastreamento em tempo real
io.on('connection', (socket) => {
    console.log('Cliente conectado:', socket.id);

    socket.on('join-route', (routeId) => {
        socket.join(`route-${routeId}`);
        console.log(`Cliente ${socket.id} entrou na rota ${routeId}`);
    });

    socket.on('update-location', (data) => {
        // Emite localização para todos acompanhando a rota
        io.to(`route-${data.routeId}`).emit('location-update', {
            lat: data.lat,
            lng: data.lng,
            deliveryId: data.deliveryId,
            timestamp: new Date()
        });
    });

    socket.on('disconnect', () => {
        console.log('Cliente desconectado:', socket.id);
    });
});

// Torna io disponível para as rotas
app.set('socketio', io);

// Tratamento de erros global
app.use((err, req, res, next) => {
    console.error('Erro não tratado:', err);
    res.status(500).json({ 
        error: 'Erro interno do servidor', 
        details: process.env.NODE_ENV === 'development' ? err.message : 'Erro interno'
    });
});

// Inicializa a aplicação
initializeApp().then(() => {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`🚀 Servidor rodando na porta ${PORT}`);
        console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
        console.log('📊 Configurações carregadas:');
        console.log(`   - DATABASE_URL: ${process.env.DATABASE_URL ? 'Configurado' : 'NÃO CONFIGURADO'}`);
        console.log(`   - FRONTEND_URL: ${process.env.FRONTEND_URL || 'http://localhost:3001'}`);
        console.log(`   - GOOGLE_MAPS_API_KEY: ${process.env.GOOGLE_MAPS_API_KEY ? 'Configurado' : 'NÃO CONFIGURADO'}`);
        console.log('🎉 Sistema pronto para uso!');
    });
}).catch((error) => {
    console.error('❌ Falha ao inicializar servidor:', error);
    process.exit(1);
});
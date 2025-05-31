// src/index.js - Backend principal (com correções de CORS e melhor log)
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const mysql = require('mysql2/promise');
require('dotenv').config();

const deliveriesRouter = require('./routes/deliveries');
const trackingRouter = require('./routes/tracking');
const settingsRouter = require('./routes/settings');
const archiveRouter = require('./routes/archive');

const app = express();
const server = http.createServer(app);

// Configuração CORS
const corsOptions = {
    origin: '*', // Aceita todas as origens - você pode restringir depois para 'http://localhost:3001'
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 200
};

// Configuração Socket.io
const io = socketIo(server, {
    cors: {
        origin: '*', // Aceita todas as origens - você pode restringir depois para 'http://localhost:3001'
        methods: ['GET', 'POST'],
        credentials: true
    }
});

// Pool de conexões MySQL
let pool;
try {
    pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'confeitaria_entregas',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });
    console.log('Pool de conexão MySQL criado com sucesso!');
} catch (error) {
    console.error('ERRO ao criar pool de conexão MySQL:', error);
}

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Log de todas as requisições
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Adiciona header CORS em todas as respostas
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); // Você pode restringir depois para 'http://localhost:3001'
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
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Servidor backend funcionando!' });
});

// Rota separada para listar rotas (mais fácil de acessar)
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
                COUNT(DISTINCT d.id) as delivery_count,
                COUNT(DISTINCT CASE WHEN d.status = 'delivered' THEN d.id END) as delivered_count
            FROM routes r 
            LEFT JOIN deliveries d ON r.route_date = d.order_date 
            GROUP BY r.id 
            ORDER BY r.route_date DESC
            LIMIT 30
        `;
        
        const [rows] = await pool.execute(query);
        console.log(`Retornando ${rows.length} rotas`);
        res.json(rows);
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
    res.status(500).json({ error: 'Erro interno do servidor', details: err.message });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
    console.log('Configurações carregadas:');
    console.log(`- DB_HOST: ${process.env.DB_HOST || 'localhost'}`);
    console.log(`- DB_NAME: ${process.env.DB_NAME || 'confeitaria_entregas'}`);
    console.log(`- FRONTEND_URL: ${process.env.FRONTEND_URL || 'http://localhost:3001'}`);
});
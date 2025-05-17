// src/index.js - Backend principal
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const mysql = require('mysql2/promise');
require('dotenv').config();

const deliveriesRouter = require('./routes/deliveries');
const trackingRouter = require('./routes/tracking');
const settingsRouter = require('./routes/settings');

const app = express();
const server = http.createServer(app);

// Configuração CORS
const corsOptions = {
    origin: 'http://localhost:3001',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 200
};

// Configuração Socket.io
const io = socketIo(server, {
    cors: {
        origin: 'http://localhost:3001',
        methods: ['GET', 'POST'],
        credentials: true
    }
});

// Pool de conexões MySQL
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'confeitaria_entregas',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Adiciona header CORS em todas as respostas
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'http://localhost:3001');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// Rota separada para listar rotas (mais fácil de acessar)
app.get('/api/routes', async (req, res) => {
    try {
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
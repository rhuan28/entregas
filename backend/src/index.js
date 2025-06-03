// src/index.js - Backend principal com Socket.IO corrigido
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const db = require('./database');
require('dotenv').config();

const deliveriesRouter = require('./routes/deliveries');
const trackingRouter = require('./routes/tracking');
const settingsRouter = require('./routes/settings');
const archiveRouter = require('./routes/archive');

const app = express();
const server = http.createServer(app);

// Configuração CORS mais permissiva para Socket.IO
const corsOptions = {
    origin: [
        'https://entregas-drab.vercel.app',
        'https://entregas.demiplie.com.br',
        process.env.FRONTEND_URL,
        'http://localhost:3001',
        'http://localhost:3000',
        'http://127.0.0.1:3001',
        'http://127.0.0.1:3000'
    ].filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 200
};

// Configuração Socket.io com configurações melhoradas
const io = socketIo(server, {
    cors: corsOptions,
    allowEIO3: true,
    transports: ['websocket', 'polling'], // Permite ambos os transportes
    pingTimeout: 60000,
    pingInterval: 25000,
    upgradeTimeout: 30000,
    maxHttpBufferSize: 1e6,
    // Configurações específicas para produção
    ...(process.env.NODE_ENV === 'production' && {
        cookie: false,
        serveClient: false
    })
});

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
        console.error('Verifique se o DATABASE_URL está configurado corretamente');
        process.exit(1);
    }
}

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// Log de todas as requisições (apenas em desenvolvimento)
if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
        next();
    });
}

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
        await db.testConnection();
        
        res.json({ 
            status: 'ok', 
            message: 'Servidor backend funcionando!',
            database: 'connected',
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development',
            socketio: 'enabled'
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'error', 
            message: 'Erro na conexão com banco de dados',
            error: error.message
        });
    }
});

// Endpoint específico para testar Socket.IO
app.get('/api/socket/test', (req, res) => {
    res.json({
        socketio: {
            status: 'enabled',
            clients: io.engine.clientsCount,
            transports: ['websocket', 'polling']
        }
    });
});

// Rota separada para listar rotas
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

// Socket.io para rastreamento em tempo real com melhor tratamento de erros
io.on('connection', (socket) => {
    console.log('✅ Cliente conectado:', socket.id);

    // Melhora o tratamento de erros de conexão
    socket.on('error', (error) => {
        console.error('❌ Erro no socket:', socket.id, error);
    });

    socket.on('disconnect', (reason) => {
        console.log('❌ Cliente desconectado:', socket.id, 'Razão:', reason);
    });

    socket.on('join-route', (routeId) => {
        socket.join(`route-${routeId}`);
        console.log(`📍 Cliente ${socket.id} entrou na rota ${routeId}`);
        
        // Confirma que entrou na sala
        socket.emit('joined-route', { routeId, message: 'Conectado ao rastreamento' });
    });

    socket.on('update-location', (data) => {
        try {
            // Valida os dados recebidos
            if (!data.lat || !data.lng) {
                console.error('Dados de localização inválidos:', data);
                return;
            }

            // Emite localização para todos acompanhando a rota
            const locationUpdate = {
                lat: parseFloat(data.lat),
                lng: parseFloat(data.lng),
                deliveryId: data.deliveryId,
                routeId: data.routeId,
                timestamp: new Date().toISOString()
            };

            if (data.routeId) {
                io.to(`route-${data.routeId}`).emit('location-update', locationUpdate);
                console.log(`📍 Localização atualizada para rota ${data.routeId}`);
            } else {
                // Broadcast geral se não há routeId específica
                io.emit('location-update', locationUpdate);
            }
        } catch (error) {
            console.error('Erro ao processar atualização de localização:', error);
        }
    });

    // Evento para notificar entrega concluída
    socket.on('delivery-completed', (data) => {
        try {
            io.emit('delivery-completed', {
                deliveryId: data.deliveryId,
                timestamp: new Date().toISOString(),
                message: 'Entrega concluída!'
            });
            console.log(`✅ Entrega ${data.deliveryId} marcada como concluída`);
        } catch (error) {
            console.error('Erro ao processar entrega concluída:', error);
        }
    });

    // Evento para quando entregador está se aproximando
    socket.on('delivery-approaching', (data) => {
        try {
            io.emit('delivery-approaching', {
                deliveryId: data.deliveryId,
                timestamp: new Date().toISOString(),
                message: 'Entregador se aproximando!'
            });
            console.log(`🚚 Entregador se aproximando da entrega ${data.deliveryId}`);
        } catch (error) {
            console.error('Erro ao processar aproximação:', error);
        }
    });
});

// Logs de conexão do Socket.IO
io.engine.on('connection_error', (err) => {
    console.error('❌ Erro de conexão Socket.IO:', err.req);
    console.error('❌ Código:', err.code);
    console.error('❌ Mensagem:', err.message);
    console.error('❌ Context:', err.context);
});

// Torna io disponível para as rotas
app.set('socketio', io);

// Tratamento de erros global
app.use((err, req, res, next) => {
    console.error('❌ Erro não tratado:', err);
    res.status(500).json({ 
        error: 'Erro interno do servidor', 
        details: process.env.NODE_ENV === 'development' ? err.message : 'Erro interno'
    });
});

// Tratamento de promessas rejeitadas
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promessa rejeitada não tratada:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Exceção não capturada:', error);
    process.exit(1);
});

// Inicializa a aplicação
initializeApp().then(() => {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Servidor rodando na porta ${PORT}`);
        console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
        console.log('📊 Configurações carregadas:');
        console.log(`   - DATABASE_URL: ${process.env.DATABASE_URL ? 'Configurado' : 'NÃO CONFIGURADO'}`);
        console.log(`   - FRONTEND_URL: ${process.env.FRONTEND_URL || 'http://localhost:3001'}`);
        console.log(`   - GOOGLE_MAPS_API_KEY: ${process.env.GOOGLE_MAPS_API_KEY ? 'Configurado' : 'NÃO CONFIGURADO'}`);
        console.log(`   - Socket.IO: Habilitado com CORS`);
        console.log('🎉 Sistema pronto para uso!');
    });
}).catch((error) => {
    console.error('❌ Falha ao inicializar servidor:', error);
    process.exit(1);
});
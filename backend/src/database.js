// backend/src/database.js - Nova configuração para PostgreSQL
const { Pool } = require('pg');
require('dotenv').config();

// Configuração do pool de conexões PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10, // máximo de conexões no pool
    idleTimeoutMillis: 30000, // tempo limite para conexões ociosas
    connectionTimeoutMillis: 2000, // tempo limite para estabelecer conexão
});

// Função para testar a conexão
async function testConnection() {
    try {
        const client = await pool.connect();
        console.log('✅ Conectado ao PostgreSQL com sucesso!');
        client.release();
        return true;
    } catch (error) {
        console.error('❌ Erro ao conectar ao PostgreSQL:', error.message);
        return false;
    }
}

// Função para executar queries
async function query(text, params) {
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        console.log('Query executada:', { text, duration, rows: res.rowCount });
        return res;
    } catch (error) {
        console.error('Erro na query:', { text, error: error.message });
        throw error;
    }
}

// Função para executar transações
async function transaction(callback) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// Inicializa o banco de dados (cria tabelas se não existirem)
async function initializeDatabase() {
    try {
        console.log('🔄 Inicializando banco de dados...');
        
        // Lê o arquivo de migração
        const fs = require('fs');
        const path = require('path');
        const migrationPath = path.join(__dirname, '..', '..', 'database', 'migration.sql');
        
        if (fs.existsSync(migrationPath)) {
            const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
            await query(migrationSQL);
            console.log('✅ Migração executada com sucesso!');
        } else {
            console.log('⚠️ Arquivo de migração não encontrado, criando tabelas básicas...');
            
            // SQL básico caso o arquivo não exista
            await query(`
                CREATE TABLE IF NOT EXISTS deliveries (
                    id SERIAL PRIMARY KEY,
                    order_date DATE NOT NULL,
                    customer_name VARCHAR(255) NOT NULL,
                    customer_phone VARCHAR(20),
                    address VARCHAR(500) NOT NULL,
                    lat DECIMAL(10, 8),
                    lng DECIMAL(11, 8),
                    product_description TEXT,
                    size VARCHAR(2) DEFAULT 'M',
                    priority INTEGER DEFAULT 0,
                    delivery_window_start TIME,
                    delivery_window_end TIME,
                    status VARCHAR(20) DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
        }
        
        console.log('✅ Banco de dados inicializado!');
    } catch (error) {
        console.error('❌ Erro ao inicializar banco de dados:', error);
        throw error;
    }
}

module.exports = {
    pool,
    query,
    transaction,
    testConnection,
    initializeDatabase
};
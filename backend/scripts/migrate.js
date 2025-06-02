// scripts/migrate.js - Script de migração para PostgreSQL
const db = require('../src/database');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    try {
        console.log('🔄 Iniciando migração do banco de dados...');
        
        // Testa conexão
        const connected = await db.testConnection();
        if (!connected) {
            throw new Error('Não foi possível conectar ao banco de dados');
        }
        
        // Lê o arquivo de migração
        const migrationPath = path.join(__dirname, '..', '..', 'database', 'migration.sql');
        console.log('📁 Lendo arquivo de migração:', migrationPath);
        
        if (!fs.existsSync(migrationPath)) {
            throw new Error(`Arquivo de migração não encontrado: ${migrationPath}`);
        }
        
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        console.log('📋 Arquivo de migração carregado, executando...');
        
        // Executa a migração
        await db.query(migrationSQL);
        
        // Verifica se as tabelas foram criadas
        const tablesResult = await db.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
            ORDER BY table_name
        `);
        
        console.log('✅ Migração concluída com sucesso!');
        console.log('📊 Tabelas criadas:');
        tablesResult.rows.forEach(row => {
            console.log(`   - ${row.table_name}`);
        });
        
        // Verifica se as configurações padrão foram inseridas
        const settingsResult = await db.query('SELECT COUNT(*) as count FROM settings');
        console.log(`⚙️ Configurações padrão: ${settingsResult.rows[0].count} registros`);
        
        console.log('🎉 Banco de dados está pronto para uso!');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Erro na migração:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

// Executa apenas se chamado diretamente
if (require.main === module) {
    runMigration();
}

module.exports = { runMigration };
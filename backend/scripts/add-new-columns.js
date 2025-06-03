// backend/scripts/add-new-columns.js
const db = require('../src/database');

async function addNewColumns() {
    try {
        console.log('🔄 Iniciando migração para adicionar novas colunas...');
        
        // Testa conexão
        const connected = await db.testConnection();
        if (!connected) {
            throw new Error('Não foi possível conectar ao banco de dados');
        }
        
        console.log('✅ Conectado ao PostgreSQL');
        
        // Executa a migração
        const migrationSQL = `
            DO $$ 
            BEGIN
                -- Adiciona order_number se não existir
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name='deliveries' AND column_name='order_number'
                ) THEN
                    ALTER TABLE deliveries ADD COLUMN order_number VARCHAR(50);
                    RAISE NOTICE 'Coluna order_number adicionada';
                ELSE
                    RAISE NOTICE 'Coluna order_number já existe';
                END IF;
                
                -- Adiciona product_type se não existir
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name='deliveries' AND column_name='product_type'
                ) THEN
                    ALTER TABLE deliveries ADD COLUMN product_type VARCHAR(50);
                    RAISE NOTICE 'Coluna product_type adicionada';
                ELSE
                    RAISE NOTICE 'Coluna product_type já existe';
                END IF;
                
                -- Adiciona product_name se não existir
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name='deliveries' AND column_name='product_name'
                ) THEN
                    ALTER TABLE deliveries ADD COLUMN product_name VARCHAR(100);
                    RAISE NOTICE 'Coluna product_name adicionada';
                ELSE
                    RAISE NOTICE 'Coluna product_name já existe';
                END IF;
            END $$;
        `;
        
        console.log('📋 Executando migração...');
        await db.query(migrationSQL);
        
        // Criar índices
        console.log('📊 Criando índices...');
        await db.query('CREATE INDEX IF NOT EXISTS idx_deliveries_order_number ON deliveries(order_number)');
        await db.query('CREATE INDEX IF NOT EXISTS idx_deliveries_product_type ON deliveries(product_type)');
        
        // Verificar se as colunas foram criadas
        const result = await db.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'deliveries' 
            AND column_name IN ('order_number', 'product_type', 'product_name')
            ORDER BY column_name
        `);
        
        console.log('✅ Migração concluída com sucesso!');
        console.log('📊 Colunas criadas:');
        result.rows.forEach(row => {
            console.log(`   - ${row.column_name} (${row.data_type}) - Nullable: ${row.is_nullable}`);
        });
        
        // Verificar tabela deliveries
        const tableInfo = await db.query(`
            SELECT COUNT(*) as total_deliveries 
            FROM deliveries
        `);
        
        console.log(`📦 Total de entregas na tabela: ${tableInfo.rows[0].total_deliveries}`);
        console.log('🎉 Banco de dados atualizado e pronto para os novos campos!');
        
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Erro na migração:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

// Executa apenas se chamado diretamente
if (require.main === module) {
    addNewColumns();
}

module.exports = { addNewColumns };
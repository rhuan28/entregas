// routes/settings.js - Atualizado para PostgreSQL
const express = require('express');
const router = express.Router();

// Obtém a instância do banco de dados a partir do app
function getDb(req) {
    return req.app.get('db');
}

// Obtém todas as configurações
router.get('/', async (req, res) => {
    try {
        const db = getDb(req);
        const result = await db.query('SELECT * FROM settings');
        
        // Converte para objeto key-value
        const settingsObject = {};
        result.rows.forEach(setting => {
            settingsObject[setting.setting_key] = setting.setting_value;
        });
        
        res.json(settingsObject);
    } catch (error) {
        console.error('Erro ao buscar configurações:', error);
        res.status(500).json({ error: error.message });
    }
});

// Atualiza uma configuração
router.put('/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const { value } = req.body;
        
        // Validação para campos numéricos
        if (key === 'daily_rate' || key === 'km_rate') {
            const numValue = parseFloat(value);
            if (isNaN(numValue) || numValue < 0) {
                return res.status(400).json({ error: 'Valor inválido para configuração de preço' });
            }
        }
        
        const db = getDb(req);
        
        // PostgreSQL usa ON CONFLICT ao invés de ON DUPLICATE KEY UPDATE
        await db.query(
            `INSERT INTO settings (setting_key, setting_value) 
             VALUES ($1, $2) 
             ON CONFLICT (setting_key) 
             DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP`,
            [key, value]
        );
        
        res.json({ message: 'Configuração atualizada' });
    } catch (error) {
        console.error('Erro ao atualizar configuração:', error);
        res.status(500).json({ error: error.message });
    }
});

// Atualiza múltiplas configurações
router.post('/bulk', async (req, res) => {
    try {
        const settings = req.body;
        const db = getDb(req);
        
        // Usa transação para garantir consistência
        await db.transaction(async (client) => {
            for (const [key, value] of Object.entries(settings)) {
                // Validação para campos numéricos
                if ((key === 'daily_rate' || key === 'km_rate') && (isNaN(parseFloat(value)) || parseFloat(value) < 0)) {
                    throw new Error(`Valor inválido para configuração de preço: ${key}`);
                }
                
                await client.query(
                    `INSERT INTO settings (setting_key, setting_value) 
                     VALUES ($1, $2) 
                     ON CONFLICT (setting_key) 
                     DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP`,
                    [key, value]
                );
            }
        });
        
        res.json({ message: 'Configurações atualizadas' });
    } catch (error) {
        console.error('Erro ao atualizar configurações:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
// routes/settings.js
const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');

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

// Obtém todas as configurações
router.get('/', async (req, res) => {
    try {
        const [settings] = await pool.execute(
            'SELECT * FROM settings'
        );
        
        // Converte para objeto key-value
        const settingsObject = {};
        settings.forEach(setting => {
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
        
        await pool.execute(
            'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            [key, value, value]
        );
        
        res.json({ message: 'Configuração atualizada' });
    } catch (error) {
        console.error('Erro ao atualizar configuração:', error);
        res.status(500).json({ error: error.message });
    }
});

// Atualiza múltiplas configurações
router.post('/bulk', async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const settings = req.body;
        
        for (const [key, value] of Object.entries(settings)) {
            // Validação para campos numéricos
            if ((key === 'daily_rate' || key === 'km_rate') && (isNaN(parseFloat(value)) || parseFloat(value) < 0)) {
                await connection.rollback();
                return res.status(400).json({ error: `Valor inválido para configuração de preço: ${key}` });
            }
            
            await connection.execute(
                'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
                [key, value, value]
            );
        }
        
        await connection.commit();
        res.json({ message: 'Configurações atualizadas' });
    } catch (error) {
        await connection.rollback();
        console.error('Erro ao atualizar configurações:', error);
        res.status(500).json({ error: error.message });
    } finally {
        connection.release();
    }
});

module.exports = router;
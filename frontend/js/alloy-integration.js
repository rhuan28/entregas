// js/alloy-integration.js

/**
 * Funções para integração com o sistema Alloy
 */

// URL base da API
const API_URL = 'http://localhost:3000/api';

/**
 * Importa pedidos do Alloy para a data atual
 * @param {String} date - Data no formato YYYY-MM-DD
 * @returns {Promise} - Resultado da importação
 */
async function importAlloyOrders(date) {
    try {
        // Mostra indicador de carregamento
        const importBtn = document.getElementById('import-alloy-btn');
        const originalText = importBtn.innerHTML;
        importBtn.innerHTML = '<span class="loading"></span> Importando...';
        importBtn.disabled = true;
        
        // Faz a requisição para importar pedidos
        const response = await fetch(`${API_URL}/alloy/import`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ date })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        const result = await response.json();
        
        // Restaura botão
        importBtn.innerHTML = originalText;
        importBtn.disabled = false;
        
        // Exibe resultado da importação
        let messageType = 'info';
        let message = '';
        
        if (result.success) {
            messageType = 'success';
            if (result.imported > 0) {
                message = `Sucesso! ${result.imported} novos pedidos importados do Alloy`;
            } else {
                message = `Nenhum novo pedido para importar. ${result.alreadyImported} pedidos já importados anteriormente.`;
            }
            
            // Recarrega lista de entregas
            loadDeliveries();
            
            // Atualiza badge de sincronização
            updateSyncStatus(date);
        } else {
            messageType = 'error';
            message = `Erro: ${result.error || 'Falha na importação'}`;
        }
        
        showToast(message, messageType);
        return result;
        
    } catch (error) {
        console.error('Erro ao importar pedidos do Alloy:', error);
        showToast(`Erro ao importar: ${error.message}`, 'error');
        
        // Restaura botão
        const importBtn = document.getElementById('import-alloy-btn');
        importBtn.innerHTML = 'Importar Alloy';
        importBtn.disabled = false;
        
        return { success: false, error: error.message };
    }
}

/**
 * Verifica status de sincronização com o Alloy
 * @param {String} date - Data no formato YYYY-MM-DD
 */
async function updateSyncStatus(date) {
    try {
        const badge = document.getElementById('alloy-sync-badge');
        if (!badge) return;
        
        badge.innerHTML = '<span class="loading"></span>';
        badge.className = 'alloy-sync-badge pending';
        
        const response = await fetch(`${API_URL}/alloy/sync-status?date=${date}`);
        const result = await response.json();
        
        if (result.success) {
            if (result.syncStatus === 'synced') {
                badge.innerHTML = `<span>✓ Sincronizado</span>`;
                badge.className = 'alloy-sync-badge synced';
            } else {
                badge.innerHTML = `<span>${result.notImported} pendente${result.notImported > 1 ? 's' : ''}</span>`;
                badge.className = 'alloy-sync-badge pending';
            }
        } else {
            badge.innerHTML = `<span>!</span>`;
            badge.className = 'alloy-sync-badge error';
        }
    } catch (error) {
        console.error('Erro ao verificar status de sincronização:', error);
        const badge = document.getElementById('alloy-sync-badge');
        if (badge) {
            badge.innerHTML = `<span>!</span>`;
            badge.className = 'alloy-sync-badge error';
        }
    }
}

// Exporta funções
window.importAlloyOrders = importAlloyOrders;
window.updateSyncStatus = updateSyncStatus;
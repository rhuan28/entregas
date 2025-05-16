// alloyService.js - Versão atualizada para criar entradas de rotas
const axios = require('axios');
require('dotenv').config();

/**
 * Serviço para comunicação com a API Alloy
 * Otimizado para realizar uma única requisição por vez
 * Com correção para usar a data de agendamento correta
 * E criação automática de entradas de rota
 */
class AlloyService {
    constructor() {
        // Token fornecido pelo usuário
        this.token = '682643ed92d4c';
        this.baseURL = 'https://api.alloy.al/api';
        
        // Armazena dados em cache para evitar múltiplas requisições
        this.cachedOrders = null;
        this.cachedDate = null;
        this.isFetching = false;
    }

    /**
     * Obtém pedidos do Alloy para a data especificada
     * Garante apenas uma requisição por vez e usa cache
     * 
     * @param {string} date - Data no formato YYYY-MM-DD
     * @param {boolean} forceRefresh - Se verdadeiro, ignora o cache
     * @returns {Promise<Array>} - Lista de pedidos
     */
    async getOrders(date = null, forceRefresh = false) {
        // Se estiver buscando dados, espera a conclusão
        if (this.isFetching) {
            console.log('Uma requisição já está em andamento. Aguardando...');
            while (this.isFetching) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            return this.cachedOrders || [];
        }

        // Verifica se já temos dados em cache para esta data
        if (!forceRefresh && this.cachedOrders && this.cachedDate === date) {
            console.log(`Usando dados em cache para a data ${date}`);
            return this.cachedOrders;
        }

        try {
            // Marca que está fazendo uma requisição
            this.isFetching = true;
            
            // Constrói a URL com os parâmetros corretos para pedidos agendados
            let url = `${this.baseURL}/delivery/getorders`;
            
            // Se uma data específica for fornecida, adiciona ao filtro
            if (date) {
                url += `?data_agendamento=${date}`;
            }
            
            console.log(`Fazendo requisição única à API Alloy: ${url}`);
            
            // Faz a requisição com o formato correto de autenticação
            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                },
                timeout: 15000 // 15 segundos de timeout
            });

            console.log(`Resposta da API Alloy: status ${response.status}`);
            
            if (response.data && response.data.status === "success") {
                const orders = response.data.pedidos || [];
                console.log(`Recebidos ${orders.length} pedidos do Alloy`);
                
                // Armazena em cache
                this.cachedOrders = orders;
                this.cachedDate = date;
                
                return orders;
            } else {
                console.error('API Alloy retornou erro:', response.data);
                throw new Error(response.data.message || 'Falha ao obter pedidos do Alloy');
            }
        } catch (error) {
            // Trata erros específicos
            if (error.response) {
                const status = error.response.status;
                console.error(`Erro ${status} na requisição à API Alloy:`, error.response.data);
                
                if (status === 429) {
                    throw new Error('Limite de requisições excedido na API Alloy. Tente novamente mais tarde.');
                }
                
                throw new Error(`Erro na API Alloy: ${error.response.data.message || status}`);
            }
            
            console.error('Erro ao buscar pedidos do Alloy:', error.message);
            throw error;
        } finally {
            // Marca que terminou a requisição
            this.isFetching = false;
        }
    }

    /**
     * Limpa o cache de pedidos
     */
    clearCache() {
        this.cachedOrders = null;
        this.cachedDate = null;
        console.log('Cache de pedidos do Alloy limpo');
    }

    /**
     * Transforma um pedido do Alloy no formato usado pelo sistema de entregas
     * @param {Object} order - Pedido do Alloy
     * @returns {Object} - Pedido formatado para o sistema de entregas
     */
    transformOrderToDelivery(order) {
        // Extrai os dados do endereço - usando endereco_de_entrega
        const address = this._formatAddress(order.endereco_de_entrega);
        
        // Usa a data de agendamento correta em vez da data atual
        // Isso garante que o pedido seja importado para a data correta
        let orderDate = new Date().toISOString().split('T')[0]; // Padrão: data atual
        
        // Se for pedido agendado, usa a data de agendamento
        if (order.agendamento === 1 && order.data_agendamento) {
            try {
                // Extrai apenas a data do campo data_agendamento (formato: YYYY-MM-DD HH:MM:SS)
                const agendamentoDate = new Date(order.data_agendamento);
                if (!isNaN(agendamentoDate)) {
                    orderDate = agendamentoDate.toISOString().split('T')[0];
                    console.log(`Usando data de agendamento: ${orderDate} para pedido ${order.ref}`);
                }
            } catch (error) {
                console.error('Erro ao extrair data de agendamento:', error);
                // Mantém a data atual em caso de erro
            }
        }
        
        // Formata a janela de entrega
        let deliveryWindowStart = null;
        let deliveryWindowEnd = null;
        
        // Verificamos se é um pedido agendado
        if (order.agendamento === 1) {
            try {
                // Extrai hora do agendamento (padrão 10:00:00 para entregas)
                // Baseado na descrição do pedido, as entregas são das 10h às 14h30
                const defaultHour = "10:00:00";
                
                // Formata para HH:MM:SS
                deliveryWindowStart = this._formatTimeForMySQL(defaultHour);
                
                // Janela de entrega até 14:30 por padrão
                deliveryWindowEnd = "14:30:00";
            } catch (error) {
                console.error('Erro ao processar data de agendamento:', error);
            }
        }
        
        // Determina a prioridade com base em diversos fatores
        const priority = this._determinePriority(order);
        
        // Cria descrição do produto a partir dos itens
        const productDescription = this._formatProductDescription(order.itens);

        return {
            external_order_id: `alloy_${order.ref}`,
            order_date: orderDate, // Usa a data de agendamento
            customer_name: `${order.usuario.nome} ${order.usuario.sobrenome || ''}`.trim(),
            customer_phone: order.usuario.telefone || '',
            address: address,
            product_description: productDescription,
            size: this._determineSize(order.itens),
            priority: priority,
            delivery_window_start: deliveryWindowStart,
            delivery_window_end: deliveryWindowEnd,
            // Campos adicionais específicos do Alloy
            external_system: 'alloy',
            payment_method: order.meio_de_pagamento || '',
            total: order.total || 0,
            observations: order.obs || ''
        };
    }

    /**
     * Formata o endereço a partir dos dados do Alloy
     * @private
     * @param {Object} endereco - Dados de endereço do Alloy
     * @returns {string} - Endereço formatado
     */
    _formatAddress(endereco) {
        if (!endereco) return '';
        
        const parts = [];
        
        if (endereco.logradouro) parts.push(endereco.logradouro);
        if (endereco.numero) parts.push(endereco.numero);
        if (endereco.complemento) parts.push(endereco.complemento);
        if (endereco.bairro) parts.push(endereco.bairro);
        if (endereco.cidade) parts.push(endereco.cidade);
        if (endereco.uf) parts.push(endereco.uf);
        if (endereco.cep) parts.push(`CEP: ${endereco.cep}`);
        
        return parts.join(', ');
    }

    /**
     * Formata a descrição do produto com base nos itens do pedido
     * @private
     * @param {Array} itens - Itens do pedido
     * @returns {string} - Descrição formatada
     */
    _formatProductDescription(itens) {
        if (!itens || itens.length === 0) {
            return 'Pedido sem itens';
        }
        
        return itens.map(item => {
            // Inclui a quantidade e o nome do item
            const quantity = item.quantidade > 1 ? `${item.quantidade}x ` : '';
            let description = `${quantity}${item.nome}`;
            
            // Adiciona complementos se existirem
            if (item.complementos && item.complementos.length > 0) {
                const complementosStr = item.complementos
                    .map(c => c.nome)
                    .join(', ');
                description += ` (${complementosStr})`;
            }
            
            return description;
        }).join('; ');
    }

    /**
     * Determina o tamanho com base nos itens do pedido
     * @private
     * @param {Array} items - Itens do pedido
     * @returns {string} - Tamanho (P, M, G, GG)
     */
    _determineSize(itens) {
        if (!itens || itens.length === 0) {
            return 'M';
        }
        
        const totalItems = itens.reduce((total, item) => total + (item.quantidade || 1), 0);
        
        if (totalItems <= 2) return 'P';
        if (totalItems <= 5) return 'M';
        if (totalItems <= 10) return 'G';
        return 'GG';
    }

    /**
     * Determina a prioridade com base no pedido
     * @private
     * @param {Object} order - Pedido do Alloy
     * @returns {number} - Prioridade (0=Normal, 1=Alta, 2=Urgente)
     */
    _determinePriority(order) {
        // Se for pedido agendado, verificamos a proximidade da data
        if (order.agendamento === 1 && order.data_agendamento) {
            try {
                const now = new Date();
                const agendamentoDate = new Date(order.data_agendamento);
                
                // Calcula diferença em dias
                const diffTime = agendamentoDate.getTime() - now.getTime();
                const diffDays = diffTime / (1000 * 3600 * 24);
                
                // Se for para hoje ou amanhã, é urgente
                if (diffDays <= 1) return 2;
                
                // Se for para depois de amanhã, é alta prioridade
                if (diffDays <= 2) return 1;
            } catch (error) {
                console.error('Erro ao calcular prioridade baseada em agendamento:', error);
            }
        }
        
        // Verifica o status do pedido
        // Status 1 = Pendente (conforme documentação)
        if (order.status === 1) {
            return 1; // Prioridade alta para pedidos pendentes
        }
        
        // Por padrão, prioridade normal
        return 0;
    }

    /**
     * Formata uma string de data/hora para o formato TIME do MySQL
     * @private
     * @param {string} dateTimeString - String de data/hora
     * @returns {string} - Formato HH:MM:SS
     */
    _formatTimeForMySQL(dateTimeString) {
        if (!dateTimeString) return null;
        
        try {
            // Se já estiver no formato HH:MM:SS, retorna diretamente
            if (/^\d{2}:\d{2}:\d{2}$/.test(dateTimeString)) {
                return dateTimeString;
            }
            
            // Se estiver no formato HH:MM, adiciona segundos
            if (/^\d{2}:\d{2}$/.test(dateTimeString)) {
                return `${dateTimeString}:00`;
            }
            
            // Tenta converter de ISO para formato TIME do MySQL
            const date = new Date(dateTimeString);
            if (isNaN(date)) return null;
            
            return date.toTimeString().split(' ')[0];
        } catch (error) {
            console.error('Erro ao formatar data:', error);
            return null;
        }
    }
}

module.exports = new AlloyService();
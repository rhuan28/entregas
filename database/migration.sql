-- migration.sql - Schema PostgreSQL atualizado para o sistema de entregas

-- Criar extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tabela de entregas com novos campos
CREATE TABLE IF NOT EXISTS deliveries (
    id SERIAL PRIMARY KEY,
    order_date DATE NOT NULL,
    order_number VARCHAR(50), -- Novo campo para número do pedido
    customer_name VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(20),
    address VARCHAR(500) NOT NULL,
    lat DECIMAL(10, 8),
    lng DECIMAL(11, 8),
    product_description TEXT,
    product_type VARCHAR(50), -- Novo campo para tipo de produto
    product_name VARCHAR(100), -- Novo campo para nome do produto
    size VARCHAR(2) DEFAULT 'M' CHECK (size IN ('P', 'M', 'G', 'GG')),
    priority INTEGER DEFAULT 0,
    delivery_window_start TIME,
    delivery_window_end TIME,
    status VARCHAR(20)  DEFAULT 'pending' CHECK (status IN ('pending', 'optimized', 'ordem_manual', 'in_transit', 'delivered', 'cancelled')),
    manual_order INTEGER DEFAULT NULL,
    external_order_id VARCHAR(50) NULL,
    external_order_data JSONB NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Adicionar novos campos à tabela existente se não existirem
DO $$ 
BEGIN
    -- Adiciona order_number se não existir
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliveries' AND column_name='order_number') THEN
        ALTER TABLE deliveries ADD COLUMN order_number VARCHAR(50);
    END IF;
    
    -- Adiciona product_type se não existir
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliveries' AND column_name='product_type') THEN
        ALTER TABLE deliveries ADD COLUMN product_type VARCHAR(50);
    END IF;
    
    -- Adiciona product_name se não existir
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliveries' AND column_name='product_name') THEN
        ALTER TABLE deliveries ADD COLUMN product_name VARCHAR(100);
    END IF;
END $$;

-- Criar índices para deliveries
CREATE INDEX IF NOT EXISTS idx_deliveries_order_date ON deliveries(order_date);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries(status);
CREATE INDEX IF NOT EXISTS idx_deliveries_external_order_id ON deliveries(external_order_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_order_number ON deliveries(order_number);
CREATE INDEX IF NOT EXISTS idx_deliveries_product_type ON deliveries(product_type);
CREATE INDEX IF NOT EXISTS idx_deliveries_priority ON deliveries(priority);

-- Função para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para deliveries
DROP TRIGGER IF EXISTS update_deliveries_updated_at ON deliveries;
CREATE TRIGGER update_deliveries_updated_at BEFORE UPDATE ON deliveries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Tabela de rotas otimizadas (com colunas de arquivamento)
CREATE TABLE IF NOT EXISTS routes (
    id SERIAL PRIMARY KEY,
    route_date DATE NOT NULL,
    total_distance INTEGER,
    total_duration INTEGER,
    optimized_order JSONB,
    status VARCHAR(20) DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
    archived BOOLEAN DEFAULT FALSE,
    archived_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Criar índices para routes
CREATE INDEX IF NOT EXISTS idx_routes_route_date ON routes(route_date);
CREATE INDEX IF NOT EXISTS idx_routes_status ON routes(status);
CREATE INDEX IF NOT EXISTS idx_routes_archived ON routes(archived);
CREATE INDEX IF NOT EXISTS idx_routes_archived_at ON routes(archived_at);

-- Trigger para routes
DROP TRIGGER IF EXISTS update_routes_updated_at ON routes;
CREATE TRIGGER update_routes_updated_at BEFORE UPDATE ON routes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Tabela de rastreamento
CREATE TABLE IF NOT EXISTS tracking (
    id SERIAL PRIMARY KEY,
    route_id INTEGER,
    delivery_id INTEGER,
    lat DECIMAL(10, 8) NOT NULL,
    lng DECIMAL(11, 8) NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE,
    FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE
);

-- Criar índice para tracking
CREATE INDEX IF NOT EXISTS idx_tracking_timestamp ON tracking(timestamp);
CREATE INDEX IF NOT EXISTS idx_tracking_delivery_id ON tracking(delivery_id);
CREATE INDEX IF NOT EXISTS idx_tracking_route_id ON tracking(route_id);

-- Tabela de notificações
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    delivery_id INTEGER,
    type VARCHAR(20) NOT NULL CHECK (type IN ('route_started', 'approaching', 'delivered')),
    message TEXT,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE
);

-- Criar índice para notifications
CREATE INDEX IF NOT EXISTS idx_notifications_delivery_id ON notifications(delivery_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

-- Tabela de configurações
CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trigger para settings
DROP TRIGGER IF EXISTS update_settings_updated_at ON settings;
CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Inserir configurações padrão
INSERT INTO settings (setting_key, setting_value) VALUES 
    ('circular_route', 'true'),
    ('origin_address', 'R. Barata Ribeiro, 466 - Vila Itapura, Campinas - SP, 13023-030'),
    ('stop_time', '8'),
    ('daily_rate', '100.00'),
    ('km_rate', '2.50')
ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value;

-- Tabela de paradas (pickup stops)
CREATE TABLE IF NOT EXISTS pickup_stops (
    id SERIAL PRIMARY KEY,
    route_id INTEGER,
    order_position INTEGER,
    lat DECIMAL(10, 8),
    lng DECIMAL(11, 8),
    description VARCHAR(255) DEFAULT 'Parada na Confeitaria',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE
);

-- Criar índices para pickup_stops
CREATE INDEX IF NOT EXISTS idx_pickup_stops_route_id ON pickup_stops(route_id);

-- Tabela de produtos e suas configurações (nova tabela auxiliar)
CREATE TABLE IF NOT EXISTS product_types (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    default_priority INTEGER DEFAULT 0,
    default_size VARCHAR(2) DEFAULT 'M' CHECK (default_size IN ('P', 'M', 'G', 'GG')),
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trigger para product_types
DROP TRIGGER IF EXISTS update_product_types_updated_at ON product_types;
CREATE TRIGGER update_product_types_updated_at BEFORE UPDATE ON product_types
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Inserir tipos de produtos padrão
INSERT INTO product_types (code, name, default_priority, default_size) VALUES 
    ('bentocake', 'Bentocake', 0, 'P'),
    ('6fatias', '6 fatias', 0, 'P'),
    ('10fatias', '10 fatias', 1, 'M'),
    ('18fatias', '18 fatias', 1, 'M'),
    ('24fatias', '24 fatias', 1, 'G'),
    ('30fatias', '30 fatias', 1, 'G'),
    ('40fatias', '40 fatias', 1, 'GG'),
    ('personalizado', 'Personalizado', 0, 'M')
ON CONFLICT (code) DO UPDATE SET 
    name = EXCLUDED.name,
    default_priority = EXCLUDED.default_priority,
    default_size = EXCLUDED.default_size;

-- Função para limpar entregas antigas (equivalente ao procedimento MySQL)
CREATE OR REPLACE FUNCTION cleanup_old_deliveries()
RETURNS void AS $
BEGIN
    DELETE FROM deliveries 
    WHERE order_date < CURRENT_DATE - INTERVAL '30 days'
    AND status IN ('delivered', 'cancelled');
END;
$ LANGUAGE plpgsql;

-- Função para arquivamento automático de rotas antigas
CREATE OR REPLACE FUNCTION auto_archive_old_routes()
RETURNS void AS $
BEGIN
    UPDATE routes 
    SET archived = TRUE, archived_at = CURRENT_TIMESTAMP
    WHERE route_date < CURRENT_DATE - INTERVAL '3 days'
    AND archived = FALSE
    AND status IN ('completed', 'cancelled');
END;
$ LANGUAGE plpgsql;

-- Função para obter configuração de produto
CREATE OR REPLACE FUNCTION get_product_config(product_code VARCHAR(50))
RETURNS TABLE(
    priority INTEGER,
    size VARCHAR(2),
    name VARCHAR(100)
) AS $
BEGIN
    RETURN QUERY
    SELECT pt.default_priority, pt.default_size, pt.name
    FROM product_types pt
    WHERE pt.code = product_code AND pt.active = TRUE;
END;
$ LANGUAGE plpgsql;

-- View para estatísticas de entregas
CREATE OR REPLACE VIEW delivery_stats AS
SELECT 
    d.order_date,
    COUNT(*) as total_deliveries,
    COUNT(CASE WHEN d.status = 'delivered' THEN 1 END) as delivered_count,
    COUNT(CASE WHEN d.status = 'pending' THEN 1 END) as pending_count,
    COUNT(CASE WHEN d.status = 'in_transit' THEN 1 END) as in_transit_count,
    COUNT(CASE WHEN d.priority = 2 THEN 1 END) as urgent_count,
    COUNT(CASE WHEN d.priority = 1 THEN 1 END) as high_priority_count,
    COUNT(CASE WHEN d.priority = 0 THEN 1 END) as normal_priority_count,
    AVG(CASE WHEN d.priority > 0 THEN 1.0 ELSE 0.0 END) as priority_ratio
FROM deliveries d
GROUP BY d.order_date;

-- View para relatório de produtos
CREATE OR REPLACE VIEW product_report AS
SELECT 
    d.product_type,
    d.product_name,
    COUNT(*) as total_orders,
    COUNT(CASE WHEN d.status = 'delivered' THEN 1 END) as delivered_orders,
    AVG(d.priority) as avg_priority,
    DATE_TRUNC('month', d.order_date) as month_year
FROM deliveries d
WHERE d.product_type IS NOT NULL
GROUP BY d.product_type, d.product_name, DATE_TRUNC('month', d.order_date);

-- Comentários nas tabelas e campos para documentação
COMMENT ON TABLE deliveries IS 'Tabela principal de entregas com informações do pedido, cliente e produto';
COMMENT ON COLUMN deliveries.order_number IS 'Número do pedido para controle interno';
COMMENT ON COLUMN deliveries.product_type IS 'Código do tipo de produto (bentocake, 6fatias, etc.)';
COMMENT ON COLUMN deliveries.product_name IS 'Nome amigável do produto para exibição';
COMMENT ON COLUMN deliveries.priority IS '0=Normal, 1=Alta, 2=Urgente';
COMMENT ON COLUMN deliveries.size IS 'Tamanho do produto: P=Pequeno, M=Médio, G=Grande, GG=Extra Grande';

COMMENT ON TABLE product_types IS 'Configurações dos tipos de produtos disponíveis';
COMMENT ON COLUMN product_types.code IS 'Código único do produto usado internamente';
COMMENT ON COLUMN product_types.name IS 'Nome do produto para exibição ao usuário';
COMMENT ON COLUMN product_types.default_priority IS 'Prioridade padrão para este tipo de produto';
COMMENT ON COLUMN product_types.default_size IS 'Tamanho padrão para este tipo de produto';

COMMENT ON TABLE routes IS 'Rotas otimizadas com informações de distância e duração';
COMMENT ON COLUMN routes.optimized_order IS 'Ordem otimizada das paradas em formato JSON';
COMMENT ON COLUMN routes.archived IS 'Indica se a rota foi arquivada';

-- Índices adicionais para performance
CREATE INDEX IF NOT EXISTS idx_deliveries_status_date ON deliveries(status, order_date);
CREATE INDEX IF NOT EXISTS idx_deliveries_priority_date ON deliveries(priority DESC, order_date);
CREATE INDEX IF NOT EXISTS idx_routes_date_status ON routes(route_date, status);

-- Constraint para garantir que order_number seja único por data (se fornecido)
CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_unique_order_number_date 
ON deliveries(order_number, order_date) 
WHERE order_number IS NOT NULL;

-- Função para validar dados de entrega
CREATE OR REPLACE FUNCTION validate_delivery_data()
RETURNS TRIGGER AS $
BEGIN
    -- Valida que lat/lng estão preenchidos se address existe
    IF NEW.address IS NOT NULL AND (NEW.lat IS NULL OR NEW.lng IS NULL) THEN
        RAISE EXCEPTION 'Latitude e longitude são obrigatórias quando endereço é fornecido';
    END IF;
    
    -- Valida que prioridade está no range correto
    IF NEW.priority < 0 OR NEW.priority > 2 THEN
        RAISE EXCEPTION 'Prioridade deve estar entre 0 e 2';
    END IF;
    
    -- Se product_type for fornecido, atualiza automaticamente priority e size se não definidos
    IF NEW.product_type IS NOT NULL THEN
        DECLARE
            config_record RECORD;
        BEGIN
            SELECT * INTO config_record FROM get_product_config(NEW.product_type);
            
            IF FOUND THEN
                -- Atualiza product_name se não foi fornecido
                IF NEW.product_name IS NULL THEN
                    NEW.product_name := config_record.name;
                END IF;
                
                -- Atualiza size se não foi fornecido ou é o padrão
                IF NEW.size IS NULL OR NEW.size = 'M' THEN
                    NEW.size := config_record.size;
                END IF;
                
                -- Atualiza priority se não foi alterado do padrão
                IF TG_OP = 'INSERT' AND NEW.priority = 0 THEN
                    NEW.priority := config_record.priority;
                END IF;
            END IF;
        END;
    END IF;
    
    RETURN NEW;
END;
$ LANGUAGE plpgsql;

-- Trigger para validação de dados
DROP TRIGGER IF EXISTS validate_delivery_trigger ON deliveries;
CREATE TRIGGER validate_delivery_trigger
    BEFORE INSERT OR UPDATE ON deliveries
    FOR EACH ROW EXECUTE FUNCTION validate_delivery_data();

-- Função para gerar relatório de performance de entregas
CREATE OR REPLACE FUNCTION delivery_performance_report(
    start_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
    end_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE(
    date_period DATE,
    total_deliveries BIGINT,
    delivered_count BIGINT,
    delivery_rate NUMERIC,
    avg_priority NUMERIC,
    urgent_deliveries BIGINT,
    products_breakdown JSONB
) AS $
BEGIN
    RETURN QUERY
    SELECT 
        d.order_date as date_period,
        COUNT(*) as total_deliveries,
        COUNT(CASE WHEN d.status = 'delivered' THEN 1 END) as delivered_count,
        ROUND(
            COUNT(CASE WHEN d.status = 'delivered' THEN 1 END)::NUMERIC / 
            NULLIF(COUNT(*), 0) * 100, 2
        ) as delivery_rate,
        ROUND(AVG(d.priority), 2) as avg_priority,
        COUNT(CASE WHEN d.priority = 2 THEN 1 END) as urgent_deliveries,
        jsonb_object_agg(
            COALESCE(d.product_name, 'Sem produto'), 
            COUNT(*)
        ) as products_breakdown
    FROM deliveries d
    WHERE d.order_date BETWEEN start_date AND end_date
    GROUP BY d.order_date
    ORDER BY d.order_date DESC;
END;
$ LANGUAGE plpgsql;

-- Grants de permissão (ajustar conforme necessário)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO delivery_app_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO delivery_app_user;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO delivery_app_user;

-- Log da migração
DO $
BEGIN
    RAISE NOTICE 'Migração concluída com sucesso!';
    RAISE NOTICE 'Novos campos adicionados: order_number, product_type, product_name';
    RAISE NOTICE 'Nova tabela: product_types';
    RAISE NOTICE 'Novas funções: get_product_config, validate_delivery_data, delivery_performance_report';
    RAISE NOTICE 'Novas views: delivery_stats, product_report';
END $;
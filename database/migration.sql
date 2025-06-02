-- migration.sql - Schema PostgreSQL para o sistema de entregas

-- Criar extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tabela de entregas
CREATE TABLE IF NOT EXISTS deliveries (
    id SERIAL PRIMARY KEY,
    order_date DATE NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(20),
    address VARCHAR(500) NOT NULL,
    lat DECIMAL(10, 8),
    lng DECIMAL(11, 8),
    product_description TEXT,
    size VARCHAR(2) DEFAULT 'M' CHECK (size IN ('P', 'M', 'G', 'GG')),
    priority INTEGER DEFAULT 0,
    delivery_window_start TIME,
    delivery_window_end TIME,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'optimized', 'in_transit', 'delivered', 'cancelled')),
    manual_order INTEGER DEFAULT NULL,
    external_order_id VARCHAR(50) NULL,
    external_order_data JSONB NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Criar índices para deliveries
CREATE INDEX IF NOT EXISTS idx_deliveries_order_date ON deliveries(order_date);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries(status);
CREATE INDEX IF NOT EXISTS idx_deliveries_external_order_id ON deliveries(external_order_id);

-- Função para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para deliveries
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

-- Tabela de notificações
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    delivery_id INTEGER,
    type VARCHAR(20) NOT NULL CHECK (type IN ('route_started', 'approaching', 'delivered')),
    message TEXT,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE
);

-- Tabela de configurações
CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trigger para settings
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

-- Função para limpar entregas antigas (equivalente ao procedimento MySQL)
CREATE OR REPLACE FUNCTION cleanup_old_deliveries()
RETURNS void AS $$
BEGIN
    DELETE FROM deliveries 
    WHERE order_date < CURRENT_DATE - INTERVAL '30 days'
    AND status IN ('delivered', 'cancelled');
END;
$$ LANGUAGE plpgsql;

-- Função para arquivamento automático de rotas antigas
CREATE OR REPLACE FUNCTION auto_archive_old_routes()
RETURNS void AS $$
BEGIN
    UPDATE routes 
    SET archived = TRUE, archived_at = CURRENT_TIMESTAMP
    WHERE route_date < CURRENT_DATE - INTERVAL '3 days'
    AND archived = FALSE
    AND status IN ('completed', 'cancelled');
END;
$$ LANGUAGE plpgsql;
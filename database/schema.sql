-- database/schema.sql - Versão atualizada com colunas de arquivamento
CREATE DATABASE IF NOT EXISTS confeitaria_entregas;
USE confeitaria_entregas;

-- Tabela de entregas
CREATE TABLE IF NOT EXISTS deliveries (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_date DATE NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(20),
    address VARCHAR(500) NOT NULL,
    lat DECIMAL(10, 8),
    lng DECIMAL(11, 8),
    product_description TEXT,
    size ENUM('P', 'M', 'G', 'GG') DEFAULT 'M',
    priority INT DEFAULT 0,
    delivery_window_start TIME,
    delivery_window_end TIME,
    status ENUM('pending', 'optimized', 'in_transit', 'delivered', 'cancelled') DEFAULT 'pending',
    manual_order INT DEFAULT NULL,
    external_order_id VARCHAR(50) NULL,
    external_order_data JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_order_date (order_date),
    INDEX idx_status (status),
    INDEX idx_external_order_id (external_order_id)
);

-- Tabela de rotas otimizadas (com colunas de arquivamento)
CREATE TABLE IF NOT EXISTS routes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    route_date DATE NOT NULL,
    total_distance INT,
    total_duration INT,
    optimized_order JSON,
    status ENUM('planned', 'active', 'completed', 'cancelled') DEFAULT 'planned',
    archived BOOLEAN DEFAULT FALSE,
    archived_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_route_date (route_date),
    INDEX idx_status (status),
    INDEX idx_archived (archived),
    INDEX idx_archived_at (archived_at)
);

-- Adiciona colunas de arquivamento se não existirem (para bancos existentes)
ALTER TABLE routes 
ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL DEFAULT NULL;

-- Adiciona índices se não existirem
ALTER TABLE routes 
ADD INDEX IF NOT EXISTS idx_archived (archived),
ADD INDEX IF NOT EXISTS idx_archived_at (archived_at);

-- Tabela de rastreamento
CREATE TABLE IF NOT EXISTS tracking (
    id INT PRIMARY KEY AUTO_INCREMENT,
    route_id INT,
    delivery_id INT,
    lat DECIMAL(10, 8) NOT NULL,
    lng DECIMAL(11, 8) NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE,
    FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
    INDEX idx_timestamp (timestamp)
);

-- Tabela de notificações
CREATE TABLE IF NOT EXISTS notifications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    delivery_id INT,
    type ENUM('route_started', 'approaching', 'delivered') NOT NULL,
    message TEXT,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE
);

-- Tabela de configurações
CREATE TABLE IF NOT EXISTS settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Insere configurações padrão
INSERT INTO settings (setting_key, setting_value) VALUES 
    ('circular_route', 'true'),
    ('origin_address', 'R. Barata Ribeiro, 466 - Vila Itapura, Campinas - SP, 13023-030'),
    ('stop_time', '8'),
    ('daily_rate', '100.00'),
    ('km_rate', '2.50')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);

-- Tabela de paradas (pickup stops)
CREATE TABLE IF NOT EXISTS pickup_stops (
    id INT PRIMARY KEY AUTO_INCREMENT,
    route_id INT,
    order_position INT,
    lat DECIMAL(10, 8),
    lng DECIMAL(11, 8),
    description VARCHAR(255) DEFAULT 'Parada na Confeitaria',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE
);

-- Procedimento para limpar entregas antigas
DELIMITER //
CREATE PROCEDURE IF NOT EXISTS cleanup_old_deliveries()
BEGIN
    DELETE FROM deliveries 
    WHERE order_date < DATE_SUB(CURDATE(), INTERVAL 30 DAY)
    AND status IN ('delivered', 'cancelled');
END//
DELIMITER ;

-- Procedimento para arquivamento automático de rotas antigas
DELIMITER //
CREATE PROCEDURE IF NOT EXISTS auto_archive_old_routes()
BEGIN
    UPDATE routes 
    SET archived = TRUE, archived_at = NOW()
    WHERE route_date < DATE_SUB(CURDATE(), INTERVAL 3 DAY)
    AND archived = FALSE
    AND status IN ('completed', 'cancelled');
END//
DELIMITER ;
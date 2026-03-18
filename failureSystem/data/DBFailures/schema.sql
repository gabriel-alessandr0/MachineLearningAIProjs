-- ============================================================
-- SISTEMA DE PREDIÇÃO DE FALHAS INDUSTRIAIS
-- Schema PostgreSQL
-- ============================================================

-- Extensão para UUID (opcional, mas útil)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABELA: failures_list
-- Catálogo mestre de tipos de falha
-- ============================================================
CREATE TABLE failures_list (
    id                        VARCHAR(10)  PRIMARY KEY,         -- Ex: F001
    name                      VARCHAR(150) NOT NULL,
    category                  VARCHAR(50)  NOT NULL,
    severity                  VARCHAR(20)  NOT NULL,
    symptoms                  TEXT[]       NOT NULL,            -- Array de sintomas
    probable_causes           TEXT[]       NOT NULL,
    immediate_action          TEXT,
    corrective_action         TEXT,
    preventive_action         TEXT,
    estimated_downtime_hours  NUMERIC(6,2),
    requires_specialist       BOOLEAN      DEFAULT FALSE,
    avg_recurrence_days       INTEGER,
    documentation_ref         VARCHAR(50),
    created_at                TIMESTAMPTZ  DEFAULT NOW()
);

-- ============================================================
-- TABELA: failures_list_related
-- Relação N:N entre falhas relacionadas
-- ============================================================
CREATE TABLE failures_list_related (
    failure_id         VARCHAR(10) REFERENCES failures_list(id) ON DELETE CASCADE,
    related_failure_id VARCHAR(10) REFERENCES failures_list(id) ON DELETE CASCADE,
    PRIMARY KEY (failure_id, related_failure_id)
);

-- ============================================================
-- TABELA: lines
-- Linhas de produção
-- ============================================================
CREATE TABLE lines (
    id               VARCHAR(10)  PRIMARY KEY,                  -- Ex: L01
    name             VARCHAR(100) NOT NULL,
    description      TEXT,
    status           VARCHAR(30)  NOT NULL DEFAULT 'Operacional',
    mtbf_days        NUMERIC(6,2),                              -- Média entre falhas em dias
    last_failure_date DATE,
    created_at       TIMESTAMPTZ  DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  DEFAULT NOW()
);

-- ============================================================
-- TABELA: machines
-- Máquinas por linha
-- ============================================================
CREATE TABLE machines (
    id                VARCHAR(15)  PRIMARY KEY,                 -- Ex: L01-M01
    line_id           VARCHAR(10)  NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
    name              VARCHAR(150) NOT NULL,
    model             VARCHAR(100),
    manufacturer      VARCHAR(100),
    installation_year SMALLINT,
    status            VARCHAR(30)  NOT NULL DEFAULT 'Operacional',
    mtbf_days         NUMERIC(6,2),
    last_maintenance  DATE,
    created_at        TIMESTAMPTZ  DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  DEFAULT NOW()
);

-- ============================================================
-- TABELA: failure_records
-- Histórico de ocorrências de falha por máquina
-- ============================================================
CREATE TABLE failure_records (
    id                  VARCHAR(10)  PRIMARY KEY,               -- Ex: R001
    machine_id          VARCHAR(15)  NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    failure_id          VARCHAR(10)  NOT NULL REFERENCES failures_list(id),
    symptom_reported    TEXT         NOT NULL,
    occurred_at         DATE         NOT NULL,
    downtime_hours      NUMERIC(6,2),
    resolved_by         VARCHAR(100),
    resolution_applied  TEXT,
    cost_brl            NUMERIC(10,2) DEFAULT 0,
    created_at          TIMESTAMPTZ  DEFAULT NOW()
);

-- ============================================================
-- TABELA: failure_records_parts
-- Peças trocadas por ocorrência (1:N)
-- ============================================================
CREATE TABLE failure_records_parts (
    id          SERIAL       PRIMARY KEY,
    record_id   VARCHAR(10)  NOT NULL REFERENCES failure_records(id) ON DELETE CASCADE,
    part_name   VARCHAR(200) NOT NULL
);

-- ============================================================
-- ÍNDICES para performance nas queries do Grafana
-- ============================================================
CREATE INDEX idx_machines_line_id          ON machines(line_id);
CREATE INDEX idx_failure_records_machine   ON failure_records(machine_id);
CREATE INDEX idx_failure_records_failure   ON failure_records(failure_id);
CREATE INDEX idx_failure_records_date      ON failure_records(occurred_at);
CREATE INDEX idx_failure_records_cost      ON failure_records(cost_brl);
CREATE INDEX idx_failures_list_category   ON failures_list(category);
CREATE INDEX idx_failures_list_severity   ON failures_list(severity);

-- ============================================================
-- VIEWS prontas para o Grafana
-- ============================================================

-- View: Custo e downtime acumulado por linha
CREATE VIEW vw_cost_by_line AS
SELECT
    l.id                                    AS line_id,
    l.name                                  AS line_name,
    COUNT(fr.id)                            AS total_failures,
    ROUND(SUM(fr.downtime_hours), 2)        AS total_downtime_hours,
    ROUND(SUM(fr.cost_brl), 2)              AS total_cost_brl,
    ROUND(AVG(fr.cost_brl), 2)              AS avg_cost_per_failure,
    l.mtbf_days
FROM lines l
LEFT JOIN machines m  ON m.line_id = l.id
LEFT JOIN failure_records fr ON fr.machine_id = m.id
GROUP BY l.id, l.name, l.mtbf_days;

-- View: Custo e downtime por máquina
CREATE VIEW vw_cost_by_machine AS
SELECT
    m.id                                    AS machine_id,
    m.name                                  AS machine_name,
    l.name                                  AS line_name,
    m.status,
    COUNT(fr.id)                            AS total_failures,
    ROUND(SUM(fr.downtime_hours), 2)        AS total_downtime_hours,
    ROUND(SUM(fr.cost_brl), 2)              AS total_cost_brl,
    m.mtbf_days,
    m.last_maintenance
FROM machines m
JOIN lines l ON l.id = m.line_id
LEFT JOIN failure_records fr ON fr.machine_id = m.id
GROUP BY m.id, m.name, l.name, m.status, m.mtbf_days, m.last_maintenance;

-- View: Falhas por categoria ao longo do tempo (série temporal para Grafana)
CREATE VIEW vw_failures_timeline AS
SELECT
    fr.occurred_at                          AS date,
    l.name                                  AS line_name,
    m.name                                  AS machine_name,
    fl.category,
    fl.severity,
    fl.name                                 AS failure_type,
    fr.symptom_reported,
    fr.downtime_hours,
    fr.cost_brl,
    fr.resolved_by
FROM failure_records fr
JOIN machines m        ON m.id  = fr.machine_id
JOIN lines l           ON l.id  = m.line_id
JOIN failures_list fl  ON fl.id = fr.failure_id
ORDER BY fr.occurred_at DESC;

-- View: Ranking de tipos de falha mais recorrentes
CREATE VIEW vw_failure_type_ranking AS
SELECT
    fl.id                                   AS failure_id,
    fl.name                                 AS failure_name,
    fl.category,
    fl.severity,
    COUNT(fr.id)                            AS occurrences,
    ROUND(SUM(fr.downtime_hours), 2)        AS total_downtime_hours,
    ROUND(SUM(fr.cost_brl), 2)              AS total_cost_brl,
    ROUND(AVG(fr.downtime_hours), 2)        AS avg_downtime_hours,
    fl.avg_recurrence_days
FROM failures_list fl
LEFT JOIN failure_records fr ON fr.failure_id = fl.id
GROUP BY fl.id, fl.name, fl.category, fl.severity, fl.avg_recurrence_days
ORDER BY occurrences DESC;

-- View: Última falha por máquina (útil para painel de status)
CREATE VIEW vw_last_failure_per_machine AS
SELECT DISTINCT ON (m.id)
    m.id                                    AS machine_id,
    m.name                                  AS machine_name,
    l.name                                  AS line_name,
    m.status,
    fr.occurred_at                          AS last_failure_date,
    fl.name                                 AS last_failure_type,
    fl.severity                             AS last_failure_severity,
    fr.downtime_hours,
    fr.cost_brl,
    NOW()::DATE - fr.occurred_at            AS days_since_last_failure
FROM machines m
JOIN lines l ON l.id = m.line_id
LEFT JOIN failure_records fr ON fr.machine_id = m.id
LEFT JOIN failures_list fl   ON fl.id = fr.failure_id
ORDER BY m.id, fr.occurred_at DESC;
// ============================================================
// migrate.js
// Migração dos JSONs para PostgreSQL
//
// Dependências:
//   npm install pg
//
// Uso:
//   node migrate.js
// ============================================================

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// ------------------------------------------------------------
// Configuração da conexão — ajuste conforme seu ambiente
// ------------------------------------------------------------
const pool = new Pool({
  host:     process.env.PG_HOST     || 'localhost',
  port:     process.env.PG_PORT     || 5432,
  database: process.env.PG_DB       || 'industrial_failures',
  user:     process.env.PG_USER     || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
});

// ------------------------------------------------------------
// Caminhos dos arquivos JSON
// ------------------------------------------------------------
const FAILURES_LIST_PATH = path.join(__dirname, 'FailuresList.json');
const FAILURES_PATH      = path.join(__dirname, 'failures.json');

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function log(msg)  { console.log(`[✔] ${msg}`); }
function warn(msg) { console.warn(`[!] ${msg}`); }

async function run() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // --------------------------------------------------------
    // Leitura dos arquivos
    // --------------------------------------------------------
    const failuresList = JSON.parse(fs.readFileSync(FAILURES_LIST_PATH, 'utf8'));
    const failuresData = JSON.parse(fs.readFileSync(FAILURES_PATH, 'utf8'));

    // --------------------------------------------------------
    // 1. Inserir failures_list
    // --------------------------------------------------------
    log('Inserindo failures_list...');
    for (const f of failuresList) {
      await client.query(`
        INSERT INTO failures_list (
          id, name, category, severity,
          symptoms, probable_causes,
          immediate_action, corrective_action, preventive_action,
          estimated_downtime_hours, requires_specialist,
          avg_recurrence_days, documentation_ref
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (id) DO UPDATE SET
          name                     = EXCLUDED.name,
          category                 = EXCLUDED.category,
          severity                 = EXCLUDED.severity,
          symptoms                 = EXCLUDED.symptoms,
          probable_causes          = EXCLUDED.probable_causes,
          immediate_action         = EXCLUDED.immediate_action,
          corrective_action        = EXCLUDED.corrective_action,
          preventive_action        = EXCLUDED.preventive_action,
          estimated_downtime_hours = EXCLUDED.estimated_downtime_hours,
          requires_specialist      = EXCLUDED.requires_specialist,
          avg_recurrence_days      = EXCLUDED.avg_recurrence_days,
          documentation_ref        = EXCLUDED.documentation_ref
      `, [
        f.id,
        f.name,
        f.category,
        f.severity,
        f.symptoms,
        f.probable_causes,
        f.resolution?.immediate_action  || null,
        f.resolution?.corrective_action || null,
        f.resolution?.preventive_action || null,
        f.resolution?.estimated_downtime_hours || null,
        f.resolution?.requires_specialist || false,
        f.avg_recurrence_days || null,
        f.documentation_ref   || null,
      ]);
    }
    log(`${failuresList.length} tipos de falha inseridos.`);

    // --------------------------------------------------------
    // 2. Inserir failures_list_related
    // --------------------------------------------------------
    log('Inserindo relações entre falhas...');
    let relCount = 0;
    for (const f of failuresList) {
      for (const relId of (f.related_failures || [])) {
        await client.query(`
          INSERT INTO failures_list_related (failure_id, related_failure_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `, [f.id, relId]);
        relCount++;
      }
    }
    log(`${relCount} relações entre falhas inseridas.`);

    // --------------------------------------------------------
    // 3. Inserir lines
    // --------------------------------------------------------
    log('Inserindo linhas de produção...');
    for (const line of failuresData.lines) {
      await client.query(`
        INSERT INTO lines (id, name, description, status, mtbf_days, last_failure_date)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (id) DO UPDATE SET
          name              = EXCLUDED.name,
          description       = EXCLUDED.description,
          status            = EXCLUDED.status,
          mtbf_days         = EXCLUDED.mtbf_days,
          last_failure_date = EXCLUDED.last_failure_date,
          updated_at        = NOW()
      `, [
        line.line_id,
        line.line_name,
        line.description   || null,
        line.status        || 'Operacional',
        line.mtbf_days     || null,
        line.last_failure_date || null,
      ]);
    }
    log(`${failuresData.lines.length} linhas inseridas.`);

    // --------------------------------------------------------
    // 4. Inserir machines
    // --------------------------------------------------------
    log('Inserindo máquinas...');
    let machineCount = 0;
    for (const line of failuresData.lines) {
      for (const machine of line.machines) {
        await client.query(`
          INSERT INTO machines (
            id, line_id, name, model, manufacturer,
            installation_year, status, mtbf_days, last_maintenance
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT (id) DO UPDATE SET
            name              = EXCLUDED.name,
            model             = EXCLUDED.model,
            manufacturer      = EXCLUDED.manufacturer,
            installation_year = EXCLUDED.installation_year,
            status            = EXCLUDED.status,
            mtbf_days         = EXCLUDED.mtbf_days,
            last_maintenance  = EXCLUDED.last_maintenance,
            updated_at        = NOW()
        `, [
          machine.machine_id,
          line.line_id,
          machine.machine_name,
          machine.model            || null,
          machine.manufacturer     || null,
          machine.installation_year|| null,
          machine.status           || 'Operacional',
          machine.mtbf_days        || null,
          machine.last_maintenance || null,
        ]);
        machineCount++;
      }
    }
    log(`${machineCount} máquinas inseridas.`);

    // --------------------------------------------------------
    // 5. Inserir failure_records e parts
    // --------------------------------------------------------
    log('Inserindo registros de falha...');
    let recordCount = 0;
    let partCount   = 0;

    for (const line of failuresData.lines) {
      for (const machine of line.machines) {
        for (const record of machine.failure_history) {

          // Verifica se failure_id existe no catálogo
          const exists = await client.query(
            'SELECT id FROM failures_list WHERE id = $1',
            [record.failure_id]
          );
          if (exists.rowCount === 0) {
            warn(`failure_id ${record.failure_id} não encontrado no catálogo — registro ${record.record_id} ignorado.`);
            continue;
          }

          await client.query(`
            INSERT INTO failure_records (
              id, machine_id, failure_id,
              symptom_reported, occurred_at,
              downtime_hours, resolved_by,
              resolution_applied, cost_brl
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT (id) DO UPDATE SET
              symptom_reported   = EXCLUDED.symptom_reported,
              occurred_at        = EXCLUDED.occurred_at,
              downtime_hours     = EXCLUDED.downtime_hours,
              resolved_by        = EXCLUDED.resolved_by,
              resolution_applied = EXCLUDED.resolution_applied,
              cost_brl           = EXCLUDED.cost_brl
          `, [
            record.record_id,
            machine.machine_id,
            record.failure_id,
            record.symptom_reported   || '',
            record.date,
            record.downtime_hours     || 0,
            record.resolved_by        || null,
            record.resolution_applied || null,
            record.cost_brl           || 0,
          ]);
          recordCount++;

          // Peças trocadas — deleta e reinsere para evitar duplicatas
          await client.query(
            'DELETE FROM failure_records_parts WHERE record_id = $1',
            [record.record_id]
          );
          for (const part of (record.parts_replaced || [])) {
            await client.query(
              'INSERT INTO failure_records_parts (record_id, part_name) VALUES ($1, $2)',
              [record.record_id, part]
            );
            partCount++;
          }
        }
      }
    }

    log(`${recordCount} registros de falha inseridos.`);
    log(`${partCount} peças inseridas.`);

    await client.query('COMMIT');
    console.log('\n✅ Migração concluída com sucesso!\n');

    // --------------------------------------------------------
    // Resumo final
    // --------------------------------------------------------
    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM failures_list)         AS failure_types,
        (SELECT COUNT(*) FROM failures_list_related) AS relations,
        (SELECT COUNT(*) FROM lines)                 AS lines,
        (SELECT COUNT(*) FROM machines)              AS machines,
        (SELECT COUNT(*) FROM failure_records)       AS records,
        (SELECT COUNT(*) FROM failure_records_parts) AS parts
    `);
    const r = counts.rows[0];
    console.log('📊 Resumo do banco:');
    console.log(`   Tipos de falha:       ${r.failure_types}`);
    console.log(`   Relações entre falhas:${r.relations}`);
    console.log(`   Linhas:               ${r.lines}`);
    console.log(`   Máquinas:             ${r.machines}`);
    console.log(`   Registros de falha:   ${r.records}`);
    console.log(`   Peças registradas:    ${r.parts}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Erro durante migração — ROLLBACK executado.');
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();

import fs from 'fs/promises';
import * as tf from '@tensorflow/tfjs';
import { ChromaService } from './src/service/ChromaService.js'; 

const chroma = new ChromaService();

/**
 * Monta o "universo" dos dados — todos os índices que a rede neural precisa.
 * Pensa nessa função como um dicionário que traduz IDs para posições numéricas.
 * Ex: { "L01": 0, "L02": 1, ... } → a rede entende 0 e 1, não "L01" e "L02"
 */
function makeContext(symptoms, plant, keywords) {

    // Extrai todos os IDs de linha únicos da planta
    const lines = [...new Set(plant.lines.map(l => l.line_id))];
    
    // Achata todas as máquinas de todas as linhas num array plano
    const machines = plant.lines.flatMap(line => line.machines);
    
    // Extrai todos os IDs de sintoma do catálogo de sintomas
    const reason = [...new Set(symptoms.map(s => s.id))];

    // Cria um dicionário: ID → posição numérica
    // Ex: { "L01": 0, "L02": 1, "L03": 2, ... }
    const linesIndex = Object.fromEntries(lines.map((l, i) => [l, i]));
    
    // Ex: { "L01-M01": 0, "L01-M02": 1, ... }
    const machineIndex = Object.fromEntries(machines.map((m, i) => [m.machine_id, i]));
    
    // Ex: { "S001": 0, "S002": 1, ... }
    const reasonIndex = Object.fromEntries(reason.map((r, i) => [r, i]));
    
    // Retorna tudo que o encodeRecord vai precisar para montar os vetores
    return {
        lines, machines, reason,
        linesIndex, machineIndex, reasonIndex,
        numLines: lines.length,       // tamanho do one-hot de linhas
        numMachines: machines.length, // tamanho do one-hot de máquinas
        numReason: reason.length,     // tamanho do one-hot de sintomas
        // tamanho total do vetor = soma dos três one-hots
        dimentions: lines.length + machines.length + reason.length,
        keywords // palavras-chave para mapear texto → sintoma
    };
}

/**
 * Transforma um registro histórico em um vetor numérico (one-hot encoding).
 * Ex: linha L01 + máquina L01-M02 + sintoma S003
 *   → [1,0,0,0,0,0] + [0,1,0,...] + [0,0,1,0,...]
 *   → [1,0,0,0,0,0,0,1,0,...,0,0,1,0,...]  (vetor concatenado)
 */
function encodeRecord(record, context) {
    // Busca a posição numérica de cada campo no índice
    const lineIdx    = context.linesIndex[record.line_id];
    const machineIdx = context.machineIndex[record.machine_id];
    
    // Converte o texto livre para um ID de sintoma padronizado
    // Ex: "Vibração no tambor de retorno" → "S002"
    const sintomaId  = symptomMaped(record.symptom_reported, context.keywords);
    const reasonIdx  = context.reasonIndex[sintomaId];

    // Cria o one-hot para cada dimensão
    // tf.oneHot(2, 6) → [0, 0, 1, 0, 0, 0]  (posição 2 ativa num vetor de tamanho 6)
    const line    = tf.oneHot(lineIdx, context.numLines).cast('float32');
    const machine = tf.oneHot(machineIdx, context.numMachines).cast('float32');
    const reason  = tf.oneHot(reasonIdx, context.numReason).cast('float32');

    // Concatena os três vetores em um só
    return tf.concat1d([line, machine, reason]);
}

/**
 * Mapeia um texto livre para um ID de sintoma padronizado.
 * Percorre o dicionário de keywords e verifica se alguma palavra-chave
 * está contida no texto reportado pelo operador.
 * Ex: "Ruído metálico no tambor" → encontra "ruído" → retorna "S003"
 */
function symptomMaped(text, keywords) {
    // Normaliza para minúsculo para evitar erros de capitalização
    const t = text.toLowerCase();
    
    // Para cada sintoma e suas palavras-chave...
    for (const [id, words] of Object.entries(keywords)) {
        // ...verifica se pelo menos uma palavra está no texto
        if (words.some(p => t.includes(p))) return id;
    }
    
    return null; // sintoma não identificado
}

/**
 * Função principal — orquestra todo o processo de população do banco.
 * 1. Lê os arquivos de dados
 * 2. Monta o contexto (índices)
 * 3. Extrai todos os registros históricos
 * 4. Vetoriza cada registro
 * 5. Envia para o ChromaDB
 */
async function run() {
    console.log('Lendo arquivos locais...');
    
    // Lê a estrutura hierárquica da planta (linhas → máquinas → histórico)
    const plantData = await fs.readFile('./data/DBFailures/failures.json', 'utf-8');
    const plant = JSON.parse(plantData);

    // Lê o catálogo de sintomas padronizados (S001..S020)
    const symptomsData = await fs.readFile('./data/DBFailures/symptoms.json', 'utf-8');
    const symptoms = JSON.parse(symptomsData);

    // Lê o dicionário de palavras-chave para mapeamento de texto → sintoma
    const keywordsData = await fs.readFile('./data/DBFailures/symptomKeywords.json', 'utf-8');
    const keywords = JSON.parse(keywordsData);

    console.log(`Lidos ${plant.lines.length} linhas, ${symptoms.length} sintomas.`);
    console.log('Gerando contexto e vetores...');

    // Monta todos os índices necessários para o encoding
    const context = makeContext(symptoms, plant, keywords);
    
    // Extrai todos os registros históricos num array plano
    // plant → lines → machines → failure_history → record
    const records = plant.lines.flatMap(line =>
        line.machines.flatMap(machine =>
            machine.failure_history.map(record => ({
                ...record,           // copia todos os campos do registro
                line_id: line.line_id,       // adiciona o ID da linha
                machine_id: machine.machine_id // adiciona o ID da máquina
            }))
        )
    );

    // Transforma cada registro em um objeto com vetor + metadados
    const recordVectors = records.map(record => ({
        id: record.record_id,  // identificador único do registro
        meta: {
            failure_id: record.failure_id,
            failure_name: record.failure_name,
            symptom_reported: record.symptom_reported,
            resolution_applied: record.resolution_applied
        },
        vector: encodeRecord(record, context).dataSync() // converte tensor → array
    }));

    console.log('Enviando para o ChromaDB...');
    await chroma.upsertVectors(recordVectors);
    
    console.log('✅ Tudo pronto! Vetores salvos no ChromaDB com sucesso.');
    process.exit(0);
}

run().catch(console.error);
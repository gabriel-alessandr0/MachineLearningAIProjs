import 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
import { workerEvents } from '../events/constants.js';
import { ChromaService } from '../service/ChromaService.js';

let _globalCtx = null;
let _model = null; 

const db = new ChromaService();

function makeContext(symptoms, plant, keywords, failures) {

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

    const failuresIndex = Object.fromEntries(failures.map((f, i) => [f.id, i]));
    
    // Retorna tudo que o encodeRecord vai precisar para montar os vetores
    return {
        lines, machines, reason, failures,
        linesIndex, machineIndex, reasonIndex, failuresIndex,
        numLines: lines.length,       // tamanho do one-hot de linhas
        numMachines: machines.length, // tamanho do one-hot de máquinas
        numReason: reason.length,     // tamanho do one-hot de sintomas
        // tamanho total do vetor = soma dos três one-hots
        dimentions: lines.length + machines.length + reason.length,
        keywords // palavras-chave para mapear texto → sintoma
    };
}

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


// ====================================================================
// 🧠 MÁGICA ACADÊMICA: Treinamento usando Vetores do Banco!
// ====================================================================
function createTrainingData(context) {
    const inputs = [];
    const labels = [];

    Object.values(context.savedVectors).forEach(record => {
        // 1. pega o input (já pronto no ChromaDB)
        inputs.push(record.values);

        // 2. descobre a posição da falha no índice
        const failureIdx = context.failuresIndex[record.metadata.failureId];
        
        // 3. cria o array de 45 zeros
        const label = Array(45).fill(0);
        
        // 4. coloca o 1 na posição correta
        label[failureIdx] = 1;
        
        labels.push(label);
    });

    return {
        xs: tf.tensor2d(inputs),
        ys: tf.tensor2d(labels),
        inputDimention: context.dimentions
    };
}

async function configureNeuralNetAndTrain(trainData) {
    const model = tf.sequential();
    
    model.add(tf.layers.dense({ inputShape: [trainData.inputDimention], units: 32, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 45, activation: 'softmax' }));

    model.compile({ optimizer: tf.train.adam(0.01), loss: 'categoricalCrossentropy', metrics: ['accuracy'] });

    await model.fit(trainData.xs, trainData.ys, {
        epochs: 100, 
        batchSize: 32,
        shuffle: true,
        callbacks: {
            onEpochEnd: (epoch, logs) => {
                postMessage({ type: workerEvents.trainingLog, epoch: epoch, loss: logs.loss, accuracy: logs.acc });
            }
        }
    });

    return model;
}

// ====================================================================
// 🧠 FLUXO DE VIDA DO WORKER
// ====================================================================
async function trainModel({ plant }) {
    console.log('1. Gerando contexto base...');
    postMessage({ type: workerEvents.progressUpdate, progress: { progress: 10 } });
    
    const failures = await (await fetch('/data/DBFailures/FailuresList.json')).json();
    const symptoms = await (await fetch('/data/DBFailures/symptoms.json')).json();
    const keywords = await (await fetch('/data/DBFailures/symptomKeywords.json')).json();

    const context = makeContext(symptoms, plant, keywords, failures);

    console.log('2. Baixando todos os seus vetores brutos do ChromaDB...');
    const dbData = await db.fetchAllVectors();
    context.savedVectors = dbData.vectors;
    _globalCtx = context;

    console.log('3. Montando matrizes e Treinando a Rede Neural Local...');
    const trainData = createTrainingData(context);
    _model = await configureNeuralNetAndTrain(trainData);

    console.log('✅ IA Treinada! Pronta para recomendar.');
    postMessage({ type: workerEvents.progressUpdate, progress: { progress: 100 } });
    postMessage({ type: workerEvents.trainingComplete });
}

async function recommend({ parameters }) {
    if (!_model) return;
    const context = _globalCtx;

    // 1. monta o vetor da seleção do operador
    const inputVector = encodeRecord(parameters, context).dataSync();

    // 2. passa para o modelo — retorna 45 probabilidades
    const inputTensor = tf.tensor2d([inputVector]);
    const scores = _model.predict(inputTensor).dataSync();

    // 3. mapeia cada score para o nome da falha correspondente
    const recommendations = context.failures.map((failure, index) => ({
        failureId: failure.id,
        failureName: failure.name,
        score: scores[index]
    }));

    // 4. ordena e pega as top 3
    const top3 = recommendations
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

    postMessage({ type: workerEvents.recommend, parameters, recommendations: top3 });
}

const handlers = {
    [workerEvents.trainModel]: trainModel,
    [workerEvents.recommend]: recommend,
};

self.onmessage = e => {
    const { action, ...data } = e.data;
    if (handlers[action]) handlers[action](data);
};
export const events = {
    // Treino
    modelTrain: 'training:train',
    trainingComplete: 'training:complete',
    modelProgressUpdate: 'model:progress-update',

    // Recomendação
    recommend: 'recommend',
    recommendationsReady: 'recommendations:ready',

    // Seleção do operador (linha + máquina + sintoma)
    selectionChanged: 'selection:changed',
}

export const workerEvents = {
    trainingComplete: 'training:complete',
    trainModel: 'train:model',
    recommend: 'recommend',
    trainingLog: 'training:log',
    progressUpdate: 'progress:update',
    tfVisData: 'tfvis:data',
    tfVisLogs: 'tfvis:logs',
}
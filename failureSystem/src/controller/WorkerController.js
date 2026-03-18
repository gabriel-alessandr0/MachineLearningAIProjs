import { workerEvents } from '../events/constants.js';
import Events from '../events/events.js';

export class WorkerController {
    #worker;
    #events;

    constructor({ worker, events }) {
        this.#worker = worker;
        this.#events = events;
        this.#setupWorkerListeners();
        this.#setupEventListeners();
    }

    static init(deps) {
        return new WorkerController(deps);
    }

    // Escuta mensagens vindas do worker
    #setupWorkerListeners() {
        this.#worker.onmessage = (e) => {
            const { type, ...data } = e.data;

            const handlers = {
                // Worker terminou o treino
                [workerEvents.trainingComplete]: () => {
                    Events.dispatchTrainingComplete();
                },

                // Worker enviou log de época (para o TFVisor)
                [workerEvents.trainingLog]: () => {
                    Events.dispatchTFVisLogs({
                        epoch: data.epoch,
                        loss: data.loss,
                        accuracy: data.accuracy
                    });
                },

                // Worker enviou atualização de progresso
                [workerEvents.progressUpdate]: () => {
                    Events.dispatchProgressUpdate(data.progress);
                },

                // Worker enviou as recomendações
                [workerEvents.recommend]: () => {
                    Events.dispatchRecommendationsReady(data.recommendations);
                },
            };

            if (handlers[type]) handlers[type]();
        };
    }

    // Escuta eventos da aplicação e envia para o worker
    #setupEventListeners() {
        // Quando o controller pede para treinar → envia a planta para o worker
        Events.onTrainModel((plant) => {
            this.#worker.postMessage({
                action: workerEvents.trainModel,
                plant
            });
        });

        // Quando o controller pede recomendação → envia a seleção do operador
        Events.onRecommend((parameters) => {
            this.#worker.postMessage({
                action: workerEvents.recommend,
                parameters
            });
        });
    }
}

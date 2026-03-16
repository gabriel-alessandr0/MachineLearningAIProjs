import { ModelController } from './controller/ModelTrainingController.js';
import { TFVisorController } from './controller/TFVisorController.js';
import { TFVisorView } from './view/TFVisorView.js';
import { PlantService } from './service/PlantService.js';
import { ModelView } from './view/ModelTrainingView.js';
import Events from './events/events.js';
import { WorkerController } from './controller/WorkerController.js';

// Serviços
const plantService = new PlantService();

// Views
const modelView = new ModelView();
const tfVisorView = new TFVisorView();

// Worker de treinamento
const mlWorker = new Worker('/src/workers/modelTrainingWorker.js', { type: 'module' });

// Controller do worker — gerencia comunicação com o worker
WorkerController.init({
    worker: mlWorker,
    events: Events
});

// Controller do modelo — gerencia treino e recomendação
ModelController.init({
    modelView,
    plantService,
    events: Events,
});

// Controller do TFVisor — exibe gráficos de treinamento
TFVisorController.init({
    tfVisorView,
    events: Events,
});

// Carrega a planta no storage ao iniciar
await plantService.getPlant();

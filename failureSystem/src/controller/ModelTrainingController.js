export class ModelController {
    #modelView;
    #plantService;
    #events;

    // Guarda a seleção atual do operador (line, machine, symptom)
    #currentSelection = null;

    // Controla se o modelo já foi treinado ao menos uma vez
    #alreadyTrained = false;

    constructor({ modelView, plantService, events }) {
        this.#modelView   = modelView;
        this.#plantService = plantService;
        this.#events      = events;
        this.#setup();
    }

    static init(deps) {
        return new ModelController(deps);
    }

    async #setup() {
        await this.#populateSelects();
        this.#setupViewCallbacks();
        this.#setupEventListeners();
    }

    // ═══════════════════════════════════════════════════════════════
    // POPULAÇÃO DOS SELECTS AO INICIAR
    // ═══════════════════════════════════════════════════════════════

    async #populateSelects() {
        const plant = await this.#plantService.getPlant();

        // Renderiza as linhas no select
        this.#modelView.renderLines(plant.lines);

        // Renderiza os sintomas (únicos, de todos os registros históricos)
        const symptoms = this.#extractUniqueSymptoms(plant);
        this.#modelView.renderSymptoms(symptoms);
    }

    // Extrai todos os sintomas únicos do histórico da planta
    #extractUniqueSymptoms(plant) {
        const set = new Set();
        plant.lines.forEach(line => {
            line.machines.forEach(machine => {
                (machine.failure_history ?? []).forEach(record => {
                    if (record.symptom_reported) set.add(record.symptom_reported);
                });
            });
        });
        return [...set].sort();
    }

    // ═══════════════════════════════════════════════════════════════
    // CALLBACKS DA VIEW → ações do operador
    // ═══════════════════════════════════════════════════════════════

    #setupViewCallbacks() {
        // Botão "train model"
        this.#modelView.registerTrainModelCallback(
            this.#handleTrainModel.bind(this)
        );

        // Botão "run prediction"
        this.#modelView.registerRunRecommendationCallback(
            this.#handleRunRecommendation.bind(this)
        );

        // Operador mudou a linha → popula máquinas imediatamente
        this.#modelView.registerLineChangedCallback(
            (lineId) => this.#updateMachineSelect(lineId)
        );

        // Operador completou a seleção (linha + máquina + sintoma)
        this.#modelView.registerSelectionChangedCallback(
            this.#handleSelectionChanged.bind(this)
        );
    }

    // ═══════════════════════════════════════════════════════════════
    // EVENTOS DO SISTEMA → respostas do worker
    // ═══════════════════════════════════════════════════════════════

    #setupEventListeners() {
        // Treino concluído
        this.#events.onTrainingComplete(() => {
            this.#alreadyTrained = true;
            this.#modelView.setStatus('ready');
            this.#modelView.log('model training complete', 'success');
            this.#modelView.updateTrainingProgress({ progress: 100 });

            if (this.#currentSelection) {
                this.#modelView.enableRecommendButton();
            }
        });

        // Atualização de progresso durante o treino
        this.#events.onProgressUpdate((progress) => {
            this.#modelView.updateTrainingProgress(progress);
        });

        // Recomendações prontas vindas do worker
        this.#events.onRecommendationsReady((recommendations) => {
            this.#modelView.setStatus('ready');
            this.#modelView.renderRecommendations(recommendations);
            this.#modelView.log('prediction complete', 'success');
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // HANDLERS
    // ═══════════════════════════════════════════════════════════════

    async #handleTrainModel() {
        const plant = await this.#plantService.getPlant();
        this.#modelView.setStatus('training');
        this.#modelView.log('model training started...', 'warn');
        this.#events.dispatchTrainModel(plant);
    }

    #handleSelectionChanged(selection) {
        this.#currentSelection = selection;

        // Habilita o botão só se o modelo já foi treinado
        if (this.#alreadyTrained && selection.line && selection.machine && selection.symptom) {
            this.#modelView.enableRecommendButton();
        }
    }

    #updateMachineSelect(lineId) {
        this.#plantService.getPlant().then(plant => {
            const line = plant.lines.find(l => l.line_id === lineId);
            if (!line) return;
            this.#modelView.renderMachines(line.machines);
        });
    }

    async #handleRunRecommendation() {
    if (!this.#currentSelection) return;
    this.#modelView.setStatus('predicting');
    this.#modelView.log(`running prediction for: ${this.#currentSelection.symptom}`, 'warn');

    // Remapeia as chaves para o formato que o worker espera
    this.#events.dispatchRecommend({
        line_id:          this.#currentSelection.line,
        machine_id:       this.#currentSelection.machine,
        symptom_reported: this.#currentSelection.symptom
    });
}
}
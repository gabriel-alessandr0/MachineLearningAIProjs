export class ModelView {
    // ── Inputs do operador ────────────────────────────────────────
    #lineSelect         = document.querySelector('#lineSelect');
    #machineSelect      = document.querySelector('#machineSelect');
    #symptomSelect      = document.querySelector('#symptomSelect');

    // ── Botões ────────────────────────────────────────────────────
    #trainModelBtn      = document.querySelector('#trainModelBtn');
    #runRecommendationBtn = document.querySelector('#runRecommendationBtn');

    // ── Progresso do treino ───────────────────────────────────────
    #progressWrap       = document.querySelector('#progressWrap');
    #progressFill       = document.querySelector('#progressFill');
    #progressLabel      = document.querySelector('#progressLabel');

    // ── Painel de resultados ──────────────────────────────────────
    #resultEmpty        = document.querySelector('#resultEmpty');
    #resultCard1        = document.querySelector('#resultCard1');
    #resultCard2        = document.querySelector('#resultCard2');
    #resultCard3        = document.querySelector('#resultCard3');

    // ── Status e log ──────────────────────────────────────────────
    #statusDot          = document.querySelector('#statusDot');
    #statusText         = document.querySelector('#statusText');
    #logBody            = document.querySelector('#logBody');

    // ── Callbacks registrados pelo controller ─────────────────────
    #onTrainModel;
    #onRunRecommendation;
    #onLineChanged;
    #onSelectionChanged;

    constructor() {
        this.#attachEventListeners();
    }

    // ═══════════════════════════════════════════════════════════════
    // REGISTRO DE CALLBACKS
    // ═══════════════════════════════════════════════════════════════

    registerTrainModelCallback(callback) {
        this.#onTrainModel = callback;
    }

    registerRunRecommendationCallback(callback) {
        this.#onRunRecommendation = callback;
    }

    registerSelectionChangedCallback(callback) {
        this.#onSelectionChanged = callback;
    }

    registerLineChangedCallback(callback) {
        this.#onLineChanged = callback;
    }

    // ═══════════════════════════════════════════════════════════════
    // EVENT LISTENERS
    // ═══════════════════════════════════════════════════════════════

    #attachEventListeners() {
        // Botão de treino
        this.#trainModelBtn.addEventListener('click', () => {
            if (this.#onTrainModel) this.#onTrainModel();
        });

        // Botão de predição
        this.#runRecommendationBtn.addEventListener('click', () => {
            if (this.#onRunRecommendation) this.#onRunRecommendation();
        });

        // Seleção de linha → notifica o controller para popular máquinas
        this.#lineSelect.addEventListener('change', () => {
            // Reseta o select de máquinas
            this.#machineSelect.innerHTML = '<option value="">— select line first —</option>';
            this.#machineSelect.disabled = true;

            if (this.#lineSelect.value && this.#onLineChanged) {
                this.#onLineChanged(this.#lineSelect.value);
            }
            this.#notifySelectionChanged();
        });

        // Seleção de máquina → dispara seleção
        this.#machineSelect.addEventListener('change', () => {
            this.#notifySelectionChanged();
        });

        // Seleção de sintoma → dispara seleção
        this.#symptomSelect.addEventListener('change', () => {
            this.#notifySelectionChanged();
        });
    }

    // Notifica o controller sempre que o operador muda qualquer campo
    #notifySelectionChanged() {
        if (!this.#onSelectionChanged) return;

        const line    = this.#lineSelect.value;
        const machine = this.#machineSelect.value;
        const symptom = this.#symptomSelect.value;

        // Só dispara se todos os 3 campos estiverem preenchidos
        if (!line || !machine || !symptom) return;

        this.#onSelectionChanged({ line, machine, symptom });
    }

    // ═══════════════════════════════════════════════════════════════
    // POPULAÇÃO DOS SELECTS
    // ═══════════════════════════════════════════════════════════════

    // Popula o select de linhas
    renderLines(lines) {
        this.#lineSelect.innerHTML = '<option value="">— select line —</option>';
        lines.forEach(line => {
            const opt = document.createElement('option');
            opt.value = line.line_id;
            opt.textContent = line.line_name;
            this.#lineSelect.appendChild(opt);
        });
    }

    renderMachines(machines) {
        this.#machineSelect.innerHTML = '<option value="">— select machine —</option>';
        machines.forEach(machine => {
            const opt = document.createElement('option');
            opt.value = machine.machine_id;
            opt.textContent = machine.machine_name;
            this.#machineSelect.appendChild(opt);
        });
        this.#machineSelect.disabled = false;
    }

    // Popula o select de sintomas
    renderSymptoms(symptoms) {
        this.#symptomSelect.innerHTML = '<option value="">— select symptom —</option>';
        symptoms.forEach(symptom => {
            const opt = document.createElement('option');
            opt.value = symptom;
            opt.textContent = symptom;
            this.#symptomSelect.appendChild(opt);
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // PROGRESSO DO TREINO
    // ═══════════════════════════════════════════════════════════════

    updateTrainingProgress(progress) {
        const pct = Math.round(progress.progress ?? progress);

        // Mostra a barra na primeira atualização
        this.#progressWrap.style.display = 'block';
        this.#progressFill.style.width   = `${pct}%`;
        this.#progressLabel.textContent  = `${pct}%`;

        // Desabilita o botão durante o treino
        this.#trainModelBtn.disabled = true;
        this.#trainModelBtn.textContent = 'training...';

        if (pct >= 100) {
            this.#trainModelBtn.disabled    = false;
            this.#trainModelBtn.textContent = 'train model';

            // Esconde a barra após 1.5s
            setTimeout(() => {
                this.#progressWrap.style.display = 'none';
                this.#progressFill.style.width   = '0%';
                this.#progressLabel.textContent  = '0%';
            }, 1500);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // RESULTADOS DA PREDIÇÃO
    // ═══════════════════════════════════════════════════════════════

    enableRecommendButton() {
        this.#runRecommendationBtn.disabled = false;
    }

    // Renderiza os 3 cards de resultado
    // Espera um array de até 3 objetos: { id, name, score }
    // score deve ser um número entre 0 e 1
    renderRecommendations(recommendations) {
        const cards = [this.#resultCard1, this.#resultCard2, this.#resultCard3];

        // Esconde o estado vazio
        this.#resultEmpty.style.display = 'none';

        cards.forEach((card, i) => {
            const rec = recommendations[i];

            if (!rec) {
                card.style.display = 'none';
                return;
            }

            const scorePct = Math.round((rec.score ?? 0) * 100);

            card.style.display  = 'block';
            card.querySelector('.result-id').textContent   = rec.failureId   ?? '—';
            card.querySelector('.result-name').textContent = rec.failureName ?? '—';
            card.querySelector('.result-score').textContent = `${scorePct}%`;

            // Anima a barra depois de um frame para a transição CSS funcionar
            requestAnimationFrame(() => {
                card.querySelector('.result-bar-fill').style.width = `${scorePct}%`;
            });
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // STATUS E LOG
    // ═══════════════════════════════════════════════════════════════

    setStatus(status) {
        const states = {
            idle:      { label: 'idle',     active: false },
            training:  { label: 'training', active: true  },
            ready:     { label: 'ready',    active: true  },
            predicting:{ label: 'running',  active: true  },
        };

        const s = states[status] ?? states.idle;
        this.#statusText.textContent = s.label;
        this.#statusDot.classList.toggle('active', s.active);
    }

    log(message, type = 'default') {
        const now  = new Date();
        const time = now.toTimeString().slice(0, 8);

        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.innerHTML = `
            <span class="log-time">${time}</span>
            <span class="log-msg ${type}">${message}</span>
        `;

        this.#logBody.appendChild(entry);
        this.#logBody.scrollTop = this.#logBody.scrollHeight;
    }
}
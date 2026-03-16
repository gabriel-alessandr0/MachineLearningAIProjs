export class PlantService {
    #storageKey = 'ew-academy-plant';

    async getPlant() {
        const response = await fetch('./data/DBFailures/failures.json');
        const plant = await response.json();
        this.#setStorage(plant);

        return plant;
    }

    async getLines() {
        const plant = this.#getStorage();
        return plant.lines;
    }

    async getLineById(lineId) {
        const plant = this.#getStorage();
        return plant.lines.find(lines => lines.line_id === lineId);
    }

    async updateplant(line) {
        const plant = this.#getStorage();
        const lineIndex = plant.lines.findIndex(l => l.id === line.line_id);

        plant[lineIndex] = { ...plant[lineIndex], ...line };
        this.#setStorage(plant);

        return plant[lineIndex];
    }

    async addline(line) {
        const plant = this.#getStorage();
        this.#setStorage([line, ...plant]);
    }

    async getMachinesByLine(lineId) {
        const line = await this.getLineById(lineId);
        return line.machines;
    }

    async getFailureHistory(machineId) {
        const plant = this.#getStorage();
        
        for (const line of plant.lines) {
            const machine = line.machines.find(m => m.machine_id === machineId);
            if (machine) return machine.failure_history;
        }
    }  
    #getStorage() {
        const data = sessionStorage.getItem(this.#storageKey);
        return data ? JSON.parse(data) : [];
    }

    #setStorage(data) {
        sessionStorage.setItem(this.#storageKey, JSON.stringify(data));
    }

}

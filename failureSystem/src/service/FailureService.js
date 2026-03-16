export class FailureService {
    async getFailures() {
        const response = await fetch('./data/DBFailures/FailuresList.json');
        return await response.json();
    }

    async getFailureById(id) {
        const Failures = await this.getFailures();
        return Failures.find(Failure => Failure.id === id);
    }

    async getFailuresByIds(ids) {
        const Failures = await this.getFailures();
        return Failures.filter(Failure => ids.includes(Failure.id));
    }

    async getSymptoms() {
        const response = await fetch('./data/DBFailures/symptoms.json');
        return await response.json();
    }

    async getSymptomById(id) {
        const Symptoms = await this.getSymptoms();
        return Symptoms.find(Symptom => Symptom.id === id);
    }

    async getSymptomsByIds(ids) {
        const Symptoms = await this.getSymptoms();
        return Symptoms.filter(Symptom => ids.includes(Symptom.id));
    }
}

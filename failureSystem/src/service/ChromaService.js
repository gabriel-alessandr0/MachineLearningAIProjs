export class ChromaService {
    #host;
    #collectionName = 'failures'; // nome da coleção no ChromaDB

    constructor() {
        // Detecta se está rodando no Node.js (terminal) ou no navegador
        const isNode = typeof importScripts === 'undefined' && typeof window === 'undefined';
        
        // No terminal (dbPopulate) acessa o ChromaDB diretamente na porta 8000
        // No navegador acessa via proxy na porta 8001 (evita erro de CORS)
        const baseUrl = isNode ? 'http://localhost:8000' : 'http://127.0.0.1:8001';
        
        // Caminho completo da API v2 do ChromaDB
        this.#host = `${baseUrl}/api/v2/tenants/default_tenant/databases/default_database`;
    }

    /**
     * Wrapper seguro para fetch — trata erros e converte resposta para JSON.
     * Centraliza o tratamento de erro para não repetir em cada método.
     */
    async #safeFetch(url, options = {}) {
        const res = await fetch(url, options);
        const txt = await res.text();
        
        if (!res.ok) {
            console.error(`❌ Erro no Chroma (${res.status}):`, txt);
            throw new Error(txt || `Status ${res.status}`);
        }
        
        // Verifica se tem conteúdo antes de parsear
        // Evita o erro "Unexpected end of JSON input"
        return txt ? JSON.parse(txt) : {};
    }

    /**
     * Busca o ID interno da coleção no ChromaDB.
     * Se a coleção não existir ainda, cria automaticamente.
     * O ChromaDB usa IDs internos (UUID) para identificar coleções.
     */
    async #getCollectionId() {
        const collections = await this.#safeFetch(`${this.#host}/collections`);
        const list = Array.isArray(collections) ? collections : (collections.collections || []);
        let myColl = list.find(c => c.name === this.#collectionName);

        if (!myColl) {
            console.log("Criando coleção 'failures'...");
            myColl = await this.#safeFetch(`${this.#host}/collections`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: this.#collectionName })
            });
        }
        return myColl.id;
    }

    /**
     * Usado pelo dbPopulate no terminal (Porta 8000).
     * Recebe os registros já vetorizados e envia para o ChromaDB.
     * "Upsert" = insert + update — se o ID já existir, atualiza; senão, insere.
     */
    async upsertVectors(recordVectors) {
        const id = await this.#getCollectionId();
        const body = {
            // IDs únicos de cada registro (record_id do failure_history)
            ids: recordVectors.map(p => String(p.id)),
            // Vetores one-hot de [linha + máquina + sintoma]
            embeddings: recordVectors.map(p => Array.from(p.vector)),
            // Metadados que o operador vai ver na recomendação
            metadatas: recordVectors.map(p => ({
                failureId: p.meta.failure_id,       // ex: "F007"
                failureName: p.meta.failure_name,   // ex: "Quebra de Correia"
                symptom: p.meta.symptom_reported,   // texto original do operador
                resolution: p.meta.resolution_applied // o que foi feito para resolver
            }))
        };
        console.log(`📤 Enviando ${body.ids.length} registros...`);
        return await this.#safeFetch(`${this.#host}/collections/${id}/upsert`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    }

    /**
     * Usado pelo navegador (Porta 8001 via proxy).
     * Baixa todos os vetores do banco para o worker usar no treinamento.
     * Retorna um objeto indexado por ID para acesso rápido.
     */
    async fetchAllVectors() {
        const id = await this.#getCollectionId();
        const data = await this.#safeFetch(`${this.#host}/collections/${id}/get`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ include: ["embeddings", "metadatas"] })
        });

        // Transforma o array de resultados em um objeto indexado por ID
        // Ex: { "R001": { id, values, metadata }, "R002": { ... } }
        const allVectors = {};
        if (data && data.ids) {
            data.ids.forEach((id, index) => {
                allVectors[id] = {
                    id: id,
                    values: data.embeddings[index],   // vetor one-hot
                    metadata: data.metadatas[index]   // failure_id, name, etc.
                };
            });
        }
        return { vectors: allVectors };
    }

    /**
     * Usado pelo worker para buscar os registros mais similares à entrada do operador.
     * Recebe o vetor one-hot da seleção atual e retorna os topK mais próximos.
     * A distância é convertida em score de similaridade (quanto maior, mais similar).
     */
    async query(userVector, topK = 20) {
        const id = await this.#getCollectionId();
        const results = await this.#safeFetch(`${this.#host}/collections/${id}/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query_embeddings: [Array.from(userVector)],
                n_results: topK,
                include: ["metadatas", "distances"]
            })
        });

        const ids = results.ids?.[0] || [];
        return {
            matches: ids.map((id, index) => ({
                id: id,
                metadata: results.metadatas[0][index],
                // Converte distância em similaridade: distância 0 = score 1 (perfeito)
                score: 1 / (1 + results.distances[0][index])
            }))
        };
    }
}
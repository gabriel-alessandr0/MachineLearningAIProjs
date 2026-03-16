import { ChromaClient } from 'chromadb';

async function verificarBanco() {
    // Conecta ao Chroma local
    const client = new ChromaClient({ path: 'http://localhost:8000' });
    
    try {
        // Pega a nossa coleção de chroma-data
        const collection = await client.getCollection({ name: 'failures' });
        
        // Conta quantos falhas existem lá dentro
        const total = await collection.count();
        console.log(`✅ Sucesso! O banco tem ${total} falahas salvos.`);

        // "Espia" os 2 primeiros falhas do banco para vermos como ficaram
        console.log('\nEspiando os 15 primeiros chroma-data:');
        const amostra = await collection.peek({ limit: 15 });
        console.log(amostra.metadatas); // Mostra meta dados..

    } catch (erro) {
        console.log('❌ Ops! A coleção "chroma-data" não foi encontrada. O dbPopulate rodou mesmo?');
        console.error(erro);
    }
}

verificarBanco();
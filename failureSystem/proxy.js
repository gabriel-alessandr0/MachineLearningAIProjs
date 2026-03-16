import http from 'http';
import httpProxy from 'http-proxy';

const proxy = httpProxy.createProxyServer({});

// Adiciona os cabeçalhos de CORS NA MARRA
proxy.on('proxyRes', function (proxyRes, req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
});

const server = http.createServer(function(req, res) {
    if (req.method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        });
        res.end();
        return;
    }

    proxy.web(req, res, { target: 'http://localhost:8000' }, function(e) {
        console.error("❌ Erro no Proxy: O ChromaDB (porta 8000) está ligado?");
        res.writeHead(500);
        res.end("Erro de conexão com o ChromaDB.");
    });
});

console.log("🚀 Proxy DESBLOQUEADOR rodando em http://localhost:8001");
server.listen(8001);
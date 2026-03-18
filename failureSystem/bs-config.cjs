module.exports = {
    server: true,
    port: 3001,
    watch: true,
    files: ["index.html", "data/**/*.json", "src/**/*.js"],
    middleware: [
        function (req, res, next) {
            // Permite acesso de qualquer origem (necessário para o Grafana)
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            // Permite ser carregado em iframes (necessário para o Grafana)
            res.setHeader('X-Frame-Options', 'ALLOWALL');
            res.setHeader('Content-Security-Policy', "frame-ancestors *");

            next();
        }
    ]
};

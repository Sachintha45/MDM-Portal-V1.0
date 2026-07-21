// MDM Portal — CAP Server Bootstrap
const cds = require('@sap/cds');

async function start() {
    console.log('[cds] booting...');
    await cds.load('./srv/csn.json');
    console.log('[cds] model loaded');
    await cds.serve('all');
    console.log('[cds] all services registered');
    // Start HTTP server explicitly — keeps the process alive
    const port = process.env.PORT || 8080;
    await new Promise((resolve, reject) => {
        cds.server.listen(port, (err) => {
            if (err) return reject(err);
            const url = `http://localhost:${port}`;
            console.log(`[cds] server listening on { url: '${url}' }`);
            resolve();
        });
    });
}

start().catch(err => {
    console.error('[cds] startup error:', err.message || err);
    process.exit(1);
});

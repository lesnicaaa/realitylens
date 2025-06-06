// Simple HTTP server for hosting AR application

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Command line arguments parsing
const args = process.argv.slice(2);
const useHttps = args.includes('--https') || args.includes('-s');
const useHttp = args.includes('--http') || args.includes('-h') || !useHttps; // Default HTTP
const httpPort = process.env.PORT || 3000; // Use PORT environment variable for Vercel
const httpsPort = process.env.HTTPS_PORT || 3001;

// Production check for Vercel
const isProduction = process.env.NODE_ENV === 'production';
const isVercel = process.env.VERCEL === '1';

// SSL certificate configuration
const sslOptions = {
    key: fs.existsSync('ssl/key.pem') ? fs.readFileSync('ssl/key.pem') : null,
    cert: fs.existsSync('ssl/cert.pem') ? fs.readFileSync('ssl/cert.pem') : null
};

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

// Generic request handler function
function handleRequest(req, res) {
    console.log(`Request: ${req.url}`);
    
    // Handle homepage request
    let filePath = req.url === '/' 
        ? path.join(__dirname, 'index.html')
        : path.join(__dirname, req.url);
    
    const extname = path.extname(filePath);
    let contentType = MIME_TYPES[extname] || 'application/octet-stream';
    
    // Read file
    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                // File not found
                fs.readFile(path.join(__dirname, '404.html'), (err, content) => {
                    res.writeHead(404, { 'Content-Type': 'text/html' });
                    res.end(content || '404 Not Found', 'utf-8');
                });
            } else {
                // Server error
                res.writeHead(500);
                res.end(`Server Error: ${err.code}`);
            }
        } else {
            // Successful response
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
}

// For Vercel deployment, export the request handler
module.exports = (req, res) => {
    handleRequest(req, res);
};

// Only start the local server if not in Vercel environment
if (!isVercel) {
    // Display IP address function
    function getLocalIPs() {
        const { networkInterfaces } = require('os');
        const nets = networkInterfaces();
        const results = [];

        for (const name of Object.keys(nets)) {
            for (const net of nets[name]) {
                // Skip internal and non-IPv4 addresses
                if (net.family === 'IPv4' && !net.internal) {
                    results.push(net.address);
                }
            }
        }
        return results;
    }

    // Start HTTP server if HTTP mode is enabled
    if (useHttp) {
        const httpServer = http.createServer(handleRequest);
        httpServer.listen(httpPort, () => {
            console.log(`HTTP server running at http://localhost:${httpPort}`);
            
            const ips = getLocalIPs();
            if (ips.length > 0) {
                ips.forEach(ip => {
                    console.log(`Mobile devices on the same network can access: http://${ip}:${httpPort}`);
                });
            } else {
                console.log(`Mobile devices on the same network can access: http://<your computer IP address>:${httpPort}`);
            }
        });
        console.log('Note: Some browsers may restrict camera and sensor access in HTTP mode');
    }
    
    // Start HTTPS server if HTTPS mode is enabled
    if (useHttps) {
        // Check if SSL certificates exist
        if (!sslOptions.key || !sslOptions.cert) {
            console.error('Error: SSL certificate files not found. Please ensure key.pem and cert.pem exist in the ssl directory.');
            console.log('Tip: You can generate a self-signed certificate with the following commands:');
            console.log('  mkdir -p ssl');
            console.log('  openssl req -nodes -new -x509 -keyout ssl/key.pem -out ssl/cert.pem');
            
            if (!useHttp) {
                process.exit(1); // Exit if using only HTTPS and certificates don't exist
            }
        } else {
            const httpsServer = https.createServer(sslOptions, handleRequest);
            httpsServer.listen(httpsPort, () => {
                console.log(`HTTPS server running at https://localhost:${httpsPort}`);
                
                const ips = getLocalIPs();
                if (ips.length > 0) {
                    ips.forEach(ip => {
                        console.log(`Mobile devices on the same network can access: https://${ip}:${httpsPort}`);
                    });
                } else {
                    console.log(`Mobile devices on the same network can access: https://<your computer IP address>:${httpsPort}`);
                }
                console.log('Note: When using a self-signed certificate, browsers will display a security warning, requiring manual selection of "Continue"');
            });
        }
    }
    
    // Display usage help
    console.log('\nUsage:');
    console.log('  npm start         - Start HTTP server (default)');
    console.log('  npm start -- --https   - Start HTTPS server');
    console.log('  npm start -- --http --https - Start both HTTP and HTTPS servers');
    console.log('\nTip: Run "ipconfig" (Windows) or "ifconfig" (Mac/Linux) in the terminal to see your IP address');
} 
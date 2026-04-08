// server.js
const WebSocket = require('ws');
const { WebcastPushConnection } = require('tiktok-live-connector');

const wss = new WebSocket.Server({ port: 8080 });
console.log('WebSocket server running on ws://localhost:8080');

wss.on('connection', (ws) => {
    console.log('Game connected');
    let tiktokConnection = null;
    
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        if (data.action === 'connect') {
            const username = data.username;
            console.log('Connecting to TikTok:', username);
            
            tiktokConnection = new WebcastPushConnection(username);
            
            tiktokConnection.on('chat', (data) => {
                ws.send(JSON.stringify({
                    type: 'chat',
                    user: data.nickname,
                    msg: data.comment
                }));
            });
            
            tiktokConnection.on('gift', (data) => {
                ws.send(JSON.stringify({
                    type: 'gift',
                    user: data.nickname,
                    gift: data.giftName,
                    count: data.repeatCount
                }));
            });
            
            tiktokConnection.on('like', (data) => {
                ws.send(JSON.stringify({
                    type: 'like',
                    count: data.count
                }));
            });
            
            tiktokConnection.on('member', (data) => {
                ws.send(JSON.stringify({
                    type: 'join',
                    user: data.nickname
                }));
            });
            
            tiktokConnection.connect().then(() => {
                console.log('Connected to TikTok Live!');
                ws.send(JSON.stringify({ type: 'status', message: 'connected' }));
            }).catch(err => {
                console.error('Failed:', err);
                ws.send(JSON.stringify({ type: 'error', message: err.message }));
            });
        }
    });
    
    ws.on('close', () => {
        if (tiktokConnection) tiktokConnection.disconnect();
    });
});

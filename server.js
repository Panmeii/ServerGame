require('dotenv').config();

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const logger = require('./utils/logger');
const tiktokHandler = require('./handlers/tiktokHandler');

// Configuration
const PORT = process.env.PORT || 3001;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['http://localhost:3000', 'http://localhost:5173'];

// Express App
const app = express();
const httpServer = createServer(app);

// CORS Middleware
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked for origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
}));

app.use(express.json());

// Health Check Endpoint
app.get('/health', (req, res) => {
  const stats = tiktokHandler.getStats();
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    connections: stats.activeConnections,
    version: '1.0.0'
  });
});

// Stats Endpoint
app.get('/stats', (req, res) => {
  res.json(tiktokHandler.getStats());
});

// Root Endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'TikTok Live Game Server',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      stats: '/stats',
      websocket: 'Socket.IO'
    },
    documentation: 'https://github.com/yourusername/tiktok-live-server'
  });
});

// Socket.IO Setup
const io = new Server(httpServer, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 45000,
  maxHttpBufferSize: 1e6
});

// Rate limiting (simple in-memory)
const connectionCounts = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_CONNECTIONS_PER_IP = parseInt(process.env.MAX_CONNECTIONS_PER_IP) || 10;

function checkRateLimit(ip) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  
  if (!connectionCounts.has(ip)) {
    connectionCounts.set(ip, []);
  }
  
  const attempts = connectionCounts.get(ip).filter(time => time > windowStart);
  connectionCounts.set(ip, [...attempts, now]);
  
  return attempts.length <= MAX_CONNECTIONS_PER_IP;
}

// Socket Connection Handler
io.on('connection', (socket) => {
  const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
  
  logger.info(`New client connected`, {
    socketId: socket.id,
    ip: clientIp,
    origin: socket.handshake.headers.origin
  });

  // Rate limiting check
  if (!checkRateLimit(clientIp)) {
    logger.warn(`Rate limit exceeded for IP: ${clientIp}`);
    socket.emit('error', {
      message: 'Too many connection attempts. Please try again later.',
      code: 'RATE_LIMITED'
    });
    socket.disconnect();
    return;
  }

  // Handle TikTok Live connection request
  socket.on('connect-to-live', async (data) => {
    try {
      const { username } = data;
      
      if (!username || typeof username !== 'string') {
        socket.emit('error', {
          message: 'Username is required',
          code: 'INVALID_USERNAME'
        });
        return;
      }

      // Validate username format
      const cleanUsername = username.replace('@', '').trim().toLowerCase();
      if (!/^[a-z0-9_.]{2,24}$/.test(cleanUsername)) {
        socket.emit('error', {
          message: 'Invalid username format',
          code: 'INVALID_USERNAME'
        });
        return;
      }

      await tiktokHandler.connect(socket, cleanUsername);
      
    } catch (error) {
      logger.error(`Error handling connect-to-live`, {
        socketId: socket.id,
        error: error.message
      });
      
      socket.emit('error', {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', async (reason) => {
    logger.info(`Client disconnected`, {
      socketId: socket.id,
      reason
    });
    
    await tiktokHandler.disconnect(socket);
  });

  // Handle explicit disconnect request
  socket.on('disconnect-live', async () => {
    await tiktokHandler.disconnect(socket);
    socket.emit('disconnected', { reason: 'User requested' });
  });

  // Ping/Pong for connection health
  socket.on('ping', () => {
    socket.emit('pong', { timestamp: Date.now() });
  });
});

// Error handling
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
  // Keep running but log the error
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
});

// Graceful shutdown
async function gracefulShutdown(signal) {
  logger.info(`${signal} received. Starting graceful shutdown...`);
  
  io.close(() => {
    logger.info('Socket.IO server closed');
  });
  
  await tiktokHandler.disconnectAll();
  
  httpServer.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  
  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
httpServer.listen(PORT, () => {
  logger.info(`🚀 TikTok Live Server running on port ${PORT}`);
  logger.info(`📊 Health check: http://localhost:${PORT}/health`);
  logger.info(`🔗 Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});

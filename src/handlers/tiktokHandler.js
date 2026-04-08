const { WebcastPushConnection } = require('tiktok-live-connector');
const logger = require('../utils/logger');

class TikTokHandler {
  constructor() {
    this.connections = new Map(); // socket.id -> { connection, username, roomId }
  }

  async connect(socket, username) {
    try {
      logger.info(`Attempting to connect to TikTok Live: @${username}`, {
        socketId: socket.id
      });

      // Disconnect existing connection for this socket
      await this.disconnect(socket);

      const connection = new WebcastPushConnection(username, {
        processInitialData: true,
        enableExtendedGiftInfo: true,
        enableWebsocketUpgrade: true,
        requestPollingIntervalMs: 1000,
        clientParams: {
          app_language: 'en-US',
          device_platform: 'web'
        }
      });

      // Setup event handlers
      this.setupEventHandlers(connection, socket, username);

      // Connect to TikTok
      const state = await connection.connect();
      
      this.connections.set(socket.id, {
        connection,
        username,
        roomId: state.roomId,
        connectedAt: new Date()
      });

      logger.info(`Successfully connected to @${username}`, {
        socketId: socket.id,
        roomId: state.roomId,
        viewerCount: state.viewerCount
      });

      socket.emit('connected', {
        roomId: state.roomId,
        viewerCount: state.viewerCount,
        timestamp: new Date().toISOString()
      });

      return true;

    } catch (error) {
      logger.error(`Failed to connect to @${username}`, {
        socketId: socket.id,
        error: error.message,
        stack: error.stack
      });

      socket.emit('error', {
        message: error.message,
        code: error.code || 'CONNECTION_FAILED',
        timestamp: new Date().toISOString()
      });

      return false;
    }
  }

  setupEventHandlers(connection, socket, username) {
    // Chat messages
    connection.on('chat', (data) => {
      socket.emit('live-event', {
        type: 'chat',
        user: data.nickname,
        userId: data.userId,
        msg: data.comment,
        profilePicture: data.profilePictureUrl,
        timestamp: Date.now(),
        uniqueId: `${socket.id}-${Date.now()}-${Math.random()}`
      });
    });

    // Gifts
    connection.on('gift', (data) => {
      socket.emit('live-event', {
        type: 'gift',
        user: data.nickname,
        userId: data.userId,
        gift: data.giftName,
        giftId: data.giftId,
        count: data.repeatCount,
        diamondValue: data.diamondCount,
        timestamp: Date.now(),
        uniqueId: `${socket.id}-${Date.now()}-${Math.random()}`
      });
    });

    // Likes
    connection.on('like', (data) => {
      socket.emit('live-event', {
        type: 'like',
        user: data.nickname,
        userId: data.userId,
        count: data.count,
        totalLikes: data.totalLikeCount,
        timestamp: Date.now(),
        uniqueId: `${socket.id}-${Date.now()}-${Math.random()}`
      });
    });

    // Member join
    connection.on('member', (data) => {
      socket.emit('live-event', {
        type: 'join',
        user: data.nickname,
        userId: data.userId,
        profilePicture: data.profilePictureUrl,
        timestamp: Date.now(),
        uniqueId: `${socket.id}-${Date.now()}-${Math.random()}`
      });
    });

    // Share
    connection.on('social', (data) => {
      socket.emit('live-event', {
        type: 'share',
        user: data.nickname,
        platform: data.platform,
        timestamp: Date.now(),
        uniqueId: `${socket.id}-${Date.now()}-${Math.random()}`
      });
    });

    // Follow
    connection.on('follow', (data) => {
      socket.emit('live-event', {
        type: 'follow',
        user: data.nickname,
        userId: data.userId,
        timestamp: Date.now(),
        uniqueId: `${socket.id}-${Date.now()}-${Math.random()}`
      });
    });

    // Question (Q&A)
    connection.on('questionNew', (data) => {
      socket.emit('live-event', {
        type: 'question',
        user: data.nickname,
        question: data.question,
        timestamp: Date.now(),
        uniqueId: `${socket.id}-${Date.now()}-${Math.random()}`
      });
    });

    // Link share
    connection.on('linkMicBattle', (data) => {
      socket.emit('live-event', {
        type: 'battle',
        data: data,
        timestamp: Date.now(),
        uniqueId: `${socket.id}-${Date.now()}-${Math.random()}`
      });
    });

    // Error handling
    connection.on('error', (err) => {
      logger.error(`TikTok connection error for @${username}`, {
        socketId: socket.id,
        error: err.message
      });
      
      socket.emit('error', {
        message: 'Connection error: ' + err.message,
        code: 'STREAM_ERROR',
        timestamp: new Date().toISOString()
      });
    });

    // Disconnection
    connection.on('disconnected', () => {
      logger.info(`TikTok stream disconnected for @${username}`, {
        socketId: socket.id
      });
      
      socket.emit('disconnected', {
        reason: 'Stream ended or connection lost',
        timestamp: new Date().toISOString()
      });
      
      this.connections.delete(socket.id);
    });
  }

  async disconnect(socket) {
    const connData = this.connections.get(socket.id);
    
    if (connData && connData.connection) {
      try {
        await connData.connection.disconnect();
        logger.info(`Disconnected from @${connData.username}`, {
          socketId: socket.id,
          duration: Date.now() - connData.connectedAt.getTime()
        });
      } catch (error) {
        logger.error(`Error disconnecting`, {
          socketId: socket.id,
          error: error.message
        });
      }
      
      this.connections.delete(socket.id);
    }
  }

  getStats() {
    return {
      activeConnections: this.connections.size,
      connections: Array.from(this.connections.entries()).map(([id, data]) => ({
        socketId: id,
        username: data.username,
        roomId: data.roomId,
        connectedAt: data.connectedAt,
        duration: Date.now() - data.connectedAt.getTime()
      }))
    };
  }

  async disconnectAll() {
    logger.info('Disconnecting all TikTok connections...');
    
    for (const [socketId, data] of this.connections) {
      try {
        await data.connection.disconnect();
      } catch (error) {
        logger.error(`Error disconnecting ${socketId}`, { error: error.message });
      }
    }
    
    this.connections.clear();
  }
}

module.exports = new TikTokHandler();

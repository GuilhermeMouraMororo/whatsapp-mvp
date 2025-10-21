const { Client, RemoteAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

class WhatsAppBotManager {
    constructor() {
        this.userClients = new Map(); // user_id -> WhatsApp client
        this.flaskBaseUrl = process.env.FLASK_URL || 'http://localhost:5000';
    }

    async initializeUserClient(userId) {
        try {
            // Check if user already has a WhatsApp session
            const response = await axios.get(`${this.flaskBaseUrl}/get_whatsapp_session?user_id=${userId}`);
            
            if (response.data.session && response.data.session.ready) {
                console.log(`User ${userId} already has WhatsApp session`);
                return true;
            }

            // Use RemoteAuth instead of LocalAuth
            const client = new Client({
                authStrategy: new RemoteAuth({
                    store: store, // You'll need to set this up
                    backupSyncIntervalMs: 300000,
                    clientId: `user-${userId}`
                }),
                puppeteer: {
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                }
            });

            // Set up event handlers for this user's client
            client.on('qr', async (qr) => {
                console.log(`QR for user ${userId}:`);
                qrcode.generate(qr, { small: true });
                
                // Send QR code to Flask app to display to user
                await axios.post(`${this.flaskBaseUrl}/qr_code`, {
                    user_id: userId,
                    qr_code: qr
                });
            });

            client.on('ready', async () => {
                console.log(`WhatsApp client ready for user ${userId}`);
                
                // Mark user's WhatsApp as ready
                await axios.post(`${this.flaskBaseUrl}/save_whatsapp_session`, {
                    user_id: userId,
                    client_id: clientId,
                    ready: true
                });
            });

            client.on('message', async (message) => {
                await this.handleUserMessage(userId, message);
            });

            client.on('auth_failure', (msg) => {
                console.error(`Auth failure for user ${userId}:`, msg);
            });

            client.on('disconnected', (reason) => {
                console.log(`Client disconnected for user ${userId}:`, reason);
                this.userClients.delete(userId);
            });

            client.on('remote_session_saved', async () => {
                console.log(`Remote session saved for user ${userId}`);
                await axios.post(`${this.flaskBaseUrl}/save_whatsapp_session`, {
                    user_id: userId,
                    ready: true
                });
            });

            // Store client and initialize
            this.userClients.set(userId, client);
            await client.initialize();

            return false; // New session created

        } catch (error) {
            console.error(`Error initializing user ${userId}:`, error);
            throw error;
        }
    }

    async handleUserMessage(userId, message) {
        try {
            // Ignore group messages and status messages
            if (message.from === 'status@broadcast' || message.fromMe || message.isGroup) {
                return;
            }

            const messageBody = message.body;
            console.log(`Message from user ${userId}: ${messageBody}`);

            // Send message to Flask app for processing
            const response = await axios.post(`${this.flaskBaseUrl}/send_message`, {
                message: messageBody,
                session_id: userId, // Use user_id as session_id
                user_id: userId
            });

            // Send response back via WhatsApp
            if (response.data && response.data.bot_message) {
                await this.userClients.get(userId).sendMessage(message.from, response.data.bot_message);
            }

        } catch (error) {
            console.error(`Error handling message for user ${userId}:`, error);
        }
    }

    async sendMessageToUser(userId, recipientNumber, message) {
        try {
            const client = this.userClients.get(userId);
            if (client) {
                const chatId = `${recipientNumber}@c.us`;
                await client.sendMessage(chatId, message);
                return true;
            }
            return false;
        } catch (error) {
            console.error(`Error sending message for user ${userId}:`, error);
            return false;
        }
    }

    getUserClientStatus(userId) {
        const client = this.userClients.get(userId);
        return client ? 'connected' : 'disconnected';
    }

    async logoutUser(userId) {
        try {
            const client = this.userClients.get(userId);
            if (client) {
                await client.destroy();
                this.userClients.delete(userId);
                
                // Update database
                await axios.post(`${this.flaskBaseUrl}/save_whatsapp_session`, {
                    user_id: userId,
                    ready: false
                });
            }
            return true;
        } catch (error) {
            console.error(`Error logging out user ${userId}:`, error);
            return false;
        }
    }
}

// Create and export singleton instance
const botManager = new WhatsAppBotManager();
module.exports = botManager;

// Start the bot manager if this file is run directly
if (require.main === module) {
    console.log('🤖 Starting WhatsApp Bot Manager...');
    
    // This would typically be called by your web interface
    // when a user needs their WhatsApp client initialized
}

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

class MultiUserWhatsAppBot {
    constructor() {
        this.userClients = new Map(); // user_id -> WhatsApp client
        this.userQRs = new Map(); // user_id -> QR code
        this.userStatus = new Map(); // user_id -> status
        this.flaskUrl = process.env.FLASK_URL || 'http://localhost:5000';
        
        console.log('🚀 Starting Multi-User WhatsApp Bot Manager...');
    }
    
    // Add this method to your MultiUserWhatsAppBot class
    async initializeUserClient(userId) {
        try {
            console.log(`🔧 Initializing WhatsApp client for user: ${userId}`);
            
            // Check if user already has a client
            if (this.userClients.has(userId)) {
                const client = this.userClients.get(userId);
                if (this.userStatus.get(userId) === 'connected') {
                    console.log(`✅ User ${userId} already connected`);
                    return client;
                }
            }
    
            return await this.initializeUserClient(userId);
        } catch (error) {
            console.error(`❌ Error initializing client for user ${userId}:`, error);
            throw error;
        }
    }

    setupUserClientEvents(userId, client) {
        // QR Code Event
        client.on('qr', (qr) => {
            console.log(`📱 QR Code for user ${userId}`);
            this.userQRs.set(userId, qr);
            this.userStatus.set(userId, 'waiting_qr');
            
            // Display in terminal
            qrcode.generate(qr, { small: true });
            
            // Send to Flask app for this specific user
            this.sendQRToFlask(userId, qr);
        });

        // Ready Event
        client.on('ready', () => {
            console.log(`✅ WhatsApp Client READY for user ${userId}`);
            this.userStatus.set(userId, 'connected');
            this.userQRs.delete(userId); // Clear QR once connected
            this.updateUserStatus(userId, true);
        });

        // Message Event - Handle incoming messages for this user
        client.on('message', async (message) => {
            await this.handleUserMessage(userId, message);
        });

        // Authentication Events
        client.on('authenticated', () => {
            console.log(`🔐 User ${userId} authenticated`);
        });

        client.on('auth_failure', (msg) => {
            console.error(`❌ Auth failure for user ${userId}:`, msg);
            this.userStatus.set(userId, 'auth_failed');
            this.updateUserStatus(userId, false);
        });

        client.on('disconnected', (reason) => {
            console.log(`🔌 User ${userId} disconnected:`, reason);
            this.userStatus.set(userId, 'disconnected');
            this.userClients.delete(userId);
            this.updateUserStatus(userId, false);
        });
    }

    async sendQRToFlask(userId, qr) {
        try {
            await axios.post(`${this.flaskUrl}/api/user_qr_code`, {
                user_id: userId,
                qr_code: qr,
                timestamp: new Date().toISOString()
            });
            console.log(`📨 QR Code sent to Flask for user ${userId}`);
        } catch (error) {
            console.error(`❌ Failed to send QR for user ${userId}:`, error.message);
        }
    }

    async updateUserStatus(userId, connected) {
        try {
            await axios.post(`${this.flaskUrl}/api/user_whatsapp_status`, {
                user_id: userId,
                connected: connected,
                timestamp: new Date().toISOString()
            });
            console.log(`📊 Status updated for user ${userId}: ${connected ? 'Connected' : 'Disconnected'}`);
        } catch (error) {
            console.error(`❌ Failed to update status for user ${userId}:`, error.message);
        }
    }

    async handleUserMessage(userId, message) {
        // Skip group messages and status messages
        if (message.from === 'status@broadcast' || message.isGroup) {
            return;
        }

        console.log(`📩 Message from user ${userId}'s WhatsApp: ${message.from} - ${message.body}`);

        try {
            // Send message to Flask for processing with user context
            const response = await axios.post(`${this.flaskUrl}/api/user_whatsapp_webhook`, {
                user_id: userId,
                from: message.from,
                message: message.body,
                timestamp: new Date().toISOString()
            });

            // Send response back to the customer
            if (response.data && response.data.reply) {
                await message.reply(response.data.reply);
            }

        } catch (error) {
            console.error(`❌ Error processing message for user ${userId}:`, error.message);
            
            try {
                await message.reply('❌ Desculpe, ocorreu um erro. Tente novamente em alguns instantes.');
            } catch (e) {
                console.error('Failed to send error message:', e.message);
            }
        }
    }

    // Send message from a specific user's WhatsApp
    async sendUserMessage(userId, phoneNumber, message) {
        const client = this.userClients.get(userId);
        if (!client) {
            throw new Error(`No WhatsApp client found for user ${userId}`);
        }

        try {
            const chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
            await client.sendMessage(chatId, message);
            console.log(`✅ Message sent from user ${userId} to ${phoneNumber}`);
            return true;
        } catch (error) {
            console.error(`❌ Failed to send message for user ${userId}:`, error.message);
            return false;
        }
    }

    // Get status for a specific user
    getUserStatus(userId) {
        return {
            connected: this.userStatus.get(userId) === 'connected',
            hasQR: this.userQRs.has(userId),
            qrCode: this.userQRs.get(userId),
            status: this.userStatus.get(userId) || 'unknown'
        };
    }

    // Get all users status (for admin)
    getAllUsersStatus() {
        const status = {};
        for (const [userId] of this.userClients) {
            status[userId] = this.getUserStatus(userId);
        }
        return status;
    }

    // Logout a specific user
    async logoutUser(userId) {
        const client = this.userClients.get(userId);
        if (client) {
            await client.destroy();
            this.userClients.delete(userId);
            this.userQRs.delete(userId);
            this.userStatus.delete(userId);
            console.log(`✅ User ${userId} logged out`);
        }
    }
}

// Create and export the multi-user bot manager
const multiUserBot = new MultiUserWhatsAppBot();

// Handle process events
process.on('SIGINT', async () => {
    console.log('🛑 Shutting down multi-user WhatsApp bot...');
    for (const [userId, client] of multiUserBot.userClients) {
        await client.destroy();
    }
    process.exit(0);
});

module.exports = multiUserBot;

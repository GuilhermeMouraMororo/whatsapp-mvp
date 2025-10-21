const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

// Simple configuration
const config = {
    flaskUrl: process.env.FLASK_URL || 'http://localhost:5000',
    adminPhone: process.env.ADMIN_PHONE || null // Optional: for sending status updates
};

class SimpleWhatsAppBot {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.currentQR = null;
        this.init();
    }

    init() {
        console.log('🚀 Starting WhatsApp Bot...');
        
        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: "whatsapp-bot"
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage'
                ]
            }
        });

        this.setupEventHandlers();
        this.client.initialize();
    }

    setupEventHandlers() {
        // QR Code Event
        this.client.on('qr', (qr) => {
            console.log('📱 QR Code Received!');
            this.currentQR = qr;
            
            // Display in terminal
            qrcode.generate(qr, { small: true });
            
            // Send to Flask app
            this.sendQRToFlask(qr);
        });

        // Ready Event
        this.client.on('ready', () => {
            console.log('✅ WhatsApp Client is Ready!');
            this.isConnected = true;
            this.currentQR = null;
            this.updateFlaskStatus(true);
        });

        // Message Event
        this.client.on('message', async (message) => {
            await this.handleIncomingMessage(message);
        });

        // Authentication Events
        this.client.on('authenticated', () => {
            console.log('🔐 Authenticated Successfully!');
        });

        this.client.on('auth_failure', (msg) => {
            console.error('❌ Authentication Failed:', msg);
            this.updateFlaskStatus(false);
        });

        this.client.on('disconnected', (reason) => {
            console.log('🔌 Disconnected:', reason);
            this.isConnected = false;
            this.updateFlaskStatus(false);
        });
    }

    async sendQRToFlask(qr) {
        try {
            await axios.post(`${config.flaskUrl}/api/qr_code`, {
                qr_code: qr,
                timestamp: new Date().toISOString()
            });
            console.log('📨 QR Code sent to Flask app');
        } catch (error) {
            console.error('❌ Failed to send QR to Flask:', error.message);
        }
    }

    async updateFlaskStatus(connected) {
        try {
            await axios.post(`${config.flaskUrl}/api/whatsapp_status`, {
                connected: connected,
                timestamp: new Date().toISOString()
            });
            console.log(`📊 Status updated: ${connected ? 'Connected' : 'Disconnected'}`);
        } catch (error) {
            console.error('❌ Failed to update status:', error.message);
        }
    }

    async handleIncomingMessage(message) {
        // Skip group messages and status messages
        if (message.from === 'status@broadcast' || message.isGroup) {
            return;
        }

        console.log(`📩 New message from ${message.from}: ${message.body}`);

        try {
            // Send message to Flask for processing
            const response = await axios.post(`${config.flaskUrl}/api/whatsapp_webhook`, {
                from: message.from,
                message: message.body,
                timestamp: new Date().toISOString()
            });

            // Send response back to user
            if (response.data && response.data.reply) {
                await message.reply(response.data.reply);
            }

        } catch (error) {
            console.error('❌ Error processing message:', error.message);
            
            // Send error message to user
            try {
                await message.reply('❌ Desculpe, ocorreu um erro. Tente novamente em alguns instantes.');
            } catch (e) {
                console.error('Failed to send error message:', e.message);
            }
        }
    }

    // Method to send messages (for your order system)
    async sendMessage(phoneNumber, message) {
        if (!this.isConnected) {
            throw new Error('WhatsApp client is not connected');
        }

        try {
            const chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
            await this.client.sendMessage(chatId, message);
            console.log(`✅ Message sent to ${phoneNumber}`);
            return true;
        } catch (error) {
            console.error('❌ Failed to send message:', error.message);
            return false;
        }
    }

    // Get current status
    getStatus() {
        return {
            connected: this.isConnected,
            hasQR: this.currentQR !== null,
            qrCode: this.currentQR
        };
    }
}

// Create and export the bot instance
const whatsappBot = new SimpleWhatsAppBot();

// Handle process events
process.on('SIGINT', async () => {
    console.log('🛑 Shutting down WhatsApp bot...');
    if (whatsappBot.client) {
        await whatsappBot.client.destroy();
    }
    process.exit(0);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled Promise Rejection:', error);
});

module.exports = whatsappBot;

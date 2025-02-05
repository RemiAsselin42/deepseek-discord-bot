require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const express = require('express'); // Importe express pour créer un serveur HTTP
const CUSTOM_PROMPT = require('./prompt');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
    ],
});

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

// Crée une application Express
const app = express();
const PORT = process.env.PORT || 3000; // Heroku définit le port automatiquement

// Route pour "ping" le bot
app.get('/', (req, res) => {
    res.send('Bot is alive!');
});

// Démarre le serveur Express
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

client.once('ready', () => {
    console.log(`Bot connecté en tant que ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const userMessage = message.content;

    try {
        const response = await axios.post(
            DEEPSEEK_API_URL,
            {
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: CUSTOM_PROMPT },
                    { role: 'user', content: userMessage },
                ],
            },
            {
                headers: {
                    'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        const botResponse = response.data.choices[0].message.content;
        message.reply(botResponse);

    } catch (error) {
        console.error('Erreur lors de l\'appel à l\'API DeepSeek:', error);
        message.reply('Désolé, une erreur s\'est produite. Veuillez réessayer plus tard.');
    }
});

client.login(process.env.DISCORD_TOKEN);
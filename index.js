require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,                    // Accès aux informations de base des serveurs
        GatewayIntentBits.GuildMessages,             // Accès aux messages des serveurs
        GatewayIntentBits.MessageContent,            // Accès au contenu des messages
        GatewayIntentBits.GuildMembers,              // Accès aux informations des membres
        GatewayIntentBits.GuildMessageReactions,     // Accès aux réactions des messages
    ]
});

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY; // Utiliser la clé API de l'environnement
const DEEPSEEK_API_URL = 'https://api.deepseek.com'; // URL de l'API DeepSeek

client.once('ready', () => {
    console.log(`Bot connecté en tant que ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return; // Ignorer les messages des autres bots

    const userMessage = message.content;

    try {
        // Appeler l'API DeepSeek pour obtenir une réponse
        const response = await axios.post(
            DEEPSEEK_API_URL,
            {
                model: 'deepseek-chat', // Modèle à utiliser
                messages: [{ role: 'user', content: userMessage }],
            },
            {
                headers: {
                    'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        const botReply = response.data.choices[0].message.content;
        message.reply(botReply); // Répondre avec la réponse de l'API
    } catch (error) {
        console.error('Erreur lors de la requête à l\'API DeepSeek :', error);
        message.reply('Désolé, une erreur s\'est produite.');
    }
});

client.login(process.env.DISCORD_TOKEN); // Utiliser le token de l'environnement
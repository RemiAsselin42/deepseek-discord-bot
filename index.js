// heroku logs --tail
// heroku restart

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const express = require('express'); // Importe express pour créer un serveur HTTP
const fs = require('fs'); // Pour lire et écrire dans un fichier JSON
const path = require('path'); // Pour gérer les chemins de fichiers
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

// Crée une application Express avec Heroku
const app = express();
const PORT = process.env.PORT || 3000;

// Route pour "ping" le bot
app.get('/', (_req, res) => {
    res.send('Bot is alive!');
});

// Démarre le serveur Express
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

const MESSAGE_HISTORY_FILE = path.join(__dirname, 'messageHistory.json');

let messageHistory = {};
if (fs.existsSync(MESSAGE_HISTORY_FILE)) {
    try {
        const data = fs.readFileSync(MESSAGE_HISTORY_FILE, 'utf-8');
        messageHistory = JSON.parse(data);
    } catch (error) {
        console.error('Erreur lors du chargement de l\'historique des messages:', error);
        messageHistory = {};
    }
}

// Fonction pour sauvegarder l'historique des messages dans le fichier JSON
function saveMessageHistory() {
    if (Object.keys(messageHistory).length === 0) {
        fs.writeFileSync(MESSAGE_HISTORY_FILE, '{}');
    } else {
        fs.writeFileSync(MESSAGE_HISTORY_FILE, JSON.stringify(messageHistory, null, 2));
    }
}

client.once('ready', () => {
    console.log(`Bot connecté en tant que ${client.user.tag}`);
    saveMessageHistory();
    const { REST, Routes } = require('discord.js');

    const commands = [
        {
            name: 'reset-history',
            description: "Supprime l'historique des messages du salon actuel",
        },
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    (async () => {
        try {
            console.log('⏳ Mise à jour des commandes slash...');
            await rest.put(
                Routes.applicationCommands(client.user.id),
                { body: commands }
            );
            console.log('✅ Commandes enregistrées avec succès !');
        } catch (error) {
            console.error('❌ Erreur lors de l\'enregistrement des commandes:', error);
        }
    })();
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'reset-history') {
        console.log('Commande /reset-history reçue');
        if (messageHistory[interaction.channelId]) {
            messageHistory[interaction.channelId] = [];
            saveMessageHistory();
            await interaction.reply('🗑️ Historique des messages réinitialisé avec succès !');
        } else {
            await interaction.reply('⚠️ Aucun historique à supprimer dans ce salon.');
        }
    }
});

const messageQueue = [];
let isProcessingQueue = false;

async function processQueue() {
    if (isProcessingQueue || messageQueue.length === 0) return;

    isProcessingQueue = true;
    const message = messageQueue.shift();

    const userMessage = message.content;
    const userName = message.author.username;

    // Initialise l'historique du salon s'il n'existe pas
    if (!messageHistory[message.channel.id]) {
        messageHistory[message.channel.id] = [];
    }

    // Ajoute le message à l'historique du salon
    const channelHistory = messageHistory[message.channel.id];

    channelHistory.push({
        username: userName,
        message: userMessage,
    });

    // Limite l'historique à 20 messages
    if (channelHistory.length > 20) {
        channelHistory.shift();
    }

    // Récupère le dernier message
    const lastMessage = channelHistory[channelHistory.length - 1];
    const previousMessages = channelHistory.length > 1 ? channelHistory.slice(0, -1) : [{ username: "Système", message: "Début de la conversation." }];

    if (!lastMessage || !lastMessage.message) {
        console.error("Impossible d'envoyer une requête à l'IA : pas de dernier message.");
        message.reply("Je ne peux pas répondre sans contexte, peux-tu reformuler ?");
        isProcessingQueue = false;
        processQueue();
        return;
    }

    saveMessageHistory();

    if (message.mentions.has(client.user)) {
        message.channel.sendTyping();
        const typingInterval = setInterval(() => {
            message.channel.sendTyping();
        }, 9000);

        console.log("Historique actuel :", JSON.stringify(channelHistory, null, 2));

        try {
            const fetchedMessage = await message.channel.messages.fetch(message.id);
            if (!fetchedMessage) {
                console.log('Le message a été supprimé avant que le bot ne puisse répondre.');
                return;
            }

            const context = `
                Contexte facultatif (messages précédents) :
                ${previousMessages.map(entry => `${entry.username} a dit : ${entry.message}`).join('\n')}

                Dernier message (à prendre en compte) :
                ${lastMessage.username} a dit : ${lastMessage.message}
            `;

            console.log('Question de l\'utilisateur:', context);

            const response = await axios.post(DEEPSEEK_API_URL, {
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: CUSTOM_PROMPT },
                    { role: 'user', content: context },
                ],
            }, {
                headers: {
                    'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            });

            const botResponse = response.data.choices[0]?.message?.content;
            console.log('Réponse de l\'API DeepSeek:', botResponse);
            message.reply(botResponse);
        } catch (error) {
            if (error.code === 'ECONNRESET') {
                console.error('Erreur de connexion réinitialisée:', error);
                message.reply('Désolé, une erreur de connexion est survenue. Veuillez réessayer.');
            } else {
                console.error('Erreur lors de la requête à l\'API DeepSeek:', error);
                message.reply('Désolé, une erreur est survenue lors de la requête à l\'API.');
            }
        } finally {
            clearInterval(typingInterval);
            isProcessingQueue = false;
            processQueue();
        }

    } else {
        isProcessingQueue = false;
        console.log('Le message ne mentionne pas le bot:', message.id);
        processQueue();
    }
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    console.log('Nouveau message reçu:', message.id);
    messageQueue.push(message);
    processQueue();
});

client.login(process.env.DISCORD_TOKEN);

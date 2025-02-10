// git add .
// git commit -m "Update index.js"
// git push origin main
// git push heroku main

// heroku logs --tail

// heroku restart

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const path = require('path');
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
    fs.writeFileSync(MESSAGE_HISTORY_FILE, JSON.stringify(messageHistory, null, 2));
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
let currentMessageId = null;
let typingInterval = null;
let currentController = null;

const TARGET_CHANNEL_ID = '1336679504273211504';

async function processQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    while (messageQueue.length > 0) {
        const message = messageQueue.shift();
        currentMessageId = message.id;
        const userMessage = message.content;
        const userName = message.author.username;

        if (!messageHistory[message.channel.id]) {
            messageHistory[message.channel.id] = [];
        }

        const channelHistory = messageHistory[message.channel.id];
        channelHistory.push({ username: userName, message: userMessage });

        if (channelHistory.length > 20) {
            channelHistory.shift();
        }

        saveMessageHistory();

        if (message.mentions.has(client.user)) {
            currentController = new AbortController();
            typingInterval = setInterval(() => {
                message.channel.sendTyping();
            }, 9000);

            try {
                const fetchedMessage = await message.channel.messages.fetch(message.id);
                if (!fetchedMessage) {
                    console.log('Le message a été supprimé avant que le bot ne puisse répondre.');
                    break;
                }
                const context = `Contexte facultatif (messages précédents) :\n${channelHistory.slice(0, -1).map(entry => `${entry.username} a dit : ${entry.message}`).join('\n')}\n\nDernier message (à prendre en compte) :\n${userName} a dit : ${userMessage}`;

                console.log('Question de l\'utilisateur:', context);

                const response = await axios.post(DEEPSEEK_API_URL, {
                    model: 'deepseek-chat',
                    messages: [
                        { role: 'system', content: CUSTOM_PROMPT },
                        { role: 'user', content: context },
                    ],
                }, {
                    signal: currentController.signal,
                    headers: {
                        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: 30000, // Timeout de 40 secondes
                });

                if (response.status < 200 || response.status >= 300) {
                    console.error(`DeepSeek a peut-être planté: statut de la réponse = ${response.status}`);
                    await message.reply('Désolé, le service semble indisponible pour le moment. Réessaie plus tard.');
                    break;
                }

                if (!response.data.choices || response.data.choices.length === 0) {
                    console.error('Réponse vide ou mal formattée de l\'API DeepSeek:', response.data);
                    await message.reply('Désolé, je n\'ai pas pu générer de réponse. Réessaie plus tard.');
                    break;
                }

                const botResponse = response.data.choices[0]?.message?.content || 'Désolé, je ne peux pas répondre pour l\'instant.';
                console.log('Réponse de l\'API DeepSeek:', botResponse);
                await message.reply(botResponse);
            } catch (error) {
                if (error.code === 'ECONNRESET') {
                    console.error('Connexion interrompue par le serveur.');
                    clearInterval(typingInterval);
                    message.retryCount = (message.retryCount || 0) + 1;
                    if (message.retryCount < 3) {
                        messageQueue.unshift(message);
                        isProcessingQueue = false;
                        processQueue();
                        return;
                    } else {
                        await message.reply('Impossible de se connecter au serveur après plusieurs tentatives.');
                        break;
                    }
                }
                console.error('Erreur lors de la requête à l\'API DeepSeek:', error);
                break;
            }
            clearInterval(typingInterval);
        }
    }
    isProcessingQueue = false;
    currentMessageId = null;
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== TARGET_CHANNEL_ID) return;
    console.log(`Message reçu de ${message.author.username}: ${message.content}`);
    messageQueue.push(message);
    await processQueue();
});

client.on('messageUpdate', (oldMessage, newMessage) => {
    if (oldMessage.channel.id !== TARGET_CHANNEL_ID) return;
    // Si le message est déjà dans la file, on le met à jour pour la prochaine requête
    const queueIndex = messageQueue.findIndex(msg => msg.id === oldMessage.id);
    if (queueIndex !== -1) {
        messageQueue[queueIndex] = newMessage;
    }
    // Si on traite le message en cours et qu'il change, on arrête et on relance avec la nouvelle version
    if (isProcessingQueue && oldMessage.id === currentMessageId) {
        console.log('Le message en cours de traitement a été mis à jour. Annulation de la requête.');
        currentController.abort();
        clearInterval(typingInterval);
        // ...arrêter proprement la requête en cours...
        isProcessingQueue = false;
        messageQueue.unshift(newMessage);
        processQueue(); // Relance la requête
    }
});

client.on('messageDelete', (deletedMessage) => {
    if (deletedMessage.channel.id !== TARGET_CHANNEL_ID) return;
    // Si le message est dans la file, on le retire
    const queueIndex = messageQueue.findIndex(msg => msg.id === deletedMessage.id);
    if (queueIndex !== -1) {
        messageQueue.splice(queueIndex, 1);
    }
    // Si on traite ce message en cours, on arrête
    if (isProcessingQueue && deletedMessage.id === currentMessageId) {
        console.log('Le message en cours de traitement a été supprimé. Annulation.');
        currentController.abort();
        clearInterval(typingInterval);
        // ...arrêter proprement la requête en cours...
        isProcessingQueue = false;
    }
});

client.on('error', (error) => {
    console.error('Erreur de connexion:', error);
});

client.login(process.env.DISCORD_TOKEN);

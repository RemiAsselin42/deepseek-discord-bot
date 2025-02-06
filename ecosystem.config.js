module.exports = {
    apps: [
        {
            name: 'discord-bot',
            script: 'index.js',
            watch: true,
            env: {
                NODE_ENV: 'development',
                DISCORD_TOKEN: process.env.DISCORD_TOKEN,
                DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
                PORT: process.env.PORT || 3000
            },
            env_production: {
                NODE_ENV: 'production'
            }
        }
    ]
};
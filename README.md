# RXD Pulse Lottery

Real Telegram Mini App for the weekly RXD lottery.

## Features
- Shared pot across all users
- Players identified by Telegram account
- Buy 5-digit tickets (5 RXD each, max 200)
- Weekly draw every Friday 9 PM Vancouver time
- Winners shown with Telegram usernames
- 80% winner / 10% dev / 10% Radiant split

## Local Testing
```bash
npm install
npm start
```
Then open http://localhost:3000

## Deploy to Render
1. Push this folder to a GitHub repo
2. On Render: New → Web Service
3. Connect the repo
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Add environment variable if needed

## Telegram Setup
1. Create bot with @BotFather
2. Set Menu Button / Mini App URL to your Render URL
3. Users open the bot and tap the button

## Notes
- Current version uses a simple file database (`server/data.json`)
- For production payouts you will need to integrate a Radiant treasury wallet
- Starting balance is 1000 RXD for testing (change in server/index.js)

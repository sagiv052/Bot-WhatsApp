const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// ============================================================
// ====== תצורת הבוט ======
// ============================================================
const CONFIG = {
    ADMINS: [
        '972502206606@c.us', 
        '972532796337@c.us', 
        '972537666983@c.us',
        '972547654321@c.us'
    ],
    PREFIX: '!',
    
    SPAM: {
        MAX_MESSAGES: 5,
        TIME_WINDOW: 20000,
        MAX_WARNINGS: 3,
        WARN_MESSAGES: [
            '⚠️ *אזהרה ראשונה!* אתה שולח יותר מדי הודעות (5 ב-20 שניות). האט!',
            '⚠️ *אזהרה שנייה!* זו אזהרה אחרונה! הודעה נוספת = הרחקה מהקבוצה.',
            '⚠️ *אזהרה שלישית!* הוסרת מהקבוצה על הצפה חוזרת.'
        ],
        KICK_MESSAGE: '🚫 הוסרת מהקבוצה על הצפה חוזרת (3 אזהרות).'
    },
    
    LOGS: {
        ENABLED: true,
        FILE: 'bot-logs.txt'
    }
};

// ============================================================
// ====== מערכת לוגים ======
// ============================================================
function logMessage(text) {
    if (!CONFIG.LOGS.ENABLED) return;
    const timestamp = new Date().toLocaleString('he-IL');
    const logLine = `[${timestamp}] ${text}\n`;
    console.log(logLine.trim());
    try {
        fs.appendFileSync(path.join(__dirname, CONFIG.LOGS.FILE), logLine);
    } catch (e) {}
}

// ============================================================
// ====== מערכת אזהרות ======
// ============================================================
const warningTracker = new Map();

function checkSpam(userId, groupId) {
    const key = `${groupId}_${userId}`;
    const now = Date.now();
    
    if (!warningTracker.has(key)) {
        warningTracker.set(key, { messages: [], warnings: 0 });
    }
    
    const userData = warningTracker.get(key);
    userData.messages = userData.messages.filter(time => now - time < CONFIG.SPAM.TIME_WINDOW);
    userData.messages.push(now);
    
    if (userData.messages.length >= CONFIG.SPAM.MAX_MESSAGES) {
        userData.warnings += 1;
        userData.messages = [];
        const warnCount = userData.warnings;
        const shouldKick = warnCount >= CONFIG.SPAM.MAX_WARNINGS;
        warningTracker.set(key, userData);
        
        logMessage(`⚠️ אזהרה ${warnCount} למשתמש ${userId} בקבוצה ${groupId}`);
        
        return {
            isSpam: true,
            warningCount: warnCount,
            shouldKick: shouldKick,
            message: CONFIG.SPAM.WARN_MESSAGES[Math.min(warnCount - 1, CONFIG.SPAM.WARN_MESSAGES.length - 1)]
        };
    }
    
    warningTracker.set(key, userData);
    return { isSpam: false };
}

// ============================================================
// ====== פונקציות עזר ======
// ============================================================
function isAdmin(contactId) {
    const cleanId = contactId.replace(/@c\.us|@s\.whatsapp\.net/g, '');
    for (const admin of CONFIG.ADMINS) {
        const cleanAdmin = admin.replace(/@c\.us|@s\.whatsapp\.net/g, '');
        if (cleanId === cleanAdmin) {
            return true;
        }
    }
    return false;
}

function isGroupChat(chat) {
    return chat.isGroup;
}

function extractMentionedUser(message) {
    if (message.mentionedIds && message.mentionedIds.length > 0) {
        return message.mentionedIds[0];
    }
    const match = message.body.match(/@?(\d{10,12})/);
    if (match) {
        return match[1] + '@c.us';
    }
    return null;
}

function getTime() {
    return new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
}

function isCommand(msgBody, commandName) {
    const withPrefix = `${CONFIG.PREFIX}${commandName}`;
    const withoutPrefix = commandName;
    return msgBody === withPrefix || msgBody === withoutPrefix || 
           msgBody.startsWith(`${withPrefix} `) || msgBody.startsWith(`${withoutPrefix} `);
}

// ============================================================
// ====== אתחול הבוט ======
// ============================================================
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-blink-features=AutomationControlled',
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-breakpad',
            '--disable-client-side-phishing-detection',
            '--disable-component-extensions-with-background-pages',
            '--disable-default-apps',
            '--disable-extensions',
            '--disable-hang-monitor',
            '--disable-ipc-flooding-protection',
            '--disable-popup-blocking',
            '--disable-prompt-on-repost',
            '--disable-renderer-backgrounding',
            '--disable-sync',
            '--force-color-profile=srgb'
        ]
    }
});

// ============================================================
// ====== אירועי הבוט ======
// ============================================================
client.on('qr', (qr) => {
    console.log('\n📱 סרוק את קוד ה-QR עם וואטסאפ:');
    qrcode.generate(qr, { small: true });
    console.log('\n⏳ ממתין לסריקה...\n');
});

client.on('authenticated', () => {
    logMessage('🔐 הבוט אומת בהצלחה!');
});

client.on('auth_failure', (msg) => {
    logMessage(`❌ אימות נכשל: ${msg}`);
});

client.on('ready', () => {
    logMessage('✅ הבוט מוכן!');
    logMessage('🛡️ מערכת אזהרות פעילה!');
    logMessage(`👥 מנהלים: ${CONFIG.ADMINS.join(', ')}`);
});

client.on('message', async (message) => {
    try {
        if (!message.body) return;
        
        const chat = await message.getChat();
        const msgBody = message.body.trim();
        const senderId = message.author || message.from;
        const prefix = CONFIG.PREFIX;
        
        // ============================================================
        // ====== 1. אנטי-ספאם (רק בקבוצות, לא למנהלים) ======
        // ============================================================
        if (isGroupChat(chat) && !isAdmin(senderId) && !msgBody.startsWith(prefix)) {
            const groupId = chat.id._serialized;
            const spamCheck = checkSpam(senderId, groupId);
            
            if (spamCheck.isSpam) {
                await message.reply(spamCheck.message);
                
                if (spamCheck.shouldKick) {
                    try {
                        await chat.removeParticipants([senderId]);
                        logMessage(`🚫 ${senderId} הוסר מהקבוצה (3 אזהרות)`);
                        
                        try {
                            const contact = await message.getContact();
                            await contact.sendMessage(
                                `🚫 *הוסרת מהקבוצה*\n\n` +
                                `קיבלת 3 אזהרות על הצפה בקבוצה והוסרת אוטומטית.\n` +
                                `📌 כדי לחזור, פנה לאחד המנהלים:\n` +
                                `${CONFIG.ADMINS.join('\n')}`
                            );
                            logMessage(`📩 נשלחה הודעה פרטית ל-${senderId}`);
                        } catch (e) {
                            logMessage(`❌ שגיאה בשליחת הודעה פרטית: ${e}`);
                        }
                        
                        warningTracker.delete(`${groupId}_${senderId}`);
                    } catch (error) {
                        logMessage(`❌ שגיאה בהסרה: ${error}`);
                        await message.reply('❌ שגיאה בהרחקת המשתמש. וודא שהבוט הוא אדמין בקבוצה.');
                    }
                }
                return;
            }
        }
        
        // ============================================================
        // ====== 2. פקודות כלליות (לכולם) ======
        // ============================================================
        if (isCommand(msgBody, 'help') || isCommand(msgBody, 'עזרה')) {
            await message.reply(
                `📋 *תפריט עזרה - הבוט החכם v2.0*\n\n` +
                `🔹 *פקודות כלליות:*\n` +
                `help / עזרה - תפריט עזרה\n` +
                `היי - שלום 👋\n` +
                `מה איתך - מה איתך?\n` +
                `שעה - שעה נוכחית\n` +
                `על הבוט - מידע על הבוט\n` +
                `זמינות - בדיקת זמינות\n\n` +
                `🔸 *פקודות ניהול (למנהלים בלבד):*\n` +
                `סגור - סגירת הקבוצה 🔒\n` +
                `פתח - פתיחת הקבוצה 🔓\n` +
                `הסר @שם - הסרת משתמש\n` +
                `קדם @שם - הפיכת משתמש לאדמין\n` +
                `הורד @שם - הורדת משתמש מאדמין\n` +
                `הזמן - קישור הזמנה לקבוצה\n` +
                `מחק - מחיקת ההודעה האחרונה\n` +
                `סטטיסטיקות - סטטיסטיקות ספאם\n` +
                `אפס ספאם - איפוס מוניטור ספאם`
            );
            return;
        }
        
        if (isCommand(msgBody, 'היי')) {
            const responses = [
                '👋 היי! מה נשמע?',
                '🤗 שלום! איך עובר היום?',
                '😊 היי חבר! שמח לראות אותך.',
                '🌟 שלום! מה שלומך?'
            ];
            await message.reply(responses[Math.floor(Math.random() * responses.length)]);
            return;
        }
        
        if (isCommand(msgBody, 'מה איתך')) {
            const responses = [
                '😊 אני בסדר תודה! איך אתה?',
                '🤖 אני מרגיש מעולה! מריץ הודעות כמו שצריך.',
                '💪 הכל טוב! בוט חזק ומתפקד.',
                '🌟 מצוין! תודה ששאלת.'
            ];
            await message.reply(responses[Math.floor(Math.random() * responses.length)]);
            return;
        }
        
        if (isCommand(msgBody, 'שעה')) {
            await message.reply(`🕐 *שעה נוכחית:* ${getTime()}`);
            return;
        }
        
        if (isCommand(msgBody, 'על הבוט')) {
            await message.reply(
                `🤖 *בוט ניהול חכם*\n\n` +
                `📌 *גרסה:* 2.0\n` +
                `🛡️ *אנטי-ספאם:* 5 הודעות ב-20 שניות → 3 אזהרות → הרחקה\n` +
                `👥 *מנהלים:* ${CONFIG.ADMINS.length} מוגדרים\n` +
                `🔒 *ניהול קבוצות:* סגירה/פתיחה/הסרה/קידום\n` +
                `📱 *פותח:* שגיב\n` +
                `⚡ *סטטוס:* פעיל ומתפקד!\n` +
                `📝 *לוגים:* ${CONFIG.LOGS.ENABLED ? 'מופעלים' : 'כבויים'}`
            );
            return;
        }
        
        if (isCommand(msgBody, 'זמינות')) {
            const start = Date.now();
            await message.reply('🏓 פונג!');
            const end = Date.now();
            await message.reply(`⏱️ זמן תגובה: ${end - start}ms`);
            return;
        }
        
        // ============================================================
        // ====== 3. פקודות ניהול (למנהלים בלבד) ======
        // ============================================================
        if (!isAdmin(senderId)) {
            return;
        }
        
        // 3.1 סגירת/פתיחת קבוצה
        if (isCommand(msgBody, 'סגור') || isCommand(msgBody, 'פתח')) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            
            const isClosing = isCommand(msgBody, 'סגור');
            await chat.setMessagesAdminsOnly(isClosing);
            await message.reply(`✅ הקבוצה ${isClosing ? '🔒 נסגרה' : '🔓 נפתחה'}. ${isClosing ? 'רק אדמינים יכולים לשלוח.' : 'כולם יכולים לשלוח.'}`);
            logMessage(`${senderId} ${isClosing ? 'סגר' : 'פתח'} את הקבוצה ${chat.id._serialized}`);
            return;
        }
        
        // 3.2 הסרת משתמש
        if (isCommand(msgBody, 'הסר')) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            
            const targetId = extractMentionedUser(message);
            if (!targetId) {
                await message.reply('⚠️ יש לציין משתמש להסרה. דוגמה: הסר @0521234567');
                return;
            }
            
            try {
                await chat.removeParticipants([targetId]);
                await message.reply(`✅ המשתמש הוסר מהקבוצה.`);
                const groupId = chat.id._serialized;
                warningTracker.delete(`${groupId}_${targetId}`);
                logMessage(`${senderId} הסיר את ${targetId} מהקבוצה`);
            } catch (error) {
                await message.reply(`❌ שגיאה בהסרה: ${error.message}`);
            }
            return;
        }
        
        // 3.3 הפיכת משתמש לאדמין
        if (isCommand(msgBody, 'קדם')) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            
            const targetId = extractMentionedUser(message);
            if (!targetId) {
                await message.reply('⚠️ יש לציין משתמש לקידום. דוגמה: קדם @0521234567');
                return;
            }
            
            try {
                await chat.promoteParticipants([targetId]);
                await message.reply(`✅ המשתמש הפך לאדמין.`);
                logMessage(`${senderId} קידם את ${targetId} לאדמין`);
            } catch (error) {
                await message.reply(`❌ שגיאה בקידום: ${error.message}`);
            }
            return;
        }
        
        // 3.4 הורדת משתמש מאדמין
        if (isCommand(msgBody, 'הורד')) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            
            const targetId = extractMentionedUser(message);
            if (!targetId) {
                await message.reply('⚠️ יש לציין משתמש להורדה. דוגמה: הורד @0521234567');
                return;
            }
            
            try {
                await chat.demoteParticipants([targetId]);
                await message.reply(`✅ המשתמש הורד מאדמין.`);
                logMessage(`${senderId} הוריד את ${targetId} מאדמין`);
            } catch (error) {
                await message.reply(`❌ שגיאה בהורדה: ${error.message}`);
            }
            return;
        }
        
        // 3.5 קישור הזמנה
        if (isCommand(msgBody, 'הזמן')) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            
            try {
                const inviteCode = await chat.getInviteCode();
                const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
                await message.reply(`🔗 *קישור הזמנה:*\n${inviteLink}`);
                logMessage(`${senderId} ביקש קישור הזמנה לקבוצה`);
            } catch (error) {
                await message.reply(`❌ שגיאה ביצירת קישור: ${error.message}`);
            }
            return;
        }
        
        // 3.6 מחיקת ההודעה האחרונה
        if (isCommand(msgBody, 'מחק')) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            
            try {
                const messages = await chat.fetchMessages({ limit: 2 });
                if (messages.length < 2) {
                    await message.reply('❌ לא נמצאו הודעות למחיקה.');
                    return;
                }
                const lastMsg = messages[1]; // ההודעה האחרונה (לא הפקודה עצמה)
                await lastMsg.delete(true);
                await message.reply('✅ ההודעה האחרונה נמחקה.');
                logMessage(`${senderId} מחק הודעה בקבוצה`);
            } catch (error) {
                await message.reply(`❌ שגיאה במחיקה: ${error.message}`);
            }
            return;
        }
        
        // 3.7 סטטיסטיקות ספאם
        if (isCommand(msgBody, 'סטטיסטיקות')) {
            let stats = `📊 *סטטיסטיקות אנטי-ספאם*\n\n`;
            let totalUsers = 0;
            let totalWarnings = 0;
            
            for (const [, data] of warningTracker) {
                totalUsers++;
                totalWarnings += data.warnings;
            }
            
            stats += `👥 משתמשים במעקב: ${totalUsers}\n`;
            stats += `⚠️ סך אזהרות: ${totalWarnings}\n`;
            stats += `⚙️ סף אזהרה: ${CONFIG.SPAM.MAX_MESSAGES} הודעות ב-${CONFIG.SPAM.TIME_WINDOW/1000} שניות\n`;
            stats += `🔢 אזהרות להרחקה: ${CONFIG.SPAM.MAX_WARNINGS}`;
            
            await message.reply(stats);
            return;
        }
        
        // 3.8 איפוס מוניטור ספאם
        if (isCommand(msgBody, 'אפס ספאם')) {
            warningTracker.clear();
            await message.reply('✅ כל נתוני הספאם אופסו.');
            logMessage(`${senderId} איפס את מוניטור הספאם`);
            return;
        }
        
        // 3.9 פקודה לא מוכרת למנהל - שותקים
        if (msgBody.startsWith(prefix)) {
            return;
        }
        
    } catch (error) {
        logMessage(`❌ שגיאה כללית: ${error}`);
        try {
            await message.reply('❌ אירעה שגיאה, נסה שוב.');
        } catch (e) {}
    }
});

// ============================================================
// ====== סגירת הבוט ======
// ============================================================
process.on('SIGINT', async () => {
    logMessage('🛑 סוגר את הבוט...');
    await client.destroy();
    process.exit(0);
});

// ============================================================
// ====== הרצה ======
// ============================================================
console.log('🚀 מפעיל את הבוט...');
console.log('🛡️ מערכת אזהרות מופעלת:');
console.log(`   📌 ${CONFIG.SPAM.MAX_MESSAGES} הודעות ב-${CONFIG.SPAM.TIME_WINDOW/1000} שניות → אזהרה`);
console.log(`   ⚠️ ${CONFIG.SPAM.MAX_WARNINGS} אזהרות → הרחקה אוטומטית`);
console.log(`   👥 מנהלים: ${CONFIG.ADMINS.join(', ')}`);
console.log(`   📝 לוגים: ${CONFIG.LOGS.ENABLED ? 'מופעלים' : 'כבויים'}`);
client.initialize();

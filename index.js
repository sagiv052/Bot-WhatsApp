const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// ============================================================
// ====== קובץ מנהלים ======
// ============================================================
const ADMINS_FILE = path.join(__dirname, 'admins.json');

function loadAdmins() {
    try {
        if (fs.existsSync(ADMINS_FILE)) {
            const data = fs.readFileSync(ADMINS_FILE, 'utf8');
            const parsed = JSON.parse(data);
            return parsed.admins || [];
        }
    } catch (error) {
        console.error('❌ שגיאה בקריאת קובץ המנהלים:', error);
    }
    return [
        '278945811427515@lid',
        '203216914501715@lid',
        '972502206606@c.us', 
        '972532796337@c.us', 
        '972537666983@c.us',
        '972547654321@c.us'
    ];
}

function saveAdmins(admins) {
    try {
        fs.writeFileSync(ADMINS_FILE, JSON.stringify({ admins }, null, 2));
        return true;
    } catch (error) {
        console.error('❌ שגיאה בשמירת קובץ המנהלים:', error);
        return false;
    }
}

let ADMINS_LIST = loadAdmins();

// ============================================================
// ====== קובץ תזמונים ======
// ============================================================
const SCHEDULE_FILE = path.join(__dirname, 'schedule.json');

function loadSchedule() {
    try {
        if (fs.existsSync(SCHEDULE_FILE)) {
            const data = fs.readFileSync(SCHEDULE_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('❌ שגיאה בקריאת קובץ התזמונים:', error);
    }
    return {
        enabled: false,
        closeTime: '22:00',
        openTime: '08:00',
        groupId: null,
        active: false
    };
}

function saveSchedule(schedule) {
    try {
        fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(schedule, null, 2));
        return true;
    } catch (error) {
        console.error('❌ שגיאה בשמירת קובץ התזמונים:', error);
        return false;
    }
}

let scheduleConfig = loadSchedule();

// ============================================================
// ====== תצורת הבוט ======
// ============================================================
const CONFIG = {
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
    const cleanId = contactId.replace(/@c\.us|@s\.whatsapp\.net|@lid/g, '');
    for (const admin of ADMINS_LIST) {
        const cleanAdmin = admin.replace(/@c\.us|@s\.whatsapp\.net|@lid/g, '');
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

function getCurrentTime() {
    const now = new Date();
    return now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
}

function isCommand(msgBody, commandName) {
    const withPrefix = `${CONFIG.PREFIX}${commandName}`;
    const withoutPrefix = commandName;
    return msgBody === withPrefix || msgBody === withoutPrefix || 
           msgBody.startsWith(`${withPrefix} `) || msgBody.startsWith(`${withoutPrefix} `);
}

// ============================================================
// ====== פונקציות תזמון ======
// ============================================================
async function checkSchedule(client) {
    if (!scheduleConfig.enabled || !scheduleConfig.groupId) {
        return;
    }

    const currentTime = getCurrentTime();
    const closeTime = scheduleConfig.closeTime;
    const openTime = scheduleConfig.openTime;

    try {
        const chat = await client.getChatById(scheduleConfig.groupId);
        if (!chat) return;

        // בדיקה אם הגיע זמן סגירה
        if (currentTime === closeTime && !scheduleConfig.active) {
            await chat.setMessagesAdminsOnly(true);
            scheduleConfig.active = true;
            saveSchedule(scheduleConfig);
            logMessage(`🔒 הקבוצה נסגרה אוטומטית בשעה ${closeTime}`);
            await client.sendMessage(scheduleConfig.groupId, `🔒 *הקבוצה נסגרה אוטומטית* (${closeTime})`);
        }
        // בדיקה אם הגיע זמן פתיחה
        else if (currentTime === openTime && scheduleConfig.active) {
            await chat.setMessagesAdminsOnly(false);
            scheduleConfig.active = false;
            saveSchedule(scheduleConfig);
            logMessage(`🔓 הקבוצה נפתחה אוטומטית בשעה ${openTime}`);
            await client.sendMessage(scheduleConfig.groupId, `🔓 *הקבוצה נפתחה אוטומטית* (${openTime})`);
        }
    } catch (error) {
        logMessage(`❌ שגיאה בבדיקת תזמון: ${error}`);
    }
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
    logMessage(`👥 מנהלים: ${ADMINS_LIST.join(', ')}`);
    
    // התחלת בדיקות תזמון
    setInterval(() => checkSchedule(client), 30000); // כל 30 שניות
    logMessage('⏰ מערכת תזמון פעילה!');
});

client.on('message', async (message) => {
    try {
        if (!message.body) return;
        
        const chat = await message.getChat();
        const msgBody = message.body.trim();
        const senderId = message.author || message.from;
        const prefix = CONFIG.PREFIX;
        
        // ============================================================
        // ====== הצגת מזהה המשתמש (לבדיקה) ======
        // ============================================================
        if (isCommand(msgBody, 'הזהות שלי') || isCommand(msgBody, 'מי אני')) {
            const isAdminStatus = isAdmin(senderId) ? '✅ כן' : '❌ לא';
            await message.reply(
                `📱 *המזהה שלך:*\n${senderId}\n\n` +
                `👑 *מנהל:* ${isAdminStatus}\n\n` +
                `🔍 *רשימת מנהלים:*\n${ADMINS_LIST.join('\n')}`
            );
            return;
        }
        
        // ============================================================
        // ====== הוספת מנהל חדש (למנהלים בלבד) ======
        // ============================================================
        if (isCommand(msgBody, 'הוסף מנהל')) {
            if (!isAdmin(senderId)) {
                await message.reply('⛔ רק מנהל יכול להוסיף מנהלים חדשים!');
                return;
            }
            
            const targetId = extractMentionedUser(message);
            if (!targetId) {
                await message.reply('⚠️ יש לציין משתמש להפוך למנהל. דוגמה: הוסף מנהל @0521234567');
                return;
            }
            
            if (isAdmin(targetId)) {
                await message.reply('✅ המשתמש כבר מנהל.');
                return;
            }
            
            ADMINS_LIST.push(targetId);
            if (saveAdmins(ADMINS_LIST)) {
                await message.reply(`✅ המשתמש ${targetId} הוסף כמנהל!`);
                logMessage(`${senderId} הוסיף את ${targetId} כמנהל`);
            } else {
                await message.reply('❌ שגיאה בשמירת הקובץ.');
            }
            return;
        }
        
        // ============================================================
        // ====== הסרת מנהל (למנהלים בלבד) ======
        // ============================================================
        if (isCommand(msgBody, 'הסר מנהל')) {
            if (!isAdmin(senderId)) {
                await message.reply('⛔ רק מנהל יכול להסיר מנהלים!');
                return;
            }
            
            const targetId = extractMentionedUser(message);
            if (!targetId) {
                await message.reply('⚠️ יש לציין משתמש להסיר ממנהלים. דוגמה: הסר מנהל @0521234567');
                return;
            }
            
            if (targetId === senderId) {
                await message.reply('❌ אתה לא יכול להסיר את עצמך ממנהלים!');
                return;
            }
            
            if (!isAdmin(targetId)) {
                await message.reply('❌ המשתמש לא מנהל.');
                return;
            }
            
            ADMINS_LIST = ADMINS_LIST.filter(id => id !== targetId);
            if (saveAdmins(ADMINS_LIST)) {
                await message.reply(`✅ המשתמש ${targetId} הוסר ממנהלים.`);
                logMessage(`${senderId} הסיר את ${targetId} ממנהלים`);
            } else {
                await message.reply('❌ שגיאה בשמירת הקובץ.');
            }
            return;
        }
        
        // ============================================================
        // ====== הגדרת תזמון (למנהלים בלבד) ======
        // ============================================================
        if (isCommand(msgBody, 'תזמן')) {
            if (!isAdmin(senderId)) {
                await message.reply('⛔ רק מנהל יכול להגדיר תזמון!');
                return;
            }
            
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            
            // פורמט: תזמן 22:00-08:00
            const match = msgBody.match(/תזמן\s+(\d{2}:\d{2})-(\d{2}:\d{2})/);
            if (!match) {
                await message.reply('⚠️ פורמט לא תקין. דוגמה: תזמן 22:00-08:00');
                return;
            }
            
            const closeTime = match[1];
            const openTime = match[2];
            
            // בדיקת תקינות השעות
            const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
            if (!timeRegex.test(closeTime) || !timeRegex.test(openTime)) {
                await message.reply('⚠️ יש להזין שעות בפורמט HH:MM (לדוגמה 22:00)');
                return;
            }
            
            scheduleConfig = {
                enabled: true,
                closeTime: closeTime,
                openTime: openTime,
                groupId: chat.id._serialized,
                active: false
            };
            
            if (saveSchedule(scheduleConfig)) {
                await message.reply(
                    `✅ *תזמון נשמר!*\n\n` +
                    `🔒 זמן סגירה: ${closeTime}\n` +
                    `🔓 זמן פתיחה: ${openTime}\n\n` +
                    `📌 הבוט יסגור את הקבוצה אוטומטית ב-${closeTime} ויפתח ב-${openTime}.`
                );
                logMessage(`${senderId} הגדיר תזמון: ${closeTime} - ${openTime}`);
            } else {
                await message.reply('❌ שגיאה בשמירת התזמון.');
            }
            return;
        }
        
        // ============================================================
        // ====== ביטול תזמון ======
        // ============================================================
        if (isCommand(msgBody, 'בטל תזמון')) {
            if (!isAdmin(senderId)) {
                await message.reply('⛔ רק מנהל יכול לבטל תזמון!');
                return;
            }
            
            scheduleConfig = {
                enabled: false,
                closeTime: '22:00',
                openTime: '08:00',
                groupId: null,
                active: false
            };
            
            if (saveSchedule(scheduleConfig)) {
                await message.reply('✅ התזמון בוטל.');
                logMessage(`${senderId} ביטל את התזמון`);
            } else {
                await message.reply('❌ שגיאה בביטול התזמון.');
            }
            return;
        }
        
        // ============================================================
        // ====== הצגת תזמון ======
        // ============================================================
        if (isCommand(msgBody, 'תזמון')) {
            if (!scheduleConfig.enabled) {
                await message.reply('❌ אין תזמון פעיל כרגע.');
                return;
            }
            
            await message.reply(
                `⏰ *תזמון פעיל:*\n\n` +
                `🔒 סגירה: ${scheduleConfig.closeTime}\n` +
                `🔓 פתיחה: ${scheduleConfig.openTime}\n` +
                `📌 סטטוס: ${scheduleConfig.active ? '🔒 סגורה' : '🔓 פתוחה'}`
            );
            return;
        }
        
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
                                `${ADMINS_LIST.join('\n')}`
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
                `📋 *תפריט עזרה - הבוט החכם v3.0*\n\n` +
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
                `אפס ספאם - איפוס מוניטור ספאם\n\n` +
                `👑 *ניהול מנהלים:*\n` +
                `הוסף מנהל @שם - הוספת מנהל חדש\n` +
                `הסר מנהל @שם - הסרת מנהל\n\n` +
                `⏰ *תזמון (למנהלים):*\n` +
                `תזמן HH:MM-HH:MM - הגדרת שעות סגירה/פתיחה\n` +
                `בטל תזמון - ביטול תזמון\n` +
                `תזמון - הצגת התזמון הנוכחי\n\n` +
                `🆔 *לבדיקת הרשאות:*\n` +
                `מי אני - הצגת המזהה והאם אתה מנהל`
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
                `🤖 *בוט ניהול חכם v3.0*\n\n` +
                `📌 *גרסה:* 3.0\n` +
                `🛡️ *אנטי-ספאם:* 5 הודעות ב-20 שניות → 3 אזהרות → הרחקה\n` +
                `👥 *מנהלים:* ${ADMINS_LIST.length} מוגדרים\n` +
                `🔒 *ניהול קבוצות:* סגירה/פתיחה/הסרה/קידום\n` +
                `👑 *ניהול מנהלים:* הוסף/הסר דרך פקודה\n` +
                `⏰ *תזמון:* ${scheduleConfig.enabled ? 'פעיל' : 'לא פעיל'}\n` +
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
            try {
                await chat.setMessagesAdminsOnly(isClosing);
                await message.reply(`✅ הקבוצה ${isClosing ? '🔒 נסגרה' : '🔓 נפתחה'}. ${isClosing ? 'רק אדמינים יכולים לשלוח.' : 'כולם יכולים לשלוח.'}`);
                logMessage(`${senderId} ${isClosing ? 'סגר' : 'פתח'} את הקבוצה ${chat.id._serialized}`);
            } catch (error) {
                await message.reply(`❌ שגיאה: ${error.message}. וודא שהבוט הוא אדמין בקבוצה.`);
            }
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
                const lastMsg = messages[1];
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
console.log(`   👥 מנהלים: ${ADMINS_LIST.join(', ')}`);
console.log(`   📝 לוגים: ${CONFIG.LOGS.ENABLED ? 'מופעלים' : 'כבויים'}`);
console.log(`   ⏰ תזמון: ${scheduleConfig.enabled ? 'פעיל' : 'לא פעיל'}`);
console.log('   🆔 שלח "מי אני" כדי לבדוק את המזהה שלך');
console.log('   👑 שלח "הוסף מנהל @שם" כדי להוסיף מנהל חדש');
console.log('   ⏰ שלח "תזמן HH:MM-HH:MM" להגדרת שעות');
client.initialize();

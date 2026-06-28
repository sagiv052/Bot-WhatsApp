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
// ====== קובץ קבוצות מנוהלות ======
// ============================================================
const GROUPS_FILE = path.join(__dirname, 'groups.json');

function loadGroups() {
    try {
        if (fs.existsSync(GROUPS_FILE)) {
            const data = fs.readFileSync(GROUPS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('❌ שגיאה בקריאת קובץ הקבוצות:', error);
    }
    return {};
}

function saveGroups(groups) {
    try {
        fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2));
        return true;
    } catch (error) {
        console.error('❌ שגיאה בשמירת קובץ הקבוצות:', error);
        return false;
    }
}

let GROUPS_LIST = loadGroups();

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
        closeTime: null,
        openTime: null,
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
// ====== חוקי הקבוצה ======
// ============================================================
const RULES = `📜 *חוקי הקבוצה - קראו בעיון!* 📜

1️⃣ 🚫 *אין להציף בהודעות!* 
אם מישהו מספים, הבוט יתן לו 3 אזהרות ויעיף אותו אוטומטית!

2️⃣ ⏳ *המתנה בין בקשות* - אין לבקש דברים שוב ושוב. יש להמתין לפחות 5 דקות בין בקשה לבקשה.

3️⃣ 😡 *אין לשלוח סטיקרים* - שליחת סטיקרים אינה מותרת בקבוצה זו.

4️⃣ 🗣️ *אין לדבר בצ'אט* - הצ'אט מיועד להודעות חשובות בלבד, לא לשיחות חולין.

5️⃣ 🔗 *אין לשתף קישורים ללא קרדיט* - שיתוף קישורים ללא קרדיט ליוצר המקורי אסור.

6️⃣ ❌ *אין לפנות למנהלים אחרי ההסרה!* 
מי שיוסר מהקבוצה - לא יפנה למנהלים, ולא יחזור לקבוצה.

⚠️ *הערה חשובה:* מי שיעבור על החוקים יוסר *מכל הקבוצות*! אל תנסו אותנו!`;

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

function isValidTime(timeStr) {
    const regex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    return regex.test(timeStr);
}

function addMinutes(timeStr, minutes) {
    const [hours, mins] = timeStr.split(':').map(Number);
    const totalMins = hours * 60 + mins + minutes;
    const newHours = Math.floor(totalMins / 60) % 24;
    const newMins = totalMins % 60;
    return `${newHours.toString().padStart(2, '0')}:${newMins.toString().padStart(2, '0')}`;
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

    if (!closeTime || !openTime) return;

    try {
        const chat = await client.getChatById(scheduleConfig.groupId);
        if (!chat) return;

        // בדיקה אם הגיע זמן סגירה (טווח של 2 דקות)
        const closeWindowStart = addMinutes(closeTime, -2);
        const closeWindowEnd = addMinutes(closeTime, 2);
        
        if (currentTime >= closeWindowStart && currentTime <= closeWindowEnd && !scheduleConfig.active) {
            await chat.setMessagesAdminsOnly(true);
            scheduleConfig.active = true;
            saveSchedule(scheduleConfig);
            logMessage(`🔒 הקבוצה נסגרה אוטומטית בשעה ${closeTime}`);
            await client.sendMessage(scheduleConfig.groupId, `🔒 *הקבוצה נסגרה אוטומטית* (${closeTime})`);
        }
        // בדיקה אם הגיע זמן פתיחה (טווח של 2 דקות)
        const openWindowStart = addMinutes(openTime, -2);
        const openWindowEnd = addMinutes(openTime, 2);
        
        if (currentTime >= openWindowStart && currentTime <= openWindowEnd && scheduleConfig.active) {
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
    logMessage(`👥 קבוצות מנוהלות: ${Object.keys(GROUPS_LIST).join(', ') || 'אין'}`);
    
    setInterval(() => checkSchedule(client), 30000);
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
        // ====== טיפול במשתמשים רגילים ======
        // ============================================================
        if (!isAdmin(senderId)) {
            // בודקים אם זו קבוצה מנוהלת
            if (isGroupChat(chat)) {
                const groupId = chat.id._serialized;
                if (GROUPS_LIST[groupId]) {
                    // ====== בדיקת ספאם (רק הודעות רגילות, לא פקודות) ======
                    if (!msgBody.startsWith(prefix)) {
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
                                            `📌 *אין לפנות למנהלים!*\n` +
                                            `📞 +972 53-279-6337`
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
                }
            }
            // שאר ההודעות של משתמשים רגילים - מתעלמים
            return;
        }
        
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
        // ====== הצגת מזהה הקבוצה (לבדיקה) ======
        // ============================================================
        if (isCommand(msgBody, 'מזהה קבוצה') || isCommand(msgBody, 'id קבוצה')) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            
            const groupId = chat.id._serialized;
            const isManaged = GROUPS_LIST[groupId] ? '✅ כן' : '❌ לא';
            
            await message.reply(
                `📌 *מזהה הקבוצה:*\n${groupId}\n\n` +
                `📋 *בניהול:* ${isManaged}\n` +
                `📝 *שם קבוצה:* ${chat.name || 'ללא שם'}`
            );
            return;
        }
        
        // ============================================================
        // ====== חוקי הקבוצה ======
        // ============================================================
        if (isCommand(msgBody, 'חוקים') || isCommand(msgBody, 'rules')) {
            await message.reply(RULES);
            return;
        }
        
        // ============================================================
        // ====== הוספת מנהל חדש (למנהלים בלבד) ======
        // ============================================================
        if (isCommand(msgBody, 'הוסף מנהל')) {
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
        // ====== ניהול קבוצות ======
        // ============================================================
        
        // 1. הוספת קבוצה לניהול
        if (isCommand(msgBody, 'הוסף קבוצה')) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            
            const groupId = chat.id._serialized;
            if (GROUPS_LIST[groupId]) {
                await message.reply('✅ הקבוצה כבר בניהול.');
                return;
            }
            
            GROUPS_LIST[groupId] = {
                name: chat.name || 'ללא שם',
                addedAt: new Date().toISOString(),
                addedBy: senderId
            };
            
            if (saveGroups(GROUPS_LIST)) {
                await message.reply(`✅ הקבוצה "${chat.name}" נוספה לניהול!`);
                logMessage(`${senderId} הוסיף את הקבוצה ${groupId} לניהול`);
            } else {
                await message.reply('❌ שגיאה בשמירת הקובץ.');
            }
            return;
        }
        
        // 2. הסרת קבוצה מניהול
        if (isCommand(msgBody, 'הסר קבוצה')) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            
            const groupId = chat.id._serialized;
            if (!GROUPS_LIST[groupId]) {
                await message.reply('❌ הקבוצה לא בניהול.');
                return;
            }
            
            delete GROUPS_LIST[groupId];
            if (saveGroups(GROUPS_LIST)) {
                await message.reply(`✅ הקבוצה הוסרה מניהול.`);
                logMessage(`${senderId} הסיר את הקבוצה ${groupId} מניהול`);
            } else {
                await message.reply('❌ שגיאה בשמירת הקובץ.');
            }
            return;
        }
        
        // 3. רשימת קבוצות מנוהלות
        if (isCommand(msgBody, 'קבוצות')) {
            const groupIds = Object.keys(GROUPS_LIST);
            if (groupIds.length === 0) {
                await message.reply('📌 אין קבוצות בניהול כרגע.');
                return;
            }
            
            let list = '📋 *קבוצות מנוהלות:*\n\n';
            for (const [id, data] of Object.entries(GROUPS_LIST)) {
                list += `📌 *${data.name || 'ללא שם'}*\n`;
                list += `   🆔 ${id}\n`;
                list += `   📅 נוספה: ${new Date(data.addedAt).toLocaleString('he-IL')}\n\n`;
            }
            await message.reply(list);
            return;
        }
        
        // ============================================================
        // ====== פקודות כלליות (למנהלים בלבד) ======
        // ============================================================
        if (isCommand(msgBody, 'help') || isCommand(msgBody, 'עזרה')) {
            await message.reply(
                `📋 *תפריט עזרה - הבוט החכם v3.3*\n\n` +
                `🔹 *פקודות כלליות:*\n` +
                `help / עזרה - תפריט עזרה\n` +
                `היי - שלום 👋\n` +
                `מה איתך - מה איתך?\n` +
                `שעה - שעה נוכחית\n` +
                `על הבוט - מידע על הבוט\n` +
                `זמינות - בדיקת זמינות\n` +
                `חוקים / rules - הצגת חוקי הקבוצה\n\n` +
                `🆔 *זיהוי:*\n` +
                `מי אני - הצגת המזהה שלך וסטטוס מנהל\n` +
                `מזהה קבוצה - הצגת מזהה הקבוצה הנוכחית\n\n` +
                `👑 *ניהול מנהלים:*\n` +
                `הוסף מנהל @שם - הוספת מנהל חדש\n` +
                `הסר מנהל @שם - הסרת מנהל\n\n` +
                `📌 *ניהול קבוצות:*\n` +
                `הוסף קבוצה - הוספת קבוצה לניהול\n` +
                `הסר קבוצה - הסרת קבוצה מניהול\n` +
                `קבוצות - רשימת קבוצות מנוהלות\n\n` +
                `🔸 *פקודות ניהול (בקבוצות מנוהלות):*\n` +
                `סגור - סגירת הקבוצה 🔒\n` +
                `פתח - פתיחת הקבוצה 🔓\n` +
                `הסר @שם - הסרת משתמש\n` +
                `קדם @שם - הפיכת משתמש לאדמין\n` +
                `הורד @שם - הורדת משתמש מאדמין\n` +
                `הזמן - קישור הזמנה לקבוצה\n` +
                `מחק - מחיקת ההודעה האחרונה\n` +
                `סטטיסטיקות - סטטיסטיקות ספאם\n` +
                `אפס ספאם - איפוס מוניטור ספאם\n\n` +
                `⏰ *תזמון (בקבוצות מנוהלות):*\n` +
                `פתיחה HH:MM - הגדרת שעת פתיחה (לבד)\n` +
                `סגירה HH:MM - הגדרת שעת סגירה (לבד)\n` +
                `תזמן HH:MM-HH:MM - הגדרת שתי השעות יחד\n` +
                `בטל תזמון - ביטול תזמון\n` +
                `תזמון - הצגת התזמון הנוכחי`
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
                `🤖 *בוט ניהול חכם v3.3*\n\n` +
                `📌 *גרסה:* 3.3\n` +
                `🛡️ *אנטי-ספאם:* 5 הודעות ב-20 שניות → 3 אזהרות → הרחקה\n` +
                `👥 *מנהלים:* ${ADMINS_LIST.length} מוגדרים\n` +
                `📌 *קבוצות מנוהלות:* ${Object.keys(GROUPS_LIST).length}\n` +
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
        // ====== פקודות ניהול (בקבוצות מנוהלות) ======
        // ============================================================
        
        // 1. סגירת/פתיחת קבוצה
        if (isCommand(msgBody, 'סגור') || isCommand(msgBody, 'פתח')) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            
            const groupId = chat.id._serialized;
            if (!GROUPS_LIST[groupId]) {
                await message.reply('⚠️ הקבוצה לא בניהול. שלח "הוסף קבוצה" קודם.');
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
        
        // 2. הסרת משתמש
        if (isCommand(msgBody, 'הסר')) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            
            const groupId = chat.id._serialized;
            if (!GROUPS_LIST[groupId]) {
                await message.reply('⚠️ הקבוצה לא בניהול. שלח "הוסף קבוצה" קודם.');
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
                const groupId2 = chat.id._serialized;
                warningTracker.delete(`${groupId2}_${targetId}`);
                logMessage(`${senderId} הסיר את ${targetId} מהקבוצה`);
            } catch (error) {
                await message.reply(`❌ שגיאה בהסרה: ${error.message}`);
            }
            return;
        }
        
        // 3. הפיכת משתמש לאדמין
        if (isCommand(msgBody, 'קדם')) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            
            const groupId = chat.id._serialized;
            if (!GROUPS_LIST[groupId]) {
                await message.reply('⚠️ הקבוצה לא בניהול. שלח "הוסף קבוצה" קודם.');
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
        
        // 4. הורדת משתמש מאדמין
        if (isCommand(msgBody, 'הורד')) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            
            const groupId = chat.id._serialized;
            if (!GROUPS_LIST[groupId]) {
                await message.reply('⚠️ הקבוצה לא בניהול. שלח "הוסף קבוצה" קודם.');
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
        
        // 5. קישור הזמנה
        if (isCommand(msgBody, 'הזמן')) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            
            const groupId = chat.id._serialized;
            if (!GROUPS_LIST[groupId]) {
                await message.reply('⚠️ הקבוצה לא בניהול. שלח "הוסף קבוצה" קודם.');
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
        
        // 6. מחיקת ההודעה האחרונה
        if (isCommand(msgBody, 'מחק')) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            
            const groupId = chat.id._serialized;
            if (!GROUPS_LIST[groupId]) {
                await message.reply('⚠️ הקבוצה לא בניהול. שלח "הוסף קבוצה" קודם.');
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
        
        // 7. סטטיסטיקות ספאם
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
        
        // 8. איפוס מוניטור ספאם
        if (isCommand(msgBody, 'אפס ספאם')) {
            warningTracker.clear();
            await message.reply('✅ כל נתוני הספאם אופסו.');
            logMessage(`${senderId} איפס את מוניטור הספאם`);
            return;
        }
        
        // ============================================================
        // ====== הגדרות תזמון (בקבוצות מנוהלות) ======
        // ============================================================
        
        // 1. שעת פתיחה
        if (isCommand(msgBody, 'פתיחה')) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            
            const groupId = chat.id._serialized;
            if (!GROUPS_LIST[groupId]) {
                await message.reply('⚠️ הקבוצה לא בניהול. שלח "הוסף קבוצה" קודם.');
                return;
            }
            
            const parts = msgBody.split(' ');
            if (parts.length !== 2) {
                await message.reply('⚠️ פורמט לא תקין. דוגמה: פתיחה 08:00');
                return;
            }
            
            const timeStr = parts[1];
            if (!isValidTime(timeStr)) {
                await message.reply('⚠️ שעה לא תקינה. יש להזין בפורמט HH:MM (לדוגמה 08:00)');
                return;
            }
            
            scheduleConfig.openTime = timeStr;
            scheduleConfig.groupId = groupId;
            if (!scheduleConfig.closeTime) {
                scheduleConfig.enabled = false;
            } else {
                scheduleConfig.enabled = true;
            }
            
            if (saveSchedule(scheduleConfig)) {
                await message.reply(`✅ *שעת פתיחה נשמרה:* ${timeStr}`);
                logMessage(`${senderId} הגדיר שעת פתיחה: ${timeStr}`);
            } else {
                await message.reply('❌ שגיאה בשמירת התזמון.');
            }
            return;
        }
        
        // 2. שעת סגירה
        if (isCommand(msgBody, 'סגירה')) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            
            const groupId = chat.id._serialized;
            if (!GROUPS_LIST[groupId]) {
                await message.reply('⚠️ הקבוצה לא בניהול. שלח "הוסף קבוצה" קודם.');
                return;
            }
            
            const parts = msgBody.split(' ');
            if (parts.length !== 2) {
                await message.reply('⚠️ פורמט לא תקין. דוגמה: סגירה 22:00');
                return;
            }
            
            const timeStr = parts[1];
            if (!isValidTime(timeStr)) {
                await message.reply('⚠️ שעה לא תקינה. יש להזין בפורמט HH:MM (לדוגמה 22:00)');
                return;
            }
            
            scheduleConfig.closeTime = timeStr;
            scheduleConfig.groupId = groupId;
            if (!scheduleConfig.openTime) {
                scheduleConfig.enabled = false;
            } else {
                scheduleConfig.enabled = true;
            }
            
            if (saveSchedule(scheduleConfig)) {
                await message.reply(`✅ *שעת סגירה נשמרה:* ${timeStr}`);
                logMessage(`${senderId} הגדיר שעת סגירה: ${timeStr}`);
            } else {
                await message.reply('❌ שגיאה בשמירת התזמון.');
            }
            return;
        }
        
        // 3. תזמון מלא
        if (isCommand(msgBody, 'תזמן')) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            
            const groupId = chat.id._serialized;
            if (!GROUPS_LIST[groupId]) {
                await message.reply('⚠️ הקבוצה לא בניהול. שלח "הוסף קבוצה" קודם.');
                return;
            }
            
            const match = msgBody.match(/תזמן\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
            if (!match) {
                await message.reply('⚠️ פורמט לא תקין. דוגמה: תזמן 22:00-08:00');
                return;
            }
            
            const closeTime = match[1];
            const openTime = match[2];
            
            if (!isValidTime(closeTime) || !isValidTime(openTime)) {
                await message.reply('⚠️ שעה לא תקינה. יש להזין בפורמט HH:MM (לדוגמה 22:00-08:00)');
                return;
            }
            
            scheduleConfig = {
                enabled: true,
                closeTime: closeTime,
                openTime: openTime,
                groupId: groupId,
                active: false
            };
            
            if (saveSchedule(scheduleConfig)) {
                await message.reply(
                    `✅ *תזמון נשמר!*\n\n` +
                    `🔒 *שעת סגירה:* ${closeTime}\n` +
                    `🔓 *שעת פתיחה:* ${openTime}`
                );
                logMessage(`${senderId} הגדיר תזמון: ${closeTime} - ${openTime}`);
            } else {
                await message.reply('❌ שגיאה בשמירת התזמון.');
            }
            return;
        }
        
        // 4. ביטול תזמון
        if (isCommand(msgBody, 'בטל תזמון')) {
            scheduleConfig = {
                enabled: false,
                closeTime: null,
                openTime: null,
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
        
        // 5. הצגת תזמון
        if (isCommand(msgBody, 'תזמון')) {
            if (!scheduleConfig.enabled || !scheduleConfig.closeTime || !scheduleConfig.openTime) {
                await message.reply('❌ אין תזמון פעיל כרגע.');
                return;
            }
            
            await message.reply(
                `⏰ *תזמון פעיל:*\n\n` +
                `🔒 *סגירה:* ${scheduleConfig.closeTime}\n` +
                `🔓 *פתיחה:* ${scheduleConfig.openTime}\n` +
                `📌 *סטטוס:* ${scheduleConfig.active ? '🔒 סגורה' : '🔓 פתוחה'}`
            );
            return;
        }
        
        // ============================================================
        // ====== פקודה לא מוכרת ======
        // ============================================================
        if (msgBody.startsWith(prefix) || isCommand(msgBody, '')) {
            // התעלם מפקודות לא מוכרות
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
console.log(`   📌 קבוצות מנוהלות: ${Object.keys(GROUPS_LIST).length}`);
console.log(`   📝 לוגים: ${CONFIG.LOGS.ENABLED ? 'מופעלים' : 'כבויים'}`);
console.log(`   ⏰ תזמון: ${scheduleConfig.enabled ? 'פעיל' : 'לא פעיל'}`);
console.log('   🆔 שלח "מי אני" כדי לבדוק את המזהה שלך');
console.log('   🆔 שלח "מזהה קבוצה" כדי לבדוק את מזהה הקבוצה');
console.log('   👑 שלח "הוסף מנהל @שם" כדי להוסיף מנהל חדש');
console.log('   📌 שלח "הוסף קבוצה" כדי להוסיף קבוצה לניהול');
console.log('   ⏰ שלח "פתיחה HH:MM" או "סגירה HH:MM" להגדרת שעות');
console.log('   📜 שלח "חוקים" כדי להציג את חוקי הקבוצה');
client.initialize();
